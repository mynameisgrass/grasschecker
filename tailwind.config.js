/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Inter"',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      transitionTimingFunction: {
        'ios': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      keyframes: {
        scan: {
          '0%, 100%': { transform: 'translateY(2%)' },
          '50%': { transform: 'translateY(96%)' },
        },
        countdown: {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
      },
      animation: {
        scan: 'scan 2.4s ease-in-out infinite',
        countdown: 'countdown linear forwards',
      },
    },
  },
  plugins: [],
};
