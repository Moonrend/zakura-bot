/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        app: "#070707",
        panel: "#111111",
        raised: "#2f2f2f",
        "raised-hover": "#3d3d3d",
        card: "#262626",
        inset: "#191919",
        hairline: "#333333",
        ink: "#fcfcfc",
        "ink-secondary": "#b3b3b3",
        accent: "#1084fe",
        "accent-border": "#459ffe",
        "bubble-user": "#5a5a5a",
        success: "#38d591",
        danger: "#ff5667",
        warning: "#ff9800",
      },
    },
  },
  plugins: [],
};
