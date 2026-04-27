"""Politics dashboard: featured event registry + RSS news aggregator.

Two responsibilities, kept together because they're both politics-specific data
fetchers with short-TTL caches:

1. ``fetch_politics_markets`` — resolves the featured event registry into live
   market rows via the Kalshi events API.
2. ``fetch_politics_news`` — pulls a handful of politics RSS feeds, dedupes by
   title, and returns a normalized feed.

Event tickers change over time (election cycles, new cycles); if an event isn't
found the group returns empty rather than erroring, so mis-guessed tickers
degrade gracefully.
"""
from __future__ import annotations

import asyncio
import logging
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from .kalshi_client import KalshiClient, dollars_to_cents

log = logging.getLogger("kalshi-dashboard.politics")


# ---------------------------------------------------------------------------
# Featured politics registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PoliticsGroup:
    id: str
    label: str
    kind: str  # "nominee" | "party" | "chamber" | "approval" | "binary"
    party: str | None  # "D" | "R" | None
    event_ticker: str
    sort: int = 0


POLITICS_GROUPS: list[PoliticsGroup] = [
    PoliticsGroup("2028_dem_nominee", "2028 Democratic Nominee", "nominee", "D", "KXPRESNOMD-28", sort=10),
    PoliticsGroup("2028_gop_nominee", "2028 Republican Nominee", "nominee", "R", "KXPRESNOMR-28", sort=11),
    PoliticsGroup("senate_2026", "Senate Control after 2026", "chamber", None, "CONTROLS-2026", sort=30),
    PoliticsGroup("house_2026", "House Control after 2026", "chamber", None, "CONTROLH-2026", sort=31),
    PoliticsGroup("potus_approval", "Trump Approval Rating 2026", "approval", None, "KXTRUMPAPPROVALYEAR-26DEC31", sort=40),
    PoliticsGroup("shutdown_2026", "Government Shutdown Length", "binary", None, "KXGOVTSHUTLENGTH-26FEB07", sort=50),
    PoliticsGroup("gov_ca_26", "California Governor 2026", "nominee", None, "KXGOVCA-26", sort=62),
    PoliticsGroup("gov_tx_26", "Texas Governor 2026", "chamber", None, "GOVPARTYTX-26", sort=63),
    PoliticsGroup("gov_fl_26", "Florida Governor 2026", "chamber", None, "GOVPARTYFL-26", sort=64),
    PoliticsGroup("gov_ga_26", "Georgia Governor 2026", "chamber", None, "GOVPARTYGA-26", sort=65),
    PoliticsGroup("gov_az_26", "Arizona Governor 2026", "chamber", None, "GOVPARTYAZ-26", sort=66),
    PoliticsGroup("gov_pa_26", "Pennsylvania Governor 2026", "chamber", None, "GOVPARTYPA-26", sort=67),
    PoliticsGroup("gov_mi_26", "Michigan Governor 2026", "chamber", None, "GOVPARTYMI-26", sort=68),
    PoliticsGroup("gov_oh_26", "Ohio Governor 2026", "chamber", None, "GOVPARTYOH-26", sort=69),
    PoliticsGroup("gov_ny_26", "New York Governor 2026", "chamber", None, "GOVPARTYNY-26", sort=70),
]

_MARKETS_CACHE_TTL = 30  # seconds
_markets_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _market_row(m: dict[str, Any]) -> dict[str, Any]:
    yes_bid = dollars_to_cents(m.get("yes_bid_dollars"))
    yes_ask = dollars_to_cents(m.get("yes_ask_dollars"))
    last_price = dollars_to_cents(m.get("last_price_dollars"))
    mid = None
    if yes_bid and yes_ask:
        mid = (yes_bid + yes_ask) // 2
    elif last_price:
        mid = last_price
    elif yes_bid:
        mid = yes_bid
    elif yes_ask:
        mid = yes_ask
    prev_price = dollars_to_cents(m.get("previous_price_dollars"))
    change_24h = None
    if mid is not None and prev_price:
        change_24h = mid - prev_price
    return {
        "ticker": m.get("ticker"),
        "title": m.get("yes_sub_title") or m.get("title"),
        "event_title": m.get("title"),
        "yes_bid_cents": yes_bid,
        "yes_ask_cents": yes_ask,
        "last_price_cents": last_price,
        "mid_cents": mid,
        "volume_24h": int(m.get("volume_24h") or 0),
        "open_interest": int(m.get("open_interest") or 0),
        "change_24h_cents": change_24h,
        "expiration_time": m.get("expiration_time") or m.get("expected_expiration_time"),
        "status": m.get("status"),
    }


async def _load_group(client: KalshiClient, group: PoliticsGroup) -> dict[str, Any]:
    try:
        data = await client.get_event(group.event_ticker, with_nested_markets=True)
    except Exception as exc:
        log.info("politics event %s not available: %s", group.event_ticker, exc)
        return {
            "id": group.id,
            "label": group.label,
            "kind": group.kind,
            "party": group.party,
            "event_ticker": group.event_ticker,
            "event_title": None,
            "markets": [],
            "error": str(exc)[:200],
        }
    event = data.get("event", {}) or {}
    raw_markets = event.get("markets") or data.get("markets") or []
    rows = [_market_row(m) for m in raw_markets if (m.get("status") or "").lower() != "settled"]
    rows.sort(key=lambda r: -(r["mid_cents"] or 0))
    return {
        "id": group.id,
        "label": group.label,
        "kind": group.kind,
        "party": group.party,
        "event_ticker": group.event_ticker,
        "event_title": event.get("title"),
        "markets": rows,
        "error": None,
    }


