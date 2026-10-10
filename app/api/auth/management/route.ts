import { getDatabase } from '@/db/database';
import {
  hashPassword,
  requireManagementAccess,
  unauthorizedResponse,
  type AdminRole,
} from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const auth = await requireManagementAccess(request);
    if (!auth) return unauthorizedResponse('只有超级管理员可以进入管理界面。');
    const database = getDatabase();
    const [admins, devices, requests] = await Promise.all([
      database
        .prepare(
          `SELECT id, account, role, created_at
           FROM auth_admins WHERE disabled_at IS NULL
           ORDER BY created_at ASC`,
        )
        .all<{ id: string; account: string; role: AdminRole; created_at: number }>(),
      database
        .prepare(
          `SELECT id, name, created_at
           FROM auth_devices WHERE revoked_at IS NULL
           ORDER BY created_at ASC`,
        )
        .all<{ id: string; name: string; created_at: number }>(),
      database
        .prepare(
          `SELECT id, code, requested_name, created_at, expires_at
           FROM device_requests
           WHERE status = 'pending' AND expires_at > ?
           ORDER BY created_at DESC`,
        )
        .bind(Date.now())
        .all<{
          id: string;
          code: string;
          requested_name: string;
          created_at: number;
          expires_at: number;
        }>(),
    ]);
    return Response.json({
      admins: admins.results.map((row) => ({
        id: row.id,
        account: row.account,
        role: row.role,
        createdAt: row.created_at,
      })),
      devices: devices.results.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
      })),
      requests: requests.results.map((row) => ({
        id: row.id,
        code: row.code,
        deviceName: row.requested_name,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      })),
    });
  } catch (error) {
    console.error('Failed to load management data', error);
    return Response.json({ error: '管理员资料读取失败，请稍后重试。' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireManagementAccess(request);
    if (!auth) return unauthorizedResponse('只有超级管理员可以执行此操作。');
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    const database = getDatabase();

    if (action === 'add-admin') {
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role;
      if (!account || account.length > 100) {
        return Response.json({ error: '请输入不超过 100 个字符的管理员账号。' }, { status: 400 });
      }
      if (password.length < 8 || password.length > 200) {
        return Response.json({ error: '密码长度须为 8 至 200 个字符。' }, { status: 400 });
      }
      if (role !== 'admin' && role !== 'super_admin') {
        return Response.json({ error: '管理员类型不正确。' }, { status: 400 });
      }
      const passwordData = await hashPassword(password);
      try {
        const id = crypto.randomUUID();
        await database
          .prepare(
            `INSERT INTO auth_admins
             (id, account, password_salt, password_hash, role, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            id,
            account,
            passwordData.salt,
            passwordData.hash,
            role,
            Date.now(),
            auth.adminId,
          )
          .run();
        return Response.json({ id, account, role }, { status: 201 });
      } catch (error) {
        if (String(error).toLowerCase().includes('unique')) {
          return Response.json({ error: '这个管理员账号已经存在。' }, { status: 409 });
        }
        throw error;
      }
    }

    if (action === 'approve-device') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      const customName = typeof body.deviceName === 'string' ? body.deviceName.trim() : '';
      if (!/^[A-Z2-9]{8}$/.test(code)) {
        return Response.json({ error: '请输入设备上显示的 8 位申请码。' }, { status: 400 });
      }
      const pending = await database
        .prepare(
          `SELECT id, request_token_hash, requested_name
           FROM device_requests
           WHERE code = ? AND status = 'pending' AND expires_at > ?`,
        )
        .bind(code, Date.now())
        .first<{ id: string; request_token_hash: string; requested_name: string }>();
      if (!pending) {
        return Response.json({ error: '没有找到有效的设备申请。' }, { status: 404 });
      }
      const deviceId = crypto.randomUUID();
      const name = (customName || pending.requested_name).slice(0, 100);
      await database.batch([
        database
          .prepare(
            `INSERT INTO auth_devices
             (id, name, token_hash, created_at, created_by)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(deviceId, name, pending.request_token_hash, Date.now(), auth.adminId),
        database
          .prepare(
            `UPDATE device_requests
             SET status = 'approved', approved_device_id = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .bind(deviceId, pending.id),
      ]);
      return Response.json({ id: deviceId, name }, { status: 201 });
    }

    return Response.json({ error: '操作类型不正确。' }, { status: 400 });
  } catch (error) {
    console.error('Failed to update management data', error);
    return Response.json({ error: '操作失败，请稍后重试。' }, { status: 500 });
  }
}
