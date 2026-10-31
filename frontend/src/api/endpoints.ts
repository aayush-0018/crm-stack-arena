import type {
  AgeingReport,
  CollectionsReport,
  ImportResult,
  OrderReturn,
  Receipt,
  ReturnCondition,
  ReturnDoc,
  ReturnPreview,
  SettlePreview,
  Analytics,
  Branch,
  CatalogueSettings,
  PublicCatalogue,
  AnalyticsDays,
  Customer,
  CustomerDetail,
  CustomerSegment,
  DailySummary,
  CustomersSummary,
  DashboardSummary,
  Invoice,
  InvoiceListItem,
  InvoicesSummary,
  InvoiceShare,
  InvoiceStatus,
  Order,
  OrderListItem,
  OrderStatus,
  Paged,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductDetail,
  ProductUnit,
  Session,
  ShareChannel,
  Shop,
  User,
} from '../types';
import { api } from './client';

export const authApi = {
  login: (body: { email: string; password: string }) => api.post<Session>('/auth/login', body),
  register: (body: { shopName: string; name: string; email: string; password: string }) =>
    api.post<Session>('/auth/register', body),
  me: () => api.get<{ user: User; shop: Shop }>('/auth/me'),
  switchBranch: (shopId: number) => api.post<Session>('/auth/switch-branch', { shopId }),
  forgotPassword: (email: string) => api.post<{ ok: true }>('/auth/forgot-password', { email }),
  checkResetToken: (token: string) => api.get<{ valid: boolean; email?: string }>(`/auth/reset-password/${encodeURIComponent(token)}`),
  resetPassword: (token: string, password: string) => api.post<Session>('/auth/reset-password', { token, password }),
};

export const branchesApi = {
  list: () => api.get<Branch[]>('/branches'),
  create: (body: { name: string; code: string | null; city: string | null; phone: string | null }) =>
    api.post<Branch>('/branches', body),
};

export const shopApi = {
  get: () => api.get<Shop>('/shop'),
  update: (body: Omit<Shop, 'id' | 'logoKey' | 'allowNegativeStock'> & { allowNegativeStock?: boolean }) => api.put<Shop>('/shop', body),
  uploadLogo: (dataUrl: string) => api.put<Shop>('/shop/logo', { dataUrl }),
  removeLogo: () => api.delete<Shop>('/shop/logo'),
};

