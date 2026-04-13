import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        scs: {
          blue: "#005DA8",
          blueDark: "#003F73",
          yellow: "#F3C400",
          ink: "#15304B",
          mist: "#E8F1F8",
          danger: "#B42318",
          warning: "#B54708"
        }
      },
      boxShadow: {
        panel: "0 12px 32px rgba(21, 48, 75, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
