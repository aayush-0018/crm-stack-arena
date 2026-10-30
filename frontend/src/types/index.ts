export type OrderStatus = 'open' | 'completed' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type InvoiceStatus = 'issued' | 'superseded' | 'void';
export type CustomerSegment = 'new' | 'active' | 'vip' | 'forgotten';

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface User {
  id: number;
  shopId: number;
  name: string;
  email: string;
  role: 'owner' | 'staff';
}

export interface Shop {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  code: string | null;
  logoKey: string | null;
  /** When off (default), an order that would take a product below zero is refused. */
  allowNegativeStock: boolean;
}

export interface Branch {
  id: number;
  name: string;
  code: string | null;
  city: string | null;
  logoKey: string | null;
  role: 'owner' | 'staff';
}

export interface Session {
  token: string;
  user: User;
  shop: Shop;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  orderCount?: number;
  lastOrderDate?: string | null;
  totalSpentPaise?: number;
  duePaise?: number;
  segment?: CustomerSegment;
}

export interface CustomersSummary {
  total: number;
  active: number;
  forgotten: number;
  vip: number;
  new: number;
  repeaters: number;
  buyers: number;
  avgGapDays: number;
  trend: { weekEnd: string; total: number; active: number }[];
}

export interface InvoiceListItem {
  id: number;
  orderId: number;
  /** null = walk-in sale */
  customerId: number | null;
  invoiceNumber: string;
  revision: number;
  status: InvoiceStatus;
  invoiceDate: string;
  issuedAt: string;
  totalPaise: number;
  orderDuePaise: number;
  orderPaymentStatus: PaymentStatus;
  customerName: string;
  customerPhone: string | null;
  orderNumber: string;
  outdated: boolean;
}

export interface InvoicesSummary {
  issued30: number;
  invoiced30Paise: number;
  duePaise: number;
  issuedTotalPaise: number;
  outdated: number;
  replaced: number;
  total: number;
  daily: { date: string; amountPaise: number; count: number }[];
}

export interface CustomerDetail extends Customer {
  stats: { orderCount: number; allOrderCount: number; totalSpentPaise: number; outstandingPaise: number };
}

