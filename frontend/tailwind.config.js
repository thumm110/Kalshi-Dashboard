/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        term: {
          bg: "#07090b",
          panel: "#0d1117",
          line: "#1a2029",
          text: "#d6e0ea",
          dim: "#6b7785",
          green: "#3fb950",
          greenBright: "#56d364",
          red: "#f85149",
          amber: "#d29922",
          cyan: "#39c5cf",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        heartbeat: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "20%": { transform: "scale(1.35)", opacity: "1" },
          "40%": { transform: "scale(1)", opacity: "0.9" },
          "60%": { transform: "scale(1.2)", opacity: "1" },
        },
        tickerBlink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        heartbeat: "heartbeat 1s ease-in-out",
        blink: "tickerBlink 1.2s infinite",
      },
    },
  },
  plugins: [],
};
