import { getDatabase } from '@/db/database';
import { requireSystemAccess, unauthorizedResponse } from '@/lib/auth';
import { ensureFormalImport } from '@/lib/formal-import';

async function currentCardNames(database: D1Database) {
  const rows = await database.prepare('SELECT id, wechat_id FROM member_records').all<{ id: string; wechat_id: string }>();
  return new Map(rows.results.map((row) => [row.id, row.wechat_id]));
}

type StoredOperation = {
  id: string;
  created_at: number;
  result_json: string;
};

type StoredLine = {
  operation_id: string;
  created_at: number;
  result_json: string;
  member_id: string;
  charge_cents: number;
  old_balance_cents: number;
  new_balance_cents: number;
};

type StoredAdjustment = {
  id: string;
  member_id: string;
  wechat_id: string;
  game_id: string;
  direction: 'increase' | 'decrease';
  amount_cents: number;
  rate_basis_points: number;
  delta_cents: number;
  old_balance_cents: number;
  new_balance_cents: number;
  created_at: number;
};

type EventKey = { kind: 'checkout' | 'adjustment'; id: string; createdAt: number; key: string };

function parseHistoryId(value: string): Omit<EventKey, 'createdAt' | 'key'> | null {
  const match = value.match(/^(checkout|adjustment):([0-9a-f-]{36})$/i);
  if (!match) return null;
  return { kind: match[1] as EventKey['kind'], id: match[2] };
}

