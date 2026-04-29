import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WeatherCity } from "../lib/cities";

export const WINDY_EMBED_ORIGIN = "https://embed.windy.com";
export const WINDY_SITE_ORIGIN = "https://www.windy.com";

export function buildWindySiteUrl(city: WeatherCity, opts: { zoom?: number } = {}): string {
  // The full windy.com page honors the user's logged-in session so premium
  // layers/models are available. Format: /-{lat},{lon},{zoom}
  const zoom = opts.zoom ?? 9;
  return `${WINDY_SITE_ORIGIN}/-${city.lat.toFixed(3)},${city.lng.toFixed(3)},${zoom}`;
}

export function buildWindyEmbedUrl(city: WeatherCity, opts: { zoom?: number } = {}): string {
  const zoom = opts.zoom ?? 8;
  const params = new URLSearchParams({
    lat: city.lat.toFixed(4),
    lon: city.lng.toFixed(4),
    detailLat: city.lat.toFixed(4),
    detailLon: city.lng.toFixed(4),
    zoom: String(zoom),
    level: "surface",
    overlay: "temp",
    menu: "",
    message: "",
    marker: "true",
    calendar: "now",
    pressure: "",
    type: "map",
    location: "coordinates",
    detail: "",
    metricWind: "mph",
    metricTemp: "°F",
    radarRange: "-1",
  });
  return `${WINDY_EMBED_ORIGIN}/embed2.html?${params.toString()}`;
}

export function WindyPreload({ city }: { city: WeatherCity | null }) {
  if (!city) return null;
  return (
    <iframe
      key={city.code}
      src={buildWindyEmbedUrl(city)}
      title={`Windy preload for ${city.name}`}
      aria-hidden="true"
      tabIndex={-1}
      style={{
        position: "fixed",
        width: 1,
        height: 1,
        border: 0,
        opacity: 0,
        pointerEvents: "none",
        left: -9999,
        top: -9999,
      }}
    />
  );
}

export function WindyCityPopup({
  city,
  leftPane,
  onClose,
}: {
  city: WeatherCity;
  leftPane: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const deepDiveUrl = buildWindySiteUrl(city);

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex h-[85vh] w-[min(1400px,96vw)] flex-col overflow-hidden rounded border border-term-line bg-[#05080b] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-term-line bg-term-panel/90 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-term-text">
              {city.name} · Position + Windy
            </div>
            <div className="text-[10px] text-term-dim">
              {city.code} · {city.lat.toFixed(4)}, {city.lng.toFixed(4)} · embed shows free layers — use Deep Dive for your premium account
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={deepDiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-term-cyan bg-term-panel px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-term-cyan hover:bg-term-cyan/10"
              title="Open windy.com in a new tab — uses your logged-in session for premium layers"
            >
              Deep Dive ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close popup"
              className="rounded border border-term-line bg-term-panel px-2 py-0.5 text-[11px] text-term-dim hover:border-term-cyan hover:text-term-cyan"
            >
              CLOSE
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="w-full overflow-y-auto border-b border-term-line bg-[#080d12]/95 p-3 text-[12px] md:w-[380px] md:shrink-0 md:border-b-0 md:border-r">
            {leftPane}
          </div>
          <div className="relative min-h-[300px] flex-1">
            <iframe
              src={buildWindyEmbedUrl(city)}
              title={`Windy weather map for ${city.name}`}
              className="h-full w-full border-0"
              allow="fullscreen"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function WindyPreconnect() {
  return (
    <>
      <link rel="preconnect" href={WINDY_EMBED_ORIGIN} crossOrigin="anonymous" />
      <link rel="dns-prefetch" href={WINDY_EMBED_ORIGIN} />
    </>
  );
}
