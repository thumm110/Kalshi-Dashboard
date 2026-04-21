"""Kalshi weather location registry for analytical weather guidance.

The series list is based on Kalshi's public Climate and Weather series as
queried in April 2026. NWS CLI URLs are settlement-source references; live
station observations are only used as intraday analytical guidance.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WeatherLocation:
    code: str
    name: str
    timezone: str
    lat: float
    lng: float
    observation_station: str | None
    climate_station: str
    climate_report_url: str
    series: tuple[str, ...]


WEATHER_LOCATIONS: tuple[WeatherLocation, ...] = (
    WeatherLocation(
        code="ATL",
        name="Atlanta",
        timezone="America/New_York",
        lat=33.7490,
        lng=-84.3880,
        observation_station="KATL",
        climate_station="ATL",
        climate_report_url="https://forecast.weather.gov/product.php?site=FFC&product=CLI&issuedby=ATL",
        series=("KXHIGHTATL", "KXLOWTATL"),
    ),
    WeatherLocation(
        code="AUS",
        name="Austin",
        timezone="America/Chicago",
        lat=30.2672,
        lng=-97.7431,
        observation_station="KAUS",
        climate_station="AUS",
        climate_report_url="https://forecast.weather.gov/product.php?site=EWX&product=CLI&issuedby=AUS",
        series=("KXHIGHAUS", "HIGHAUS", "KXLOWTAUS", "KXLOWAUS"),
    ),
    WeatherLocation(
        code="BOS",
        name="Boston",
        timezone="America/New_York",
        lat=42.3601,
        lng=-71.0589,
        observation_station="KBOS",
        climate_station="BOS",
        climate_report_url="https://forecast.weather.gov/product.php?site=BOX&product=CLI&issuedby=BOS",
        series=("KXHIGHTBOS", "KXLOWTBOS"),
    ),
    WeatherLocation(
        code="CHI",
        name="Chicago",
        timezone="America/Chicago",
        lat=41.8781,
        lng=-87.6298,
        observation_station="KMDW",
        climate_station="MDW",
        climate_report_url="https://forecast.weather.gov/product.php?site=LOT&product=CLI&issuedby=MDW",
        series=("KXHIGHCHI", "HIGHCHI", "KXLOWTCHI", "KXLOWCHI"),
    ),
    WeatherLocation(
        code="DAL",
        name="Dallas",
        timezone="America/Chicago",
        lat=32.7767,
        lng=-96.7970,
        observation_station="KDFW",
        climate_station="DFW",
        climate_report_url="https://forecast.weather.gov/product.php?site=FWD&product=CLI&issuedby=DFW",
        series=("KXHIGHTDAL", "KXLOWTDAL"),
    ),
    WeatherLocation(
        code="DCA",
        name="Washington DC",
        timezone="America/New_York",
        lat=38.9072,
        lng=-77.0369,
        observation_station="KDCA",
        climate_station="DCA",
        climate_report_url="https://forecast.weather.gov/product.php?site=LWX&product=CLI&issuedby=DCA",
        series=("KXHIGHTDC", "KXLOWTDC"),
    ),
    WeatherLocation(
        code="DEN",
        name="Denver",
        timezone="America/Denver",
        lat=39.7392,
        lng=-104.9903,
        observation_station="KDEN",
        climate_station="DEN",
        climate_report_url="https://forecast.weather.gov/product.php?site=BOU&product=CLI&issuedby=DEN",
        series=("KXHIGHDEN", "KXDENHIGH", "KXLOWTDEN", "KXLOWDEN"),
    ),
    WeatherLocation(
        code="HOU",
        name="Houston",
        timezone="America/Chicago",
        lat=29.7604,
        lng=-95.3698,
        observation_station="KHOU",
        climate_station="HOU",
        climate_report_url="https://forecast.weather.gov/product.php?site=HGX&product=CLI&issuedby=HOU",
        series=("KXHIGHHOU", "KXHIGHTHOU", "KXHIGHOU", "KXHOUHIGH", "KXLOWTHOU"),
    ),
    WeatherLocation(
        code="LAS",
        name="Las Vegas",
        timezone="America/Los_Angeles",
        lat=36.1699,
        lng=-115.1398,
        observation_station="KLAS",
        climate_station="LAS",
        climate_report_url="https://forecast.weather.gov/product.php?site=VEF&product=CLI&issuedby=LAS",
        series=("KXHIGHTLV", "KXLOWTLV"),
    ),
    WeatherLocation(
        code="LAX",
        name="Los Angeles",
        timezone="America/Los_Angeles",
        lat=34.0522,
        lng=-118.2437,
        observation_station="KLAX",
        climate_station="LAX",
        climate_report_url="https://forecast.weather.gov/product.php?site=LOX&product=CLI&issuedby=LAX",
        series=("KXHIGHLAX", "KXLOWTLAX", "KXLOWLAX"),
    ),
    WeatherLocation(
        code="MIA",
        name="Miami",
        timezone="America/New_York",
        lat=25.7617,
        lng=-80.1918,
        observation_station="KMIA",
        climate_station="MIA",
        climate_report_url="https://forecast.weather.gov/product.php?site=MFL&product=CLI&issuedby=MIA",
        series=("KXHIGHMIA", "HIGHMIA", "KXLOWTMIA", "KXLOWMIA"),
    ),
    WeatherLocation(
        code="MSP",
        name="Minneapolis",
        timezone="America/Chicago",
        lat=44.9778,
        lng=-93.2650,
        observation_station="KMSP",
        climate_station="MSP",
        climate_report_url="https://forecast.weather.gov/product.php?site=MPX&product=CLI&issuedby=MSP",
        series=("KXHIGHTMIN", "KXLOWTMIN"),
    ),
    WeatherLocation(
        code="MSY",
        name="New Orleans",
        timezone="America/Chicago",
        lat=29.9511,
        lng=-90.0715,
        observation_station="KMSY",
        climate_station="MSY",
        climate_report_url="https://forecast.weather.gov/product.php?site=LIX&product=CLI&issuedby=MSY",
        series=("KXHIGHTNOLA", "KXLOWTNOLA"),
    ),
    WeatherLocation(
        code="NYC",
        name="New York",
        timezone="America/New_York",
        lat=40.7128,
        lng=-74.0060,
        observation_station="KNYC",
        climate_station="NYC",
        climate_report_url="https://forecast.weather.gov/product.php?site=OKX&product=CLI&issuedby=NYC",
        series=("KXHIGHNY", "HIGHNY", "KXLOWTNYC", "KXLOWNYC", "KXLOWNY", "KXMINNYC", "MINNYC"),
    ),
    WeatherLocation(
        code="OKC",
        name="Oklahoma City",
        timezone="America/Chicago",
        lat=35.4676,
        lng=-97.5164,
        observation_station="KOKC",
        climate_station="OKC",
        climate_report_url="https://forecast.weather.gov/product.php?site=OUN&product=CLI&issuedby=OKC",
        series=("KXHIGHTOKC", "KXLOWTOKC"),
    ),
    WeatherLocation(
        code="PHL",
        name="Philadelphia",
        timezone="America/New_York",
        lat=39.9526,
        lng=-75.1652,
        observation_station="KPHL",
        climate_station="PHL",
        climate_report_url="https://forecast.weather.gov/product.php?site=PHI&product=CLI&issuedby=PHL",
        series=("KXHIGHPHIL", "KXPHILHIGH", "KXLOWTPHIL", "KXLOWPHIL"),
    ),
    WeatherLocation(
        code="PHX",
        name="Phoenix",
        timezone="America/Phoenix",
        lat=33.4484,
        lng=-112.0740,
        observation_station="KPHX",
        climate_station="PHX",
        climate_report_url="https://forecast.weather.gov/product.php?site=PSR&product=CLI&issuedby=PHX",
        series=("KXHIGHTPHX", "KXLOWTPHX"),
    ),
    WeatherLocation(
        code="SAT",
        name="San Antonio",
        timezone="America/Chicago",
        lat=29.4241,
        lng=-98.4936,
        observation_station="KSAT",
        climate_station="SAT",
        climate_report_url="https://forecast.weather.gov/product.php?site=EWX&product=CLI&issuedby=SAT",
        series=("KXHIGHTSATX", "KXLOWTSATX"),
    ),
    WeatherLocation(
        code="SEA",
        name="Seattle",
        timezone="America/Los_Angeles",
        lat=47.6062,
        lng=-122.3321,
        observation_station="KSEA",
        climate_station="SEA",
        climate_report_url="https://forecast.weather.gov/product.php?site=SEW&product=CLI&issuedby=SEA",
        series=("KXHIGHTSEA", "KXLOWTSEA"),
    ),
    WeatherLocation(
        code="SFO",
        name="San Francisco",
        timezone="America/Los_Angeles",
        lat=37.7749,
        lng=-122.4194,
        observation_station="KSFO",
        climate_station="SFO",
        climate_report_url="https://forecast.weather.gov/product.php?site=MTR&product=CLI&issuedby=SFO",
        series=("KXHIGHTSFO", "KXLOWTSFO"),
    ),
    WeatherLocation(
        code="DVF",
        name="Death Valley",
        timezone="America/Los_Angeles",
        lat=36.4626,
        lng=-116.8672,
        observation_station=None,
        climate_station="DVF",
        climate_report_url="https://forecast.weather.gov/product.php?site=VEF&product=CLI&issuedby=LAS",
        series=("KXDVHIGH",),
    ),
)


SERIES_TO_WEATHER_LOCATION: dict[str, WeatherLocation] = {
    series: location
    for location in WEATHER_LOCATIONS
    for series in location.series
}

