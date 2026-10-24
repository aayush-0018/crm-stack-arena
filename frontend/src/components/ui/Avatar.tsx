export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

export default function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-[#f6f6f4] font-semibold tracking-wide text-ink-2"
    >
      {initials(name)}
    </span>
  );
}
