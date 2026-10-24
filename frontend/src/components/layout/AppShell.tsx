import {
  ArrowLeftRight,
  ChartLine,
  Contact,
  FileText,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Settings,
  SlidersHorizontal,
  UserPlus,
  Zap,
} from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { dashboardApi, invoicesApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../ui/Avatar';
import Popover, { MenuItem } from '../ui/Popover';
import BranchSwitcher from './BranchSwitcher';
import CommandPalette from './CommandPalette';

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

const SectionLabel = ({ children }: { children: string }) => <p className="px-2.5 pb-1.5 pt-6 text-[13px] text-ink-3">{children}</p>;

export default function AppShell() {
  const { shop, user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [counts, setCounts] = useState<{ open?: number; outdated?: number }>({});

  // Badge counts; refreshed on navigation.
  useEffect(() => {
    let cancelled = false;
    Promise.all([dashboardApi.summary(), invoicesApi.summary()])
      .then(([d, i]) => !cancelled && setCounts({ open: d.openOrders, outdated: i.outdated }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname, shop?.id]);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <div className="flex h-full flex-col px-3 pb-3 pt-4">
      <BranchSwitcher />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mt-5 flex h-9 w-full items-center gap-2.5 rounded-lg border border-line bg-white px-2.5 text-[14.5px] text-ink-2 shadow-soft hover:text-ink"
      >
        <Zap {...ICON} />
        <span className="flex-1 text-left">Quick Actions</span>
        <kbd className="rounded border border-line px-1.5 font-sans text-[11px] leading-[18px] text-ink-3">/</kbd>
      </button>

      <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto">
        <NavItem to="/orders/new" icon={<Plus {...ICON} />} label="New order" />
        <NavItem to="/customers/new" icon={<UserPlus {...ICON} />} label="Add customer" />

        <SectionLabel>Work</SectionLabel>
        <NavItem to="/" end icon={<LayoutGrid {...ICON} />} label="Dashboard" />
        <NavItem to="/customers" icon={<Contact {...ICON} />} label="Customers" />
        <NavItem to="/orders" icon={<ArrowLeftRight {...ICON} />} label="Orders" count={counts.open} />
        <NavItem to="/invoices" icon={<FileText {...ICON} />} label="Invoices" count={counts.outdated} />
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
    </div>
  );

  return (
    <div className="app-root flex h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside className="no-print hidden w-[272px] shrink-0 md:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="no-print fixed inset-0 z-40 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-ink/20" />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-canvas shadow-pop" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-14 items-center gap-3 px-3 md:hidden">
          <button aria-label="Open menu" onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-ink-2 hover:bg-hover">
            <Menu size={20} strokeWidth={1.6} />
          </button>
          <span className="flex-1 truncate text-[15px] font-semibold">{shop?.name}</span>
          <button aria-label="Quick actions" onClick={() => setPaletteOpen(true)} className="rounded-lg p-2 text-ink-2 hover:bg-hover">
            <Zap size={18} strokeWidth={1.6} />
          </button>
        </header>
        <main className="app-panel min-h-0 flex-1 overflow-y-auto border-line bg-white md:my-2 md:mr-2 md:rounded-2xl md:border md:shadow-soft">
          {/* Keyed by branch: switching remounts every page, so nothing from the old branch lingers. */}
          <Outlet key={shop?.id} />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
