import { getDatabase } from '@/db/database';
import {
  authenticateAccount,
  clearAuthAttempts,
  consumeAuthAttempt,
  createSession,
  deviceCookie,
  hashToken,
  randomToken,
  sessionCookie,
} from '@/lib/auth';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: '提交内容格式不正确。' }, { status: 400 });
  }
  const account = typeof body.account === 'string' ? body.account.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
  if (!account || !password || !deviceName || deviceName.length > 100) {
    return Response.json({ error: '请填写管理账号、密码和设备名称。' }, { status: 400 });
  }

  try {
    const attempt = await consumeAuthAttempt(request, 'bootstrap', account, 6);
    if (!attempt.allowed) {
      return Response.json({ error: '尝试次数过多，请 30 分钟后再试。' }, { status: 429 });
    }
    const database = getDatabase();
    const row = await database
      .prepare('SELECT COUNT(*) AS count FROM auth_devices WHERE revoked_at IS NULL')
      .first<{ count: number }>();
    if ((row?.count ?? 0) > 0) {
      return Response.json({ error: '首次设备已经登记，请提交设备访问申请。' }, { status: 409 });
    }
    const admin = await authenticateAccount(account, password);
    if (!admin || admin.role !== 'owner') {
      return Response.json({ error: '管理账号或密码不正确。' }, { status: 401 });
    }
    await clearAuthAttempts(attempt.key);
    const deviceId = crypto.randomUUID();
    const deviceToken = randomToken();
    await database
      .prepare(
        `INSERT INTO auth_devices
         (id, name, token_hash, created_at, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(deviceId, deviceName, await hashToken(deviceToken), Date.now(), admin.id)
      .run();
    const loginToken = await createSession(admin.id, deviceId);
    const headers = new Headers();
    headers.append('Set-Cookie', deviceCookie(deviceToken));
    headers.append('Set-Cookie', sessionCookie(loginToken));
    return Response.json(
      { user: { account: admin.account, role: admin.role } },
      { headers },
    );
  } catch (error) {
    console.error('Failed to bootstrap first device', error);
    return Response.json({ error: '首次设备登记失败，请稍后重试。' }, { status: 500 });
  }
}
