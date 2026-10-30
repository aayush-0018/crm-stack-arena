/**
 * Light / dark / follow-the-device theme, remembered per device. The palette lives in index.css; this only
 * toggles the "dark" class on <html>. index.html applies the saved choice before first paint so nothing flashes.
 */
export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'crm.theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  document.documentElement.classList.toggle('dark', pref === 'dark' || (pref === 'system' && darkQuery().matches));
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'light') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: lasts until reload */
  }
  applyTheme(pref);
}

/** Follows the device when set to "system", and always prints on light colours. */
export function initTheme() {
  applyTheme();
  darkQuery().addEventListener('change', () => applyTheme());
  window.addEventListener('beforeprint', () => document.documentElement.classList.remove('dark'));
  window.addEventListener('afterprint', () => applyTheme());
}
