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
  customerId: number;
  invoiceNumber: string;
  revision: number;
  status: InvoiceStatus;
  invoiceDate: string;
  issuedAt: string;
  totalPaise: number;
  orderDuePaise: number;
  orderPaymentStatus: PaymentStatus;
  customerName: string;
  customerPhone: string;
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
  itemName: string;
  quantity: string;
  unitPricePaise: number;
  lineTotalPaise: number;
}

export interface OrderBase {
  id: number;
  customerId: number;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  notes: string | null;
  orderDate: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderListItem extends OrderBase {
  customerName: string;
  customerPhone: string;
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

export interface Order extends OrderBase {
  customer: Customer | null;
  items: OrderItem[];
  invoice: InvoiceRef | null;
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
  customerSnapshot: { name: string; phone: string; email: string | null; address: string | null };
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
  };
  daily: { date: string; revenuePaise: number; collectedPaise: number; orders: number }[];
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
}
