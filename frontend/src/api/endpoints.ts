import type {
  Analytics,
  AnalyticsDays,
  Customer,
  CustomerDetail,
  CustomerSegment,
  CustomersSummary,
  DashboardSummary,
  Invoice,
  InvoiceListItem,
  InvoicesSummary,
  InvoiceStatus,
  Order,
  OrderListItem,
  OrderStatus,
  Paged,
  PaymentStatus,
  Session,
  Shop,
  User,
} from '../types';
import { api } from './client';

export const authApi = {
  login: (body: { email: string; password: string }) => api.post<Session>('/auth/login', body),
  register: (body: { shopName: string; name: string; email: string; password: string }) =>
    api.post<Session>('/auth/register', body),
  me: () => api.get<{ user: User; shop: Shop }>('/auth/me'),
};

export const shopApi = {
  get: () => api.get<Shop>('/shop'),
  update: (body: Omit<Shop, 'id'>) => api.put<Shop>('/shop', body),
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
  remove: (id: number | string) => api.delete<{ deleted: 'hard' | 'soft'; orderCount: number }>(`/customers/${id}`),
  orders: (id: number | string, q: { page?: number; pageSize?: number }) =>
    api.get<Paged<OrderListItem>>(`/customers/${id}/orders`, q),
};

export interface OrderItemPayload {
  itemName: string;
  quantity: string;
  unit: string | null;
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
};

export const invoicesApi = {
  generate: (orderId: number | string, reissue = false) =>
    api.post<Invoice>(`/orders/${orderId}/invoice`, {}, reissue ? { reissue: 'true' } : undefined),
  get: (id: number | string) => api.get<Invoice>(`/invoices/${id}`),
  list: (q: { search?: string; status?: InvoiceStatus | ''; page?: number; pageSize?: number }) =>
    api.get<Paged<InvoiceListItem>>('/invoices', q),
  summary: () => api.get<InvoicesSummary>('/invoices/summary'),
  pdf: (id: number | string) => api.blob(`/invoices/${id}/pdf`),
};

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary'),
  analytics: (days: AnalyticsDays) => api.get<Analytics>('/dashboard/analytics', { days }),
};
