/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Hebrew"', 'system-ui', 'sans-serif'],
        display: ['Fraunces', '"Frank Ruhl Libre"', 'Georgia', 'serif'],
      },
      colors: {
        // Teal accent ("Harbor" direction).
        brand: {
          50:  '#EAF4F3',
          100: '#D3E9E8',
          200: '#A8D3D2',
          300: '#74B8B7',
          400: '#3E9C9B',
          500: '#0E7C7B',
          600: '#0B6665',
          700: '#095251',
          800: '#073F3E',
          900: '#052D2C',
        },
        // Warm neutrals with navy ink: overrides Tailwind's cool gray so the
        // existing gray-* classes across the app pick up the new ground/ink.
        gray: {
          50:  '#F5F1EA',
          100: '#ECE6DB',
          200: '#E3DCD0',
          300: '#D5CDBF',
          400: '#737A8C',
          500: '#5B6373',
          600: '#3B4358',
          700: '#2B3448',
          800: '#1E2A44',
          900: '#14213D',
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
