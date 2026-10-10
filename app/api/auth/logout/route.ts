import { clearCookie, readCookie, SESSION_COOKIE, hashToken } from '@/lib/auth';
import { getDatabase } from '@/db/database';

export async function POST(request: Request) {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      await getDatabase()
        .prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
        .bind(await hashToken(token))
        .run();
    }
  } catch (error) {
    console.error('Failed to remove session', error);
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearCookie(SESSION_COOKIE) } },
  );
}
