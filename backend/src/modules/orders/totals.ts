import { AppError } from '../../lib/errors';
import { lineTotalPaise, milliToQuantity } from '../../lib/money';
import { LineItemInput, PaymentStatus } from './orders.schemas';

export interface ComputedLine {
  position: number;
  itemName: string;
  quantity: string;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface ComputedTotals {
  lines: ComputedLine[];
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  paymentStatus: PaymentStatus;
}

export function derivePaymentStatus(amountPaidPaise: number, totalPaise: number): PaymentStatus {
  if (amountPaidPaise >= totalPaise) return 'paid'; // includes ₹0 orders: nothing is owed
  return amountPaidPaise <= 0 ? 'unpaid' : 'partial';
}

export function assertPaidWithinTotal(amountPaidPaise: number, totalPaise: number) {
  if (amountPaidPaise > totalPaise) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Amount paid cannot be more than the order total', {
      amountPaid: 'Amount paid cannot be more than the order total',
    });
  }
}

/** Server-side source of truth for every amount. Client totals are never used. */
export function computeTotals(
  items: LineItemInput[],
  discountPaise: number,
  amountPaidPaise: number,
): ComputedTotals {
  const lines = items.map((it, i) => ({
    position: i + 1,
    itemName: it.itemName,
    quantity: milliToQuantity(it.quantity),
    unitPricePaise: it.unitPrice,
    lineTotalPaise: lineTotalPaise(it.quantity, it.unitPrice),
  }));
  const subtotalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);

  if (discountPaise > subtotalPaise) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Discount cannot be more than the subtotal', {
      discount: 'Discount cannot be more than the subtotal',
    });
  }
  const totalPaise = subtotalPaise - discountPaise;
  assertPaidWithinTotal(amountPaidPaise, totalPaise);

  return {
    lines,
    subtotalPaise,
    discountPaise,
    totalPaise,
    amountPaidPaise,
    paymentStatus: derivePaymentStatus(amountPaidPaise, totalPaise),
  };
}
