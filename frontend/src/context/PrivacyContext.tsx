import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

/**
 * "Hide numbers" for when customers can see the screen at the counter.
 * Each page has its own setting (hiding on the Dashboard doesn't touch Orders or the
 * daily summary), remembered per page in this browser.
 */
interface PrivacyValue {
  isHidden: (page: string) => boolean;
  toggleHidden: (page: string) => void;
  isCollapsed: (page: string) => boolean;
  toggleCollapsed: (page: string) => void;
}

const PrivacyContext = createContext<PrivacyValue>({
  isHidden: () => false,
  toggleHidden: () => undefined,
  isCollapsed: () => false,
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

/** A per-page on/off map backed by localStorage keys `<prefix>.<page>`. */
function usePageFlags(prefix: string) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const get = useCallback((page: string) => flags[page] ?? read(`${prefix}.${page}`), [flags, prefix]);
  const toggle = useCallback(
    (page: string) =>
      setFlags((f) => {
        const next = !(f[page] ?? read(`${prefix}.${page}`));
        write(`${prefix}.${page}`, next);
        return { ...f, [page]: next };
      }),
    [prefix],
  );
  return [get, toggle] as const;
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [isHidden, toggleHidden] = usePageFlags('crm.hideNumbers');
  const [isCollapsed, toggleCollapsed] = usePageFlags('crm.statsCollapsed');
  return <PrivacyContext.Provider value={{ isHidden, toggleHidden, isCollapsed, toggleCollapsed }}>{children}</PrivacyContext.Provider>;
}

/** The hide / collapse state for one page. */
export function usePageNumbers(page: string) {
  const { isHidden, toggleHidden, isCollapsed, toggleCollapsed } = useContext(PrivacyContext);
  return {
    hideNumbers: isHidden(page),
    toggleHideNumbers: () => toggleHidden(page),
    collapsed: isCollapsed(page),
    toggleCollapsed: () => toggleCollapsed(page),
  };
}
