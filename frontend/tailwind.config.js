/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          300: '#f9a8d4',
          400: '#f472b6',
          500: '#ec4899',
          600: '#db2777',
          700: '#be185d',
          800: '#9d174d',
          900: '#831843',
        },
      },
      keyframes: {
        'slide-left': {
          '0%':   { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateX(-120%) rotate(-20deg)', opacity: '0' },
        },
        'slide-right': {
          '0%':   { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateX(120%) rotate(20deg)', opacity: '0' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pop-in': {
          '0%':   { opacity: '0', transform: 'scale(0.8)' },
          '60%':  { transform: 'scale(1.05)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-from-left': {
          '0%':   { transform: 'translateX(-120%) rotate(-20deg)', opacity: '0' },
          '60%':  { transform: 'translateX(3%) rotate(1deg)', opacity: '1' },
          '100%': { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
        },
        'slide-in-from-right': {
          '0%':   { transform: 'translateX(120%) rotate(20deg)', opacity: '0' },
          '60%':  { transform: 'translateX(-3%) rotate(-1deg)', opacity: '1' },
          '100%': { transform: 'translateX(0) rotate(0deg)', opacity: '1' },
        },
      },
      animation: {
        'slide-left':  'slide-left 0.4s ease-in forwards',
        'slide-right': 'slide-right 0.4s ease-in forwards',
        'fade-in':     'fade-in 0.25s ease-out',
        'pop-in':      'pop-in 0.35s ease-out',
        'slide-in-from-left':  'slide-in-from-left 0.4s ease-out forwards',
        'slide-in-from-right': 'slide-in-from-right 0.4s ease-out forwards',
      },
    },
  },
  plugins: [],
}