function compareEvents(a: EventKey, b: EventKey) {
  return a.createdAt - b.createdAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

type ResultMember = {
  id: string;
  wechatId: string;
  gameId: string;
  chargeCents: number;
};

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function readResult(json: string): { members: ResultMember[]; totalCents: number } {
  const result = JSON.parse(json) as { members: ResultMember[]; totalCents: number };
  if (!Array.isArray(result.members) || !Number.isSafeInteger(result.totalCents)) {
    throw new Error('Invalid saved checkout result');
  }
  return result;
}

export async function GET(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  try {
    const database = getDatabase();
    await ensureFormalImport(database);
    const names = await currentCardNames(database);
    const rows = await database
      .prepare(
        `SELECT id, created_at, result_json
         FROM checkout_operations
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC, id DESC`,
      )
      .all<StoredOperation>();
    const adjustments = await database
      .prepare(
        `SELECT id, member_id, wechat_id, game_id, direction, amount_cents,
                rate_basis_points, delta_cents, old_balance_cents,
                new_balance_cents, created_at
         FROM balance_adjustments
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC, id DESC`,
      )
      .all<StoredAdjustment>();
    const checkoutRecords = rows.results.map((row) => {
      const result = readResult(row.result_json);
      return {
        id: `checkout:${row.id}`,
        kind: 'checkout' as const,
        createdAt: row.created_at,
        totalCents: result.totalCents,
        members: result.members.map((member) => ({
          memberId: member.id,
          wechatId: names.get(member.id) ?? member.wechatId,
          chargeCents: member.chargeCents,
        })),
      };
    });
    const adjustmentRecords = adjustments.results.map((row) => ({
      id: `adjustment:${row.id}`,
      kind: 'adjustment' as const,
      createdAt: row.created_at,
      memberId: row.member_id,
      wechatId: names.get(row.member_id) ?? row.wechat_id,
      gameId: row.game_id,
      direction: row.direction,
      amountCents: row.amount_cents,
      rateBasisPoints: row.rate_basis_points,
      deltaCents: row.delta_cents,
      oldBalanceCents: row.old_balance_cents,
      newBalanceCents: row.new_balance_cents,
    }));
    return Response.json({
      records: [...checkoutRecords, ...adjustmentRecords].sort(
        (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
      ),
    });
  } catch (error) {
    console.error('Failed to load checkout history', error);
    return errorResponse('历史记录加载失败，请稍后重试。', 500);
  }
}

export async function POST(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse('提交内容格式不正确。', 400);
  }
  const ids =
    input && typeof input === 'object' && 'ids' in input
      ? (input as { ids: unknown }).ids
      : null;
  if (
    !Array.isArray(ids) ||
    (ids.length !== 1 && ids.length !== 2) ||
    (ids.length === 2 && ids[0] === ids[1]) ||
    ids.some((id) => typeof id !== 'string' || !parseHistoryId(id))
  ) {
    return errorResponse('请选择一条或两条不同的历史记录。', 400);
  }

  try {
    const database = getDatabase();
    await ensureFormalImport(database);
    const names = await currentCardNames(database);
    const anchors: EventKey[] = [];
    for (const value of ids as string[]) {
      const parsed = parseHistoryId(value);
      if (!parsed) return errorResponse('历史记录编号不正确。', 400);
      const table = parsed.kind === 'checkout' ? 'checkout_operations' : 'balance_adjustments';
      const row = await database
        .prepare(`SELECT id, created_at FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
        .bind(parsed.id)
        .first<{ id: string; created_at: number }>();
      if (!row) return errorResponse('选中的历史记录已不存在，请重新选择。', 409);
      anchors.push({ ...parsed, createdAt: row.created_at, key: value });
    }
    const [start, last] = anchors.sort(compareEvents);
    const end = last ?? start;
    const lines = await database
      .prepare(
        `SELECT o.id AS operation_id, o.created_at, o.result_json, l.member_id, l.charge_cents,
                l.old_balance_cents, l.new_balance_cents
         FROM checkout_operations o
         JOIN checkout_lines l ON l.operation_id = o.id
         WHERE o.deleted_at IS NULL
           AND o.created_at BETWEEN ? AND ?
         ORDER BY o.created_at ASC, o.id ASC, l.id ASC`,
      )
      .bind(start.createdAt, end.createdAt)
      .all<StoredLine>();
    const adjustments = await database
      .prepare(
        `SELECT id, member_id, wechat_id, game_id, direction, amount_cents,
                rate_basis_points, delta_cents, old_balance_cents,
                new_balance_cents, created_at
         FROM balance_adjustments
         WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ?
         ORDER BY created_at ASC, id ASC`,
      )
      .bind(start.createdAt, end.createdAt)
      .all<StoredAdjustment>();

    const events = lines.results.map((line) => {
      const savedMember = readResult(line.result_json).members.find(
        (member) => member.id === line.member_id,
      );
      if (!savedMember) throw new Error('Checkout member snapshot is missing');
      const event: EventKey = {
        kind: 'checkout', id: line.operation_id,
        createdAt: line.created_at, key: `checkout:${line.operation_id}`,
      };
      return {
        event,
        memberId: line.member_id,
        wechatId: savedMember.wechatId,
        gameId: savedMember.gameId,
        chargeCents: line.charge_cents,
        adjustmentCents: 0,
        adjustmentCount: 0,
        oldBalanceCents: line.old_balance_cents,
        newBalanceCents: line.new_balance_cents,
      };
    });
    for (const row of adjustments.results) {
      events.push({
        event: {
          kind: 'adjustment', id: row.id,
          createdAt: row.created_at, key: `adjustment:${row.id}`,
        },
        memberId: row.member_id,
        wechatId: row.wechat_id,
        gameId: row.game_id,
        chargeCents: 0,
        adjustmentCents: row.delta_cents,
        adjustmentCount: 1,
        oldBalanceCents: row.old_balance_cents,
        newBalanceCents: row.new_balance_cents,
      });
    }

    const byMember = new Map<string, {
      memberId: string;
      wechatId: string;
      gameId: string;
      chargeCents: number;
      adjustmentCents: number;
      adjustmentCount: number;
      originalBalanceCents: number;
      currentBalanceCents: number;
    }>();
    for (const item of events.filter((entry) =>
      compareEvents(entry.event, start) >= 0 && compareEvents(entry.event, end) <= 0,
    ).sort((a, b) => compareEvents(a.event, b.event))) {
      const current = byMember.get(item.memberId);
      if (current) {
        current.chargeCents += item.chargeCents;
        current.adjustmentCents += item.adjustmentCents;
        current.adjustmentCount += item.adjustmentCount;
        current.currentBalanceCents = item.newBalanceCents;
        current.wechatId = item.wechatId;
        current.gameId = item.gameId;
        if (!Number.isSafeInteger(current.chargeCents) || !Number.isSafeInteger(current.adjustmentCents)) {
          return errorResponse('区间金额过大，请缩小统计范围。', 400);
        }
      } else {
        byMember.set(item.memberId, {
          memberId: item.memberId,
          wechatId: item.wechatId,
          gameId: item.gameId,
          chargeCents: item.chargeCents,
          adjustmentCents: item.adjustmentCents,
          adjustmentCount: item.adjustmentCount,
          originalBalanceCents: item.oldBalanceCents,
          currentBalanceCents: item.newBalanceCents,
        });
      }
    }
    return Response.json({
      startAt: start.createdAt,
      endAt: end.createdAt,
      selectionCount: ids.length,
      members: Array.from(byMember.values()).map((member) => ({
        ...member,
        wechatId: names.get(member.memberId) ?? member.wechatId,
      })),
    });
  } catch (error) {
    console.error('Failed to summarize checkout history', error);
    return errorResponse('统计失败，请稍后重试。', 500);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse('提交内容格式不正确。', 400);
  }
  const ids =
    input && typeof input === 'object' && 'ids' in input
      ? (input as { ids: unknown }).ids
      : null;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 500 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !parseHistoryId(id))
  ) {
    return errorResponse('请选择要删除的历史记录。', 400);
  }

  try {
    const database = getDatabase();
    const byKind = {
      checkout: [] as string[],
      adjustment: [] as string[],
    };
    for (const value of ids as string[]) {
      const parsed = parseHistoryId(value);
      if (!parsed) return errorResponse('历史记录编号不正确。', 400);
      byKind[parsed.kind].push(parsed.id);
    }
    const statements: D1PreparedStatement[] = [];
    for (const kind of ['checkout', 'adjustment'] as const) {
      const values = byKind[kind];
      if (!values.length) continue;
      const table = kind === 'checkout' ? 'checkout_operations' : 'balance_adjustments';
      const placeholders = values.map(() => '?').join(', ');
      statements.push(database
        .prepare(`UPDATE ${table} SET deleted_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`)
        .bind(Date.now(), ...values));
    }
    await database.batch(statements);
    return Response.json({ deletedIds: ids });
  } catch (error) {
    console.error('Failed to delete checkout history', error);
    return errorResponse('删除历史记录失败，请稍后重试。', 500);
  }
}
