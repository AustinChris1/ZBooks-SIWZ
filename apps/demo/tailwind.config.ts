import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/siwz-react/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        zcash: {
          yellow: "#f4b728",
          dark: "#1a1a1a",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
