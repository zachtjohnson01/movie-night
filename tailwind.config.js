/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0b0f',
          900: '#13131a',
          800: '#1c1c26',
          700: '#262633',
          600: '#3a3a4a',
          500: '#5a5a6e',
          400: '#8a8aa0',
          300: '#b8b8cc',
          200: '#d8d8e4',
          100: '#ececf2',
        },
        amber: {
          glow: '#ffb347',
        },
        crimson: {
          deep: '#b3242c',
          bright: '#e63946',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
