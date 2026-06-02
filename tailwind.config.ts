import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FBF7F0",
          100: "#F5EFE3",
          200: "#EBE0CB",
          300: "#DCC9A8",
        },
        clay: {
          400: "#C68B5C",
          500: "#A8693B",
          600: "#854F25",
          700: "#5E371A",
          900: "#2D1810",
        },
        ember: {
          400: "#E89B5C",
          500: "#D97A2E",
        },
      },
      fontFamily: {
        serif: ['var(--font-serif)', '"Source Han Serif SC"', "ui-serif", "Georgia", "serif"],
        sans: ['var(--font-sans)', '"PingFang SC"', "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        widest: "0.32em",
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out",
        "slow-pulse": "slowPulse 2.6s ease-in-out infinite",
        "drift": "drift 12s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slowPulse: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(0, -10px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
