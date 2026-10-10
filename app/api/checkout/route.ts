import { getDatabase } from '@/db/database';
import { requireSystemAccess, unauthorizedResponse } from '@/lib/auth';
import {
  calculateChargeCents,
  parseDiscountBasisPoints,
  parseUnitPriceCents,
} from '@/lib/checkout-pricing';
import { ensureFormalImport } from '@/lib/formal-import';
import { initialMembers, parseStoredGameNames, storedGameNames, type Member } from '@/lib/members';

type StoredMember = {
  id: string;
  wechat_id: string;
  game_id: string;
  discount: string;
  balance_cents: number;
};

type CheckoutEntry = {
  memberId: string;
  unitPrice: string;
  quantity: number;
  expectedBalanceCents: number;
  expectedDiscount: string;
};

type ChargedMember = Member & { chargeCents: number };

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!(await requireSystemAccess(request))) return unauthorizedResponse();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse('提交内容格式不正确。', 400);
  }
  if (!input || typeof input !== 'object') {
    return errorResponse('缺少扣费信息。', 400);
  }

  const body = input as Record<string, unknown>;
  const operationId = body.operationId;
  const rawEntries = body.entries;
  if (
    typeof operationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId) ||
    !Array.isArray(rawEntries) ||
    rawEntries.length < 1 ||
    rawEntries.length > 100
  ) {
    return errorResponse('扣费信息不正确。', 400);
  }

  const entries: CheckoutEntry[] = [];
  const ids = new Set<string>();
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== 'object') {
      return errorResponse('扣费信息不正确。', 400);
    }
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.memberId !== 'string' ||
      !entry.memberId ||
      entry.memberId.length > 200 ||
      ids.has(entry.memberId) ||
      typeof entry.unitPrice !== 'string' ||
      parseUnitPriceCents(entry.unitPrice) === null ||
      !Number.isSafeInteger(entry.quantity) ||
      (entry.quantity as number) < 1 ||
      (entry.quantity as number) > 10000 ||
      !Number.isSafeInteger(entry.expectedBalanceCents) ||
      typeof entry.expectedDiscount !== 'string' ||
      !entry.expectedDiscount ||
      entry.expectedDiscount.length > 50
    ) {
      return errorResponse('请核对会员、次数与单价后重试。', 400);
    }
    ids.add(entry.memberId);
    entries.push(entry as CheckoutEntry);
  }

  entries.sort((a, b) => a.memberId.localeCompare(b.memberId));
  const fingerprint = JSON.stringify(entries.map((entry) => ({
    memberId: entry.memberId,
    unitPrice: entry.unitPrice,
    quantity: entry.quantity,
    expectedBalanceCents: entry.expectedBalanceCents,
    expectedDiscount: entry.expectedDiscount,
  })));
  const database = getDatabase();

  try {
    await ensureFormalImport(database);
    const previous = await database
      .prepare('SELECT fingerprint, result_json FROM checkout_operations WHERE id = ?')
      .bind(operationId)
      .first<{ fingerprint: string; result_json: string }>();
    if (previous) {
      return previous.fingerprint === fingerprint
        ? Response.json(JSON.parse(previous.result_json))
        : errorResponse('这次扣费请求与已完成记录不一致，请重新截图结账。', 409);
    }

    const charges: {
      entry: CheckoutEntry;
      member: Member;
      chargeCents: number;
      nextBalanceCents: number;
      initial: boolean;
    }[] = [];
    for (const entry of entries) {
      const initial = initialMembers.find((member) => member.id === entry.memberId);
      if (initial) {
        const deleted = await database
          .prepare('SELECT id FROM deleted_initial_members WHERE id = ?')
          .bind(entry.memberId)
          .first<{ id: string }>();
        if (deleted) return errorResponse('有会员已被删除，请刷新页面后重试。', 409);
      }

      const row = await database
        .prepare(
          `SELECT id, wechat_id, game_id, discount, balance_cents
           FROM member_records WHERE id = ?`,
        )
        .bind(entry.memberId)
        .first<StoredMember>();
      if (!row && !initial) {
        return errorResponse('有会员已被删除，请刷新页面后重试。', 409);
      }
      const member: Member = row
        ? {
            id: row.id,
            wechatId: row.wechat_id,
            ...parseStoredGameNames(row.game_id),
            discount: row.discount,
            balance: row.balance_cents / 100,
          }
        : (initial as Member);
      const currentBalanceCents = row
        ? row.balance_cents
        : Math.round(member.balance * 100);
      if (
        currentBalanceCents !== entry.expectedBalanceCents ||
        member.discount !== entry.expectedDiscount
      ) {
        return errorResponse('会员余额或折扣已变化，请刷新页面后重新结账。', 409);
      }

      const rate = parseDiscountBasisPoints(member.discount);
      const priceCents = parseUnitPriceCents(entry.unitPrice);
      const chargeCents =
        rate !== null && priceCents !== null
          ? calculateChargeCents(priceCents, entry.quantity, rate)
          : null;
      if (chargeCents === null) {
        return errorResponse('有会员的折扣无法计算，或金额过大。', 400);
      }
      const nextBalanceCents = currentBalanceCents - chargeCents;
      if (!Number.isSafeInteger(nextBalanceCents)) {
        return errorResponse('扣费后余额超出支持范围，请核对单价。', 400);
      }
      charges.push({ entry, member, chargeCents, nextBalanceCents, initial: !!initial });
    }

    const chargedMembers: ChargedMember[] = charges.map(({ member, chargeCents, nextBalanceCents }) => ({
      ...member,
      balance: nextBalanceCents / 100,
      chargeCents,
    }));
    const totalCents = charges.reduce((sum, charge) => sum + charge.chargeCents, 0);
    if (!Number.isSafeInteger(totalCents)) {
      return errorResponse('本次合计金额过大，请分次结账。', 400);
    }
    const result = { members: chargedMembers, totalCents };

    const statements: D1PreparedStatement[] = [];
    for (const charge of charges) {
      if (charge.initial) {
        statements.push(
          database.prepare(
            `INSERT OR IGNORE INTO member_records
             (id, wechat_id, game_id, discount, balance_cents, created_at)
             SELECT ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
          ).bind(
            charge.member.id,
            charge.member.wechatId,
            storedGameNames(charge.member),
            charge.member.discount,
            Math.round(charge.member.balance * 100),
            Date.now(),
            charge.member.id,
          ),
        );
      }
    }
    statements.push(
      database.prepare(
        `INSERT INTO checkout_operations (id, fingerprint, result_json, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(operationId, fingerprint, JSON.stringify(result), Date.now()),
    );
    for (const charge of charges) {
      statements.push(
        database.prepare(
          `UPDATE member_records
           SET balance_cents = ?
           WHERE id = ? AND balance_cents = ? AND discount = ?
             AND NOT EXISTS (SELECT 1 FROM deleted_initial_members WHERE id = ?)`,
        ).bind(
          charge.nextBalanceCents,
          charge.entry.memberId,
          charge.entry.expectedBalanceCents,
          charge.entry.expectedDiscount,
          charge.entry.memberId,
        ),
      );
      // A failed or stale update makes this CHECK fail, rolling back the whole batch.
      statements.push(
        database.prepare(
          `INSERT INTO checkout_lines
           (id, operation_id, member_id, charge_cents, old_balance_cents, new_balance_cents, guard)
           VALUES (?, ?, ?, ?, ?, ?, changes())`,
        ).bind(
          crypto.randomUUID(),
          operationId,
          charge.entry.memberId,
          charge.chargeCents,
          charge.entry.expectedBalanceCents,
          charge.nextBalanceCents,
        ),
      );
    }
    await database.batch(statements);
    return Response.json(result);
  } catch (error) {
    console.error('Failed to charge members', error);
    try {
      const previous = await database
        .prepare('SELECT fingerprint, result_json FROM checkout_operations WHERE id = ?')
        .bind(operationId)
        .first<{ fingerprint: string; result_json: string }>();
      if (previous) {
        return previous.fingerprint === fingerprint
          ? Response.json(JSON.parse(previous.result_json))
          : errorResponse('这次扣费请求与已完成记录不一致，请重新截图结账。', 409);
      }
    } catch (lookupError) {
      console.error('Failed to verify checkout outcome', lookupError);
    }
    return errorResponse('扣费未完成，请核对余额后重试。', 409);
  }
}
