// Append one audit row inside the caller's transaction connection.
// before/after are plain objects (or null); stored as JSON.
//
// `orgId` is the tenancy filter and `userId` is the actor. They carry the same
// value today only because Vastra gives us no per-person identity — keeping
// them separate means adding real users later needs no migration.
export async function writeAudit(conn, { orgId, entityType, entityId, action, before, after, userId = 'system' }) {
  if (!orgId) throw new Error('writeAudit requires an orgId');
  await conn.query(
    `INSERT INTO audit_log (fk_org_id, entity_type, entity_id, action, before_json, after_json, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId,
      entityType,
      String(entityId),
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      userId,
    ]
  );
}
