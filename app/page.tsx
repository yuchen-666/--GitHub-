'use client';

import { useEffect, useState, type SubmitEvent } from 'react';
import { History, LogOut, Pencil, Plus, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';

import { AuthShell, type SignedInUser } from '@/components/auth-shell';
import { CheckoutFlow } from '@/components/checkout-flow';
import { CheckoutResultsDialog } from '@/components/checkout-results-dialog';
import { HistoryDialog } from '@/components/history-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { initialMembers, type Member } from '@/lib/members';
import type { CheckoutResult } from '@/lib/checkout';
import {
  calculateChargeCents,
  parseDiscountBasisPoints,
  parseAdjustmentRateBasisPoints,
  parseUnitPriceCents,
} from '@/lib/checkout-pricing';

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function Page() {
  return (
    <AuthShell>
      {({ user, openManagement, logout }) => (
        <Home user={user} openManagement={openManagement} logout={logout} />
      )}
    </AuthShell>
  );
}

function Home({
  user,
  openManagement,
  logout,
}: {
  user: SignedInUser;
  openManagement: () => void;
  logout: () => void;
}) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingMemberIds, setDeletingMemberIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [adjustingMember, setAdjustingMember] = useState<Member | null>(null);
  const [adjustDirection, setAdjustDirection] = useState<
    'increase' | 'decrease'
  >('increase');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDiscount, setAdjustDiscount] = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editingField, setEditingField] = useState<'wechatId' | 'discount'>('wechatId');
  const [profileValue, setProfileValue] = useState('');
  const [profileError, setProfileError] = useState('');
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  const adjustAmountCents = parseUnitPriceCents(adjustAmount);
  const adjustmentRateBasisPoints =
    parseAdjustmentRateBasisPoints(adjustDiscount);
  const effectiveAdjustmentCents =
    adjustAmountCents !== null && adjustmentRateBasisPoints !== null
      ? calculateChargeCents(adjustAmountCents, 1, adjustmentRateBasisPoints)
      : null;
  const adjustedBalanceCents =
    adjustingMember && effectiveAdjustmentCents !== null
      ? Math.round(adjustingMember.balance * 100) +
        (adjustDirection === 'increase'
          ? effectiveAdjustmentCents
          : -effectiveAdjustmentCents)
      : null;

  function closeAdjustment() {
    setAdjustingMember(null);
    setAdjustAmount('');
    setAdjustDiscount('');
    setAdjustError('');
    setAdjustDirection('increase');
  }

  function openProfileEditor(member: Member, field: 'wechatId' | 'discount') {
    setEditingMember(member);
    setEditingField(field);
    if (field === 'discount') {
      const basisPoints = parseDiscountBasisPoints(member.discount);
      setProfileValue(basisPoints === null ? '' : String(basisPoints / 10000));
    } else {
      setProfileValue(member.wechatId);
    }
    setProfileError('');
  }

  function closeProfileEditor() {
    setEditingMember(null);
    setProfileValue('');
    setProfileError('');
    setEditingField('wechatId');
  }

  async function handleProfileSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMember) return;
    const value = profileValue.trim();
    if (editingField === 'wechatId') {
      if (!value) {
        setProfileError('请输入新的昵称。');
        return;
      }
    } else if (parseAdjustmentRateBasisPoints(value) === null) {
      setProfileError('折扣须在 0 到 1 之间，最多保留四位小数。');
      return;
    }

    setIsProfileSaving(true);
    setProfileError('');
    try {
      const response = await fetch('/api/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-profile',
          id: editingMember.id,
          field: editingField,
          value,
          expectedValue: editingField === 'wechatId'
            ? editingMember.wechatId
            : editingMember.discount,
        }),
      });
      const data = (await response.json()) as { member?: Member; error?: string };
      if (!response.ok || !data.member) {
        throw new Error(data.error || '资料调整失败，请稍后重试。');
      }
      setMembers((current) => current.map((member) =>
        member.id === data.member?.id ? data.member : member,
      ));
      closeProfileEditor();
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : '资料调整失败，请稍后重试。',
      );
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function handleAdjust(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustingMember) return;
    if (adjustAmountCents === null || adjustAmountCents <= 0) {
      setAdjustError('请输入大于 0 的金额，最多保留两位小数。');
      return;
    }
    if (adjustmentRateBasisPoints === null) {
      setAdjustError('折扣须在 0 到 1 之间，最多保留四位小数。');
      return;
    }
    if (
      adjustedBalanceCents === null ||
      !Number.isSafeInteger(adjustedBalanceCents)
    ) {
      setAdjustError('调整后余额超出支持范围，请输入较小的金额。');
      return;
    }

    setIsAdjusting(true);
    setAdjustError('');
    try {
      const response = await fetch('/api/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: adjustingMember.id,
          amount: adjustAmount,
          adjustmentRate: adjustDiscount,
          direction: adjustDirection,
          expectedBalanceCents: Math.round(adjustingMember.balance * 100),
        }),
      });
      const data = (await response.json()) as {
        member?: Member;
        error?: string;
      };
      const savedMember = data.member;
      if (!response.ok || !savedMember) {
        throw new Error(data.error || '余额调整失败，请稍后重试。');
      }
      setMembers((current) =>
        current.map((member) =>
          member.id === savedMember.id ? savedMember : member,
        ),
      );
      closeAdjustment();
    } catch (error) {
      setAdjustError(
        error instanceof Error ? error.message : '余额调整失败，请稍后重试。',
      );
    } finally {
      setIsAdjusting(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadMembers() {
      try {
        const response = await fetch('/api/members');
        const data = (await response.json()) as {
          members?: Member[];
          error?: string;
        };

        if (!response.ok || !data.members) {
          throw new Error(data.error || '会员数据加载失败。');
        }

        if (active) setMembers(data.members);
      } catch (error) {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : '会员数据加载失败。',
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadMembers();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const balance = Number(form.get('balance'));

    const readText = (name: string) => {
      const value = form.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };

    const input = {
      wechatId: readText('wechatId'),
      gameId: readText('gameId'),
      discount: readText('discount'),
      balance,
    };

    if (
      !input.wechatId ||
      !input.gameId ||
      !input.discount ||
      !Number.isFinite(input.balance)
    ) {
      setFormError('请填写完整且有效的会员信息。');
      return;
    }

    setIsSaving(true);
    setFormError('');

    try {
      const response = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await response.json()) as {
        member?: Member;
        error?: string;
      };

      if (!response.ok || !data.member) {
        throw new Error(data.error || '保存失败，请稍后重试。');
      }

      setMembers((current) => [...current, data.member as Member]);
      formElement.reset();
      setDialogOpen(false);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : '保存失败，请稍后重试。',
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(member: Member) {
    setLoadError('');
    setDeletingMemberIds((current) => new Set(current).add(member.id));

    try {
      const response = await fetch('/api/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: member.id }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || '删除失败，请稍后重试。');
      }

      setMembers((current) =>
        current.filter((currentMember) => currentMember.id !== member.id),
      );
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : '删除失败，请稍后重试。',
      );
    } finally {
      setDeletingMemberIds((current) => {
        const next = new Set(current);
        next.delete(member.id);
        return next;
      });
    }
  }

  return (
    <main className="min-h-screen bg-[#f2f4f7] px-4 py-5 text-[#17202a] sm:px-8 sm:py-8">
      <section className="mx-auto min-h-[calc(100vh-2.5rem)] w-full max-w-6xl rounded-[28px] border border-[#cdd3db] bg-[#e7ebf0] p-4 shadow-[0_18px_55px_rgba(28,39,51,0.08)] sm:min-h-[calc(100vh-4rem)] sm:p-7 lg:p-9">
        <header className="mb-3 flex flex-wrap items-end justify-between gap-4 px-1 sm:mb-5">
          <div className="flex flex-wrap items-center gap-4">
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open);
                if (!open) setFormError('');
              }}
            >
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="lg"
                    className="h-11 rounded-xl bg-[#17202a] px-4 text-base text-white shadow-sm hover:bg-[#303b47]"
                  />
                }
              >
                <Plus className="size-5" aria-hidden="true" />
                新建
              </DialogTrigger>

              <DialogContent className="gap-0 rounded-2xl p-0 sm:max-w-md">
                <DialogHeader className="px-6 pt-6 pb-5">
                  <DialogTitle className="text-xl font-semibold">
                    新建会员
                  </DialogTitle>
                  <DialogDescription className="text-sm">
                    填写会员信息后保存。
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit}>
                  <div className="grid gap-5 px-6 pb-6">
                    <div className="grid gap-2">
                      <Label htmlFor="wechatId">微信 ID</Label>
                      <Input
                        id="wechatId"
                        name="wechatId"
                        required
                        maxLength={200}
                        autoComplete="off"
                        className="h-11 bg-white px-3 text-base md:text-base"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="gameId">公式战昵称</Label>
                      <Textarea
                        id="gameId"
                        name="gameId"
                        required
                        autoComplete="off"
                        placeholder={'一行一个昵称；第一行是主卡人'}
                        className="min-h-20 bg-white px-3 text-base md:text-base"
                      />
                      <p className="text-xs text-[#66717f]">多人共用一张卡时，每行填一个游戏昵称；所有人共用余额和折扣。</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="discount">折扣力度</Label>
                      <Input
                        id="discount"
                        name="discount"
                        required
                        maxLength={50}
                        placeholder="例如：五折"
                        autoComplete="off"
                        className="h-11 bg-white px-3 text-base md:text-base"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="balance">剩余储值（元）</Label>
                      <Input
                        id="balance"
                        name="balance"
                        type="number"
                        required
                        step="0.01"
                        inputMode="decimal"
                        className="h-11 bg-white px-3 text-base md:text-base"
                      />
                    </div>
                    {formError && (
                      <p
                        role="alert"
                        className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                      >
                        {formError}
                      </p>
                    )}
                  </div>

                  <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6 py-4">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={isSaving}
                      className="h-10 px-5"
                    >
                      {isSaving ? '正在保存…' : '保存会员'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>

            <div>
              <p className="mb-1 text-sm font-medium text-[#66717f]">雀庄</p>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                会员储值
              </h1>
            </div>
            <CheckoutFlow
              members={members}
              onStart={() => setCheckoutResult(null)}
              onComplete={setCheckoutResult}
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 pb-1">
            {user.role !== 'admin' && (
              <Button type="button" variant="outline" onClick={openManagement} className="rounded-xl bg-white">
                <ShieldCheck className="size-4" aria-hidden="true" />管理员设置
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)} className="rounded-xl bg-white">
              <History className="size-4" aria-hidden="true" />历史记录
            </Button>
            <Button type="button" variant="outline" onClick={logout} className="rounded-xl bg-white" aria-label="退出登录">
              <LogOut className="size-4" aria-hidden="true" />退出
            </Button>
            <p className="text-sm text-[#66717f]">
              {isLoading ? '正在读取会员…' : `共 ${members.length} 位会员`}
            </p>
          </div>
        </header>

        {loadError && (
          <p
            role="alert"
            className="mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {loadError}
          </p>
        )}

        {checkoutResult && (
          <CheckoutResultsDialog
            result={checkoutResult}
            members={members}
            onClose={() => setCheckoutResult(null)}
            onCharged={(chargedMembers) => {
              const chargedById = new Map(
                chargedMembers.map((member) => [member.id, member]),
              );
              setMembers((current) =>
                current.map((member) => chargedById.get(member.id) ?? member),
              );
              setCheckoutResult(null);
            }}
          />
        )}

        {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}

        <Dialog
          open={editingMember !== null}
          onOpenChange={(open) => {
            if (!open && !isProfileSaving) closeProfileEditor();
          }}
        >
          <DialogContent className="gap-0 rounded-2xl p-0 sm:max-w-md">
            <DialogHeader className="px-6 pt-6 pb-5">
              <DialogTitle className="text-xl font-semibold">
                {editingField === 'wechatId' ? '调整昵称' : '调整折扣'}
              </DialogTitle>
              <DialogDescription className="break-all">
                {editingMember?.wechatId} · {editingMember?.gameId}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleProfileSubmit}>
              <div className="grid gap-3 px-6 pb-6">
                <Label htmlFor="profile-value">
                  {editingField === 'wechatId' ? '新昵称' : '新折扣（0–1）'}
                </Label>
                <Input
                  id="profile-value"
                  type={editingField === 'discount' ? 'number' : 'text'}
                  min={editingField === 'discount' ? '0' : undefined}
                  max={editingField === 'discount' ? '1' : undefined}
                  step={editingField === 'discount' ? '0.0001' : undefined}
                  inputMode={editingField === 'discount' ? 'decimal' : 'text'}
                  required
                  autoFocus
                  maxLength={editingField === 'wechatId' ? 200 : undefined}
                  disabled={isProfileSaving}
                  placeholder={editingField === 'wechatId' ? '请输入昵称' : '例如 0.6（六折）'}
                  value={profileValue}
                  onChange={(event) => {
                    setProfileValue(event.target.value);
                    setProfileError('');
                  }}
                  className="h-11 bg-white px-3 text-base md:text-base"
                />
                {editingField === 'discount' && (
                  <p className="text-sm text-[#66717f]">
                    请输入 0 到 1 之间的数字，例如 0.6 表示六折。
                  </p>
                )}
                {profileError && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {profileError}
                  </p>
                )}
              </div>
              <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6 py-4">
                <Button type="button" variant="outline" disabled={isProfileSaving} onClick={closeProfileEditor}>
                  取消
                </Button>
                <Button type="submit" disabled={isProfileSaving}>
                  {isProfileSaving ? '保存中…' : '保存调整'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={adjustingMember !== null}
          onOpenChange={(open) => {
            if (!open && !isAdjusting) closeAdjustment();
          }}
        >
          <DialogContent className="gap-0 rounded-2xl p-0 sm:max-w-xl">
            <DialogHeader className="px-6 pt-6 pb-5">
              <DialogTitle className="text-xl font-semibold">
                调整余额
              </DialogTitle>
              <DialogDescription className="break-all">
                {adjustingMember?.wechatId} · {adjustingMember?.gameId}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdjust}>
              <div className="grid gap-5 px-6 pb-6">
                <div className="rounded-xl bg-[#eef2f6] px-4 py-3 text-sm text-[#566272]">
                  当前余额：
                  <strong className="font-mono text-lg text-[#17202a]">
                    {currencyFormatter.format(adjustingMember?.balance ?? 0)} 元
                  </strong>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="adjust-direction">调整方式</Label>
                    <Select
                      value={adjustDirection}
                      onValueChange={(value) => {
                        if (value === 'increase' || value === 'decrease') {
                          setAdjustDirection(value);
                          setAdjustError('');
                        }
                      }}
                      disabled={isAdjusting}
                    >
                      <SelectTrigger
                        id="adjust-direction"
                        className="h-11 w-full bg-white px-3 text-base"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="increase">增加余额</SelectItem>
                        <SelectItem value="decrease">减少余额</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adjust-amount">调整金额（元）</Label>
                    <Input
                      id="adjust-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      required
                      disabled={isAdjusting}
                      placeholder="请输入金额"
                      value={adjustAmount}
                      onChange={(event) => {
                        setAdjustAmount(event.target.value);
                        setAdjustError('');
                      }}
                      className="h-11 bg-white px-3 text-base md:text-base"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adjust-discount">折扣（0–1）</Label>
                    <Input
                      id="adjust-discount"
                      type="number"
                      min="0"
                      max="1"
                      step="0.0001"
                      inputMode="decimal"
                      required
                      disabled={isAdjusting}
                      placeholder="如 0.7"
                      value={adjustDiscount}
                      onChange={(event) => {
                        setAdjustDiscount(event.target.value);
                        setAdjustError('');
                      }}
                      className="h-11 bg-white px-3 text-base md:text-base"
                    />
                  </div>
                </div>
                <p className="text-sm text-[#66717f]">
                  实际调整额 = 调整金额 × 本次折扣；不改变会员原有折扣。
                </p>
                {adjustedBalanceCents !== null &&
                  Number.isSafeInteger(adjustedBalanceCents) && (
                    <p className="text-sm text-[#3f4a56]">
                      实际{adjustDirection === 'increase' ? '增加' : '减少'}：
                      {currencyFormatter.format(
                        (effectiveAdjustmentCents ?? 0) / 100,
                      )}{' '}
                      元<span className="mx-2 text-[#a0a9b4]">·</span>
                      调整后余额：
                      {currencyFormatter.format(
                        adjustedBalanceCents / 100,
                      )} 元
                    </p>
                  )}
                {adjustError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                  >
                    {adjustError}
                  </p>
                )}
              </div>
              <DialogFooter className="mx-0 mb-0 rounded-b-2xl px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isAdjusting}
                  onClick={closeAdjustment}
                  className="h-10 px-5"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={isAdjusting}
                  className="h-10 px-5"
                >
                  {isAdjusting ? '保存中…' : '确认调整'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Table className="min-w-[960px] border-separate border-spacing-y-3">
          <TableCaption className="sr-only">
            会员微信 ID、游戏 ID、折扣力度和剩余储值
          </TableCaption>
          <TableBody>
            {members.map((member) => (
              <TableRow
                key={member.id}
                className="border-0 bg-transparent hover:bg-transparent [&>td]:border-y [&>td]:border-[#bfc6cf] [&>td]:bg-white [&>td]:transition-colors hover:[&>td]:border-[#929dab] hover:[&>td]:bg-[#fbfcfd]"
              >
                <TableCell className="h-20 w-[27%] rounded-l-2xl border-l px-6 text-lg font-medium whitespace-normal">
                  <span className="block break-all">{member.wechatId}</span>
                </TableCell>
                <TableCell
                  className="w-24 px-1 text-center"
                >
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLoading || deletingMemberIds.has(member.id)}
                    aria-label={`调整会员 ${member.wechatId} 的昵称`}
                    onClick={() => openProfileEditor(member, 'wechatId')}
                    className="h-9 rounded-lg px-2 text-xs"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    昵称
                  </Button>
                </TableCell>
                <TableCell className="w-[27%] px-6 text-lg font-medium whitespace-normal">
                  <span className="block break-all">{member.gameId}</span>
                  {member.aliases.length > 0 && (
                    <span className="mt-1 block break-all text-xs font-normal text-[#66717f]">
                      同卡昵称：{member.aliases.join('、')}
                    </span>
                  )}
                </TableCell>
                <TableCell
                  className="w-24 px-1 text-center"
                >
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLoading || deletingMemberIds.has(member.id)}
                    aria-label={`调整会员 ${member.wechatId} 的折扣`}
                    onClick={() => openProfileEditor(member, 'discount')}
                    className="h-9 rounded-lg px-2 text-xs"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    折扣
                  </Button>
                </TableCell>
                <TableCell className="w-[14%] px-6 text-lg font-medium text-[#3f4a56]">
                  {member.discount}
                </TableCell>
                <TableCell
                  aria-hidden="true"
                  className="w-8 px-1 text-center text-xl text-[#9aa3af]"
                >
                  —
                </TableCell>
                <TableCell className="w-24 px-2 text-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLoading || deletingMemberIds.has(member.id)}
                    aria-label={`调整会员 ${member.wechatId} 的余额`}
                    onClick={() => {
                      setAdjustingMember(member);
                      setAdjustDirection('increase');
                      setAdjustAmount('');
                      setAdjustDiscount('');
                      setAdjustError('');
                    }}
                    className="h-10 rounded-xl px-3 text-sm"
                  >
                    <SlidersHorizontal className="size-4" aria-hidden="true" />
                    调整
                  </Button>
                </TableCell>
                <TableCell className="w-[22%] px-6 text-right font-mono text-xl font-semibold tracking-[-0.02em] text-[#111820]">
                  {currencyFormatter.format(member.balance)} 元
                </TableCell>
                <TableCell className="w-28 rounded-r-2xl border-r px-4 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={deletingMemberIds.has(member.id)}
                    aria-label={`删除会员 ${member.wechatId}`}
                    onClick={() => void handleDelete(member)}
                    className="h-10 rounded-xl px-3 text-base text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {deletingMemberIds.has(member.id) ? '删除中…' : '删除'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
  );
}
