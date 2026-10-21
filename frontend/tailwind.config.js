/** @type {import('tailwindcss').Config} */
// Design System — Learning Support System
// Chuẩn doanh nghiệp: nền slate, 1 màu primary duy nhất (xanh lá trầm #15803d),
// bo góc tối đa 8px, shadow tối đa shadow-sm, không gradient / glassmorphism.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#15803d',
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          300: '#86efac',
          400: '#4ade80',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
      },
      fontFamily: {
        sans: [
          '"Be Vietnam Pro"',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      },
      // Cố ý giới hạn: không dùng bo góc lớn hơn 8px trong hệ thống.
      borderRadius: {
        none: '0',
        sm: '0.25rem', // 4px
        DEFAULT: '0.375rem', // 6px
        md: '0.375rem', // 6px
        lg: '0.5rem', // 8px
        xl: '0.5rem', // 8px — trần tối đa
        full: '9999px', // chỉ cho avatar / dot / pill badge khi thật cần
      },
      // Cố ý giới hạn: không shadow đậm. md/lg được neo về mức nhẹ.
      boxShadow: {
        none: 'none',
        sm: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        DEFAULT: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        md: '0 1px 3px 0 rgb(15 23 42 / 0.06)',
        lg: '0 1px 3px 0 rgb(15 23 42 / 0.06)',
        xl: '0 1px 3px 0 rgb(15 23 42 / 0.06)',
      },
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '1.5rem',
          lg: '2rem',
        },
        screens: {
          sm: '640px',
          md: '768px',
          lg: '1024px',
          xl: '1280px',
          '2xl': '1280px',
        },
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.99)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'dialog-in': 'dialog-in 150ms ease-out',
        'toast-in': 'toast-in 180ms ease-out',
      },
    },
  },
  plugins: [],
};
