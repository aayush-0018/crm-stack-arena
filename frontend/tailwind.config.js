/** A colour token from index.css, with Tailwind's opacity modifier support. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        // Every colour is a theme token defined in index.css (light and dark).
        canvas: v('canvas'),
        surface: v('surface'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        hover: v('hover'),
        selected: v('selected'),
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3'), 4: v('ink-4'), strong: v('ink-strong') },
        'on-ink': v('on-ink'),
        overlay: v('overlay'),
        wash: { DEFAULT: v('wash'), 2: v('wash-2'), 3: v('wash-3') },
        danger: { DEFAULT: v('danger'), strong: v('danger-strong'), text: v('danger-text'), bg: v('danger-bg'), 'bg-2': v('danger-bg-2'), line: v('danger-line'), 'line-2': v('danger-line-2'), solid: v('danger-solid'), 'solid-hover': v('danger-solid-hover') },
        critical: v('critical'),
        success: { DEFAULT: v('success'), text: v('success-text'), strong: v('success-strong'), bg: v('success-bg'), 'bg-2': v('success-bg-2'), line: v('success-line') },
        warn: { text: v('warn-text'), strong: v('warn-strong'), bg: v('warn-bg'), 'bg-2': v('warn-bg-2'), line: v('warn-line') },
        yellow: { text: v('yellow-text'), bg: v('yellow-bg') },
        info: { text: v('info-text'), strong: v('info-strong'), bg: v('info-bg'), 'bg-2': v('info-bg-2'), line: v('info-line') },
        neutral: { text: v('neutral-text') },
      },
      boxShadow: {
        pop: '0 12px 32px -8px rgba(23,23,23,0.18), 0 2px 6px rgba(23,23,23,0.06)',
        soft: '0 1px 2px rgba(23,23,23,0.05)',
      },
    },
  },
  plugins: [],
};
