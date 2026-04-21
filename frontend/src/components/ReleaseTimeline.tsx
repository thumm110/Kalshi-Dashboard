import { useEffect, useState } from "react";
import { fmtUsd, type Position } from "../lib/api";
import {
  countdown,
  groupByEvent,
  impliedProb,
  MACRO_KIND_LABEL,
  type MacroEvent,
} from "../lib/macro";

type Props = {
  positions: Position[];
  selectedEvent: string | null;
  onSelectEvent: (ev: string | null) => void;
};

export function ReleaseTimeline({ positions, selectedEvent, onSelectEvent }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const events = groupByEvent(positions);

  if (events.length === 0) {
    return <div className="text-term-dim text-xs p-2">no open economics positions</div>;
  }

  return (
    <div className="flex flex-col">
      {events.map((ev) => (
        <EventRow
          key={ev.eventTicker}
          ev={ev}
          selected={selectedEvent === ev.eventTicker}
          onClick={() =>
            onSelectEvent(selectedEvent === ev.eventTicker ? null : ev.eventTicker)
          }
        />
      ))}
    </div>
  );
}

function EventRow({
  ev,
  selected,
  onClick,
}: {
  ev: MacroEvent;
  selected: boolean;
  onClick: () => void;
}) {
  const pnlColor =
    ev.totalPnl > 5 ? "text-term-greenBright" : ev.totalPnl < -5 ? "text-term-red" : "text-term-dim";
  const dotColor =
    ev.totalPnl > 5 ? "#56d364" : ev.totalPnl < -5 ? "#f85149" : "#6b7280";
  const isPast = ev.expirationTs != null && ev.expirationTs * 1000 < Date.now();

  return (
    <div
      className={`border-l-2 pl-3 py-2 cursor-pointer transition-colors ${
        selected ? "border-term-cyan bg-term-line/40" : "border-term-line hover:bg-term-line/20"
      }`}
      onClick={onClick}
      style={{ borderLeftColor: selected ? undefined : dotColor + "55" }}
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-block rounded-full mt-1 shrink-0"
          style={{ width: 10, height: 10, background: dotColor, boxShadow: `0 0 6px ${dotColor}88` }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className="text-term-text text-[12px] font-semibold truncate">{ev.label}</span>
            <span className={`text-[11px] tabular-nums ${pnlColor}`}>{fmtUsd(ev.totalPnl, true)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-term-dim mt-0.5">
            <span>
              <span className="uppercase tracking-wider">{MACRO_KIND_LABEL[ev.kind]}</span>
              <span className="mx-1.5">·</span>
              <span>{ev.positions.length} strike{ev.positions.length > 1 ? "s" : ""}</span>
              <span className="mx-1.5">·</span>
              <span>exp {fmtUsd(ev.totalExposure)}</span>
            </span>
            <span className={isPast ? "text-term-dim" : "text-term-cyan"}>
              {countdown(ev.expirationTs)}
            </span>
          </div>
          {selected && <StrikeStrip ev={ev} />}
        </div>
      </div>
    </div>
  );
}

/** Horizontal strip showing each strike as a tick on a 0-100¢ line,
    with marker size by position size and color by YES/NO side. */
function StrikeStrip({ ev }: { ev: MacroEvent }) {
  const w = 360;
  const h = 46;
  const padL = 4;
  const padR = 4;
  const innerW = w - padL - padR;

  return (
    <div className="mt-2">
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
        {/* axis */}
        <line x1={padL} y1={h - 14} x2={w - padR} y2={h - 14} stroke="#1f2937" strokeWidth={1} />
        {[0, 25, 50, 75, 100].map((t) => {
          const x = padL + (t / 100) * innerW;
          return (
            <g key={t}>
              <line x1={x} y1={h - 16} x2={x} y2={h - 12} stroke="#374151" strokeWidth={0.75} />
              <text x={x} y={h - 2} textAnchor="middle" fontSize={7} fill="#6b7280">
                {t}¢
              </text>
            </g>
          );
        })}
        {ev.positions.map((p) => {
          const prob = impliedProb(p);
          if (prob == null) return null;
          const x = padL + prob * innerW;
          const isYes = p.position >= 0;
          const pnl = p.unrealized_pnl_cents + p.realized_pnl_cents;
          const col = pnl > 5 ? "#56d364" : pnl < -5 ? "#f85149" : "#6b7280";
          const size = 3 + Math.min(6, Math.sqrt(Math.abs(p.position)) * 0.8);
          return (
            <g key={p.ticker}>
              <line x1={x} y1={6} x2={x} y2={h - 14} stroke={col} strokeWidth={0.5} opacity={0.45} />
              {isYes ? (
                <circle cx={x} cy={h - 14} r={size} fill={col} opacity={0.9} />
              ) : (
                <rect
                  x={x - size}
                  y={h - 14 - size}
                  width={size * 2}
                  height={size * 2}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.3}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 space-y-0.5">
        {ev.positions.map((p) => {
          const pnl = p.unrealized_pnl_cents + p.realized_pnl_cents;
          const color = pnl > 5 ? "text-term-greenBright" : pnl < -5 ? "text-term-red" : "text-term-dim";
          return (
            <div key={p.ticker} className="flex justify-between text-[10px] tabular-nums">
              <span className="truncate text-term-dim">
                <span className={p.position >= 0 ? "text-term-greenBright" : "text-term-red"}>
                  {p.position >= 0 ? "YES" : "NO"} {Math.abs(p.position)}
                </span>
                <span className="ml-2 text-term-text">{p.title || p.ticker}</span>
              </span>
              <span className={color}>{fmtUsd(pnl, true)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
