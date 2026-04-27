import { Panel } from "./KpiCard";
import { DonkeyIcon, ElephantIcon } from "./PartyMascots";
import { fmtCents, type PoliticsGroup } from "../lib/api";

type Props = { group: PoliticsGroup | undefined; party: "D" | "R" };

const PARTY_STYLES = {
  D: {
    accent: "text-blue-400",
    bar: "bg-blue-500",
    barDim: "bg-blue-900/40",
    border: "border-blue-500/30",
    glow: "shadow-[0_0_24px_rgba(59,130,246,0.15)]",
    label: "Democrat",
    Icon: DonkeyIcon,
  },
  R: {
    accent: "text-red-400",
    bar: "bg-red-500",
    barDim: "bg-red-900/40",
    border: "border-red-500/30",
    glow: "shadow-[0_0_24px_rgba(239,68,68,0.15)]",
    label: "Republican",
    Icon: ElephantIcon,
  },
} as const;

export function PartyPanel({ group, party }: Props) {
  const style = PARTY_STYLES[party];
  const markets = (group?.markets || []).slice(0, 10);
  const topPrice = markets.reduce((acc, m) => Math.max(acc, m.mid_cents || 0), 0) || 100;

  return (
    <div className={`rounded border ${style.border} bg-term-panel ${style.glow}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-line">
        <div className="flex items-center gap-2">
          <style.Icon className="text-3xl" />
          <div>
            <div className={`text-xs font-bold uppercase tracking-wider ${style.accent}`}>{style.label}</div>
            <div className="text-[11px] text-term-dim">{group?.label || "—"}</div>
          </div>
        </div>
        <div className="text-[10px] text-term-dim">
          {group?.error ? "event not live" : `${markets.length} candidate${markets.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="p-3">
        {markets.length === 0 ? (
          <div className="text-term-dim text-xs py-6 text-center">
            {group?.error
              ? "no live markets for this event yet"
              : "no markets loaded"}
          </div>
        ) : (
          <div className="space-y-1.5">
            {markets.map((m) => {
              const mid = m.mid_cents ?? 0;
              const pct = topPrice > 0 ? Math.min(100, (mid / topPrice) * 100) : 0;
              const chg = m.change_24h_cents;
              return (
                <div key={m.ticker} className="text-[11px]">
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-term-text truncate">{m.title || m.ticker}</span>
                    <span className="tabular-nums flex items-center gap-1.5 shrink-0">
                      <span className={style.accent}>{mid ? fmtCents(mid) : "—"}</span>
                      {chg != null && chg !== 0 ? (
                        <span className={chg > 0 ? "text-term-greenBright" : "text-term-red"}>
                          {chg > 0 ? "+" : ""}{chg}¢
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className={`h-1.5 rounded ${style.barDim} overflow-hidden`}>
                    <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PartyPanelWrapper({ group, party }: Props) {
  return (
    <Panel title="">
      <PartyPanel group={group} party={party} />
    </Panel>
  );
}
