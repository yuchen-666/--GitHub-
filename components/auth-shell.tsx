'use client';

import { useCallback, useEffect, useState, type ReactNode, type SubmitEvent } from 'react';
import { Copy, KeyRound, Laptop, LogOut, ShieldCheck, UserPlus, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type SignedInUser = {
  account: string;
  role: 'owner' | 'super_admin' | 'admin';
};

type Status = {
  deviceAuthorized: boolean;
  deviceName: string | null;
  bootstrapAvailable: boolean;
  authenticated: boolean;
  user: SignedInUser | null;
};

type ManagementData = {
  admins: { id: string; account: string; role: SignedInUser['role']; createdAt: number }[];
  devices: { id: string; name: string; createdAt: number }[];
  requests: { id: string; code: string; deviceName: string; createdAt: number; expiresAt: number }[];
};

const emptyManagement: ManagementData = { admins: [], devices: [], requests: [] };

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。');
  return data;
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-4 py-10 text-[#17202a]">
      <section className="w-full max-w-md rounded-[28px] border border-[#cdd3db] bg-white p-7 shadow-[0_20px_70px_rgba(28,39,51,0.12)] sm:p-9">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#17202a] text-white">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#66717f]">雀庄</p>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">会员储值</h1>
          </div>
        </div>
        {children}
      </section>
    </main>
  );
}

function LoginScreen({ onSignedIn }: { onSignedIn: (user: SignedInUser) => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      const data = await readJson<{ user: SignedInUser }>(
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: form.get('account'), password: form.get('password') }),
        }),
      );
      onSignedIn(data.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="text-xl font-semibold">管理员登录</h2>
      <p className="mt-2 text-sm leading-6 text-[#66717f]">此设备已获授权，请输入管理员账号和密码。</p>
      <form className="mt-6 grid gap-5" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="login-account">管理员账号</Label>
          <Input id="login-account" name="account" required maxLength={100} autoComplete="username" className="h-11 text-base md:text-base" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">密码</Label>
          <Input id="login-password" name="password" type="password" required maxLength={200} autoComplete="current-password" className="h-11 text-base md:text-base" />
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" size="lg" disabled={saving} className="h-11 bg-[#17202a] text-base text-white hover:bg-[#303b47]">
          <KeyRound className="size-5" aria-hidden="true" />
          {saving ? '正在登录…' : '登录'}
        </Button>
      </form>
    </>
  );
}

