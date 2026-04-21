import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EquityPoint } from "../lib/api";
import { fmtUsd } from "../lib/api";

export function EquityCurve({ points }: { points: EquityPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-term-dim text-sm">
        Collecting snapshots… equity curve will build up over time.
      </div>
    );
  }
  const data = points.map((p) => ({
    t: p.ts * 1000,
    equity: p.equity_cents / 100,
    label: new Date(p.ts * 1000).toLocaleTimeString(),
  }));
  const first = data[0].equity;
  const last = data[data.length - 1].equity;
  const up = last >= first;
  const color = up ? "#56d364" : "#f85149";
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1a2029" strokeDasharray="2 4" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            stroke="#6b7785"
            fontSize={10}
          />
          <YAxis stroke="#6b7785" fontSize={10} tickFormatter={(v) => `$${v.toFixed(0)}`} />
          <Tooltip
            contentStyle={{ background: "#0d1117", border: "1px solid #1a2029", fontSize: 12 }}
            labelFormatter={(t: number) => new Date(t).toLocaleString()}
            formatter={(v: number) => fmtUsd(Math.round(v * 100))}
          />
          <Area type="monotone" dataKey="equity" stroke={color} strokeWidth={2} fill="url(#equityFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
