import { useEffect, useState } from "react";
import { api, type Position } from "../lib/api";
import { eventKindFromSeries, seriesFromTicker } from "../lib/cities";

type Point = { ts: number; yes_price_cents: number };
type Series = { ticker: string; kind: string; position: number; points: Point[] };

type Props = {
  positions: Position[];
  hours?: number;
  period?: number;
};

export function CityCharts({ positions, hours = 24, period = 60 }: Props) {
  const [data, setData] = useState<Series[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (positions.length === 0) {
      setData([]);
      return;
    }

    async function load() {
      setLoading(true);
      const results = await Promise.all(
        positions.map((p) =>
          api
            .marketHistory(p.ticker, hours, period)
            .then((r) => ({ ticker: p.ticker, points: r.points, ok: true as const }))
            .catch(() => ({ ticker: p.ticker, points: [] as Point[], ok: false as const }))
        )
      );
      if (cancelled) return;
      setData((prev) => {
        const prevByTicker = new Map(prev.map((s) => [s.ticker, s]));
        return positions.map((p) => {
          const r = results.find((x) => x.ticker === p.ticker);
          // On fetch error, keep prior points if we had them (avoids clobbering on 429)
          const points =
            r && r.ok
              ? r.points
              : prevByTicker.get(p.ticker)?.points ?? [];
          return {
            ticker: p.ticker,
            kind: eventKindFromSeries(seriesFromTicker(p.ticker)),
            position: p.position,
            points,
          };
        });
      });
      setLoading(false);
    }

    load();
    const id = window.setInterval(load, 90000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [positions.map((p) => p.ticker).join("|"), hours, period]);

  if (positions.length === 0) {
    return <div className="text-term-dim text-xs">no positions held for this city</div>;
  }
  if (loading && data.length === 0) {
    return <div className="text-term-dim text-xs">loading price history…</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {data.map((s) => (
        <Spark key={s.ticker} series={s} />
      ))}
    </div>
  );
}

function Spark({ series }: { series: Series }) {
  const { ticker, kind, position, points } = series;
  if (points.length < 2) {
    return (
      <div className="border border-term-line p-2">
        <div className="flex justify-between text-[11px]">
          <span className="text-term-text">
            {kind} <span className="text-term-dim">{ticker}</span>
          </span>
          <span className="text-term-dim">qty {position}</span>
        </div>
        <div className="text-term-dim text-xs mt-1">no recent price history</div>
      </div>
    );
  }
  const w = 400;
  const h = 56;
  const xs = points.map((p) => p.ts);
  const ys = points.map((p) => p.yes_price_cents);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys, 0);
  const ymax = Math.max(...ys, 100);
  const sx = (x: number) => ((x - xmin) / Math.max(1, xmax - xmin)) * w;
  const sy = (y: number) => h - ((y - ymin) / Math.max(1, ymax - ymin)) * h;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.ts).toFixed(1)},${sy(p.yes_price_cents).toFixed(1)}`).join(" ");
  const first = ys[0];
  const last = ys[ys.length - 1];
  const delta = last - first;
  const color = delta >= 0 ? "#56d364" : "#f85149";

  return (
    <div className="border border-term-line p-2">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-term-text">
          {kind} <span className="text-term-dim">{ticker}</span>
        </span>
        <span className="tabular-nums">
          <span className="text-term-dim">qty {position} · yes </span>
          <span style={{ color }}>
            {last}¢ ({delta >= 0 ? "+" : ""}
            {delta}¢)
          </span>
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
        <path d={path} fill="none" stroke={color} strokeWidth={1.25} />
      </svg>
    </div>
  );
}
