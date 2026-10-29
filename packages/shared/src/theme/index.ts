// Harbor design tokens (redesign 2026-09-28): one source for web and mobile.
// The web's frontend/tailwind.config.js reads these; the mobile app imports them.

/** Teal accent. */
const brand = {
  50: '#EAF4F3',
  100: '#D3E9E8',
  200: '#A8D3D2',
  300: '#74B8B7',
  400: '#3E9C9B',
  500: '#0E7C7B',
  600: '#0B6665',
  700: '#095251',
  800: '#073F3E',
  900: '#052D2C',
}

/** Warm neutrals: ivory ground (50) to navy ink (900). Replaces Tailwind's gray on the web. */
const gray = {
  50: '#F5F1EA',
  100: '#ECE6DB',
  200: '#E3DCD0',
  300: '#D5CDBF',
  400: '#737A8C',
  500: '#5B6373',
  600: '#3B4358',
  700: '#2B3448',
  800: '#1E2A44',
  900: '#14213D',
}

export const colors = { brand, gray }

/** Font stacks, each with a Hebrew sibling. Plain family names (no CSS quoting). */
export const fonts = {
  sans: ['IBM Plex Sans', 'IBM Plex Sans Hebrew', 'system-ui', 'sans-serif'],
  display: ['Fraunces', 'Frank Ruhl Libre', 'Georgia', 'serif'],
}
