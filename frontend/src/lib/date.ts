const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** 'YYYY-MM-DD' (calendar date) -> '22 Oct 2026' */
export const formatDate = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00+05:30`));

/** ISO timestamp -> '22 Oct 2026, 3:45 pm' */
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** Today's date in India as 'YYYY-MM-DD'. */
export function todayIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

/** 'YYYY-MM-DD' -> 'Today' / 'Yesterday' / '5 days ago' / '3 months ago' */
export function relativeDays(iso: string | null | undefined): string {
  if (!iso) return '—';
  const days = Math.round((new Date(`${todayIST()}T00:00:00Z`).getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
