type Props = {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "pos" | "neg" | "info";
};

export function KpiCard({ label, value, sub, tone = "neutral" }: Props) {
  const valueColor =
    tone === "pos" ? "text-term-greenBright"
      : tone === "neg" ? "text-term-red"
      : tone === "info" ? "text-term-cyan"
      : "text-term-text";
  return (
    <div className="border border-term-line bg-term-panel/60 px-4 py-3">
      <div className="text-[10px] tracking-[0.2em] text-term-dim uppercase">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueColor} tabular-nums`}>{value}</div>
      {sub && <div className="text-[11px] text-term-dim mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-term-line bg-term-panel/60 ${className}`}>
      <div className="flex items-center justify-between border-b border-term-line px-3 py-1.5">
        <h2 className="text-[11px] tracking-[0.2em] text-term-dim uppercase">{title}</h2>
        {right}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}
