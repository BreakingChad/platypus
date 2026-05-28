import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50:"#EEF2FF",100:"#E0E7FF",500:"#4F46E5",600:"#4338CA",700:"#3730A3" },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"','system-ui','sans-serif'],
        sans:   ['"DM Sans"','system-ui','sans-serif'],
        mono:   ['"JetBrains Mono"','ui-monospace','monospace'],
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
