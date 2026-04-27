"""Map Kalshi market tickers to user-facing categories.

Kalshi ticker series prefixes roughly indicate category. We normalize loosely —
refine over time as we discover new series.
"""

CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Weather",  ("KXHIGH", "KXLOW", "KXTEMP", "KXDV", "HIGH", "LOW", "TEMP", "RAIN", "SNOW", "HURRICANE")),
    ("Crypto",   ("KXBTC", "KXETH", "BTC", "ETH", "CRYPTO")),
    ("Sports",   ("KXNFL", "KXNBA", "KXMLB", "KXNHL", "KXUFC", "KXMLS", "KXUCL", "KXMOTOGP", "KXNASCAR", "KXF1", "KXMARMAD", "KXWMARMAD", "KXWNBA", "KXPGA", "KXCOACHOUT", "KXMVESPORTS", "MVESPORTS", "NFL", "NBA", "MLB", "NHL", "UFC", "NCAA", "PGA", "TEN", "MLS", "F1", "NASCAR")),
    ("Politics", ("PRES", "GOV", "SEN", "HOUSE", "ELECT", "POTUS", "KXPRES")),
    ("Economics",("CPI", "FED", "GDP", "JOBS", "KXFED", "KXCPI", "KXGDP", "UNEMP", "KXECONSTAT")),
    ("Entertainment", ("KXOSCAR", "KXEMMY", "KXGRAMMY", "OSCAR", "EMMY", "GRAMMY", "BOX", "MOVIE")),
]


def categorize(ticker: str) -> str:
    t = (ticker or "").upper()
    for name, prefixes in CATEGORY_RULES:
        for p in prefixes:
            if t.startswith(p) or f"-{p}" in t or f"_{p}" in t:
                return name
    return "Other"
