/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        canvas: '#f4f4f2', // app background behind the panel
        line: { DEFAULT: '#ebebe8', strong: '#dcdcd7' },
        hover: '#efefec',
        selected: '#e7e7e3',
        ink: { DEFAULT: '#171717', 2: '#5f5f5b', 3: '#8f8f8a', 4: '#b8b8b2' },
      },
      boxShadow: {
        pop: '0 12px 32px -8px rgba(23,23,23,0.18), 0 2px 6px rgba(23,23,23,0.06)',
        soft: '0 1px 2px rgba(23,23,23,0.05)',
      },
    },
  },
  plugins: [],
};
