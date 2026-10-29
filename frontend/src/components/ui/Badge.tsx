import type { CustomerSegment, InvoiceStatus, OrderStatus, PaymentStatus } from '../../types';

const TONES = {
  green: 'bg-[#e6f2e1] text-[#2e7031]',
  blue: 'bg-[#e7eefa] text-[#2f5ea8]',
  gray: 'bg-[#efefec] text-[#6b6b66]',
  yellow: 'bg-[#f7efd2] text-[#80650c]',
  amber: 'bg-[#fcecd8] text-[#9a5a0a]',
  red: 'bg-[#fbe5e2] text-[#a8321f]',
};
export type Tone = keyof typeof TONES;

export function Pill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}
/** Backwards-compatible name. */
export const Badge = ({ color, children }: { color: Tone; children: string }) => <Pill tone={color}>{children}</Pill>;

const ORDER: Record<OrderStatus, [Tone, string]> = {
  open: ['blue', 'Open'],
  completed: ['green', 'Completed'],
  cancelled: ['gray', 'Cancelled'],
};
const PAYMENT: Record<PaymentStatus, [Tone, string]> = {
  unpaid: ['red', 'Unpaid'],
  partial: ['amber', 'Partial'],
  paid: ['green', 'Paid'],
};
const INVOICE: Record<InvoiceStatus, [Tone, string]> = {
  issued: ['green', 'Issued'],
  superseded: ['yellow', 'Replaced'],
  void: ['gray', 'Cancelled'],
};
const SEGMENT: Record<CustomerSegment, [Tone, string]> = {
  new: ['blue', 'New'],
  active: ['green', 'Active'],
  vip: ['yellow', 'VIP'],
  forgotten: ['gray', 'Forgotten'],
};

export const StatusBadge = ({ status }: { status: OrderStatus }) => <Pill tone={ORDER[status][0]}>{ORDER[status][1]}</Pill>;
export const PaymentBadge = ({ status }: { status: PaymentStatus }) => <Pill tone={PAYMENT[status][0]}>{PAYMENT[status][1]}</Pill>;
export const InvoiceBadge = ({ status, outdated }: { status: InvoiceStatus; outdated?: boolean }) =>
  outdated && status === 'issued' ? <Pill tone="amber">Needs reissue</Pill> : <Pill tone={INVOICE[status][0]}>{INVOICE[status][1]}</Pill>;
export const SegmentBadge = ({ segment }: { segment: CustomerSegment }) => (
  <Pill tone={SEGMENT[segment][0]}>{SEGMENT[segment][1]}</Pill>
);

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { open: 'Open', completed: 'Completed', cancelled: 'Cancelled' };
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid' };
export const SEGMENT_LABEL: Record<CustomerSegment, string> = { new: 'New', active: 'Active', vip: 'VIP', forgotten: 'Forgotten' };
