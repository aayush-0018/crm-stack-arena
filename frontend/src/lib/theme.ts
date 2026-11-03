/**
 * Light or dark theme, remembered per device. The palette lives in index.css; this only
 * toggles the "dark" class on <html>. index.html applies the saved choice before first paint so nothing flashes.
 */
export type ThemePref = 'light' | 'dark';

const KEY = 'crm.theme';

export function getThemePref(): ThemePref {
  try {
    // An old "same as device" choice now means light.
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  document.documentElement.classList.toggle('dark', pref === 'dark');
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

/** Always prints on light colours. */
export function initTheme() {
  applyTheme();
  window.addEventListener('beforeprint', () => document.documentElement.classList.remove('dark'));
  window.addEventListener('afterprint', () => applyTheme());
}
