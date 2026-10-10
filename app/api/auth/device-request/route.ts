import { getDatabase } from '@/db/database';
import {
  DEVICE_REQUEST_COOKIE,
  consumeAuthAttempt,
  clearCookie,
  deviceCookie,
  getAuthorizedDevice,
  hashToken,
  randomToken,
  readCookie,
  requestCookie,
} from '@/lib/auth';

function requestCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export async function POST(request: Request) {
  try {
    if (await getAuthorizedDevice(request)) return Response.json({ authorized: true });
    const attempt = await consumeAuthAttempt(request, 'device-request', 'anonymous', 5, 60 * 60 * 1000);
    if (!attempt.allowed) {
      return Response.json({ error: '设备申请过于频繁，请稍后再试。' }, { status: 429 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
    if (!deviceName || deviceName.length > 100) {
      return Response.json({ error: '请填写设备名称。' }, { status: 400 });
    }
    const database = getDatabase();
    const token = randomToken();
    let code = requestCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exists = await database
        .prepare('SELECT id FROM device_requests WHERE code = ?')
        .bind(code)
        .first();
      if (!exists) break;
      code = requestCode();
    }
    const now = Date.now();
    await database
      .prepare(
        `INSERT INTO device_requests
         (id, code, request_token_hash, requested_name, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        code,
        await hashToken(token),
        deviceName,
        now,
        now + 24 * 60 * 60 * 1000,
      )
      .run();
    return Response.json(
      { authorized: false, code, expiresAt: now + 24 * 60 * 60 * 1000 },
      { headers: { 'Set-Cookie': requestCookie(token) } },
    );
  } catch (error) {
    console.error('Failed to create device request', error);
    return Response.json({ error: '设备申请提交失败，请稍后重试。' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    if (await getAuthorizedDevice(request)) return Response.json({ authorized: true });
    const token = readCookie(request, DEVICE_REQUEST_COOKIE);
    if (!token) return Response.json({ authorized: false, status: 'none' });
    const tokenHash = await hashToken(token);
    const row = await getDatabase()
      .prepare(
        `SELECT r.code, r.status, r.expires_at, d.id AS device_id
         FROM device_requests r
         LEFT JOIN auth_devices d ON d.id = r.approved_device_id AND d.revoked_at IS NULL
         WHERE r.request_token_hash = ?`,
      )
      .bind(tokenHash)
      .first<{ code: string; status: string; expires_at: number; device_id: string | null }>();
    if (!row) return Response.json({ authorized: false, status: 'none' });
    if (row.status === 'approved' && row.device_id) {
      const headers = new Headers();
      headers.append('Set-Cookie', deviceCookie(token));
      headers.append('Set-Cookie', clearCookie(DEVICE_REQUEST_COOKIE));
      return Response.json({ authorized: true }, { headers });
    }
    return Response.json({
      authorized: false,
      status: row.expires_at <= Date.now() ? 'expired' : row.status,
      code: row.code,
      expiresAt: row.expires_at,
    });
  } catch (error) {
    console.error('Failed to read device request', error);
    return Response.json({ error: '设备申请状态读取失败。' }, { status: 500 });
  }
}