export interface CustomerPayload {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export const customersApi = {
  list: (q: {
    search?: string;
    segment?: CustomerSegment | '';
    sort?: 'name' | 'created' | 'lastOrder' | 'spent' | 'orders';
    dir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }) => api.get<Paged<Customer>>('/customers', q),
  summary: () => api.get<CustomersSummary>('/customers/summary'),
  get: (id: number | string) => api.get<CustomerDetail>(`/customers/${id}`),
  create: (body: CustomerPayload) => api.post<Customer>('/customers', body),
  /** CSV import; dryRun = preview only. */
  importRows: (rows: Record<string, string>[], dryRun: boolean) => api.post<ImportResult>('/customers/import', { rows, dryRun }),
  update: (id: number | string, body: CustomerPayload) => api.put<Customer>(`/customers/${id}`, body),
  remove: (id: number | string, purge = false) =>
    api.delete<{ deleted: 'hard' | 'soft'; orderCount: number }>(`/customers/${id}${purge ? '?purge=true' : ''}`),
  orders: (id: number | string, q: { page?: number; pageSize?: number }) =>
    api.get<Paged<OrderListItem>>(`/customers/${id}/orders`, q),
};

export interface OrderItemPayload {
  productId?: number | null;
  itemName: string;
  quantity: string;
  unitPrice: string;
}

export interface OrderPayload {
  items: OrderItemPayload[];
  discount: string;
  /** Create only. Edits leave payments to the ledger (POST /orders/:id/payments). */
  amountPaid?: string;
  /** Create only: how the amount paid was paid. */
  paymentMethod?: PaymentMethod;
  notes: string | null;
  orderDate?: string;
}

export interface OrderCreatePayload extends OrderPayload {
  idempotencyKey: string;
  customerId?: number;
  newCustomer?: CustomerPayload;
  /** Counter sale with no customer. */
  walkIn?: boolean;
}

export interface OrderListQuery {
  search?: string;
  status?: OrderStatus | '';
  paymentStatus?: PaymentStatus | '';
  /** Only orders with money still owed (not cancelled, paid < total). */
  due?: 'true';
  from?: string;
  to?: string;
  sort?: 'date' | 'total' | 'number';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface PaymentEntryPayload {
  kind: PaymentKind;
  amount: string;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  note: string | null;
  idempotencyKey: string;
}

export const ordersApi = {
  list: (q: OrderListQuery) => api.get<Paged<OrderListItem>>('/orders', { ...q }),
  get: (id: number | string) => api.get<Order>(`/orders/${id}`),
  create: (body: OrderCreatePayload) => api.post<Order>('/orders', body),
  update: (id: number | string, body: OrderPayload) => api.put<Order>(`/orders/${id}`, body),
  setStatus: (id: number | string, status: OrderStatus, refund?: { method: PaymentMethod }) =>
    api.patch<Order>(`/orders/${id}/status`, { status, refund }),
  addPayment: (id: number | string, body: PaymentEntryPayload) => api.post<Order>(`/orders/${id}/payments`, body),
  voidPayment: (id: number | string, paymentId: number, reason: string | null) =>
    api.post<Order>(`/orders/${id}/payments/${paymentId}/void`, { reason }),
  /** The entry's receipt id; issues one for entries recorded before receipts existed. */
  receiptFor: (id: number | string, paymentId: number) => api.post<{ receiptId: number }>(`/orders/${id}/payments/${paymentId}/receipt`),
  remove: (id: number | string) => api.delete<{ orderNumber: string; deletedInvoices: number }>(`/orders/${id}`),
};

export const invoicesApi = {
  generate: (orderId: number | string, reissue = false) =>
    api.post<Invoice>(`/orders/${orderId}/invoice`, {}, reissue ? { reissue: 'true' } : undefined),
  get: (id: number | string) => api.get<Invoice>(`/invoices/${id}`),
  list: (q: { search?: string; status?: InvoiceStatus | 'needs_reissue' | ''; from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<Paged<InvoiceListItem>>('/invoices', q),
  summary: () => api.get<InvoicesSummary>('/invoices/summary'),
  remove: (id: number | string) => api.delete<{ orderId: number; invoiceNumber: string; revision: number }>(`/invoices/${id}`),
  pdf: (id: number | string) => api.blob(`/invoices/${id}/pdf`),
  shareLink: (id: number | string) => api.post<{ token: string }>(`/invoices/${id}/share-link`),
  resetShareLink: (id: number | string) => api.post<{ token: string }>(`/invoices/${id}/share-link/reset`),
  logShare: (id: number | string, channel: ShareChannel, recipient?: string | null) =>
    api.post<InvoiceShare[]>(`/invoices/${id}/shares`, { channel, recipient: recipient ?? null }),
};

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  analytics: (days: AnalyticsDays) => api.get<Analytics>('/dashboard/analytics', { days }),
  dailySummary: (date: string) => api.get<DailySummary>('/dashboard/daily-summary', { date }),
};

export interface ProductPayload {
  name: string;
  sku: string | null;
  category: string | null;
  unit: ProductUnit;
  price: string;
  cost: string | null;
  trackStock: boolean;
  lowStockAt: string | null;
}

export const productsApi = {
  list: (q: { search?: string; status?: 'active' | 'low' | 'archived'; page?: number; pageSize?: number }) =>
    api.get<Paged<Product>>('/products', q),
  lowStockCount: () => api.get<{ count: number }>('/products/low-stock-count'),
  get: (id: number | string) => api.get<ProductDetail>(`/products/${id}`),
  create: (body: ProductPayload & { openingStock: string | null }) => api.post<ProductDetail>('/products', body),
  /** CSV import; dryRun = preview only. */
  importRows: (rows: Record<string, string>[], dryRun: boolean) => api.post<ImportResult>('/products/import', { rows, dryRun }),
  update: (id: number | string, body: ProductPayload) => api.put<ProductDetail>(`/products/${id}`, body),
  setActive: (id: number | string, active: boolean) => api.patch<ProductDetail>(`/products/${id}/active`, { active }),
  addStock: (
    id: number | string,
    body: { kind: 'receipt' | 'write_off' | 'stocktake'; qty: string; note: string | null; idempotencyKey: string },
  ) => api.post<ProductDetail>(`/products/${id}/stock`, body),
};

export type CatalogueSettingsPayload = Pick<CatalogueSettings, 'template' | 'title' | 'tagline' | 'showPrices' | 'hideOutOfStock' | 'showBranches'>;

export const catalogueApi = {
  get: () => api.get<CatalogueSettings | null>('/catalogue'),
  /** Creates the catalogue, or turns its link back on. */
  enable: () => api.post<CatalogueSettings>('/catalogue'),
  update: (body: CatalogueSettingsPayload) => api.put<CatalogueSettings>('/catalogue', body),
  resetLink: () => api.post<CatalogueSettings>('/catalogue/reset-link'),
  turnOff: () => api.delete<CatalogueSettings>('/catalogue/link'),
  /** No login: the token is the permission. */
  publicGet: (token: string) => api.get<PublicCatalogue>(`/public/catalogues/${encodeURIComponent(token)}`),
};

export interface SettlePayload {
  amount: string;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  note: string | null;
  idempotencyKey: string;
}

export const settleApi = {
  preview: (customerId: number | string, body: SettlePayload) =>
    api.post<SettlePreview>(`/customers/${customerId}/settle`, { ...body, dryRun: true }),
  save: (customerId: number | string, body: SettlePayload) =>
    api.post<{ created: boolean; receipt: Receipt }>(`/customers/${customerId}/settle`, { ...body, dryRun: false }),
};

export const receiptsApi = {
  get: (id: number | string) => api.get<Receipt>(`/receipts/${id}`),
  pdf: (id: number | string) => api.blob(`/receipts/${id}/pdf`),
};

export interface ReturnPayload {
  items: { position: number; quantity: string; condition: ReturnCondition }[];
  reason: string | null;
  refundMethod: 'original' | PaymentMethod;
  idempotencyKey: string;
}

export const returnsApi = {
  preview: (orderId: number | string, body: ReturnPayload) =>
    api.post<{ preview: ReturnPreview }>(`/orders/${orderId}/returns`, { ...body, dryRun: true }),
  save: (orderId: number | string, body: ReturnPayload) =>
    api.post<{ created: boolean; return: OrderReturn; order: Order }>(`/orders/${orderId}/returns`, { ...body, dryRun: false }),
  get: (id: number | string) => api.get<ReturnDoc>(`/returns/${id}`),
  pdf: (id: number | string) => api.blob(`/returns/${id}/pdf`),
};

export const reportsApi = {
  ageing: (q: { from?: string; to?: string }) => api.get<AgeingReport>('/reports/ageing', q),
  collections: (q: { from?: string; to?: string }) => api.get<CollectionsReport>('/reports/collections', q),
};
