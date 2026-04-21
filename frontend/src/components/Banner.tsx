import { useEffect, useState } from "react";

type Props = {
  pulseKey: number;
  lastPollTs: number | null;
  connected: boolean;
};

export function Banner({ pulseKey, lastPollTs, connected }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = lastPollTs ? Math.floor((now - lastPollTs) / 1000) : null;
  const status = !connected
    ? { label: "OFFLINE", color: "text-term-red" }
    : age !== null && age > 15
    ? { label: "STALE", color: "text-term-amber" }
    : { label: "LIVE", color: "text-term-greenBright" };

  return (
    <header className="border-b border-term-line bg-term-panel/80 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-2 text-[13px]">
        <div className="flex items-center gap-3">
          <span
            key={pulseKey}
            className="inline-block animate-heartbeat text-term-red drop-shadow-[0_0_6px_rgba(248,81,73,0.7)]"
            aria-label="heartbeat"
          >
            ♥
          </span>
          <h1 className="font-bold tracking-[0.15em] text-term-greenBright">
            TANNER'S KALSHI DIAGNOSTICS
          </h1>
        </div>
        <div className="flex items-center gap-6 text-term-dim">
          <span>
            <span className="text-term-dim">STATUS </span>
            <span className={`${status.color} font-bold animate-blink`}>● {status.label}</span>
          </span>
          <span>
            <span className="text-term-dim">LAST </span>
            <span className="text-term-text">
              {age === null ? "—" : `${age}s ago`}
            </span>
          </span>
          <span className="text-term-text">{new Date(now).toLocaleTimeString()}</span>
        </div>
      </div>
    </header>
  );
}
