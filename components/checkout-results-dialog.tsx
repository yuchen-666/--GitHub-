'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import type { CheckoutResult } from '@/lib/checkout';
import {
  calculateChargeCents,
  parseDiscountBasisPoints,
  parseUnitPriceCents,
} from '@/lib/checkout-pricing';
import type { Member } from '@/lib/members';

const yuanFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatYuan(cents: number) {
  return `${yuanFormatter.format(cents / 100)} 元`;
}

type Props = {
  result: CheckoutResult;
  members: Member[];
  onClose: () => void;
  onCharged: (members: Member[]) => void;
};

export function CheckoutResultsDialog({ result, members, onClose, onCharged }: Props) {
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [operationId] = useState(() => crypto.randomUUID());
  const [isCharging, setIsCharging] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [chargeError, setChargeError] = useState('');
  const byId = new Map(members.map((member) => [member.id, member]));
  const matched = result.counts
    .filter((item) => item.count > 0 && byId.has(item.memberId))
    .map((item) => ({
      member: byId.get(item.memberId) as Member,
      recognizedCount: item.count,
    }));

  const rows = matched.map(({ member, recognizedCount }) => {
    const rawQuantity = quantities[member.id] ?? String(recognizedCount);
    const count = /^\d{1,5}$/.test(rawQuantity) ? Number(rawQuantity) : Number.NaN;
    const rawPrice = unitPrices[member.id] ?? '';
    const unitPriceCents = parseUnitPriceCents(rawPrice);
    const discountBasisPoints = parseDiscountBasisPoints(member.discount);
    const chargeCents =
      unitPriceCents !== null && discountBasisPoints !== null
        ? calculateChargeCents(unitPriceCents, count, discountBasisPoints)
        : null;
    return { member, count, rawQuantity, rawPrice, discountBasisPoints, chargeCents };
  });
  const canShowTotal =
    rows.length > 0 && rows.every((row) => row.chargeCents !== null);
  const totalCents = rows.reduce((sum, row) => sum + (row.chargeCents ?? 0), 0);
  const canCharge =
    canShowTotal &&
    Number.isSafeInteger(totalCents) &&
    rows.every((row) =>
      Number.isSafeInteger(row.count) && row.count >= 1 && row.count <= 10000 &&
      Number.isSafeInteger(Math.round(row.member.balance * 100) - (row.chargeCents ?? 0)),
    );

  async function confirmCharge() {
    if (!canCharge || isCharging) return;
    setIsCharging(true);
    setHasSubmitted(true);
    setChargeError('');
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId,
          entries: rows.map((row) => ({
            memberId: row.member.id,
            unitPrice: row.rawPrice,
            quantity: row.count,
            expectedBalanceCents: Math.round(row.member.balance * 100),
            expectedDiscount: row.member.discount,
          })),
        }),
      });
      const data = (await response.json()) as {
        members?: Member[];
        error?: string;
      };
      if (!response.ok || !data.members) {
        throw new Error(data.error || '扣费失败，请稍后重试。');
      }
      onCharged(data.members);
    } catch (error) {
      setChargeError(
        error instanceof Error ? error.message : '扣费失败，请稍后重试。',
      );
    } finally {
      setIsCharging(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isCharging) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pt-6 pb-5">
          <DialogTitle className="text-xl font-semibold">
            本次消费明细
          </DialogTitle>
          <DialogDescription>
            同卡昵称的次数已合并到主卡；请核对次数并填写单价。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(65vh,640px)] overflow-y-auto px-4 py-5 sm:px-6">
          {rows.length > 0 ? (
            <Accordion className="gap-3">
              {rows.map(
                ({
                  member,
                  count,
                  rawQuantity,
                  rawPrice,
                  discountBasisPoints,
                  chargeCents,
                }) => (
                  <AccordionItem
                    key={member.id}
                    value={member.id}
                    className="rounded-xl border border-[#d3d9e1] bg-white px-4 shadow-sm last:border-b"
                  >
                    <AccordionTrigger className="min-h-16 items-center gap-3 py-3 hover:no-underline">
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block break-all text-base font-semibold text-[#17202a]">
                          {member.wechatId}
                        </span>
                        <span className="mt-0.5 block break-all text-sm text-[#66717f]">
                          游戏 ID：{member.gameId}
                        </span>
                        {member.aliases.length > 0 && (
                          <span className="mt-0.5 block break-all text-xs text-[#66717f]">
                            同卡昵称：{member.aliases.join('、')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 rounded-full bg-[#eef2f6] px-3 py-1 text-sm text-[#344253]">
                        {Number.isSafeInteger(count) ? count : '—'} 把
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="border-t pt-4 pb-4">
                      <div className="grid gap-3 sm:grid-cols-[1.3fr_0.8fr_0.8fr]">
                        <div className="grid gap-2">
                          <Label htmlFor={`unit-price-${member.id}`}>
                            单价（元／把）
                          </Label>
                          <Input
                            id={`unit-price-${member.id}`}
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            placeholder="请填写"
                            value={rawPrice}
                            disabled={hasSubmitted}
                            onChange={(event) => {
                              setChargeError('');
                              setUnitPrices((current) => ({
                                ...current,
                                [member.id]: event.target.value,
                              }));
                            }}
                            className="h-11 bg-white text-base md:text-base"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`quantity-${member.id}`}>数量（把）</Label>
                          <Input
                            id={`quantity-${member.id}`}
                            type="number"
                            min="1"
                            max="10000"
                            step="1"
                            inputMode="numeric"
                            value={rawQuantity}
                            disabled={hasSubmitted}
                            onChange={(event) => {
                              setChargeError('');
                              setQuantities((current) => ({ ...current, [member.id]: event.target.value }));
                            }}
                            className="h-11 bg-white text-base md:text-base"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label>折扣</Label>
                          <div className="flex h-11 items-center rounded-md border bg-[#f6f8fa] px-3 text-base">
                            {member.discount}
                          </div>
                        </div>
                      </div>
                      {discountBasisPoints === null && (
                        <p role="alert" className="mt-3 text-sm text-red-700">
                          此会员的折扣格式无法计算，请先核对会员资料。
                        </p>
                      )}
                      {rawPrice && parseUnitPriceCents(rawPrice) === null && (
                        <p role="alert" className="mt-3 text-sm text-red-700">
                          单价须为不小于 0 的金额，最多保留两位小数。
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#eef2f6] px-4 py-3">
                        <span className="text-sm text-[#566272]">
                          单价 × {Number.isSafeInteger(count) ? count : '—'} 把 × {member.discount}
                        </span>
                        <strong className="text-lg text-[#17202a]">
                          {chargeCents === null
                            ? '请填写有效单价'
                            : formatYuan(chargeCents)}
                        </strong>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ),
              )}
            </Accordion>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-[#66717f]">
              这张截图中没有识别到已登记会员的游戏 ID。
            </p>
          )}
          <p className="mt-4 text-xs text-[#66717f]">
            截图识别可能漏字，请核对数量；如有偏差可直接修改。点击“确定扣费”后，将按上方金额扣减会员储值。
          </p>
          {chargeError && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {chargeError}
            </p>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 items-center justify-between rounded-b-2xl px-6 py-4">
          <div className="mr-auto text-base font-semibold">
            合计：
            {canShowTotal && Number.isSafeInteger(totalCents)
              ? formatYuan(totalCents)
              : '请填写各会员单价'}
          </div>
          <Button type="button" onClick={onClose} disabled={isCharging} variant="outline">
            关闭
          </Button>
          <Button type="button" onClick={confirmCharge} disabled={!canCharge || isCharging}>
            {isCharging ? '正在扣费…' : hasSubmitted ? '重试扣费' : '确定扣费'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
