import { lazy, ReactNode, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoadingState } from './components/ui/States';
import AppShell from './components/layout/AppShell';
import ProtectedRoute from './components/layout/ProtectedRoute';
import DashboardPage from './pages/DashboardPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import RegisterPage from './pages/RegisterPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SettingsPage from './pages/SettingsPage';
import CustomerCreatePage from './pages/customers/CustomerCreatePage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import CustomerEditPage from './pages/customers/CustomerEditPage';
import CustomerListPage from './pages/customers/CustomerListPage';
import AnalyticsPage from './pages/AnalyticsPage';
import { ReceiptPage, ReturnPage } from './pages/documents/DocumentPages';
import ReportsPage from './pages/ReportsPage';
import InvoiceListPage from './pages/invoices/InvoiceListPage';
import InvoicePreviewPage from './pages/invoices/InvoicePreviewPage';
import OrderCreatePage from './pages/orders/OrderCreatePage';
import OrderDetailPage from './pages/orders/OrderDetailPage';
import OrderEditPage from './pages/orders/OrderEditPage';
import OrderListPage from './pages/orders/OrderListPage';
import ProductDetailPage from './pages/products/ProductDetailPage';
import { ProductCreatePage, ProductEditPage } from './pages/products/ProductFormPages';
import ProductListPage from './pages/products/ProductListPage';
import PublicCataloguePage from './pages/catalogue/PublicCataloguePage';
import BillPage from './pages/BillPage';

// Dine-in pages load on demand: they bring the QR code library and the floor editor.
const GuestMenuPage = lazy(() => import('./pages/tables/GuestMenuPage'));
const GuestOrderPage = lazy(() => import('./pages/tables/GuestOrderPage'));
const KitchenPage = lazy(() => import('./pages/tables/KitchenPage'));
const TablesPage = lazy(() => import('./pages/tables/TablesPage'));
const later = (page: ReactNode) => <Suspense fallback={<LoadingState />}>{page}</Suspense>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Public: the link shops send to customers. */}
      <Route path="/c/:token" element={<PublicCataloguePage />} />
      {/* Public: a table's QR code, and the guest's order progress. */}
      <Route path="/t/:token" element={later(<GuestMenuPage />)} />
      <Route path="/o/:guestToken" element={later(<GuestOrderPage />)} />
      <Route path="/bill/:token" element={<BillPage />} />
      <Route element={<ProtectedRoute />}>
        {/* Full screen, no app menu: runs on the kitchen's tablet or TV. */}
        <Route path="kitchen" element={later(<KitchenPage />)} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="customers" element={<CustomerListPage />} />
          <Route path="customers/new" element={<CustomerCreatePage />} />
          <Route path="customers/:id" element={<CustomerDetailPage />} />
          <Route path="customers/:id/edit" element={<CustomerEditPage />} />
          <Route path="orders" element={<OrderListPage />} />
          <Route path="orders/new" element={<OrderCreatePage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="orders/:id/edit" element={<OrderEditPage />} />
          <Route path="invoices" element={<InvoiceListPage />} />
          <Route path="invoices/:id" element={<InvoicePreviewPage />} />
          <Route path="products" element={<ProductListPage />} />
          <Route path="products/new" element={<ProductCreatePage />} />
          <Route path="products/:id" element={<ProductDetailPage />} />
          <Route path="products/:id/edit" element={<ProductEditPage />} />
          <Route path="tables" element={later(<TablesPage />)} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="receipts/:id" element={<ReceiptPage />} />
          <Route path="returns/:id" element={<ReturnPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
