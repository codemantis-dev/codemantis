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
        green: { DEFAULT: "var(--green)" },
        yellow: { DEFAULT: "var(--yellow)" },
        red: { DEFAULT: "var(--red)" },
        blue: { DEFAULT: "var(--blue)" },
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
        micro: "calc(var(--font-size-base, 13px) - 5px)",
        fine: "calc(var(--font-size-base, 13px) - 4px)",
        detail: "calc(var(--font-size-base, 13px) - 3px)",
        label: "calc(var(--font-size-base, 13px) - 2px)",
        ui: "calc(var(--font-size-base, 13px) - 1px)",
        chat: "var(--font-size-base, 13px)",
        title: "calc(var(--font-size-base, 13px) + 2px)",
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
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.85" },
        },
      },
      animation: {
        pulse: "pulse 2s ease-in-out infinite",
        blink: "blink 1.06s step-end infinite",
        "trivia-fade-in": "trivia-fade-in 3s ease-out",
        "detail-slide-in": "detail-slide-in 0.2s ease-out",
        "pulse-subtle": "pulse-subtle 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
