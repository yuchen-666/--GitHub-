import { env } from 'cloudflare:workers';

import { getDatabase } from '@/db/database';

export type AdminRole = 'owner' | 'super_admin' | 'admin';

export type AuthContext = {
  adminId: string;
  account: string;
  role: AdminRole;
  deviceId: string;
};

export const DEVICE_COOKIE = 'qz_device';
export const SESSION_COOKIE = 'qz_session';
export const DEVICE_REQUEST_COOKIE = 'qz_device_request';

const encoder = new TextEncoder();
// Cloudflare Workers caps Web Crypto PBKDF2 at 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function runtimeSecrets() {
  return env as unknown as {
    LOCAL_MODE?: string;
    AUTH_MANAGER_ACCOUNT?: string;
    AUTH_MANAGER_PASSWORD?: string;
    AUTH_INITIAL_ADMIN_ACCOUNT?: string;
    AUTH_INITIAL_ADMIN_PASSWORD?: string;
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return bytesToBase64(new Uint8Array(digest));
}

export async function hashPassword(password: string, salt = randomToken(18)) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PASSWORD_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return { salt, hash: bytesToBase64(new Uint8Array(bits)) };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const { hash } = await hashPassword(password, salt);
  const actualBytes = base64ToBytes(hash);
  const expectedBytes = base64ToBytes(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get('cookie') ?? '';
  for (const item of cookies.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

export function setCookie(name: string, value: string, maxAge: number) {
  const localMode = (runtimeSecrets().LOCAL_MODE ?? '') === '1';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly;${localMode ? '' : ' Secure;'} SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function deviceCookie(token: string) {
  return setCookie(DEVICE_COOKIE, token, DEVICE_MAX_AGE_SECONDS);
}

export function requestCookie(token: string) {
  return setCookie(DEVICE_REQUEST_COOKIE, token, 24 * 60 * 60);
}

export function sessionCookie(token: string) {
  return setCookie(SESSION_COOKIE, token, SESSION_MAX_AGE_SECONDS);
}

export async function ensureSeedAdmins(database = getDatabase()) {
  const secrets = runtimeSecrets();
  const configured: { account: string; password: string; role: AdminRole }[] = [
    {
      account: secrets.AUTH_MANAGER_ACCOUNT ?? '',
      password: secrets.AUTH_MANAGER_PASSWORD ?? '',
      role: 'owner',
    },
    {
      account: secrets.AUTH_INITIAL_ADMIN_ACCOUNT ?? '',
      password: secrets.AUTH_INITIAL_ADMIN_PASSWORD ?? '',
      role: 'admin',
    },
  ];
  const seeds = configured.filter((seed) => seed.account && seed.password);

  for (const seed of seeds) {
    const existing = await database
      .prepare('SELECT id FROM auth_admins WHERE account = ?')
      .bind(seed.account)
      .first<{ id: string }>();
    if (existing) continue;
    const password = await hashPassword(seed.password);
    await database
      .prepare(
        `INSERT OR IGNORE INTO auth_admins
         (id, account, password_salt, password_hash, role, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        seed.account,
        password.salt,
        password.hash,
        seed.role,
        Date.now(),
        'system',
      )
      .run();
  }
}

export async function authenticateAccount(account: string, password: string) {
  const database = getDatabase();
  await ensureSeedAdmins(database);
  const admin = await database
    .prepare(
      `SELECT id, account, password_salt, password_hash, role
       FROM auth_admins WHERE account = ? AND disabled_at IS NULL`,
    )
    .bind(account)
    .first<{
      id: string;
      account: string;
      password_salt: string;
      password_hash: string;
      role: AdminRole;
    }>();
  if (!admin || !(await verifyPassword(password, admin.password_salt, admin.password_hash))) {
    return null;
  }
  return { id: admin.id, account: admin.account, role: admin.role };
}

export async function getAuthorizedDevice(request: Request) {
  const token = readCookie(request, DEVICE_COOKIE);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  return getDatabase()
    .prepare(
      `SELECT id, name FROM auth_devices
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(tokenHash)
    .first<{ id: string; name: string }>();
}

export async function createSession(adminId: string, deviceId: string) {
  const token = randomToken();
  const now = Date.now();
  await getDatabase()
    .prepare(
      `INSERT INTO auth_sessions
       (id, token_hash, admin_id, device_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      await hashToken(token),
      adminId,
      deviceId,
      now,
      now + SESSION_MAX_AGE_SECONDS * 1000,
    )
    .run();
  return token;
}

export async function getAuthContext(request: Request): Promise<AuthContext | null> {
  const device = await getAuthorizedDevice(request);
  const sessionToken = readCookie(request, SESSION_COOKIE);
  if (!device || !sessionToken) return null;
  const now = Date.now();
  const result = await getDatabase()
    .prepare(
      `SELECT a.id AS admin_id, a.account, a.role, s.device_id
       FROM auth_sessions s
       JOIN auth_admins a ON a.id = s.admin_id
       WHERE s.token_hash = ? AND s.device_id = ? AND s.expires_at > ?
         AND a.disabled_at IS NULL`,
    )
    .bind(await hashToken(sessionToken), device.id, now)
    .first<{
      admin_id: string;
      account: string;
      role: AdminRole;
      device_id: string;
    }>();
  return result
    ? {
        adminId: result.admin_id,
        account: result.account,
        role: result.role,
        deviceId: result.device_id,
      }
    : null;
}

export async function requireSystemAccess(request: Request) {
  const auth = await getAuthContext(request);
  return auth && ['owner', 'super_admin', 'admin'].includes(auth.role) ? auth : null;
}

export async function requireManagementAccess(request: Request) {
  const auth = await getAuthContext(request);
  return auth && ['owner', 'super_admin'].includes(auth.role) ? auth : null;
}

export function unauthorizedResponse(message = '请先登录。') {
  return Response.json({ error: message }, { status: 401 });
}

function requestAddress(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export async function consumeAuthAttempt(
  request: Request,
  scope: string,
  identifier: string,
  limit = 8,
  windowMs = 15 * 60 * 1000,
) {
  const now = Date.now();
  const key = await hashToken(`${scope}:${requestAddress(request)}:${identifier.toLocaleLowerCase()}`);
  const database = getDatabase();
  const row = await database
    .prepare(
      `SELECT attempts, window_started_at, blocked_until
       FROM auth_rate_limits WHERE key = ?`,
    )
    .bind(key)
    .first<{ attempts: number; window_started_at: number; blocked_until: number }>();
  if (row && row.blocked_until > now) return { allowed: false, key };
  const freshWindow = !row || now - row.window_started_at >= windowMs;
  const attempts = freshWindow ? 1 : row.attempts + 1;
  const blockedUntil = attempts > limit ? now + 30 * 60 * 1000 : 0;
  await database
    .prepare(
      `INSERT INTO auth_rate_limits (key, attempts, window_started_at, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         attempts = excluded.attempts,
         window_started_at = excluded.window_started_at,
         blocked_until = excluded.blocked_until`,
    )
    .bind(key, attempts, freshWindow ? now : row!.window_started_at, blockedUntil)
    .run();
  return { allowed: blockedUntil === 0, key };
}

export async function clearAuthAttempts(key: string) {
  await getDatabase().prepare('DELETE FROM auth_rate_limits WHERE key = ?').bind(key).run();
}
