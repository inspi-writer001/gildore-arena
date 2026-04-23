import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        grotesk: ["Anton", "sans-serif"],
        condiment: ["Condiment", "cursive"],
        barlow: ["Barlow", "sans-serif"],
        instrument: ["Instrument Serif", "serif"],
        inter: ["Inter", "sans-serif"],
        poppins: ["Poppins", "sans-serif"],
        "source-serif": ["Source Serif 4", "serif"]
      }
    }
  },
  plugins: []
};

export default config;
