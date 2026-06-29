import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Strictly monochrome — black, greys, white. No hues anywhere.
        ink: {
          0: "#000000",
          50: "#050505",
          100: "#0a0a0b",
          200: "#121214",
          300: "#1b1b1e",
        },
        fog: {
          400: "#565656",
          500: "#8a8a8a",
          600: "#aaaaaa",
          700: "#d6d6d6",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        "glow-breathe": {
          "0%, 100%": { opacity: "0.85" },
          "50%": { opacity: "1" },
        },
        sheen: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" },
        },
      },
      animation: {
        "pulse-soft": "pulse-soft 3.5s ease-in-out infinite",
        "glow-breathe": "glow-breathe 9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
