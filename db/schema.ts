import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const memberRecords = sqliteTable('member_records', {
  id: text('id').primaryKey(),
  wechatId: text('wechat_id').notNull(),
  gameId: text('game_id').notNull(),
  discount: text('discount').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const deletedInitialMembers = sqliteTable('deleted_initial_members', {
  id: text('id').primaryKey(),
  deletedAt: integer('deleted_at').notNull(),
});

export const formalImports = sqliteTable('formal_imports', {
  id: text('id').primaryKey(),
  importedAt: integer('imported_at').notNull(),
});

export const checkoutOperations = sqliteTable(
  'checkout_operations',
  {
    id: text('id').primaryKey(),
    fingerprint: text('fingerprint').notNull(),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (table) => [index('idx_checkout_operations_history').on(table.deletedAt, table.createdAt, table.id)],
);

export const checkoutLines = sqliteTable(
  'checkout_lines',
  {
    id: text('id').primaryKey(),
    operationId: text('operation_id').notNull(),
    memberId: text('member_id').notNull(),
    chargeCents: integer('charge_cents').notNull(),
    oldBalanceCents: integer('old_balance_cents').notNull(),
    newBalanceCents: integer('new_balance_cents').notNull(),
    guard: integer('guard').notNull(),
  },
  (table) => [
    check('checkout_line_guard', sql`${table.guard} = 1`),
    index('idx_checkout_lines_operation_id').on(table.operationId),
  ],
);

export const balanceAdjustments = sqliteTable(
  'balance_adjustments',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id').notNull(),
    wechatId: text('wechat_id').notNull(),
    gameId: text('game_id').notNull(),
    direction: text('direction').notNull(),
    amountCents: integer('amount_cents').notNull(),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    deltaCents: integer('delta_cents').notNull(),
    oldBalanceCents: integer('old_balance_cents').notNull(),
    newBalanceCents: integer('new_balance_cents').notNull(),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
    guard: integer('guard').notNull(),
  },
  (table) => [
    check('balance_adjustment_guard', sql`${table.guard} = 1`),
    index('idx_balance_adjustments_history').on(table.deletedAt, table.createdAt, table.id),
  ],
);

export const authAdmins = sqliteTable(
  'auth_admins',
  {
    id: text('id').primaryKey(),
    account: text('account').notNull(),
    passwordSalt: text('password_salt').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    disabledAt: integer('disabled_at'),
  },
  (table) => [uniqueIndex('idx_auth_admins_account').on(table.account)],
);

export const authDevices = sqliteTable(
  'auth_devices',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [uniqueIndex('idx_auth_devices_token_hash').on(table.tokenHash)],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    adminId: text('admin_id').notNull(),
    deviceId: text('device_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_auth_sessions_token_hash').on(table.tokenHash),
    index('idx_auth_sessions_expiry').on(table.expiresAt),
  ],
);

export const deviceRequests = sqliteTable(
  'device_requests',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    requestTokenHash: text('request_token_hash').notNull(),
    requestedName: text('requested_name').notNull(),
    status: text('status').notNull(),
    approvedDeviceId: text('approved_device_id'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    consumedAt: integer('consumed_at'),
  },
  (table) => [
    uniqueIndex('idx_device_requests_code').on(table.code),
    uniqueIndex('idx_device_requests_token').on(table.requestTokenHash),
    index('idx_device_requests_status_expiry').on(table.status, table.expiresAt),
  ],
);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  windowStartedAt: integer('window_started_at').notNull(),
  blockedUntil: integer('blocked_until').notNull(),
});
