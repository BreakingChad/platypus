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
      /* Three page-width tiers (audit v3): narrow = forms/profile/gates,
         standard = most pages, wide = boards & designers. Use these — not
         raw max-w-* — for page containers. */
      /* FLUID-FIRST (Chad's call, 2026-06-03): standard and wide pages use
         the full window — no caps. Only "narrow" keeps a reading measure
         (gate cards, settings forms). Gutters scale at 2xl instead. */
      maxWidth: {
        "page-narrow": "48rem",
        "page-standard": "none",
        "page-wide": "none",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
