import { getDatabase } from '@/db/database';
import {
  calculateChargeCents,
  parseAdjustmentRateBasisPoints,
  parseUnitPriceCents,
} from '@/lib/checkout-pricing';
import { ensureFormalImport } from '@/lib/formal-import';
import { initialMembers, parseStoredGameNames, storedGameNames, type Member } from '@/lib/members';
import { requireSystemAccess, unauthorizedResponse } from '@/lib/auth';

type StoredMemberRow = {
  id: string;
  wechat_id: string;
  game_id: string;
  discount: string;
  balance_cents: number;
};

const initialMemberIds = new Set(initialMembers.map((member) => member.id));

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function canonicalDiscount(rateBasisPoints: number) {
  return (rateBasisPoints / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

async function updateProfile(
  database: D1Database,
  id: string,
  field: 'wechatId' | 'discount',
  value: string,
  expectedValue: string,
) {
  const initialMember = initialMembers.find((member) => member.id === id);
  if (initialMember) {
    const deleted = await database
      .prepare('SELECT id FROM deleted_initial_members WHERE id = ?')
      .bind(id)
      .first<{ id: string }>();
    if (deleted) return jsonError('没有找到这位会员。', 404);
  }

  const stored = await database
    .prepare(
      `SELECT id, wechat_id, game_id, discount, balance_cents
       FROM member_records WHERE id = ?`,
    )
    .bind(id)
    .first<StoredMemberRow>();
  if (!stored && !initialMember) return jsonError('没有找到这位会员。', 404);

  const currentValue = field === 'wechatId'
    ? (stored?.wechat_id ?? initialMember?.wechatId ?? '')
    : (stored?.discount ?? initialMember?.discount ?? '');
  if (currentValue !== expectedValue) {
    return jsonError('这位会员资料已变化，请刷新页面后重试。', 409);
  }

  const snapshot = stored ?? {
    id: initialMember?.id ?? id,
    wechat_id: initialMember?.wechatId ?? '',
    game_id: initialMember?.gameId ?? '',
    discount: initialMember?.discount ?? '',
    balance_cents: Math.round((initialMember?.balance ?? 0) * 100),
  };
  const names = parseStoredGameNames(snapshot.game_id);
  const updateGameId = field === 'wechatId' && snapshot.wechat_id === names.gameId;
  const column = field === 'wechatId' ? 'wechat_id' : 'discount';
  const statements: D1PreparedStatement[] = [];
  if (initialMember) {
    statements.push(
      database.prepare(
        `INSERT OR IGNORE INTO member_records
         (id, wechat_id, game_id, discount, balance_cents, created_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
      ).bind(
        initialMember.id,
        initialMember.wechatId,
        storedGameNames(initialMember),
        initialMember.discount,
        Math.round(initialMember.balance * 100),
        Date.now(),
        id,
      ),
    );
  }
  statements.push(
    database.prepare(
      `UPDATE member_records SET ${column} = ?${updateGameId ? ', game_id = ?' : ''}
       WHERE id = ? AND ${column} = ?
         AND NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
    ).bind(...(updateGameId ? [value, storedGameNames({ gameId: value, aliases: names.aliases }), id, expectedValue, id] : [value, id, expectedValue, id])),
  );
  const results = await database.batch(statements);
  const updateResult = results.at(-1);
  if ((updateResult?.meta.changes ?? 0) === 0) {
    return jsonError('这位会员资料已变化，请刷新页面后重试。', 409);
  }

  return Response.json({
    member: {
      id,
      wechatId: field === 'wechatId' ? value : snapshot.wechat_id,
      gameId: updateGameId ? value : names.gameId,
      aliases: names.aliases,
      discount: field === 'discount' ? value : snapshot.discount,
      balance: snapshot.balance_cents / 100,
    } satisfies Member,
  });
}

export async function GET(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  try {
    const database = getDatabase();
    await ensureFormalImport(database);
    const result = await database
      .prepare(
        `SELECT id, wechat_id, game_id, discount, balance_cents
         FROM member_records
         ORDER BY created_at ASC`,
      )
      .all<StoredMemberRow>();
    const deletedInitialResult = await database
      .prepare('SELECT id FROM deleted_initial_members')
      .all<{ id: string }>();

    const deletedInitialIds = new Set(
      deletedInitialResult.results.map((row) => row.id),
    );

    const savedMembers: Member[] = result.results.map((row) => ({
      id: row.id,
      wechatId: row.wechat_id,
      ...parseStoredGameNames(row.game_id),
      discount: row.discount,
      balance: row.balance_cents / 100,
    }));

    const savedById = new Map(
      savedMembers.map((member) => [member.id, member]),
    );
    const visibleInitialMembers = initialMembers
      .filter((member) => !deletedInitialIds.has(member.id))
      .map((member) => savedById.get(member.id) ?? member);

    return Response.json({
      members: [
        ...visibleInitialMembers,
        ...savedMembers.filter((member) => !initialMemberIds.has(member.id)),
      ],
    });
  } catch (error) {
    console.error('Failed to load members', error);
    return jsonError('会员数据加载失败，请稍后重试。', 500);
  }
}

export async function PATCH(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return jsonError('提交内容格式不正确。', 400);
  }

  if (!input || typeof input !== 'object') {
    return jsonError('请填写调整金额。', 400);
  }

  const body = input as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';

  try {
    await ensureFormalImport(getDatabase());
  } catch (error) {
    console.error('Failed to import formal members', error);
    return jsonError('正式会员数据加载失败，请稍后重试。', 500);
  }

  if (body.action === 'update-profile') {
    if (!id || id.length > 200) {
      return jsonError('会员编号不正确。', 400);
    }
    const field = body.field;
    const rawValue = typeof body.value === 'string' ? body.value.trim() : '';
    const expectedValue =
      typeof body.expectedValue === 'string' ? body.expectedValue : '';
    if (field !== 'wechatId' && field !== 'discount') {
      return jsonError('要调整的资料不正确。', 400);
    }
    if (!expectedValue) {
      return jsonError('会员资料已变化，请刷新后重试。', 400);
    }
    if (field === 'wechatId') {
      if (!rawValue) return jsonError('请输入新的昵称。', 400);
      if (rawValue.length > 200) return jsonError('昵称不能超过 200 个字符。', 400);
    } else {
      const rate = parseAdjustmentRateBasisPoints(rawValue);
      if (rate === null) return jsonError('折扣须在 0 到 1 之间，最多保留四位小数。', 400);
      const value = canonicalDiscount(rate);
      try {
        return await updateProfile(getDatabase(), id, field, value, expectedValue);
      } catch (error) {
        console.error('Failed to update member discount', error);
        return jsonError('折扣调整失败，请稍后重试。', 500);
      }
    }
    try {
      return await updateProfile(getDatabase(), id, field, rawValue, expectedValue);
    } catch (error) {
      console.error('Failed to update member nickname', error);
      return jsonError('昵称调整失败，请稍后重试。', 500);
    }
  }

  const amountCents =
    typeof body.amount === 'string' ? parseUnitPriceCents(body.amount) : null;
  const adjustmentRateBasisPoints =
    typeof body.adjustmentRate === 'string'
      ? parseAdjustmentRateBasisPoints(body.adjustmentRate)
      : null;
  const direction = body.direction;
  const expectedBalanceCents = body.expectedBalanceCents;

  if (!id || id.length > 200) {
    return jsonError('会员编号不正确。', 400);
  }
  if (amountCents === null || amountCents <= 0) {
    return jsonError('请输入大于 0 的金额，最多保留两位小数。', 400);
  }
  if (adjustmentRateBasisPoints === null) {
    return jsonError('折扣须在 0 到 1 之间，最多保留四位小数。', 400);
  }
  if (direction !== 'increase' && direction !== 'decrease') {
    return jsonError('请选择增加或减少余额。', 400);
  }
  if (
    typeof expectedBalanceCents !== 'number' ||
    !Number.isSafeInteger(expectedBalanceCents)
  ) {
    return jsonError('余额数据不正确，请刷新后重试。', 400);
  }

  const adjustedAmountCents = calculateChargeCents(
    amountCents,
    1,
    adjustmentRateBasisPoints,
  );
  if (adjustedAmountCents === null) {
    return jsonError('金额过大，请输入较小的调整金额。', 400);
  }
  const deltaCents =
    direction === 'increase' ? adjustedAmountCents : -adjustedAmountCents;
  const nextBalanceCents = expectedBalanceCents + deltaCents;
  if (!Number.isSafeInteger(nextBalanceCents)) {
    return jsonError('调整后余额超出支持范围，请输入较小的金额。', 400);
  }

  try {
    const database = getDatabase();
    const initialMember = initialMembers.find((member) => member.id === id);

    if (initialMember) {
      const deleted = await database
        .prepare('SELECT id FROM deleted_initial_members WHERE id = ?')
        .bind(id)
        .first<{ id: string }>();
      if (deleted) return jsonError('没有找到这位会员。', 404);
    }
    const stored = await database
      .prepare(
        `SELECT id, wechat_id, game_id, discount, balance_cents
         FROM member_records WHERE id = ?`,
      )
      .bind(id)
      .first<StoredMemberRow>();
    if (!stored && !initialMember) return jsonError('没有找到这位会员。', 404);
    const currentBalanceCents = stored
      ? stored.balance_cents
      : Math.round((initialMember as Member).balance * 100);
    if (currentBalanceCents !== expectedBalanceCents) {
      return jsonError('这位会员的余额已变化，请刷新页面后重试。', 409);
    }

    const snapshot = stored
      ? {
          wechatId: stored.wechat_id,
          ...parseStoredGameNames(stored.game_id),
          discount: stored.discount,
        }
      : (initialMember as Member);
    const statements: D1PreparedStatement[] = [];
    if (initialMember) {
      statements.push(
        database.prepare(
          `INSERT OR IGNORE INTO member_records
           (id, wechat_id, game_id, discount, balance_cents, created_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
        ).bind(
          initialMember.id,
          initialMember.wechatId,
          storedGameNames(initialMember),
          initialMember.discount,
          Math.round(initialMember.balance * 100),
          Date.now(),
          id,
        ),
      );
    }
    statements.push(
      database.prepare(
        `UPDATE member_records SET balance_cents = ?
         WHERE id = ? AND balance_cents = ?
           AND NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
      ).bind(nextBalanceCents, id, expectedBalanceCents, id),
    );
    // The CHECK guard rolls back the balance update if the history insert cannot follow it.
    statements.push(
      database.prepare(
        `INSERT INTO balance_adjustments
         (id, member_id, wechat_id, game_id, direction, amount_cents,
          rate_basis_points, delta_cents, old_balance_cents, new_balance_cents,
          created_at, guard)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, changes())`,
      ).bind(
        crypto.randomUUID(),
        id,
        snapshot.wechatId,
        snapshot.gameId,
        direction,
        amountCents,
        adjustmentRateBasisPoints,
        deltaCents,
        expectedBalanceCents,
        nextBalanceCents,
        Date.now(),
      ),
    );
    await database.batch(statements);

    const member: Member = {
      id,
      wechatId: snapshot.wechatId,
      gameId: snapshot.gameId,
      aliases: snapshot.aliases,
      discount: snapshot.discount,
      balance: nextBalanceCents / 100,
    };
    return Response.json({ member });
  } catch (error) {
    console.error('Failed to adjust member balance', error);
    return jsonError('余额调整失败，请稍后重试。', 500);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return jsonError('提交内容格式不正确。', 400);
  }

  if (!input || typeof input !== 'object') {
    return jsonError('缺少要删除的会员。', 400);
  }

  const body = input as Record<string, unknown>;
  const id = typeof body.id === 'string' ? body.id.trim() : '';

  if (!id || id.length > 200) {
    return jsonError('会员编号不正确。', 400);
  }

  try {
    const database = getDatabase();

    if (initialMemberIds.has(id)) {
      await database
        .prepare(
          `INSERT OR IGNORE INTO deleted_initial_members (id, deleted_at)
           VALUES (?, ?)`,
        )
        .bind(id, Date.now())
        .run();
    } else {
      const result = await database
        .prepare('DELETE FROM member_records WHERE id = ?')
        .bind(id)
        .run();

      if ((result.meta.changes ?? 0) === 0) {
        return jsonError('没有找到这位会员。', 404);
      }
    }

    return Response.json({ id });
  } catch (error) {
    console.error('Failed to delete member', error);
    return jsonError('删除失败，请稍后重试。', 500);
  }
}

export async function POST(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return jsonError('提交内容格式不正确。', 400);
  }

  if (!input || typeof input !== 'object') {
    return jsonError('请填写完整的会员信息。', 400);
  }

  const body = input as Record<string, unknown>;
  const wechatId =
    typeof body.wechatId === 'string' ? body.wechatId.trim() : '';
  const names = typeof body.gameId === 'string'
    ? parseStoredGameNames(body.gameId)
    : { gameId: '', aliases: [] };
  const gameId = names.gameId;
  const discount =
    typeof body.discount === 'string' ? body.discount.trim() : '';
  const balance = typeof body.balance === 'number' ? body.balance : Number.NaN;
  const balanceCents = Math.round(balance * 100);

  if (!wechatId || !gameId || !discount) {
    return jsonError('请填写完整的会员信息。', 400);
  }

  if (wechatId.length > 200 || [gameId, ...names.aliases].some((name) => name.length > 200) || names.aliases.length > 20 || discount.length > 50) {
    return jsonError('填写内容过长，请缩短后重试。', 400);
  }

  if (!Number.isFinite(balance) || !Number.isSafeInteger(balanceCents)) {
    return jsonError('请输入有效的剩余储值。', 400);
  }

  const member: Member = {
    id: crypto.randomUUID(),
    wechatId,
    gameId,
    aliases: names.aliases,
    discount,
    balance: balanceCents / 100,
  };

  try {
    await getDatabase()
      .prepare(
        `INSERT INTO member_records
         (id, wechat_id, game_id, discount, balance_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        member.id,
        member.wechatId,
        storedGameNames(member),
        member.discount,
        balanceCents,
        Date.now(),
      )
      .run();

    return Response.json({ member }, { status: 201 });
  } catch (error) {
    console.error('Failed to create member', error);
    return jsonError('保存失败，请稍后重试。', 500);
  }
}
