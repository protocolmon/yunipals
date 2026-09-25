import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0d1526",
        muted: "#59616e",
        line: "#eceef2",
        surface: "#ffffff",
        canvas: "#ffffff",
        grape: "#7e22ce",
        cyanx: "#22d3ee",
        bluex: "#1d4ed8",
        ethereum: "#4158b5",
        polygon: "#8247e5",
        basechain: "#0000ff",
        bnbchain: "#8a6100",
        success: "#16c784",
        badge: "#4f46e5",
        lavender: "#c7c9f9",
        sky: "#b3e7f5",
        mint: "#cdf6cf"
      },
      fontFamily: {
        display: ['"Archivo Black"', '"Arial Black"', "sans-serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"]
      },
      borderRadius: {
        card: "22px"
      },
      boxShadow: {
        card: "0 10px 30px -14px rgba(13,21,38,.18), 0 0 0 1px rgba(13,21,38,.04)",
        cardHover: "0 22px 50px -18px rgba(13,21,38,.28)",
        cta: "0 8px 20px -8px rgba(13,21,38,.5)"
      },
      backgroundImage: {
        "accent-bar": "linear-gradient(90deg,#b13bff,#22d3ee,#3b82f6)",
        "hero-lav":
          "linear-gradient(180deg,#c7c9f9 0%,#e9eafc 58%,#ffffff 100%)",
        "panel-base":
          "linear-gradient(145deg,#dce9ff 0%,#dff4ff 52%,#dcf6ee 100%)",
        "panel-ethereum":
          "linear-gradient(145deg,#e7e9ff 0%,#f1edff 52%,#e9f1ff 100%)",
        "panel-polygon":
          "linear-gradient(145deg,#eee5ff 0%,#f5edff 52%,#e8f4ff 100%)",
        "panel-bnb":
          "linear-gradient(145deg,#fff4c7 0%,#fff9e8 52%,#f4f0df 100%)",
        "soft-orbit":
          "radial-gradient(circle at center,rgba(255,255,255,.95) 0%,rgba(255,255,255,.55) 42%,rgba(255,255,255,0) 68%)"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(2deg)" },
          "50%": { transform: "translateY(-12px) rotate(-1deg)" }
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(10px, -8px, 0)" }
        }
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        drift: "drift 8s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;
