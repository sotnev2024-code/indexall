/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        black: '#1a1a1a',
        yellow: {
          DEFAULT: '#f5c800',
          hover: '#e0b500',
        },
        bg: '#f4f4f4',
        border: '#d0d0d0',
        muted: '#888',
      },
    },
  },
  plugins: [],
}
