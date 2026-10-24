import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

/**
 * "Hide numbers" for when customers can see the screen at the counter.
 * One setting for the whole app, remembered in this browser.
 */
interface PrivacyValue {
  hideNumbers: boolean;
  toggleHideNumbers: () => void;
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const PrivacyContext = createContext<PrivacyValue>({
  hideNumbers: false,
  toggleHideNumbers: () => undefined,
  collapsed: false,
  toggleCollapsed: () => undefined,
});

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* storage unavailable: setting lasts until reload */
  }
};

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hideNumbers, setHide] = useState(() => read('crm.hideNumbers'));
  const [collapsed, setCollapsed] = useState(() => read('crm.statsCollapsed'));

  const toggleHideNumbers = useCallback(
    () =>
      setHide((v) => {
        write('crm.hideNumbers', !v);
        return !v;
      }),
    [],
  );
  const toggleCollapsed = useCallback(
    () =>
      setCollapsed((v) => {
        write('crm.statsCollapsed', !v);
        return !v;
      }),
    [],
  );

  return (
    <PrivacyContext.Provider value={{ hideNumbers, toggleHideNumbers, collapsed, toggleCollapsed }}>{children}</PrivacyContext.Provider>
  );
}

export const usePrivacy = () => useContext(PrivacyContext);
