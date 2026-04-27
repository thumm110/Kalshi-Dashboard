"""Sports dashboard: live game series + season-long futures registry.

Two flavors of content, cached together with a 30s TTL:

1. Live-game series (NBA, NHL, MLB, MLS, UFC) — queried by ``series_ticker``
   via ``list_events(..., with_nested_markets=True)``, one call per sport.
   Each returned event is a game/fight with its own nested markets
   (moneyline-style binary YES per side, plus any alt markets Kalshi exposes).
2. Futures groups (MLB awards, UFC title holders, MLS Cup, UCL winner, Golf,
   F1/NASCAR/motorsports champions) — same pattern as politics: one
   ``event_ticker`` per group, resolved via ``get_event``.

Event tickers for futures can go stale at season boundaries. Groups that fail
to resolve return empty rows rather than erroring, so the page still renders.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from .espn import fetch_espn_enrichment, series_for_game, stats_for_game, teams_from_sub_title
from .kalshi_client import KalshiClient, dollars_to_cents

log = logging.getLogger("kalshi-dashboard.sports")


# ---------------------------------------------------------------------------
# Registries
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SportSeries:
    id: str
    label: str
    series_ticker: str
    sort: int = 0


@dataclass(frozen=True)
class SportFutures:
    id: str
    sport_id: str     # "mlb" | "ufc" | "golf" | "mls" | "nba" | "motorsport" | "soccer"
    label: str
    kind: str         # "champion" | "award" | "title" | "stat" | "team_wins" | "novelty"
    event_ticker: str
    sort: int = 0


SPORT_LIVE_SERIES: list[SportSeries] = [
    SportSeries("nba", "NBA", "KXNBAGAME", sort=10),
    SportSeries("nhl", "NHL", "KXNHLGAME", sort=20),
    SportSeries("mlb", "MLB", "KXMLBGAME", sort=30),
    SportSeries("mls", "MLS", "KXMLSGAME", sort=40),
    SportSeries("ufc", "UFC", "KXUFCFIGHT", sort=50),
]


# Playoff series markets — each event has two markets (team A wins / team B wins).
PLAYOFF_SERIES_REGISTRY: list[tuple[str, str, str]] = [
    ("nba", "NBA", "KXNBASERIES"),
    ("nhl", "NHL", "KXNHLSERIES"),
]


# Per-sport additional series (spread, total) — merged into game cards by game_id.
# game_id = the ticker suffix after the first dash, which matches across series.
SPORT_EXTRA_SERIES: dict[str, list[tuple[str, str]]] = {
    "mlb": [("spread", "KXMLBSPREAD"), ("total", "KXMLBTOTAL")],
    "nba": [("spread", "KXNBASPREAD"), ("total", "KXNBATOTAL")],
    "nhl": [("spread", "KXNHLSPREAD"), ("total", "KXNHLTOTAL")],
}


# Per-tournament golf prop series. Each produces one event per active tournament
# with suffix = tournament_code (e.g. -PGC26 for PGA Championship). We group
# by tournament_code so each active tournament gets a full prop card.
GOLF_PROP_SERIES: list[tuple[str, str, int]] = [
    # (series_ticker, human_label, sort_order_within_tournament)
    ("KXPGATOUR",       "Winner",        10),
    ("KXPGATOP5",       "Top 5 Finish",  20),
    ("KXPGATOP10",      "Top 10 Finish", 21),
    ("KXPGATOP20",      "Top 20 Finish", 22),
    ("KXPGATOP40",      "Top 40 Finish", 23),
    ("KXPGAMAKECUT",    "Make the Cut",  30),
    ("KXPGACUTLINE",    "Cut Line",      31),
    ("KXPGAAGECUT",     "Oldest to Cut", 32),
    ("KXPGAR1LEAD",     "R1 Leader",     40),
    ("KXPGAR2LEAD",     "R2 Leader",     41),
    ("KXPGAR3LEAD",     "R3 Leader",     42),
    ("KXPGAR1TOP5",     "R1 Top 5",      43),
    ("KXPGAR1TOP10",    "R1 Top 10",     44),
    ("KXPGAR1TOP20",    "R1 Top 20",     45),
    ("KXPGAR2TOP5",     "R2 Top 5",      46),
    ("KXPGAR2TOP10",    "R2 Top 10",     47),
    ("KXPGAR3TOP5",     "R3 Top 5",      48),
    ("KXPGAR3TOP10",    "R3 Top 10",     49),
    ("KXPGAHOLEINONE",  "Hole in One",   60),
    ("KXPGAPLAYOFF",    "Playoff",       61),
    ("KXPGAEAGLE",      "Eagle in Round",62),
    ("KXPGABOGEYFREE",  "Bogey Free Round", 63),
    ("KXPGALOWSCORE",   "Lowest Round Score", 64),
    ("KXPGAWINMARGIN",  "Win Margin",    70),
    ("KXPGAWINNINGSCORE","Winning Score",71),
    ("KXPGASTROKEMARGIN","Stroke Margin",72),
    ("KXPGAH2H",        "H2H Matchups",  80),
    ("KXPGAWINNERREGION","Winner Region",81),
]


# Futures registry — grouped by sport_id for page sectioning.
SPORT_FUTURES: list[SportFutures] = [
    # MLB awards (AL + NL parity)
    SportFutures("mlb_al_mvp",    "mlb", "AL MVP",                 "award",    "KXMLBALMVP-26",       sort=10),
    SportFutures("mlb_nl_mvp",    "mlb", "NL MVP",                 "award",    "KXMLBNLMVP-26",       sort=11),
    SportFutures("mlb_al_cy",     "mlb", "AL Cy Young",            "award",    "KXMLBALCY-26",        sort=12),
    SportFutures("mlb_nl_cy",     "mlb", "NL Cy Young",            "award",    "KXMLBNLCY-26",        sort=13),
    SportFutures("mlb_al_roty",   "mlb", "AL Rookie of the Year",  "award",    "KXMLBALROTY-26",      sort=14),
    SportFutures("mlb_nl_roty",   "mlb", "NL Rookie of the Year",  "award",    "KXMLBNLROTY-26",      sort=15),
    SportFutures("mlb_al_cpoty",  "mlb", "AL Comeback Player",     "award",    "KXMLBALCPOTY-26",     sort=16),
    SportFutures("mlb_nl_cpoty",  "mlb", "NL Comeback Player",     "award",    "KXMLBNLCPOTY-26",     sort=17),
    SportFutures("mlb_al_reloty", "mlb", "AL Reliever of the Year","award",    "KXMLBALRELOTY-26",    sort=18),
    SportFutures("mlb_nl_reloty", "mlb", "NL Reliever of the Year","award",    "KXMLBNLRELOTY-26",    sort=19),
    SportFutures("mlb_al_moty",   "mlb", "AL Manager of the Year", "award",    "KXMLBALMOTY-26",      sort=20),
    SportFutures("mlb_nl_moty",   "mlb", "NL Manager of the Year", "award",    "KXMLBNLMOTY-26",      sort=21),
    SportFutures("mlb_eoty",      "mlb", "Executive of the Year",  "award",    "KXMLBEOTY-26",        sort=22),
    SportFutures("mlb_al_haaron", "mlb", "AL Hank Aaron Award",    "award",    "KXMLBALHAARON-26",    sort=23),
    SportFutures("mlb_nl_haaron", "mlb", "NL Hank Aaron Award",    "award",    "KXMLBNLHAARON-26",    sort=24),
    SportFutures("mlb_ohtani",    "mlb", "Ohtani: Cy Young + MVP", "novelty",  "KXMLBAWARDCOMBO-26MVPCY", sort=25),
    # MLB stat milestones (binary)
    SportFutures("mlb_nohit",     "mlb", "No Hitter",              "stat",     "KXMLBSTAT-26NOHIT",   sort=40),
    SportFutures("mlb_pg",        "mlb", "Perfect Game",           "stat",     "KXMLBSTAT-26PG",      sort=41),
    SportFutures("mlb_hr500",     "mlb", "500+ Foot Home Run",     "stat",     "KXMLBSTAT-26HR500",   sort=42),
    SportFutures("mlb_k20",       "mlb", "20+ Strikeout Game",     "stat",     "KXMLBSTAT-26K20",     sort=43),
    SportFutures("mlb_hr4",       "mlb", "4+ HR Game",             "stat",     "KXMLBSTAT-26HR4",     sort=44),
    SportFutures("mlb_gs2",       "mlb", "2+ Grand Slam Game",     "stat",     "KXMLBSTAT-26GS2",     sort=45),
    SportFutures("mlb_w20",       "mlb", "20+ Win Season",         "stat",     "KXMLBSTAT-26W20",     sort=46),
    SportFutures("mlb_5050",      "mlb", "50/50 Season",           "stat",     "KXMLBSTAT-265050",    sort=47),
    # UFC title holders
    SportFutures("ufc_hw",  "ufc", "Heavyweight Title",       "title", "KXUFCHEAVYWEIGHTTITLE-26",   sort=10),
    SportFutures("ufc_lhw", "ufc", "Light Heavyweight Title", "title", "KXUFCLHEAVYWEIGHTTITLE-26",  sort=11),
    SportFutures("ufc_mw",  "ufc", "Middleweight Title",      "title", "KXUFCMIDDLEWEIGHTTITLE-26",  sort=12),
    SportFutures("ufc_ww",  "ufc", "Welterweight Title",      "title", "KXUFCWELTERWEIGHTTITLE-26",  sort=13),
    SportFutures("ufc_ltw", "ufc", "Lightweight Title",       "title", "KXUFCLIGHTWEIGHTTITLE-26",   sort=14),
    SportFutures("ufc_fw",  "ufc", "Featherweight Title",     "title", "KXUFCFEATHERWEIGHTTITLE-26", sort=15),
    SportFutures("ufc_bw",  "ufc", "Bantamweight Title",      "title", "KXUFCBANTAMWEIGHTTITLE-26",  sort=16),
    SportFutures("ufc_flw", "ufc", "Flyweight Title",         "title", "KXUFCFLYWEIGHTTITLE-26",     sort=17),
    # Golf — season-long
    SportFutures("pga_majors",        "golf", "PGA Major Winner 2026",         "champion", "KXPGAMAJORWIN-26",         sort=10),
    SportFutures("pga_majortop10",    "golf", "Top 10 in All 4 Majors 2026",   "award",    "KXPGAMAJORTOP10-MAJORS26", sort=11),
    SportFutures("pga_ryder",         "golf", "Ryder Cup 2027",                "champion", "KXPGARYDER-RC27",          sort=12),
    SportFutures("pga_ryder_captain", "golf", "Ryder Cup 2027 Captain (USA)",  "novelty",  "KXRYDERCUPCAPTAIN-2027USA",sort=13),
    SportFutures("pga_solheim",       "golf", "Solheim Cup 2026",              "champion", "KXPGASOLHEIM-SC26",        sort=14),
    SportFutures("pga_tiger",         "golf", "Tiger plays a PGA event",       "novelty",  "KXPGATIGER-26",            sort=15),
    SportFutures("pga_curry",         "golf", "Curry in PGA event",            "novelty",  "KXPGACURRY-28",            sort=16),
    # MLS futures
    SportFutures("mls_cup",   "mls", "MLS Cup Champion",     "champion", "KXMLSCUP-26",  sort=10),
    SportFutures("mls_east",  "mls", "MLS East Champion",    "champion", "KXMLSEAST-26", sort=11),
    SportFutures("mls_west",  "mls", "MLS West Champion",    "champion", "KXMLSWEST-26", sort=12),
    # NHL — Stanley Cup, conference finals, awards
    SportFutures("nhl_cup",      "nhl", "Stanley Cup Champion",        "champion", "KXNHL-26",          sort=10),
    SportFutures("nhl_east",     "nhl", "Eastern Conference Final",    "champion", "KXNHLEAST-26",      sort=11),
    SportFutures("nhl_west",     "nhl", "Western Conference Final",    "champion", "KXNHLWEST-26",      sort=12),
    SportFutures("nhl_teams_sc", "nhl", "Teams in Stanley Cup",        "novelty",  "KXTEAMSINSC-26",    sort=13),
    SportFutures("nhl_hart",     "nhl", "Hart Trophy (MVP)",           "award",    "KXNHLHART-26",      sort=20),
    SportFutures("nhl_norris",   "nhl", "Norris Trophy (Defenseman)",  "award",    "KXNHLNORRIS-26",    sort=21),
    SportFutures("nhl_vezina",   "nhl", "Vezina Trophy (Goalie)",      "award",    "KXNHLVEZINA-26",    sort=22),
    SportFutures("nhl_calder",   "nhl", "Calder Trophy (Rookie)",      "award",    "KXNHLCALDER-26",    sort=23),
    SportFutures("nhl_adams",    "nhl", "Jack Adams (Coach)",          "award",    "KXNHLADAMS-26",     sort=24),
    # NBA (thin — mostly college + women + novelty since Kalshi has no men's pro champ)
    SportFutures("nba_march_m",   "nba", "Men's March Madness 2027",   "champion", "KXMARMAD-27",   sort=10),
    SportFutures("nba_march_w",   "nba", "Women's March Madness 2027", "champion", "KXWMARMAD-27",  sort=11),
    SportFutures("nba_wnba",      "nba", "WNBA Champion 2026",         "champion", "KXWNBA-26",     sort=12),
    SportFutures("nba_top5_roty", "nba", "Top-5 Pick wins ROY",        "novelty",  "KXNBATOP5ROTY-26", sort=13),
    # Soccer — Champions League only; EPL/UEFA/FIFA not tradeable
    SportFutures("ucl_winner",    "soccer", "Champions League 2026",    "champion", "KXUCL-26",       sort=10),
    # Motorsports
    SportFutures("f1_drivers",      "motorsport", "F1 Drivers Champion",       "champion", "KXF1-26",                       sort=10),
    SportFutures("f1_constructors", "motorsport", "F1 Constructors Champion",  "champion", "KXF1CONSTRUCTORS-26",           sort=11),
    SportFutures("motogp",          "motorsport", "MotoGP World Champion",     "champion", "KXMOTOGP-26",                   sort=12),
    SportFutures("motogp_teams",    "motorsport", "MotoGP Teams Champion",     "champion", "KXMOTOGPTEAMS-26",              sort=13),
    SportFutures("nascar_cup",      "motorsport", "NASCAR Cup Series",         "champion", "KXNASCARCUPSERIES-NCS26",       sort=14),
    SportFutures("nascar_truck",    "motorsport", "NASCAR Truck Series",       "champion", "KXNASCARTRUCKSERIES-NTS26",     sort=15),
]


SPORT_LABELS: dict[str, str] = {
    "nba": "NBA",
    "nhl": "NHL",
    "mlb": "MLB",
    "mls": "MLS",
    "ufc": "UFC",
    "golf": "Golf",
    "soccer": "Soccer",
    "motorsport": "Motorsports",
}


NOT_OFFERED_NOTE = [
    "NFL (offseason)",
    "EPL / La Liga / Serie A / Bundesliga",
    "FIFA World Cup 2026 (markets not live yet)",
    "Tennis",
    "Boxing",
    "College football/basketball games (offseason)",
]


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

_CACHE_TTL = 30
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


# ---------------------------------------------------------------------------
# Row shaping
# ---------------------------------------------------------------------------

def _market_row(m: dict[str, Any]) -> dict[str, Any]:
    yes_bid = dollars_to_cents(m.get("yes_bid_dollars"))
    yes_ask = dollars_to_cents(m.get("yes_ask_dollars"))
    last_price = dollars_to_cents(m.get("last_price_dollars"))
    mid: int | None = None
    if yes_bid and yes_ask:
        mid = (yes_bid + yes_ask) // 2
    elif last_price:
        mid = last_price
    elif yes_bid:
        mid = yes_bid
    elif yes_ask:
        mid = yes_ask
    prev = dollars_to_cents(m.get("previous_price_dollars"))
    change_24h = None
    if mid is not None and prev:
        change_24h = mid - prev
    return {
        "ticker": m.get("ticker"),
        "title": m.get("yes_sub_title") or m.get("title"),
        "yes_bid_cents": yes_bid,
        "yes_ask_cents": yes_ask,
        "last_price_cents": last_price,
        "mid_cents": mid,
        "volume_24h": int(m.get("volume_24h") or 0),
        "open_interest": int(m.get("open_interest") or 0),
        "change_24h_cents": change_24h,
        "status": m.get("status"),
        "expiration_time": m.get("expiration_time") or m.get("expected_expiration_time"),
    }


def _game_row(event: dict[str, Any], sport_id: str, sport_label: str) -> dict[str, Any]:
    raw_markets = event.get("markets") or []
    rows = [_market_row(m) for m in raw_markets if (m.get("status") or "").lower() not in ("settled", "finalized", "closed")]
    rows.sort(key=lambda r: -(r["mid_cents"] or 0))
    return {
        "sport_id": sport_id,
        "sport_label": sport_label,
        "event_ticker": event.get("event_ticker"),
        "title": event.get("title"),
        "sub_title": event.get("sub_title"),
        "expected_expiration_time": event.get("expected_expiration_time"),
        "markets": rows,
    }


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------

async def _load_live_series(client: KalshiClient, sport: SportSeries) -> list[dict[str, Any]]:
    games: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(15):
        try:
            data = await client.list_events(
                limit=200, cursor=cursor,
                series_ticker=sport.series_ticker, with_nested_markets=True,
            )
        except Exception as exc:
            log.info("sports live series %s failed: %s", sport.series_ticker, exc)
            break
        batch = data.get("events") or []
        for ev in batch:
            row = _game_row(ev, sport.id, sport.label)
            # Drop games where every market already settled (past games) — leaves current + upcoming
            if row["markets"]:
                games.append(row)
        cursor = data.get("cursor") or None
        if not cursor or not batch:
            break
    return games


async def _load_futures(client: KalshiClient, fut: SportFutures) -> dict[str, Any]:
    try:
        data = await client.get_event(fut.event_ticker, with_nested_markets=True)
    except Exception as exc:
        log.info("sports futures %s not available: %s", fut.event_ticker, exc)
        return {
            "id": fut.id,
            "sport_id": fut.sport_id,
            "label": fut.label,
            "kind": fut.kind,
            "event_ticker": fut.event_ticker,
            "event_title": None,
            "markets": [],
            "error": str(exc)[:200],
        }
    event = data.get("event", {}) or {}
    raw = event.get("markets") or data.get("markets") or []
    rows = [_market_row(m) for m in raw if (m.get("status") or "").lower() not in ("settled", "finalized", "closed")]
    rows.sort(key=lambda r: -(r["mid_cents"] or 0))
    return {
        "id": fut.id,
        "sport_id": fut.sport_id,
        "label": fut.label,
        "kind": fut.kind,
        "event_ticker": fut.event_ticker,
        "event_title": event.get("title"),
        "markets": rows,
        "error": None,
    }


def _game_id(ticker: str | None) -> str:
    if not ticker:
        return ""
    _, _, rest = ticker.partition("-")
    return rest


async def _load_extra_series(
    client: KalshiClient, sport_id: str, kind: str, series_ticker: str
) -> dict[str, list[dict[str, Any]]]:
    """Returns game_id -> list of market rows (tagged with kind)."""
    by_game: dict[str, list[dict[str, Any]]] = {}
    cursor: str | None = None
    for _ in range(15):
        try:
            data = await client.list_events(
                limit=200, cursor=cursor,
                series_ticker=series_ticker, with_nested_markets=True,
            )
        except Exception as exc:
            log.info("sports extra series %s failed: %s", series_ticker, exc)
            break
        batch = data.get("events") or []
        for ev in batch:
            raw = ev.get("markets") or []
            rows = [_market_row(m) for m in raw if (m.get("status") or "").lower() not in ("settled", "finalized", "closed")]
            if not rows:
                continue
            for r in rows:
                r["kind"] = kind
            rows.sort(key=lambda r: -(r["mid_cents"] or 0))
            gid = _game_id(ev.get("event_ticker"))
            if gid:
                by_game.setdefault(gid, []).extend(rows)
        cursor = data.get("cursor") or None
        if not cursor or not batch:
            break
    return by_game


async def _load_golf_prop(
    client: KalshiClient, series_ticker: str, label: str, sort: int
) -> list[dict[str, Any]]:
    """Returns per-tournament grouped props: [{tournament_code, event_ticker, event_title, label, sort, markets}]."""
    out: list[dict[str, Any]] = []
    try:
        data = await client.list_events(
            limit=200, series_ticker=series_ticker, with_nested_markets=True,
        )
    except Exception as exc:
        log.info("golf prop %s failed: %s", series_ticker, exc)
        return out
    for ev in data.get("events") or []:
        raw = ev.get("markets") or []
        rows = [_market_row(m) for m in raw if (m.get("status") or "").lower() not in ("settled", "finalized", "closed")]
        if not rows:
            continue
        rows.sort(key=lambda r: -(r["mid_cents"] or 0))
        ticker = ev.get("event_ticker") or ""
        _, _, tcode = ticker.partition("-")
        out.append({
            "tournament_code": tcode,
            "event_ticker": ticker,
            "event_title": ev.get("title"),
            "sub_title": ev.get("sub_title"),
            "label": label,
            "sort": sort,
            "markets": rows,
        })
    return out


async def _load_playoff_series(
    client: KalshiClient, sport_id: str, sport_label: str, series_ticker: str
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(5):
        try:
            data = await client.list_events(
                limit=200, cursor=cursor,
                series_ticker=series_ticker, with_nested_markets=True,
            )
        except Exception as exc:
            log.info("sports playoff series %s failed: %s", series_ticker, exc)
            break
        batch = data.get("events") or []
        for ev in batch:
            raw_markets = ev.get("markets") or []
            rows = [_market_row(m) for m in raw_markets if (m.get("status") or "").lower() not in ("settled", "finalized", "closed")]
            rows.sort(key=lambda r: -(r["mid_cents"] or 0))
            if not rows:
                continue
            out.append({
                "sport_id": sport_id,
                "sport_label": sport_label,
                "event_ticker": ev.get("event_ticker"),
                "title": ev.get("title"),
                "sub_title": ev.get("sub_title"),
                "markets": rows,
            })
        cursor = data.get("cursor") or None
        if not cursor or not batch:
            break
    return out


async def fetch_sports_markets(client: KalshiClient) -> dict[str, Any]:
    key = "markets"
    now = time.time()
    cached = _cache.get(key)
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    extra_pairs: list[tuple[str, str, str]] = []
    for sport_id, specs in SPORT_EXTRA_SERIES.items():
        for kind, series_ticker in specs:
            extra_pairs.append((sport_id, kind, series_ticker))

    live_task = asyncio.gather(*(_load_live_series(client, s) for s in SPORT_LIVE_SERIES))
    futures_task = asyncio.gather(*(_load_futures(client, f) for f in SPORT_FUTURES))
    series_task = asyncio.gather(
        *(_load_playoff_series(client, sid, label, t) for (sid, label, t) in PLAYOFF_SERIES_REGISTRY)
    )
    extras_task = asyncio.gather(
        *(_load_extra_series(client, sid, kind, st) for (sid, kind, st) in extra_pairs)
    )
    golf_task = asyncio.gather(
        *(_load_golf_prop(client, st, lbl, sort) for (st, lbl, sort) in GOLF_PROP_SERIES)
    )
    espn_task = fetch_espn_enrichment()
    live_batches, futures, series_batches, extras_batches, golf_batches, espn = await asyncio.gather(
        live_task, futures_task, series_task, extras_task, golf_task, espn_task
    )

    # Group golf props by tournament_code
    golf_tournaments_map: dict[str, dict[str, Any]] = {}
    for group in golf_batches:
        for row in group:
            tcode = row["tournament_code"]
            t = golf_tournaments_map.setdefault(tcode, {
                "tournament_code": tcode,
                "event_title": None,
                "sections": [],
            })
            if not t["event_title"] and row.get("event_title"):
                t["event_title"] = row["event_title"]
            t["sections"].append({
                "label": row["label"],
                "sort": row["sort"],
                "event_ticker": row["event_ticker"],
                "markets": row["markets"],
            })
    golf_tournaments = []
    for tcode, t in golf_tournaments_map.items():
        t["sections"].sort(key=lambda s: s["sort"])
        golf_tournaments.append(t)
    # Sort tournaments: those with a Winner section first (active PGA tournaments)
    golf_tournaments.sort(key=lambda t: (
        0 if any(s["label"] == "Winner" for s in t["sections"]) else 1,
        -sum(len(s["markets"]) for s in t["sections"]),
    ))

    # Build sport_id -> game_id -> {kind: [markets]}
    extras_by_sport_game: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = {}
    for (sport_id, kind, _st), by_game in zip(extra_pairs, extras_batches):
        sport_map = extras_by_sport_game.setdefault(sport_id, {})
        for gid, rows in by_game.items():
            sport_map.setdefault(gid, {}).setdefault(kind, []).extend(rows)
    playoff_series: list[dict[str, Any]] = []
    for batch in series_batches:
        playoff_series.extend(batch)
    for s in playoff_series:
        s["series_summary"] = series_for_game(s.get("sub_title"), s.get("sport_id", ""), espn)
        s["series_stats"] = stats_for_game(s.get("sub_title"), s.get("sport_id", ""), espn)

    live_games: list[dict[str, Any]] = []
    for batch in live_batches:
        live_games.extend(batch)
    # Sort live games by expiration (proxy for start time)
    live_games.sort(key=lambda g: g.get("expected_expiration_time") or "")

    records_by_sport = {
        "nhl": espn.get("nhl_team_records") or {},
        "nba": espn.get("nba_team_records") or {},
        "mlb": espn.get("mlb_team_records") or {},
    }
    for g in live_games:
        sid = g.get("sport_id", "")
        g["series_summary"] = series_for_game(g.get("sub_title"), sid, espn)
        g["series_stats"] = stats_for_game(g.get("sub_title"), sid, espn)
        gid = _game_id(g.get("event_ticker"))
        extras = (extras_by_sport_game.get(sid) or {}).get(gid) or {}
        g["extra_markets"] = extras
        team_records: dict[str, str] = {}
        records_src = records_by_sport.get(sid) or {}
        if records_src:
            pair = teams_from_sub_title(g.get("sub_title"), sid)
            if pair:
                for ab in pair:
                    if ab in records_src:
                        team_records[ab] = records_src[ab]
        g["team_records"] = team_records

    sports_meta = [
        {"id": s.id, "label": s.label, "series_ticker": s.series_ticker,
         "game_count": sum(1 for g in live_games if g["sport_id"] == s.id)}
        for s in SPORT_LIVE_SERIES
    ]

    payload = {
        "live_games": live_games,
        "futures": futures,
        "sports": sports_meta,
        "sport_labels": SPORT_LABELS,
        "not_offered": NOT_OFFERED_NOTE,
        "pga_leaderboard": espn.get("pga") or {},
        "playoff_series": playoff_series,
        "golf_tournaments": golf_tournaments,
    }
    _cache[key] = (now, payload)
    return payload


# ---------------------------------------------------------------------------
# Sports news (RSS)
# ---------------------------------------------------------------------------

from .politics import NewsSource, fetch_rss_news  # noqa: E402

SPORTS_NEWS_SOURCES: list[NewsSource] = [
    # League-desk feeds — in-tune, no cross-sport mumbo-jumbo.
    NewsSource("mlb_com", "MLB.com", "https://www.mlb.com/feeds/news/rss.xml"),
    NewsSource("yahoo_nhl", "Yahoo NHL", "https://sports.yahoo.com/nhl/rss/"),
    NewsSource("espn_nhl", "ESPN NHL", "https://www.espn.com/espn/rss/nhl/news"),
    NewsSource("cbs_nhl", "CBS NHL", "https://www.cbssports.com/rss/headlines/nhl/"),
    NewsSource("sportsnet_nhl", "Sportsnet NHL", "https://www.sportsnet.ca/hockey/nhl/feed/"),
    NewsSource("yahoo_nba", "Yahoo NBA", "https://sports.yahoo.com/nba/rss/"),
    NewsSource("espn_nba", "ESPN NBA", "https://www.espn.com/espn/rss/nba/news"),
    NewsSource("yahoo_mlb", "Yahoo MLB", "https://sports.yahoo.com/mlb/rss/"),
    NewsSource("yahoo_golf", "Yahoo Golf", "https://sports.yahoo.com/golf/rss/"),
    # General-desk fallback (only used by the "General" filter tab).
    NewsSource("cbs", "CBS Sports", "https://www.cbssports.com/rss/headlines/"),
    NewsSource("bbc_sport", "BBC Sport", "https://feeds.bbci.co.uk/sport/rss.xml"),
]

_sports_news_cache: dict[str, tuple[float, dict]] = {}


async def fetch_sports_news(limit: int = 40) -> dict:
    return await fetch_rss_news(SPORTS_NEWS_SOURCES, _sports_news_cache, "sports", limit=limit)
