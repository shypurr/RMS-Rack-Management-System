import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { HttpError } from './rackService.js';

// Turning a verified Vastra profile into an RMS session. Extracted from
// routes/auth.js so the OTP path and the QR path cannot drift apart: both call
// this, so single-active-session, the `blocked` check and the token refresh all
// behave identically no matter how you logged in.
//
// The caller is responsible for having actually verified the profile with
// Vastra first. This function trusts what it is given.
export async function establishSession(profile, mobile) {
  const vastraOrgId = String(profile.organization_Id);
  const name = profile.organization_name || `Org ${vastraOrgId}`;

  const [[existing]] = await pool.query(
    'SELECT id, blocked FROM organization WHERE vastra_org_id = ?',
    [vastraOrgId]
  );
  if (existing?.blocked) throw new HttpError(403, 'Account is blocked');

  let orgId;
  if (existing) {
    orgId = existing.id;
    // Refresh all three every login: the token rotates and the org name can
    // change on Vastra's side.
    await pool.query(
      'UPDATE organization SET name = ?, mobile = ?, vastra_access_token = ? WHERE id = ?',
      [name, mobile == null ? null : String(mobile), profile.access_token, orgId]
    );
  } else {
    // The only INSERT into `organization` in the codebase. Not "creating an
    // account for a stranger": Vastra just vouched for this org, so we mirror
    // their identity locally to have something for our foreign keys and audit
    // trail to point at.
    const [ins] = await pool.query(
      'INSERT INTO organization (vastra_org_id, name, mobile, vastra_access_token) VALUES (?, ?, ?, ?)',
      [vastraOrgId, name, mobile == null ? null : String(mobile), profile.access_token]
    );
    orgId = ins.insertId;
  }

  // One active session per org — logging in anywhere kills the old session.
  const token = randomBytes(32).toString('hex');
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM session WHERE org_id = ?', [orgId]);
    await conn.query('INSERT INTO session (token, org_id) VALUES (?, ?)', [token, orgId]);
  });

  // Never the vastra_access_token — that stays server-side.
  return { token, org: { id: orgId, name } };
}
