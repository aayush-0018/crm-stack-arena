import type {
  Analytics,
  Branch,
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
  PaymentStatus,
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
  update: (body: Omit<Shop, 'id' | 'logoKey'>) => api.put<Shop>('/shop', body),
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
  update: (id: number | string, body: CustomerPayload) => api.put<Customer>(`/customers/${id}`, body),
  remove: (id: number | string, purge = false) =>
    api.delete<{ deleted: 'hard' | 'soft'; orderCount: number }>(`/customers/${id}${purge ? '?purge=true' : ''}`),
  orders: (id: number | string, q: { page?: number; pageSize?: number }) =>
    api.get<Paged<OrderListItem>>(`/customers/${id}/orders`, q),
};

export interface OrderItemPayload {
  itemName: string;
  quantity: string;
  unitPrice: string;
}

export interface OrderPayload {
  items: OrderItemPayload[];
  discount: string;
  amountPaid: string;
  notes: string | null;
  orderDate?: string;
}

export interface OrderCreatePayload extends OrderPayload {
  idempotencyKey: string;
  customerId?: number;
  newCustomer?: CustomerPayload;
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

export const ordersApi = {
  list: (q: OrderListQuery) => api.get<Paged<OrderListItem>>('/orders', { ...q }),
  get: (id: number | string) => api.get<Order>(`/orders/${id}`),
  create: (body: OrderCreatePayload) => api.post<Order>('/orders', body),
  update: (id: number | string, body: OrderPayload) => api.put<Order>(`/orders/${id}`, body),
  setStatus: (id: number | string, status: OrderStatus) => api.patch<Order>(`/orders/${id}/status`, { status }),
  setPayment: (id: number | string, amountPaid: string) =>
    api.patch<Order>(`/orders/${id}/payment`, { amountPaid }),
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
  logShare: (id: number | string, channel: ShareChannel, recipient?: string | null) =>
    api.post<InvoiceShare[]>(`/invoices/${id}/shares`, { channel, recipient: recipient ?? null }),
};

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  analytics: (days: AnalyticsDays) => api.get<Analytics>('/dashboard/analytics', { days }),
  dailySummary: (date: string) => api.get<DailySummary>('/dashboard/daily-summary', { date }),
};