export interface OrderItem {
  position: number;
  /** Set when the line was picked from the product list. */
  productId: number | null;
  itemName: string;
  quantity: string;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface OrderBase {
  id: number;
  /** null = walk-in sale */
  customerId: number | null;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  /** Value of returned items; already taken off totalPaise (total = subtotal − discount − returned). */
  returnedPaise: number;
  amountPaidPaise: number;
  notes: string | null;
  orderDate: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem extends OrderBase {
  customerName: string;
  customerPhone: string | null;
  itemCount: number;
}

export interface InvoiceRef {
  id: number;
  invoiceNumber: string;
  revision: number;
  status: InvoiceStatus;
  issuedAt: string;
  outdated: boolean;
}

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank' | 'other';
export type PaymentKind = 'payment' | 'refund';

/** One ledger entry. Voided entries stay in the history and no longer count. */
export interface Payment {
  id: number;
  kind: PaymentKind;
  amountPaise: number;
  /** 'unrecorded' = entered before payment history existed, or no method was given. */
  method: PaymentMethod | 'unrecorded';
  reference: string | null;
  note: string | null;
  paidOn: string;
  createdAt: string;
  createdByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /** Every entry recorded since receipts were introduced has one; older ones can be given one. */
  receiptId: number | null;
  receiptNumber: string | null;
}

export interface Order extends OrderBase {
  customer: Customer | null;
  items: OrderItem[];
  invoice: InvoiceRef | null;
  payments: Payment[];
  returns: OrderReturn[];
}

export type ReturnCondition = 'saleable' | 'damaged';

export interface ReturnItem {
  position: number;
  itemName: string;
  productId: number | null;
  quantity: string;
  unitPricePaise: number;
  grossPaise: number;
  valuePaise: number;
  condition: ReturnCondition;
}

export interface ReturnRefund {
  id: number;
  amountPaise: number;
  method: PaymentMethod | 'unrecorded';
  paidOn: string;
  voidedAt: string | null;
  receiptId: number | null;
  receiptNumber: string | null;
}

export interface OrderReturn {
  id: number;
  orderId: number;
  orderNumber: string;
  returnNumber: string;
  returnDate: string;
  reason: string | null;
  valuePaise: number;
  refundPaise: number;
  createdAt: string;
  createdByName: string | null;
  items: ReturnItem[];
  refunds: ReturnRefund[];
}

/** The internal return adjustment document. */
export interface ReturnDoc extends OrderReturn {
  orderDate: string;
  customerId: number | null;
  shop: Omit<Shop, 'id'>;
  customer: { name: string; phone: string | null };
  invoice: { id: number; invoiceNumber: string; revision: number; status: InvoiceStatus } | null;
}

export interface ReturnPreview {
  orderId: number;
  orderNumber: string;
  returnDate: string;
  valuePaise: number;
  totalBeforePaise: number;
  totalAfterPaise: number;
  paidBeforePaise: number;
  refundPaise: number;
  dueAfterPaise: number;
  refunds: { method: PaymentMethod | 'unrecorded'; amountPaise: number }[];
  lines: { position: number; itemName: string; quantity: number; condition: ReturnCondition; grossPaise: number; valuePaise: number }[];
}

export interface Receipt {
  id: number;
  kind: PaymentKind;
  receiptNumber: string;
  receiptDate: string;
  customerId: number | null;
  method: PaymentMethod | 'unrecorded';
  reference: string | null;
  note: string | null;
  amountPaise: number;
  shopSnapshot: Omit<Shop, 'id'>;
  customerSnapshot: { name: string; phone: string | null; email: string | null; address: string | null };
  allocations: { orderId: number; orderNumber: string; amountPaise: number }[];
  createdAt: string;
  createdByName: string | null;
  /** Part of this receipt later removed from the payment history. */
  voidedPaise: number;
}

export interface SettlePreview {
  totalDuePaise: number;
  amountPaise: number;
  allocations: { orderId: number; orderNumber: string; orderDate: string; duePaise: number; allocatePaise: number; remainingPaise: number }[];
}

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+';

export interface AgeingReport {
  asOf: string;
  from: string | null;
  to: string | null;
  buckets: AgeingBucket[];
  totals: Record<AgeingBucket, number> & { totalPaise: number; orders: number };
  customers: (Record<AgeingBucket, number> & {
    customerId: number | null;
    customerName: string;
    customerPhone: string | null;
    totalPaise: number;
    orders: number;
    oldestOrderDate: string;
  })[];
  orders: {
    id: number;
    orderNumber: string;
    orderDate: string;
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    totalPaise: number;
    paidPaise: number;
    duePaise: number;
    ageDays: number;
    bucket: AgeingBucket;
    invoiceId: number | null;
    invoiceNumber: string | null;
  }[];
}

export interface CollectionTotals {
  receivedPaise: number;
  refundedPaise: number;
  netPaise: number;
  payments: number;
  refunds: number;
}

export interface CollectionsReport {
  from: string;
  to: string;
  rows: (CollectionTotals & { date: string; method: PaymentMethod | 'unrecorded' })[];
  byMethod: (CollectionTotals & { method: PaymentMethod | 'unrecorded' })[];
  byDate: (CollectionTotals & { date: string })[];
  totals: CollectionTotals;
}

export interface Invoice {
  id: number;
  orderId: number;
  invoiceNumber: string;
  revision: number;
  status: InvoiceStatus;
  orderVersion: number;
  issuedAt: string;
  invoiceDate: string;
  shopSnapshot: Omit<Shop, 'id'>;
  customerSnapshot: { name: string; phone: string | null; email: string | null; address: string | null };
  orderSnapshot: { orderNumber: string; orderDate: string; status: OrderStatus; notes: string | null };
  itemsSnapshot: OrderItem[];
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  paymentStatus: PaymentStatus;
  shareToken: string | null;
  shares: InvoiceShare[];
}

export type ShareChannel = 'whatsapp' | 'email' | 'share' | 'link' | 'download';

export interface InvoiceShare {
  channel: ShareChannel;
  recipient: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  customers: number;
  ordersToday: number;
  openOrders: number;
  unpaidOrders: number;
}

export type AnalyticsDays = 7 | 30 | 90 | 180;

export interface Analytics {
  days: AnalyticsDays;
  summary: {
    revenuePaise: number;
    orders: number;
    collectedPaise: number;
    outstandingPaise: number;
    prevRevenuePaise: number;
    prevOrders: number;
    activeCustomers: number;
    /** Money received in the window by payment date (payments minus refunds). */
    receivedPaise: number;
    prevReceivedPaise: number;
  };
  daily: { date: string; revenuePaise: number; collectedPaise: number; receivedPaise: number; orders: number }[];
  payment: { status: PaymentStatus; orders: number; duePaise: number }[];
  status: { status: OrderStatus; orders: number }[];
  topCustomers: { id: number; name: string; orders: number; revenuePaise: number }[];
  topItems: { name: string; orders: number; revenuePaise: number }[];
}

export interface DailySummary {
  date: string;
  from: string;
  to: string;
  orders: number;
  revenuePaise: number;
  collectedPaise: number;
  unpaidOrders: number;
  cancelled: number;
  prevOrders: number;
  prevRevenuePaise: number;
  itemLines: number;
  unitsSold: number;
  newCustomers: number;
  invoicesIssued: number;
  invoicesSent: number;
  topItems: { name: string; units: number; revenuePaise: number }[];
  topCustomer: { id: number; name: string; orders: number; spentPaise: number } | null;
  busiestHour: { hour: number; orders: number } | null;
  outstanding: { duePaise: number; dueOrders: number };
  /** Payments minus refunds entered in the window, on any order. */
  receivedPaise: number;
  refundedPaise: number;
}

export const PRODUCT_UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'box', 'pack', 'dozen', 'pair', 'set'] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Quantities are integer milli-units (1.5 kg = 1500). */
export interface Product {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  unit: ProductUnit;
  pricePaise: number;
  costPaise: number | null;
  trackStock: boolean;
  lowStockMilli: number | null;
  active: boolean;
  stockMilli: number;
  /** Tracked and at/below its warning level, or below zero. */
  low: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StockMovementKind = 'opening' | 'receipt' | 'adjustment' | 'stocktake' | 'write_off' | 'sale' | 'sale_reversal';

export interface StockMovement {
  id: number;
  kind: StockMovementKind;
  qtyMilli: number;
  /** Stock level right after this movement. */
  balanceMilli: number;
  orderId: number | null;
  orderNumber: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface ProductDetail extends Product {
  movements: StockMovement[];
}

export interface ImportRowResult {
  /** Position in the rows sent, counted like a sheet: the first data row is 2. */
  row: number;
  action: 'create' | 'update' | 'error';
  id?: number;
  name?: string;
  errors?: Record<string, string>;
  note?: string;
}

export interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}
