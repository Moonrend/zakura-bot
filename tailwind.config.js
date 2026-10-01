/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--color-app) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        raised: "rgb(var(--color-raised) / <alpha-value>)",
        "raised-hover": "rgb(var(--color-raised-hover) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        inset: "rgb(var(--color-inset) / <alpha-value>)",
        hairline: "rgb(var(--color-hairline) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        "ink-secondary": "rgb(var(--color-ink-secondary) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        "accent-border": "rgb(var(--color-accent-border) / <alpha-value>)",
        "bubble-user": "rgb(var(--color-bubble-user) / <alpha-value>)",
        success: "rgb(var(--color-success) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
