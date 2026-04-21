import type { BotSignal, Position } from "../lib/api";

function fmtPct(value?: number | null, sign = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const pct = value * 100;
  const prefix = sign && pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(1)}%`;
}

function fmtTime(value?: string | null): string {
  if (!value) return "—";
  return new Date(value.replace(" ", "T")).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function impliedYes(position: Position): number | null {
  const bid = position.yes_bid_cents ?? 0;
  const ask = position.yes_ask_cents ?? 0;
  if (bid && ask) return (bid + ask) / 200;
  if (bid) return bid / 100;
  if (ask) return ask / 100;
  return null;
}

function liveHeldEdge(position: Position, signal?: BotSignal): number | null {
  const modelYes = signal?.model_yes_probability;
  const marketYes = impliedYes(position);
  if (modelYes === null || modelYes === undefined || marketYes === null) return null;
  return position.position >= 0 ? modelYes - marketYes : marketYes - modelYes;
}

function edgeTone(edge: number | null): string {
  if (edge === null) return "text-term-dim";
  if (edge >= 0.05) return "text-term-greenBright";
  if (edge <= -0.03) return "text-term-red";
  return "text-term-cyan";
}

function actionForEdge(edge: number | null): string {
  if (edge === null) return "no signal";
  if (edge >= 0.08) return "add / hold";
  if (edge >= 0.03) return "hold";
  if (edge <= -0.05) return "exit";
  if (edge <= -0.03) return "trim";
  return "neutral";
}

type Props = {
  positions: Position[];
  signals: BotSignal[];
  loading?: boolean;
  error?: string | null;
};

export function BotEdgeTable({ positions, signals, loading = false, error = null }: Props) {
  const byTicker = new Map(signals.map((signal) => [signal.ticker, signal]));
  const rows = positions.map((position) => ({
    position,
    signal: byTicker.get(position.ticker),
    marketYes: impliedYes(position),
    edge: liveHeldEdge(position, byTicker.get(position.ticker)),
  }));
  const matched = rows.filter((row) => row.signal).length;

  return (
    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead className="sticky top-0 bg-term-panel">
          <tr>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Market</th>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Bot</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Fair YES</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Kalshi YES</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Held Edge</th>
            <th className="text-right font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Bot Edge</th>
            <th className="text-left font-bold text-[10px] tracking-[0.15em] uppercase text-term-dim py-1 px-2 border-b border-term-line">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-term-dim py-6">
                {loading ? "loading bot signals" : error || "no positions"}
              </td>
            </tr>
          )}
          {rows.map(({ position, signal, marketYes, edge }) => (
            <tr key={position.ticker} className="border-b border-term-line/40 hover:bg-term-line/40">
              <td className="py-1 px-2 text-term-text">
                <div className="font-medium truncate max-w-[280px]">{position.ticker}</div>
                <div className="text-[10px] text-term-dim">
                  held {position.position >= 0 ? "YES" : "NO"} · {Math.abs(position.position)} contracts
                </div>
              </td>
              <td className="py-1 px-2 text-term-cyan">
                {signal ? signal.source : "—"}
                <div className="text-[10px] text-term-dim">{fmtTime(signal?.observed_at)}</div>
              </td>
              <td className="py-1 px-2 text-right text-term-text">{fmtPct(signal?.model_yes_probability)}</td>
              <td className="py-1 px-2 text-right text-term-text">{fmtPct(marketYes)}</td>
              <td className={`py-1 px-2 text-right ${edgeTone(edge)}`}>{fmtPct(edge, true)}</td>
              <td className={`py-1 px-2 text-right ${edgeTone(signal?.bot_edge ?? null)}`}>
                {fmtPct(signal?.bot_edge, true)}
              </td>
              <td className={`py-1 px-2 ${edgeTone(edge)}`}>
                {actionForEdge(edge)}
                {signal?.skip_reason && <div className="text-[10px] text-term-dim truncate max-w-[180px]">{signal.skip_reason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {positions.length > 0 && (
        <div className="mt-2 text-[10px] text-term-dim">
          Matched {matched}/{positions.length} positions to latest bot decisions. Held edge compares bot fair YES to current Kalshi YES mid, adjusted for YES/NO inventory.
        </div>
      )}
    </div>
  );
}