async def fetch_politics_markets(client: KalshiClient) -> dict[str, Any]:
    key = "markets"
    now = time.time()
    cached = _markets_cache.get(key)
    if cached and now - cached[0] < _MARKETS_CACHE_TTL:
        return cached[1]
    groups = await asyncio.gather(*(_load_group(client, g) for g in POLITICS_GROUPS))
    payload = {"groups": groups}
    _markets_cache[key] = (now, payload)
    return payload


# ---------------------------------------------------------------------------
# News feed
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class NewsSource:
    id: str
    name: str
    url: str


NEWS_SOURCES: list[NewsSource] = [
    NewsSource("nyt", "NYT Politics", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml"),
    NewsSource("politico", "Politico", "https://rss.politico.com/politics-news.xml"),
    NewsSource("thehill", "The Hill", "https://thehill.com/homenews/feed/"),
    NewsSource("npr", "NPR Politics", "https://feeds.npr.org/1014/rss.xml"),
    NewsSource("wapo", "WaPo Politics", "https://feeds.washingtonpost.com/rss/politics"),
    NewsSource("cnn", "CNN Politics", "http://rss.cnn.com/rss/cnn_allpolitics.rss"),
    NewsSource("bloomberg", "Bloomberg Politics", "https://feeds.bloomberg.com/politics/news.rss"),
    NewsSource("abc", "ABC News Politics", "https://abcnews.go.com/abcnews/politicsheadlines"),
]

NEWS_HEADERS = {
    "User-Agent": "kalshi-dashboard/1.0 (+personal analytics)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
}

_NEWS_CACHE_TTL = 60
_news_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _text(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    t = (el.text or "").strip()
    return t or None


def _parse_ts(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt is None:
            return None
        return int(dt.timestamp())
    except (TypeError, ValueError):
        pass
    # ISO-8601 fallback (Atom feeds)
    try:
        from datetime import datetime
        raw2 = raw.replace("Z", "+00:00")
        return int(datetime.fromisoformat(raw2).timestamp())
    except ValueError:
        return None


ATOM_NS = "{http://www.w3.org/2005/Atom}"


def _parse_feed(xml_text: str, source: NewsSource) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        log.info("rss parse failed for %s: %s", source.id, exc)
        return []
    items: list[dict[str, Any]] = []
    # RSS 2.0: rss > channel > item
    for item in root.iter("item"):
        title = _text(item.find("title"))
        link = _text(item.find("link"))
        pub = _text(item.find("pubDate")) or _text(item.find("{http://purl.org/dc/elements/1.1/}date"))
        desc = _text(item.find("description"))
        if not title or not link:
            continue
        items.append({
            "source_id": source.id,
            "source_name": source.name,
            "title": title,
            "link": link,
            "published_ts": _parse_ts(pub),
            "summary": desc,
        })
    if items:
        return items
    # Atom fallback
    for entry in root.iter(f"{ATOM_NS}entry"):
        title = _text(entry.find(f"{ATOM_NS}title"))
        link_el = entry.find(f"{ATOM_NS}link")
        link = link_el.get("href") if link_el is not None else None
        pub = _text(entry.find(f"{ATOM_NS}published")) or _text(entry.find(f"{ATOM_NS}updated"))
        summary = _text(entry.find(f"{ATOM_NS}summary")) or _text(entry.find(f"{ATOM_NS}content"))
        if not title or not link:
            continue
        items.append({
            "source_id": source.id,
            "source_name": source.name,
            "title": title,
            "link": link,
            "published_ts": _parse_ts(pub),
            "summary": summary,
        })
    return items


async def _fetch_one(client: httpx.AsyncClient, source: NewsSource) -> tuple[NewsSource, list[dict[str, Any]], str | None]:
    try:
        r = await client.get(source.url, headers=NEWS_HEADERS, follow_redirects=True, timeout=10.0)
        r.raise_for_status()
    except Exception as exc:
        log.info("news fetch failed for %s: %s", source.id, exc)
        return source, [], str(exc)[:200]
    return source, _parse_feed(r.text, source), None


async def fetch_rss_news(
    sources: list[NewsSource],
    cache: dict[str, tuple[float, dict[str, Any]]],
    cache_key: str,
    limit: int = 40,
    cache_ttl: int = _NEWS_CACHE_TTL,
) -> dict[str, Any]:
    key = f"{cache_key}:{limit}"
    now = time.time()
    cached = cache.get(key)
    if cached and now - cached[0] < cache_ttl:
        return cached[1]

    async with httpx.AsyncClient() as http:
        results = await asyncio.gather(*(_fetch_one(http, s) for s in sources))

    all_items: list[dict[str, Any]] = []
    sources_meta: list[dict[str, Any]] = []
    for source, items, err in results:
        sources_meta.append({
            "id": source.id,
            "name": source.name,
            "item_count": len(items),
            "ok": err is None,
            "error": err,
        })
        all_items.extend(items)

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for item in all_items:
        norm = " ".join((item["title"] or "").lower().split())
        if norm in seen:
            continue
        seen.add(norm)
        deduped.append(item)

    deduped.sort(key=lambda x: x.get("published_ts") or 0, reverse=True)
    payload = {
        "items": deduped[:limit],
        "sources": sources_meta,
    }
    cache[key] = (now, payload)
    return payload


async def fetch_politics_news(limit: int = 40) -> dict[str, Any]:
    return await fetch_rss_news(NEWS_SOURCES, _news_cache, "politics", limit=limit)
