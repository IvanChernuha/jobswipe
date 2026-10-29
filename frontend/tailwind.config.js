import { colors, fonts } from '../packages/shared/src/theme/index.ts'

// Quote multi-word family names for CSS.
const cssFamily = (f) => (f.includes(' ') ? `"${f}"` : f)

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Harbor tokens are shared with the mobile app (packages/shared/src/theme).
      fontFamily: {
        sans: fonts.sans.map(cssFamily),
        display: fonts.display.map(cssFamily),
      },
      colors: {
        brand: colors.brand,
        // Overrides Tailwind's cool gray so the existing gray-* classes across
        // the app pick up the warm ivory ground and navy ink.
        gray: colors.gray,
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
