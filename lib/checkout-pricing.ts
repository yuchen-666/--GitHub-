const chineseDigits: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Returns the discount rate in basis points: 五折 = 5000. */
export function parseDiscountBasisPoints(value: string): number | null {
  const text = value.trim().normalize('NFKC').replace(/\s+/g, '');
  if (!text) return null;

  const percent = text.match(/^(\d+(?:\.\d+)?)%$/);
  if (percent) {
    const rate = Math.round(Number(percent[1]) * 100);
    return Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : null;
  }

  const chinese = text.match(/^([零〇一二两三四五六七八九十]{1,3})折$/);
  if (chinese) {
    if (chinese[1] === '十') return 10000;
    const digits = chinese[1].split('').map((digit) => chineseDigits[digit]);
    if (digits.some((digit) => digit === undefined)) return null;
    const numeric = Number(digits.join(''));
    const rate = numeric * 10 ** (4 - digits.length);
    return rate >= 0 && rate <= 10000 ? rate : null;
  }

  const zhe = text.match(/^(\d+(?:\.\d+)?)折$/);
  if (zhe) {
    const numeric = Number(zhe[1]);
    const rate = numeric <= 10 ? numeric * 1000 : numeric * 100;
    return Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : null;
  }

  const decimal = text.match(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/);
  if (decimal) {
    const rate = Number(text) * 10000;
    return Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : null;
  }

  return null;
}

/** Parses a nonnegative yuan amount with at most two decimal places. */
export function parseUnitPriceCents(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(text)) return null;
  const [yuan, fractional = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fractional.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Parses a one-off adjustment multiplier from 0 to 1, to four decimals. */
export function parseAdjustmentRateBasisPoints(value: string): number | null {
  const match = value.trim().match(/^([01])(?:\.(\d{1,4}))?$/);
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (match[1] === '1') return /^0*$/.test(fraction) ? 10000 : null;
  return Number(fraction.padEnd(4, '0'));
}

/** Rounds the final charge to the nearest cent, half up. */
export function calculateChargeCents(
  unitPriceCents: number,
  quantity: number,
  discountBasisPoints: number,
): number | null {
  if (
    !Number.isSafeInteger(unitPriceCents) ||
    unitPriceCents < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0 ||
    !Number.isInteger(discountBasisPoints) ||
    discountBasisPoints < 0 ||
    discountBasisPoints > 10000
  ) {
    return null;
  }
  const cents =
    (BigInt(unitPriceCents) * BigInt(quantity) * BigInt(discountBasisPoints) +
      BigInt(5000)) /
    BigInt(10000);
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
