import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryPnl } from "../lib/api";
import { fmtUsd } from "../lib/api";

const PALETTE = ["#56d364", "#39c5cf", "#d29922", "#a371f7", "#f85149", "#6b7785"];

export function CategoryBreakdown({ categories }: { categories: CategoryPnl[] }) {
  if (categories.length === 0) {
    return <div className="h-52 flex items-center justify-center text-term-dim text-sm">No data</div>;
  }
  const data = categories.map((c, i) => ({
    name: c.category,
    pnl: c.total_pnl_cents / 100,
    exposure: c.exposure_cents / 100,
    count: c.position_count,
    color: PALETTE[i % PALETTE.length],
  }));
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="name" stroke="#6b7785" fontSize={10} />
          <YAxis stroke="#6b7785" fontSize={10} tickFormatter={(v) => `$${v.toFixed(0)}`} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid #1a2029", fontSize: 12 }}
            formatter={(v: number, name: string) =>
              name === "pnl" ? fmtUsd(Math.round(v * 100), true) : fmtUsd(Math.round(v * 100))
            }
          />
          <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? d.color : "#f85149"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
