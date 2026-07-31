import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../services/rackService.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendLoginOtp, verifyLoginOtp, VastraApiError, VastraRejection } from '../vastraClient.js';

const router = Router();

// Vastra is the identity provider: only people who already exist there can log
// in. No password, no signup, no admin "create org" — the single INSERT into
// `organization` below happens only after Vastra verifies an OTP.

const COUNTRY_CODE = /^\+[0-9]+$/;
const MOBILE = /^[0-9]{6,15}$/;
const OTP = /^[0-9]{3,10}$/;

// The two OTP endpoints are unauthenticated and each one costs Vastra a real
// SMS, so cap them per IP.
// ponytail: in-memory, per-process — move to a shared store if RMS ever runs multiple instances.
const WINDOW_MS = 60_000;
const MAX_HITS = 10;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const hit = hits.get(ip);
  if (!hit || now - hit.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    // Opportunistic sweep so the Map can't grow without bound.
    if (hits.size > 1000) {
      for (const [key, val] of hits) if (now - val.windowStart > WINDOW_MS) hits.delete(key);
    }
    return next();
  }
  if (++hit.count > MAX_HITS) {
    return next(new HttpError(429, 'Too many OTP requests — wait a minute and try again.'));
  }
  next();
}

// Vastra's own rejection message is safe to show (bad OTP, unknown mobile).
// A transport error's raw text is not — it can embed the internal Vastra IP, so
// it goes to the log and the browser gets a generic 502. Same discipline app.js
// already applies to driver errors.
function toHttpError(err, rejectionStatus) {
  if (err instanceof VastraRejection) return new HttpError(rejectionStatus, err.message);
  if (err instanceof VastraApiError) {
    console.error('Vastra call failed:', err.message);
    return new HttpError(502, 'Vastra login service unavailable: please try again in a moment.');
  }
  return err;
}

// POST /api/auth/send-otp — Vastra texts the OTP.
router.post('/send-otp', rateLimit, async (req, res, next) => {
  try {
    const { country_code = '+91', mobile, is_resend = 0 } = req.body || {};
    if (!COUNTRY_CODE.test(String(country_code))) {
      throw new HttpError(400, 'country_code must look like +91');
    }
    if (!MOBILE.test(String(mobile ?? ''))) throw new HttpError(400, 'mobile must be 6–15 digits');

    let message;
    try {
      message = await sendLoginOtp(String(country_code), String(mobile), is_resend ? 1 : 0);
    } catch (err) {
      throw toHttpError(err, 403);
    }
    res.json({ message });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/verify-otp — the only path that can create a session.
router.post('/verify-otp', rateLimit, async (req, res, next) => {
  try {
    const { country_code = '+91', mobile, otp } = req.body || {};
    if (!COUNTRY_CODE.test(String(country_code))) {
      throw new HttpError(400, 'country_code must look like +91');
    }
    if (!MOBILE.test(String(mobile ?? ''))) throw new HttpError(400, 'mobile must be 6–15 digits');
    if (!OTP.test(String(otp ?? ''))) throw new HttpError(400, 'otp must be 3–10 digits');

    let profile;
    try {
      profile = await verifyLoginOtp(String(country_code), String(mobile), String(otp));
    } catch (err) {
      throw toHttpError(err, 401);
    }

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
        [name, String(mobile), profile.access_token, orgId]
      );
    } else {
      // The only INSERT into `organization` in the codebase. Not "creating an
      // account for a stranger": Vastra just vouched for this org via a
      // verified OTP, so we mirror their identity locally to have something for
      // our foreign keys and audit trail to point at.
      const [ins] = await pool.query(
        'INSERT INTO organization (vastra_org_id, name, mobile, vastra_access_token) VALUES (?, ?, ?, ?)',
        [vastraOrgId, name, String(mobile), profile.access_token]
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
    res.json({ token, org: { id: orgId, name } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — the Vastra session dies with ours.
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM session WHERE org_id = ?', [req.org.id]);
    await pool.query('UPDATE organization SET vastra_access_token = NULL WHERE id = ?', [req.org.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — lets the client restore a session on refresh.
router.get('/me', requireAuth, (req, res) => {
  res.json({ id: req.org.id, name: req.org.name });
});

export default router;
