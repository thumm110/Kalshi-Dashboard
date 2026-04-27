import { useState } from "react";
import { fmtCents, type GolfTournament } from "../lib/api";
import { Panel } from "./KpiCard";

type Props = {
  tournament: GolfTournament;
};

export function GolfTournamentPanel({ tournament }: Props) {
  const { event_title, sections } = tournament;
  const totalMarkets = sections.reduce((a, s) => a + s.markets.length, 0);
  const [openSection, setOpenSection] = useState<string | null>(
    sections.find((s) => s.label === "Winner")?.label ?? sections[0]?.label ?? null
  );

  return (
    <Panel
      title={event_title || tournament.tournament_code}
      right={
        <span className="text-[10px] text-term-dim">
          {sections.length} markets · {totalMarkets} contracts
        </span>
      }
    >
      <div className="flex flex-wrap gap-1 mb-2">
        {sections.map((s) => {
          const active = openSection === s.label;
          return (
            <button
              key={s.label}
              onClick={() => setOpenSection(active ? null : s.label)}
              className={`text-[10px] px-2 py-0.5 rounded border ${
                active
                  ? "bg-term-cyan/20 text-term-cyan border-term-cyan/40"
                  : "text-term-dim hover:text-term-text border-term-line"
              }`}
            >
              {s.label} <span className="text-term-dim">· {s.markets.length}</span>
            </button>
          );
        })}
      </div>
      {openSection && (() => {
        const sec = sections.find((s) => s.label === openSection);
        if (!sec) return null;
        const top = sec.markets.slice(0, 20);
        return (
          <div className="space-y-0.5">
            {top.map((m) => (
              <div key={m.ticker} className="flex justify-between text-[11px] tabular-nums">
                <span className="text-term-text truncate pr-2">{m.title || m.ticker}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-term-cyan">
                    {m.mid_cents != null ? fmtCents(m.mid_cents) : "—"}
                  </span>
                  {m.change_24h_cents != null && m.change_24h_cents !== 0 && (
                    <span className={`text-[9px] ${m.change_24h_cents > 0 ? "text-term-greenBright" : "text-term-red"}`}>
                      {m.change_24h_cents > 0 ? "+" : ""}{m.change_24h_cents}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {sec.markets.length > 20 && (
              <div className="text-[9px] text-term-dim">+{sec.markets.length - 20} more</div>
            )}
          </div>
        );
      })()}
    </Panel>
  );
}
