'use client';

import { useEffect, useState } from 'react';
import { Clock3, Copy, History, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type CheckoutHistoryRecord = {
  id: string;
  kind: 'checkout';
  createdAt: number;
  totalCents: number;
  members: { memberId: string; wechatId: string; chargeCents: number }[];
};

type AdjustmentHistoryRecord = {
  id: string;
  kind: 'adjustment';
  createdAt: number;
  memberId: string;
  wechatId: string;
  gameId: string;
  direction: 'increase' | 'decrease';
  amountCents: number;
  rateBasisPoints: number;
  deltaCents: number;
  oldBalanceCents: number;
  newBalanceCents: number;
};

type HistoryRecord = CheckoutHistoryRecord | AdjustmentHistoryRecord;

type Report = {
  startAt: number;
  endAt: number;
  selectionCount: number;
  members: {
    memberId: string;
    wechatId: string;
    gameId: string;
    chargeCents: number;
    adjustmentCents: number;
    adjustmentCount: number;
    originalBalanceCents: number;
    currentBalanceCents: number;
  }[];
};

const money = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function yuan(cents: number) {
  return `${money.format(cents / 100)}元`;
}

function signedYuan(cents: number) {
  return `${cents >= 0 ? '+' : '-'}${yuan(Math.abs(cents))}`;
}

function messageFor(member: Report['members'][number]) {
  const consumption = member.chargeCents > 0 || member.adjustmentCount === 0
    ? `您本次消费${yuan(member.chargeCents)}`
    : '您本次';
  const adjustment = member.adjustmentCount > 0
    ? `${member.chargeCents > 0 ? '，期间' : ''}余额调整${signedYuan(member.adjustmentCents)}`
    : '';
  return `${consumption}${adjustment}，账户原有${yuan(member.originalBalanceCents)}，现有${yuan(member.currentBalanceCents)}——${member.wechatId}`;
}

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'generate' | 'delete' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<'generate' | 'delete' | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/history');
        const data = (await response.json()) as {
          records?: HistoryRecord[];
          error?: string;
        };
        if (!response.ok || !data.records) {
          throw new Error(data.error || '历史记录加载失败。');
        }
        if (active) setRecords(data.records);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '历史记录加载失败。');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  function chooseMode(next: 'generate' | 'delete') {
    setError('');
    setMode(next);
    setSelected(new Set());
  }

  function toggle(id: string, checked: boolean) {
    setError('');
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function requestAction(action: 'generate' | 'delete') {
    if (mode !== action) {
      chooseMode(action);
      return;
    }
    if (action === 'generate' && (selected.size < 1 || selected.size > 2)) {
      setError('请勾选一笔或两笔记录。');
      return;
    }
    if (action === 'delete' && selected.size === 0) {
      setError('请至少勾选一条要删除的记录。');
      return;
    }
    setConfirmAction(action);
  }

  async function performAction() {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/history', {
        method: action === 'generate' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = (await response.json()) as {
        members?: Report['members'];
        startAt?: number;
        endAt?: number;
        selectionCount?: number;
        deletedIds?: string[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || '操作失败，请稍后重试。');
      if (action === 'generate') {
        if (!data.members || data.startAt === undefined || data.endAt === undefined || data.selectionCount === undefined) {
          throw new Error('统计结果不完整，请稍后重试。');
        }
        setReport({ members: data.members, startAt: data.startAt, endAt: data.endAt, selectionCount: data.selectionCount });
      } else {
        if (!data.deletedIds) throw new Error('删除结果不完整，请刷新后重试。');
        const deleted = new Set(data.deletedIds);
        setRecords((current) => current.filter((record) => !deleted.has(record.id)));
      }
      setMode(null);
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function copyMessage(member: Report['members'][number]) {
    try {
      await navigator.clipboard.writeText(messageFor(member));
      setCopiedId(member.memberId);
    } catch {
      setCopiedId(null);
      setError('复制失败，请检查浏览器的剪贴板权限。');
    }
  }

  return (
    <>
      <Dialog open={report === null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 pt-6 pb-5">
            <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
              <History className="size-5" aria-hidden="true" />历史记录
            </DialogTitle>
            <DialogDescription>
              每张卡片是一笔结账或余额调整。选一笔查看该笔变动；选两笔汇总其间记录。
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(65vh,620px)] min-h-40 overflow-y-auto bg-[#f6f8fa] px-4 py-5 sm:px-6">
            {loading ? (
              <p className="py-8 text-center text-[#66717f]">正在读取历史记录…</p>
            ) : records.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#cdd3db] bg-white p-8 text-center text-[#66717f]">
                还没有历史记录。
              </p>
            ) : (
              <div className="grid gap-3">
                {records.map((record) => (
                  <div key={record.id} className="flex gap-3 rounded-xl border border-[#d3d9e1] bg-white p-4 shadow-sm">
                    {mode && (
                      <Checkbox
                        checked={selected.has(record.id)}
                        disabled={busy || (mode === 'generate' && selected.size >= 2 && !selected.has(record.id))}
                        onCheckedChange={(checked) => toggle(record.id, checked === true)}
                        aria-label={`选择 ${dateTime.format(record.createdAt)} 的${record.kind === 'checkout' ? '结账' : '余额调整'}记录`}
                        className="mt-1 size-5"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="break-all font-semibold text-[#17202a]">
                          {record.kind === 'checkout'
                            ? record.members.map((member) => member.wechatId).join('、')
                            : `余额调整 · ${record.wechatId}`}
                        </div>
                        <strong className="whitespace-nowrap text-lg text-[#17202a]">
                          {record.kind === 'checkout' ? `-${yuan(record.totalCents)}` : signedYuan(record.deltaCents)}
                        </strong>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-sm text-[#66717f]">
                        <Clock3 className="size-4" aria-hidden="true" />
                        <time dateTime={new Date(record.createdAt).toISOString()}>{dateTime.format(record.createdAt)}</time>
                      </div>
                      {record.kind === 'checkout' && record.members.length > 1 && (
                        <div className="mt-3 border-t pt-2 text-sm text-[#566272]">
                          {record.members.map((member) => (
                            <div key={member.memberId} className="flex justify-between gap-3">
                              <span className="break-all">{member.wechatId}</span>
                              <span className="whitespace-nowrap">-{yuan(member.chargeCents)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {record.kind === 'adjustment' && (
                        <div className="mt-3 border-t pt-2 text-sm text-[#566272]">
                          <p>{record.direction === 'increase' ? '增加余额' : '减少余额'}：{yuan(record.amountCents)} × 折扣 {record.rateBasisPoints / 10000}</p>
                          <p>余额：{yuan(record.oldBalanceCents)} → {yuan(record.newBalanceCents)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {mode && <p className="mt-4 text-sm text-[#566272]">
              {mode === 'generate' ? `已选择 ${selected.size} 笔（最多 2 笔）` : `已选择 ${selected.size} 条记录`}
            </p>}
            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>

          <DialogFooter className="mx-0 mb-0 flex-wrap justify-between gap-2 rounded-b-2xl px-6 py-4">
            <Button type="button" onClick={() => requestAction('generate')} disabled={loading || busy || records.length === 0}>
              {mode === 'generate' ? '确定生成' : '生成'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>关闭</Button>
            <Button type="button" variant="outline" onClick={() => requestAction('delete')} disabled={loading || busy || records.length === 0} className="text-red-700 hover:text-red-800">
              <Trash2 className="size-4" aria-hidden="true" />
              {mode === 'delete' ? '确定删除' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction === 'delete' ? '确定删除历史记录？' : '确定生成区间统计？'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'delete'
                ? `将从历史记录中移除选中的 ${selected.size} 笔记录；已执行的扣费或余额调整不会撤销。`
                : selected.size === 1
                  ? '将只统计勾选的这一笔记录，按会员汇总消费与余额调整。'
                  : '将统计勾选的两笔及其之间的所有记录，按会员汇总消费与余额调整。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void performAction()} variant={confirmAction === 'delete' ? 'destructive' : 'default'}>
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={report !== null} onOpenChange={(open) => { if (!open) setReport(null); }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 pt-6 pb-5">
            <DialogTitle className="text-xl font-semibold">区间记录汇总</DialogTitle>
            <DialogDescription>
              {report && (report.selectionCount === 1
                ? `${dateTime.format(report.startAt)}（单笔记录）`
                : `${dateTime.format(report.startAt)} 至 ${dateTime.format(report.endAt)}（含起止记录）`)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(65vh,620px)] overflow-y-auto bg-[#f6f8fa] px-4 py-5 sm:px-6">
            {report?.members.length ? (
              <div className="grid gap-3">
                {report.members.map((member) => (
                  <div key={member.memberId} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#d3d9e1] bg-white p-4 shadow-sm">
                    <p className="min-w-0 flex-1 break-all leading-7 text-[#17202a]">{messageFor(member)}</p>
                    <Button type="button" variant="outline" onClick={() => void copyMessage(member)}>
                      <Copy className="size-4" aria-hidden="true" />
                      {copiedId === member.memberId ? '已复制' : '复制'}
                    </Button>
                  </div>
                ))}
              </div>
            ) : <p className="py-8 text-center text-[#66717f]">这个区间内没有会员变动。</p>}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6 py-4">
            <Button type="button" onClick={() => { setReport(null); setCopiedId(null); setError(''); }}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