function DeviceGate({ status, onReady }: { status: Status; onReady: () => void }) {
  const [deviceName, setDeviceName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await readJson<{ authorized: boolean; status?: string }>(
          await fetch('/api/auth/device-request'),
        );
        if (data.authorized) onReady();
        else if (data.status === 'expired') setError('申请码已过期，请重新申请。');
      } catch {
        // A transient polling failure does not discard the visible request code.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [code, onReady]);

  async function requestDevice(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await readJson<{ authorized: boolean; code?: string }>(
        await fetch('/api/auth/device-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceName }),
        }),
      );
      if (data.authorized) onReady();
      else setCode(data.code ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '设备申请失败。');
    } finally {
      setSaving(false);
    }
  }

  async function bootstrap(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      await readJson<{ user: SignedInUser }>(
        await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account: form.get('account'),
            password: form.get('password'),
            deviceName: form.get('deviceName'),
          }),
        }),
      );
      onReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '首次设备登记失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthCard>
      <h2 className="text-xl font-semibold">{status.bootstrapAvailable ? '首次授权本机' : '此设备尚未授权'}</h2>
      <p className="mt-2 text-sm leading-6 text-[#66717f]">
        {status.bootstrapAvailable
          ? '请使用设备管理账号登记当前浏览器。登记完成后，本机即可进入管理员登录界面。'
          : '请输入便于识别的设备名称并申请访问，然后将申请码交给超级管理员。'}
      </p>

      {status.bootstrapAvailable ? (
        <form className="mt-6 grid gap-4" onSubmit={bootstrap}>
          <div className="grid gap-2"><Label htmlFor="bootstrap-account">设备管理账号</Label><Input id="bootstrap-account" name="account" required autoComplete="username" className="h-11 text-base md:text-base" /></div>
          <div className="grid gap-2"><Label htmlFor="bootstrap-password">密码</Label><Input id="bootstrap-password" name="password" type="password" required autoComplete="current-password" className="h-11 text-base md:text-base" /></div>
          <div className="grid gap-2"><Label htmlFor="bootstrap-device">设备名称</Label><Input id="bootstrap-device" name="deviceName" required maxLength={100} placeholder="例如：我的办公室电脑" className="h-11 text-base md:text-base" /></div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" disabled={saving} className="h-11 bg-[#17202a] text-white hover:bg-[#303b47]">{saving ? '正在登记…' : '授权当前设备'}</Button>
        </form>
      ) : code ? (
        <div className="mt-6 rounded-2xl border border-[#cdd3db] bg-[#f5f7f9] p-5 text-center">
          <p className="text-sm text-[#66717f]">设备申请码</p>
          <p className="my-3 font-mono text-3xl font-semibold tracking-[0.16em]">{code}</p>
          <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(code)}>
            <Copy className="size-4" aria-hidden="true" />复制申请码
          </Button>
          <p className="mt-4 text-sm text-[#66717f]">批准后本页会自动进入登录界面。</p>
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        </div>
      ) : (
        <form className="mt-6 grid gap-4" onSubmit={requestDevice}>
          <div className="grid gap-2"><Label htmlFor="request-device">设备名称</Label><Input id="request-device" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required maxLength={100} placeholder="例如：前台电脑" className="h-11 text-base md:text-base" /></div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" size="lg" disabled={saving} className="h-11 bg-[#17202a] text-white hover:bg-[#303b47]">
            <Laptop className="size-5" aria-hidden="true" />{saving ? '正在申请…' : '申请访问'}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

function ManagementDashboard({ user, onSystem, onLogout }: { user: SignedInUser; onSystem: () => void; onLogout: () => void }) {
  const [data, setData] = useState<ManagementData>(emptyManagement);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'admin' | 'super_admin' | 'device' | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await readJson<ManagementData>(await fetch('/api/auth/management')));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '管理员资料读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    try {
      if (dialog === 'device') {
        await readJson(
          await fetch('/api/auth/management', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve-device', code: form.get('code'), deviceName: form.get('deviceName') }),
          }),
        );
      } else {
        await readJson(
          await fetch('/api/auth/management', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add-admin', account: form.get('account'), password: form.get('password'), role: dialog }),
          }),
        );
      }
      setDialog(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-5 text-[#17202a] sm:px-8 sm:py-8">
      <section className="mx-auto min-h-[calc(100vh-2.5rem)] w-full max-w-6xl rounded-[28px] border border-[#cdd3db] bg-[#e7ebf0] p-5 shadow-[0_18px_55px_rgba(28,39,51,0.08)] sm:min-h-[calc(100vh-4rem)] sm:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><p className="text-sm font-medium text-[#66717f]">雀庄</p><h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">管理员与设备</h1></div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={onSystem}>进入储值系统</Button><Button type="button" variant="outline" onClick={onLogout}><LogOut className="size-4" />退出</Button></div>
        </header>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Button type="button" size="lg" onClick={() => setDialog('admin')} className="h-12 bg-[#17202a] text-white hover:bg-[#303b47]"><UserPlus className="size-5" />增设管理员</Button>
          <Button type="button" size="lg" onClick={() => setDialog('super_admin')} className="h-12 bg-[#17202a] text-white hover:bg-[#303b47]"><ShieldCheck className="size-5" />增设超级管理员</Button>
          <Button type="button" size="lg" onClick={() => setDialog('device')} className="h-12 bg-[#17202a] text-white hover:bg-[#303b47]"><Laptop className="size-5" />增设可访问设备</Button>
        </div>

        {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-[#cdd3db] bg-white p-5"><h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5" />管理员</h2><div className="mt-4 grid gap-2">{loading ? <p className="text-sm text-[#66717f]">正在读取…</p> : data.admins.map((admin) => <div key={admin.id} className="flex items-center justify-between rounded-xl bg-[#f5f7f9] px-4 py-3"><span className="font-medium">{admin.account}</span><span className="text-sm text-[#66717f]">{admin.role === 'owner' ? '设备管理账号' : admin.role === 'super_admin' ? '超级管理员' : '管理员'}</span></div>)}</div></section>
          <section className="rounded-2xl border border-[#cdd3db] bg-white p-5"><h2 className="flex items-center gap-2 text-lg font-semibold"><Laptop className="size-5" />已授权设备</h2><div className="mt-4 grid gap-2">{loading ? <p className="text-sm text-[#66717f]">正在读取…</p> : data.devices.map((device) => <div key={device.id} className="rounded-xl bg-[#f5f7f9] px-4 py-3 font-medium">{device.name}</div>)}</div></section>
        </div>
        {data.requests.length > 0 && <section className="mt-5 rounded-2xl border border-[#cdd3db] bg-white p-5"><h2 className="text-lg font-semibold">待批准设备申请</h2><div className="mt-4 grid gap-2">{data.requests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f5f7f9] px-4 py-3"><span>{request.deviceName}</span><span className="font-mono font-semibold tracking-widest">{request.code}</span></div>)}</div></section>}
        <p className="mt-6 text-sm text-[#66717f]">当前登录：{user.account}</p>
      </section>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{dialog === 'admin' ? '增设管理员' : dialog === 'super_admin' ? '增设超级管理员' : '增设可访问设备'}</DialogTitle><DialogDescription>{dialog === 'device' ? '在新设备上申请访问后，将该设备显示的申请码填在这里。' : '新账号创建后可在已授权设备上登录。'}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="grid gap-5">
            {dialog === 'device' ? <><div className="grid gap-2"><Label htmlFor="device-code">8 位设备申请码</Label><Input id="device-code" name="code" required maxLength={8} className="h-11 font-mono uppercase tracking-widest" /></div><div className="grid gap-2"><Label htmlFor="approved-device-name">设备名称（可选）</Label><Input id="approved-device-name" name="deviceName" maxLength={100} className="h-11" /></div></> : <><div className="grid gap-2"><Label htmlFor="new-account">登录账号</Label><Input id="new-account" name="account" required maxLength={100} autoComplete="off" className="h-11" /></div><div className="grid gap-2"><Label htmlFor="new-password">登录密码</Label><Input id="new-password" name="password" type="password" required minLength={8} maxLength={200} autoComplete="new-password" className="h-11" /></div></>}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <DialogFooter><Button type="submit" disabled={saving}>{saving ? '正在保存…' : dialog === 'device' ? '批准设备' : '创建账号'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export function AuthShell({ children }: { children: (input: { user: SignedInUser; openManagement: () => void; logout: () => void }) => ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [showManagement, setShowManagement] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await readJson<Status>(await fetch('/api/auth/status', { cache: 'no-store' }));
      setStatus(next);
      if (next.user?.role === 'owner') setShowManagement(true);
    } catch {
      setStatus({ deviceAuthorized: false, deviceName: null, bootstrapAvailable: false, authenticated: false, user: null });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setShowManagement(false);
    await refresh();
  }, [refresh]);

  if (!status) return <AuthCard><p className="text-sm text-[#66717f]">正在验证设备和登录状态…</p></AuthCard>;
  if (!status.deviceAuthorized) return <DeviceGate status={status} onReady={refresh} />;
  if (!status.authenticated || !status.user) return <AuthCard><LoginScreen onSignedIn={(user) => { setStatus({ ...status, authenticated: true, user }); setShowManagement(user.role === 'owner'); }} /></AuthCard>;
  if (showManagement && status.user.role !== 'admin') return <ManagementDashboard user={status.user} onSystem={() => setShowManagement(false)} onLogout={() => void logout()} />;
  return <>{children({ user: status.user, openManagement: () => setShowManagement(true), logout: () => void logout() })}</>;
}
