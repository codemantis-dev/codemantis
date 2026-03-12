import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          subtle: "var(--bg-subtle)",
          elevated: "var(--bg-elevated)",
        },
        border: {
          DEFAULT: "var(--border)",
          light: "var(--border-light)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          dim: "var(--text-dim)",
          faint: "var(--text-faint)",
          ghost: "var(--text-ghost)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          light: "var(--accent-light)",
          dim: "var(--accent-dim)",
        },
        green: "var(--green)",
        yellow: "var(--yellow)",
        red: "var(--red)",
        blue: "var(--blue)",
        tool: {
          read: "var(--tool-read)",
          write: "var(--tool-write)",
          edit: "var(--tool-edit)",
          bash: "var(--tool-bash)",
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
      fontSize: {
        chat: "13.5px",
        ui: "12px",
        label: "11px",
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "trivia-fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "detail-slide-in": {
          "0%": { opacity: "0", transform: "translateX(100%)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        pulse: "pulse 2s ease-in-out infinite",
        blink: "blink 1.06s step-end infinite",
        "trivia-fade-in": "trivia-fade-in 1s ease-out",
        "detail-slide-in": "detail-slide-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
