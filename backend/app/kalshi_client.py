"""Kalshi v2 API client using RSA-PSS request signing."""
import asyncio
import base64
import time
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


def dollars_to_cents(s: Any) -> int:
    """Convert a Kalshi `_dollars` string like '3.680000' to integer cents."""
    if s is None or s == "":
        return 0
    return int(round(float(s) * 100))


def fp_to_float(s: Any) -> float:
    """Convert a Kalshi `_fp` fixed-point string like '-8.00' to float."""
    if s is None or s == "":
        return 0.0
    return float(s)


class KalshiClient:
    def __init__(self, api_key_id: str, private_key_path: str, base_url: str):
        self.api_key_id = api_key_id
        self.base_url = base_url.rstrip("/")
        self._private_key = self._load_private_key(private_key_path)
        self._client = httpx.AsyncClient(timeout=15.0)

    @staticmethod
    def _load_private_key(path: str) -> rsa.RSAPrivateKey:
        p = Path(path)
        if not p.exists():
            raise FileNotFoundError(
                f"Kalshi private key not found at {path}. "
                "Download your RSA private key PEM from Kalshi and place it there."
            )
        with open(p, "rb") as f:
            key = serialization.load_pem_private_key(f.read(), password=None)
        if not isinstance(key, rsa.RSAPrivateKey):
            raise ValueError("Expected an RSA private key PEM.")
        return key

    def _sign(self, method: str, path: str) -> dict[str, str]:
        # Kalshi signs: f"{timestamp_ms}{METHOD}{path}" with RSA-PSS + SHA256, base64-encoded.
        ts = str(int(time.time() * 1000))
        message = (ts + method.upper() + path).encode("utf-8")
        signature = self._private_key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
        return {
            "KALSHI-ACCESS-KEY": self.api_key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(signature).decode("utf-8"),
            "Accept": "application/json",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict[str, Any]:
        # Kalshi signs the path portion that follows the API version, e.g. "/trade-api/v2/portfolio/balance".
        sig_path = "/trade-api/v2" + path if not path.startswith("/trade-api/v2") else path
        headers = self._sign("GET", sig_path)
        url = self.base_url + path
        r = await self._client.get(url, headers=headers, params=params)
        r.raise_for_status()
        return r.json()

    async def get_balance(self) -> dict[str, Any]:
        return await self._get("/portfolio/balance")

    async def get_positions(self, limit: int = 200) -> dict[str, Any]:
        return await self._get("/portfolio/positions", params={"limit": limit})

    async def get_fills(self, limit: int = 100) -> dict[str, Any]:
        return await self._get("/portfolio/fills", params={"limit": limit})

    async def get_orders(self, status: str = "resting", limit: int = 100) -> dict[str, Any]:
        return await self._get("/portfolio/orders", params={"status": status, "limit": limit})

    async def get_market(self, ticker: str) -> dict[str, Any]:
        return await self._get(f"/markets/{ticker}")

    async def get_candlesticks(
        self, series_ticker: str, ticker: str, start_ts: int, end_ts: int, period_minutes: int
    ) -> dict[str, Any]:
        return await self._get(
            f"/series/{series_ticker}/markets/{ticker}/candlesticks",
            params={"start_ts": start_ts, "end_ts": end_ts, "period_interval": period_minutes},
        )

    async def get_markets_batch(self, tickers: list[str]) -> dict[str, dict[str, Any]]:
        async def one(t: str):
            try:
                data = await self.get_market(t)
                return t, data.get("market", {})
            except Exception:
                return t, {}
        results = await asyncio.gather(*(one(t) for t in tickers))
        return {t: m for t, m in results}

    async def aclose(self) -> None:
        await self._client.aclose()
