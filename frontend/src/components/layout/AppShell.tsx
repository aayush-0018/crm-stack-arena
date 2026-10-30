import {
  ArrowLeftRight,
  Bell,
  ChartLine,
  Contact,
  FileText,
  LayoutGrid,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SlidersHorizontal,
  UserPlus,
  X,
} from 'lucide-react';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { dashboardApi, invoicesApi, productsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../ui/Avatar';
import Popover, { MenuItem } from '../ui/Popover';
import ShopLogo from '../ui/ShopLogo';
import { useDailySummary } from '../../lib/dailySummary';
import BranchSwitcher from './BranchSwitcher';
import DailySummaryModal from './DailySummaryModal';

const ICON = { size: 17, strokeWidth: 1.6 };

function NavItem({ to, icon, label, count, end, onClick }: { to: string; icon: ReactNode; label: string; count?: number; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[14.5px] transition-colors ${
          isActive ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
        }`
      }
    >
      <span className="flex w-5 justify-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {!!count && (
        <span className="min-w-[22px] rounded-md border border-line bg-white px-1.5 text-center text-[11px] font-medium leading-[20px] text-ink-2">
          {count}
        </span>
      )}
    </NavLink>
  );
}

/** Opens the 10 pm daily summary; shows a badge until it's been read. */
function NotificationsItem({ unread, onClick }: { unread: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14.5px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
    >
      <span className="flex w-5 justify-center">
        <Bell {...ICON} />
      </span>
      <span className="flex-1 truncate">Notifications</span>
      {unread && (
        <span className="min-w-[22px] rounded-md border border-line bg-white px-1.5 text-center text-[11px] font-medium leading-[20px] text-ink-2">
          1
        </span>
      )}
    </button>
  );
}

function BellButton({ unread, onClick }: { unread: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? 'Notifications: daily summary ready' : 'Notifications'}
      title="Daily summary"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Bell size={18} strokeWidth={1.6} />
      {unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#d0503f] ring-2 ring-canvas" />}
    </button>
  );
}

const SectionLabel = ({ children }: { children: string }) => <p className="px-2.5 pb-1.5 pt-6 text-[13px] text-ink-3">{children}</p>;

export default function AppShell() {
  const { shop, user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false); // mobile drawer
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('crm.sidebar') !== '0';
    } catch {
      return true;
    }
  }); // desktop sidebar, remembered
  const [counts, setCounts] = useState<{ open?: number; outdated?: number; lowStock?: number }>({});
  const daily = useDailySummary(shop?.id);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const openSummary = () => {
    setMenuOpen(false);
    setSummaryOpen(true);
    daily.markSeen();
  };

  // Badge counts; refreshed on navigation.
  useEffect(() => {
    let cancelled = false;
    Promise.all([dashboardApi.summary(), invoicesApi.summary(), productsApi.lowStockCount()])
      .then(([d, i, p]) => !cancelled && setCounts({ open: d.openOrders, outdated: i.outdated, lowStock: p.count }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname, shop?.id]);

  useEffect(() => setMenuOpen(false), [pathname]);

  const toggleSidebar = useCallback(
    () =>
      setSidebarOpen((open) => {
        try {
          localStorage.setItem('crm.sidebar', open ? '0' : '1');
        } catch {
          /* storage unavailable: lasts until reload */
        }
        return !open;
      }),
    [],
  );

  // Ctrl/⌘+B hides or shows the menu: the drawer on phones, the sidebar on larger screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (window.matchMedia('(min-width: 768px)').matches) toggleSidebar();
        else setMenuOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col px-3 pb-3 pt-4">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <BranchSwitcher />
        </div>
        <button
          type="button"
          onClick={mobile ? () => setMenuOpen(false) : toggleSidebar}
          aria-label={mobile ? 'Close menu' : 'Hide menu'}
          title={mobile ? 'Close menu' : 'Hide menu (Ctrl+B)'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
        >
          {mobile ? <X size={19} strokeWidth={1.6} /> : <PanelLeftClose size={17} strokeWidth={1.6} />}
        </button>
      </div>

      <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto">
        <NotificationsItem unread={daily.unread} onClick={openSummary} />
        <NavItem to="/orders/new" icon={<Plus {...ICON} />} label="New order" />
        <NavItem to="/customers/new" icon={<UserPlus {...ICON} />} label="Add customer" />

        <SectionLabel>Work</SectionLabel>
        <NavItem to="/" end icon={<LayoutGrid {...ICON} />} label="Dashboard" />
        <NavItem to="/customers" icon={<Contact {...ICON} />} label="Customers" />
        <NavItem to="/orders" icon={<ArrowLeftRight {...ICON} />} label="Orders" count={counts.open} />
        <NavItem to="/invoices" icon={<FileText {...ICON} />} label="Invoices" count={counts.outdated} />
        <NavItem to="/products" icon={<Package {...ICON} />} label="Products" count={counts.lowStock} />
        <NavItem to="/analytics" icon={<ChartLine {...ICON} />} label="Analytics and reports" />

        <SectionLabel>Shop</SectionLabel>
        <NavItem to="/settings" icon={<Settings {...ICON} />} label="Settings" />
      </nav>

      <div className="mt-3 flex items-center gap-2.5 px-1.5">
        <Avatar name={user?.name ?? '?'} size={32} />
        <span className="flex-1 truncate text-[14.5px] text-ink">{user?.name}</span>
        <Popover
          align="end"
          placement="top"
          width={200}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="Account menu" className="rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink">
              <SlidersHorizontal size={16} strokeWidth={1.6} />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-2 py-1.5 text-[12px] text-ink-3">{user?.email}</div>
              <MenuItem icon={<Settings size={15} />} onClick={() => { close(); navigate('/settings'); }}>
                Settings
              </MenuItem>
              <MenuItem icon={<LogOut size={15} />} onClick={signOut}>
                Log out
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
      <p className="mt-2 select-none px-1.5 text-[11px] tracking-[0.04em] text-ink-4" aria-label="CartWell">
        Powered by <span className="font-semibold text-ink-3">CartWell</span>
      </p>
    </div>
  );

  return (
    <div className="app-root flex h-screen bg-canvas">
      {/* Desktop: full sidebar, or a slim rail with one button to bring it back */}
      {sidebarOpen ? (
        <aside className="no-print hidden w-[272px] shrink-0 md:block">{sidebar(false)}</aside>
      ) : (
        <div className="no-print hidden w-14 shrink-0 flex-col items-center pt-4 md:flex">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Show menu"
            title="Show menu (Ctrl+B)"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"
          >
            <PanelLeftOpen size={18} strokeWidth={1.6} />
          </button>
          <BellButton unread={daily.unread} onClick={openSummary} />
        </div>
      )}

      {/* Mobile drawer: hamburger opens it; the X, a tap outside, or picking a page closes it */}
      {menuOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-ink/20" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-canvas shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar(true)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 items-center gap-3 px-3 md:hidden">
          <button
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg p-2 text-ink-2 hover:bg-hover"
          >
            {menuOpen ? <X size={20} strokeWidth={1.6} /> : <Menu size={20} strokeWidth={1.6} />}
          </button>
          <ShopLogo logoKey={shop?.logoKey} name={shop?.name} size={26} />
          <span className="flex-1 truncate text-[15px] font-semibold">{shop?.name}</span>
          <BellButton unread={daily.unread} onClick={openSummary} />
        </header>
        <main className="app-panel min-h-0 flex-1 overflow-y-auto border-line bg-white md:my-2 md:mr-2 md:rounded-2xl md:border md:shadow-soft">
          {/* Keyed by branch: switching remounts every page, so nothing from the old branch lingers. */}
          <Outlet key={shop?.id} />
        </main>
      </div>

      <DailySummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        summary={daily.summary}
        loading={daily.loading}
        error={daily.error}
        onRetry={daily.retry}
      />

    </div>
  );
}
