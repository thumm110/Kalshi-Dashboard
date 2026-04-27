import { fmtCents, type PoliticsGroup } from "../lib/api";

type Props = { group: PoliticsGroup | undefined; title: string };

function findMarket(group: PoliticsGroup | undefined, needle: string) {
  if (!group) return undefined;
  return group.markets.find((m) => (m.title || "").toLowerCase().includes(needle));
}

export function CongressControl({ group, title }: Props) {
  const dem = findMarket(group, "democrat");
  const gop = findMarket(group, "republican");
  const demPct = dem?.mid_cents ?? 0;
  const gopPct = gop?.mid_cents ?? 0;
  const total = demPct + gopPct || 100;
  const demW = (demPct / total) * 100;
  const gopW = (gopPct / total) * 100;

  return (
    <div className="rounded border border-term-line bg-term-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-term-text">{title}</div>
        <div className="text-[10px] text-term-dim">{group?.error ? "not live" : group?.event_ticker}</div>
      </div>
      {dem || gop ? (
        <>
          <div className="flex h-4 rounded overflow-hidden">
            <div className="bg-blue-500 flex items-center justify-start px-2 text-[10px] text-white tabular-nums" style={{ width: `${demW}%` }}>
              {demPct ? fmtCents(demPct) : ""}
            </div>
            <div className="bg-red-500 flex items-center justify-end px-2 text-[10px] text-white tabular-nums" style={{ width: `${gopW}%` }}>
              {gopPct ? fmtCents(gopPct) : ""}
            </div>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-term-dim">
            <span>Dem</span>
            <span>GOP</span>
          </div>
        </>
      ) : (
        <div className="text-term-dim text-xs py-2">no data</div>
      )}
    </div>
  );
}
