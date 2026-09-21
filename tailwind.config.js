/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'sans-serif',
        ],
        num: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#bed3ff',
          300: '#91b4ff',
          400: '#5d8bff',
          500: '#3663f6',
          600: '#2148e6',
          700: '#1a37c4',
          800: '#1a309e',
          900: '#1b2f7d',
        },
        ink: {
          900: '#0d1526',
          800: '#1b2436',
          700: '#333e52',
          600: '#4a5568',
          500: '#6b7688',
          400: '#96a0b0',
          300: '#c3cad6',
          200: '#e2e6ed',
          100: '#f1f4f8',
          50: '#f8fafc',
        },
        sale: '#2148e6',
        purchase: '#d97706',
        opex: '#e11d48',
        gain: '#0f9d58',
        loss: '#dc2626',
      },
      boxShadow: {
        card: '0 1px 2px rgba(13,21,38,0.04), 0 10px 28px -16px rgba(13,21,38,0.18)',
        pop: '0 18px 48px -20px rgba(13,21,38,0.35)',
      },
      borderRadius: {
        xl2: '1.125rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.22s ease-out both',
        'slide-in': 'slide-in 0.24s ease-out both',
      },
    },
  },
  plugins: [],
}
