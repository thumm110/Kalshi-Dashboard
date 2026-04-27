import type { PoliticsNewsItem } from "../lib/api";

type Props = {
  items: PoliticsNewsItem[];
  sources: { id: string; name: string; item_count: number; ok: boolean }[];
  loading: boolean;
  error: string | null;
};

const SOURCE_COLORS: Record<string, string> = {
  nyt: "text-white bg-black",
  axios: "text-white bg-fuchsia-700",
  politico: "text-white bg-rose-700",
  thehill: "text-white bg-emerald-700",
  reuters: "text-white bg-orange-600",
  ap: "text-white bg-sky-700",
};

function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function NewsFeed({ items, sources, loading, error }: Props) {
  if (error) return <div className="text-term-red text-xs p-3">news error: {error}</div>;
  if (loading && items.length === 0) return <div className="text-term-dim text-xs p-3">loading…</div>;
  if (items.length === 0) return <div className="text-term-dim text-xs p-3">no headlines</div>;

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {sources.map((s) => (
          <span
            key={s.id}
            className={`text-[9px] px-1.5 py-0.5 rounded ${
              s.ok ? "bg-term-line text-term-dim" : "bg-term-red/20 text-term-red"
            }`}
            title={s.ok ? `${s.name}: ${s.item_count}` : `${s.name}: failed`}
          >
            {s.name} {s.ok ? s.item_count : "×"}
          </span>
        ))}
      </div>
      <div className="max-h-[520px] overflow-y-auto divide-y divide-term-line/60">
        {items.map((item) => (
          <a
            key={item.link}
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="block py-2 px-1 hover:bg-term-line/30 transition-colors"
          >
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className={`text-[9px] px-1 rounded shrink-0 uppercase ${SOURCE_COLORS[item.source_id] || "bg-term-line text-term-dim"}`}>
                {item.source_name}
              </span>
              <span className="text-[10px] text-term-dim tabular-nums">{timeAgo(item.published_ts)}</span>
            </div>
            <div className="text-xs text-term-text leading-snug">{item.title}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
