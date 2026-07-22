// Append one audit row inside the caller's transaction connection.
// before/after are plain objects (or null); stored as JSON.
export async function writeAudit(conn, { entityType, entityId, action, before, after, userId = 'system' }) {
  await conn.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, before_json, after_json, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      entityType,
      String(entityId),
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      userId,
    ]
  );
}
