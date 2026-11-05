/**
 * Who runs CartWell, for the Privacy Policy, Terms, Refund Policy and page footers.
 * Fill in every [FILL IN] before sharing the app with shop owners. Values marked [FILL IN] are
 * shown highlighted on the legal pages so a missing one is easy to spot.
 */
export const BUSINESS = {
  brand: 'CartWell',
  /** Registered name of the business (proprietorship, LLP or company). */
  legalName: '[FILL IN: registered business name]',
  address: '[FILL IN: registered address, city, state, PIN]',
  supportEmail: '[FILL IN: support email]',
  /** Required by the DPDP Act 2023 and the Consumer Protection (E-Commerce) Rules 2020. */
  grievanceOfficer: '[FILL IN: Grievance Officer name]',
  grievanceEmail: '[FILL IN: grievance email]',
  /** Courts named in the Terms, e.g. "Jaipur, Rajasthan". */
  jurisdiction: '[FILL IN: city, state]',
  trialDays: '[FILL IN: number of]',
  lastUpdated: '6 November 2026',
};

export const isPlaceholder = (v: string) => v.startsWith('[FILL IN');

export const LEGAL_LINKS = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/refunds', label: 'Refunds' },
  { to: '/cookies', label: 'Cookies' },
] as const;
