import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import { authApi } from '../api/endpoints';
import type { Session, Shop, User } from '../types';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  user: User | null;
  shop: Shop | null;
  signIn: (session: Session) => void;
  logout: () => void;
  setShop: (shop: Shop) => void;
  switchBranch: (shopId: number) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(tokenStore.get() ? 'loading' : 'anonymous');
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setShop(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    authApi
      .me()
      .then(({ user, shop }) => {
        setUser(user);
        setShop(shop);
        setStatus('authenticated');
      })
      .catch(() => {
        // Network failure or bad token: send to login (token cleared on 401).
        setStatus('anonymous');
      });
  }, []);

  const signIn = useCallback((s: Session) => {
    tokenStore.set(s.token);
    setUser(s.user);
    setShop(s.shop);
    setStatus('authenticated');
  }, []);

  // New token scoped to the other branch; every page re-fetches because the shop id changes.
  const switchBranch = useCallback(async (shopId: number) => signIn(await authApi.switchBranch(shopId)), [signIn]);

  const value = useMemo(
    () => ({ status, user, shop, signIn, logout, setShop, switchBranch }),
    [status, user, shop, signIn, logout, switchBranch],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
