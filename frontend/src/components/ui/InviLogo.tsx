/** The INVi mark: the "i" as a bill with a saffron dot. Fixed brand colours, so it looks the same in light and dark mode. */
export default function InviLogo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label="INVi logo">
      <rect width="100" height="100" rx="26" fill="#0f3d3a" />
      <circle cx="50" cy="25" r="8.5" fill="#f2a43a" />
      <path d="M37 39h26v38l-4.33 4.5-4.34-4.5-4.33 4.5-4.33-4.5-4.34 4.5L37 77z" fill="#f6f3ea" />
      <rect x="42.5" y="47" width="15" height="3" rx="1.5" fill="#0f3d3a" />
      <rect x="42.5" y="54" width="10" height="3" rx="1.5" fill="#0f3d3a" opacity=".55" />
      <rect x="42.5" y="61" width="15" height="3" rx="1.5" fill="#0f3d3a" opacity=".55" />
    </svg>
  );
}
