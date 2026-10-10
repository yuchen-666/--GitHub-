import { initialMembers, storedGameNames } from './members';

const importId = 'official-members-2026-09-14-v1';

/** Apply the supplied card balances once, not on every deployment or request. */
export async function ensureFormalImport(database: D1Database) {
  const existing = await database
    .prepare('SELECT id FROM formal_imports WHERE id = ?')
    .bind(importId)
    .first<{ id: string }>();
  if (existing) return;

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    database.prepare('INSERT INTO formal_imports (id, imported_at) VALUES (?, ?)').bind(importId, now),
  ];
  for (const member of initialMembers) {
    statements.push(
      database.prepare('DELETE FROM deleted_initial_members WHERE id = ?').bind(member.id),
      database.prepare(
        `INSERT INTO member_records
         (id, wechat_id, game_id, discount, balance_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           wechat_id = excluded.wechat_id,
           game_id = excluded.game_id,
           discount = excluded.discount,
           balance_cents = excluded.balance_cents`,
      ).bind(
        member.id,
        member.wechatId,
        storedGameNames(member),
        member.discount,
        Math.round(member.balance * 100),
        now,
      ),
    );
  }

  try {
    // The unique marker is the first statement. Concurrent imports cannot
    // overwrite a later adjustment or checkout: a duplicate marker rolls
    // back the complete batch.
    await database.batch(statements);
  } catch (error) {
    const completed = await database
      .prepare('SELECT id FROM formal_imports WHERE id = ?')
      .bind(importId)
      .first<{ id: string }>();
    if (!completed) throw error;
  }
}
