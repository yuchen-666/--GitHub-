import { getDatabase } from '@/db/database';
import { getAuthContext, getAuthorizedDevice } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const device = await getAuthorizedDevice(request);
    const auth = device ? await getAuthContext(request) : null;
    const row = await getDatabase()
      .prepare('SELECT COUNT(*) AS count FROM auth_devices WHERE revoked_at IS NULL')
      .first<{ count: number }>();
    return Response.json({
      deviceAuthorized: Boolean(device),
      deviceName: device?.name ?? null,
      bootstrapAvailable: (row?.count ?? 0) === 0,
      authenticated: Boolean(auth),
      user: auth
        ? { account: auth.account, role: auth.role }
        : null,
    });
  } catch (error) {
    console.error('Failed to load authentication status', error);
    return Response.json({ error: '登录状态暂时无法读取，请稍后重试。' }, { status: 500 });
  }
}
