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
  const ageLabel = age === null ? "-" : `${Math.max(0, age)}s`;

  return (
    <header className="border-b border-term-line bg-term-panel/80 backdrop-blur">
      <div className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-[12px] sm:px-4 sm:text-[13px]">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span
            key={pulseKey}
            className="inline-block shrink-0 animate-heartbeat text-term-red drop-shadow-[0_0_6px_rgba(248,81,73,0.7)]"
            aria-label="heartbeat"
          >
            ♥
          </span>
          <h1 className="truncate font-bold tracking-[0.12em] text-term-greenBright sm:tracking-[0.15em]">
            TANNER'S KALSHI DIAGNOSTICS
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-term-dim sm:gap-6">
          <span className="inline-flex items-center gap-1">
            <span className="hidden text-term-dim sm:inline">STATUS</span>
            <span className={`${status.color} font-bold animate-blink`}>● {status.label}</span>
          </span>
          <span className="inline-flex items-baseline gap-1 tabular-nums">
            <span className="hidden text-term-dim sm:inline">LAST</span>
            <span className="inline-block min-w-[4ch] text-right text-term-text">
              {ageLabel}
            </span>
          </span>
          <span className="hidden text-term-text tabular-nums sm:inline">{new Date(now).toLocaleTimeString()}</span>
        </div>
      </div>
    </header>
  );
}
