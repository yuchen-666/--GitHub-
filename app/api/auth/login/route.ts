import {
  authenticateAccount,
  clearAuthAttempts,
  consumeAuthAttempt,
  createSession,
  getAuthorizedDevice,
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
  if (!account || !password || account.length > 100 || password.length > 200) {
    return Response.json({ error: '请输入正确的账号和密码。' }, { status: 400 });
  }

  try {
    const attempt = await consumeAuthAttempt(request, 'login', account);
    if (!attempt.allowed) {
      return Response.json({ error: '登录尝试次数过多，请 30 分钟后再试。' }, { status: 429 });
    }
    const device = await getAuthorizedDevice(request);
    if (!device) {
      return Response.json({ error: '当前设备尚未获得访问授权。' }, { status: 403 });
    }
    const admin = await authenticateAccount(account, password);
    if (!admin) {
      return Response.json({ error: '账号或密码不正确。' }, { status: 401 });
    }
    await clearAuthAttempts(attempt.key);
    const token = await createSession(admin.id, device.id);
    return Response.json(
      { user: { account: admin.account, role: admin.role } },
      { headers: { 'Set-Cookie': sessionCookie(token) } },
    );
  } catch (error) {
    console.error('Failed to sign in', error);
    return Response.json({ error: '登录失败，请稍后重试。' }, { status: 500 });
  }
}
