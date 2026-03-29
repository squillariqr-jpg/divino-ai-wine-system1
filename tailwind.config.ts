import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        burgundy: "#800020",
        gold: "#D4AF37",
        cream: "#F5F5DC",
        bottle: "#006A4E",
        ink: "#241417"
      },
      boxShadow: {
        soft: "0 20px 45px rgba(36, 20, 23, 0.12)"
      },
      backgroundImage: {
        vignette:
          "radial-gradient(circle at top, rgba(212, 175, 55, 0.18), transparent 35%), radial-gradient(circle at bottom left, rgba(128, 0, 32, 0.2), transparent 30%)"
      }
    }
  },
  plugins: []
};

export default config;
