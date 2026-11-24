/** Colours and type match the UltraRentz MVP frontend. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: "#2563eb", // Brand Blue
        secondary: "#10b981", // Emerald Green
        background: "#f9fafb", // Soft Gray
        neutral: "#1f2937", // Dark Charcoal
        error: "#dc2626", // Red
        accent: "#f59e0b", // Gold (for yields)
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: { custom: "0 8px 24px rgba(124, 58, 237, 0.2)" },
      borderRadius: { xl: "1rem" },
    },
  },
  plugins: [],
};
