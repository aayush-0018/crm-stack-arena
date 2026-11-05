/**
 * GST. Selling prices include GST, so bills never change: the tax inside an amount is worked out
 * from it. Supplies are treated as within the state, so the tax splits evenly into CGST and SGST.
 * The same maths runs on the server (backend/src/lib/gst.ts); keep the two in step.
 */

/** Rates a product can have (%). 0 = exempt / nil-rated. */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40] as const;

export interface GstSplit {
  /** Amount including GST. */
  grossPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxPaise: number;
}

/** The GST inside an amount that includes it. Rates are handled in basis points, so no floats. */
export function splitInclusive(grossPaise: number, rate: number): GstSplit {
  const bp = BigInt(Math.round(rate * 100));
  const g = BigInt(grossPaise);
  const sign = g < 0n ? -1n : 1n;
  const abs = g * sign;
  const taxable = Number(sign * ((abs * 20000n + 10000n + bp) / (2n * (10000n + bp)))); // half-up
  const tax = grossPaise - taxable;
  const cgst = tax >= 0 ? Math.ceil(tax / 2) : -Math.ceil(-tax / 2);
  return { grossPaise, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: tax - cgst, taxPaise: tax };
}

/**
 * Shares an order-level discount across lines in proportion to their amounts (largest remainder,
 * so the shares add up exactly). Returns each line's amount after its share.
 */
export function netOfDiscount(amounts: number[], discountPaise: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (!discountPaise || !total) return [...amounts];
  const exact = amounts.map((a) => (BigInt(a) * BigInt(discountPaise) * 1000n) / BigInt(total));
  const shares = exact.map((e) => Number(e / 1000n));
  let left = discountPaise - shares.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => ({ i, rem: Number(e % 1000n) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) shares[order[k].i] += 1;
  return amounts.map((a, i) => a - shares[i]);
}

export interface GstRateRow extends GstSplit {
  rate: number;
}

/**
 * GST breakup of a bill: lines grouped by rate, after the discount. Lines with no rate are left
 * out of the rows and returned as `unratedPaise`.
 */
export function gstBreakup(lines: { gstRate?: number | null; lineTotalPaise: number }[], discountPaise: number) {
  const nets = netOfDiscount(
    lines.map((l) => l.lineTotalPaise),
    discountPaise,
  );
  const byRate = new Map<number, number>();
  let unratedPaise = 0;
  lines.forEach((l, i) => {
    if (l.gstRate === null || l.gstRate === undefined) unratedPaise += nets[i];
    else byRate.set(Number(l.gstRate), (byRate.get(Number(l.gstRate)) ?? 0) + nets[i]);
  });
  const rows: GstRateRow[] = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate, gross]) => ({ rate, ...splitInclusive(gross, rate) }));
  return { rows, unratedPaise };
}
