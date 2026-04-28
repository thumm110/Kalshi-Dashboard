// Registry of Kalshi weather/climate cities with their series tickers.
// Extend as new series appear. Matching is by series_ticker prefix of a market ticker:
// e.g. "KXHIGHDEN-26APR21-T75" → series "KXHIGHDEN" → Denver.

export type WeatherCity = {
  code: string;        // short code for map labels
  name: string;        // display name
  lat: number;
  lng: number;
  timezone?: string;
  stationId?: string;  // NWS observation station used for intraday guidance
  climateStation?: string;
  climateReportUrl?: string;
  // Known series tickers that resolve to this city.
  series: string[];
};

export const CITIES: WeatherCity[] = [
  { code: "NYC", name: "New York",     lat: 40.7128, lng: -74.0060, timezone: "America/New_York", stationId: "KNYC", climateStation: "NYC", climateReportUrl: "https://forecast.weather.gov/product.php?site=OKX&product=CLI&issuedby=NYC",
    series: ["KXHIGHNY","HIGHNY","KXLOWNY","KXLOWTNYC","KXLOWNYC","KXMINNYC","MINNYC","KXRAINNYC","RAINNYC","KXRAINNYCM","RAINNYCM","KXSNOWNYC","KXSNOWNY","SNOWNY","KXSNOWNYM","SNOWNYM","KXNYCSNOWM","KXNYCSNOWXMAS","KXTEMPNYCH","KXHIGHNYD","KXHURNYC","HURNYC"] },
  { code: "CHI", name: "Chicago",      lat: 41.8781, lng: -87.6298, timezone: "America/Chicago", stationId: "KMDW", climateStation: "MDW", climateReportUrl: "https://forecast.weather.gov/product.php?site=LOT&product=CLI&issuedby=MDW",
    series: ["KXHIGHCHI","HIGHCHI","KXLOWTCHI","KXLOWCHI","KXRAINCHIM","KXSNOWCHIM","SNOWCHIM","KXCHISNOWM","KXCHISNOWXMAS","KXTEMPCHIH"] },
  { code: "DEN", name: "Denver",       lat: 39.7392, lng: -104.9903, timezone: "America/Denver", stationId: "KDEN", climateStation: "DEN", climateReportUrl: "https://forecast.weather.gov/product.php?site=BOU&product=CLI&issuedby=DEN",
    series: ["KXHIGHDEN","KXDENHIGH","KXLOWDEN","KXLOWTDEN","KXHIGHTEMPDEN","KXRAINDENM","KXDENSNOWM","KXDENSNOWMB","KXDENSNOWXMAS"] },
  { code: "HOU", name: "Houston",      lat: 29.7604, lng: -95.3698, timezone: "America/Chicago", stationId: "KHOU", climateStation: "HOU", climateReportUrl: "https://forecast.weather.gov/product.php?site=HGX&product=CLI&issuedby=HOU",
    series: ["KXHIGHHOU","KXHOUHIGH","KXHIGHOU","KXHIGHTHOU","KXLOWTHOU","KXRAINHOUM","KXHOUSNOWM","KXHURPATHHOU","EMERGENCYHOU","KXEMERGENCYHOU"] },
  { code: "LAX", name: "Los Angeles",  lat: 34.0522, lng: -118.2437, timezone: "America/Los_Angeles", stationId: "KLAX", climateStation: "LAX", climateReportUrl: "https://forecast.weather.gov/product.php?site=LOX&product=CLI&issuedby=LAX",
    series: ["KXHIGHLAX","KXLOWLAX","KXLOWTLAX","KXRAINLAXM","KXLAXSNOWM","KXTEMPLAXH","KXEMERGENCYLA","EMERGENCYLA","KXEARTHQUAKELA"] },
  { code: "SFO", name: "San Francisco",lat: 37.7749, lng: -122.4194, timezone: "America/Los_Angeles", stationId: "KSFO", climateStation: "SFO", climateReportUrl: "https://forecast.weather.gov/product.php?site=MTR&product=CLI&issuedby=SFO",
    series: ["KXHIGHTSFO","KXLOWTSFO","KXRAINSFOM","KXSFOSNOWM","KXEMERGENCYSF","EMERGENCYSF"] },
  { code: "MIA", name: "Miami",        lat: 25.7617, lng: -80.1918, timezone: "America/New_York", stationId: "KMIA", climateStation: "MIA", climateReportUrl: "https://forecast.weather.gov/product.php?site=MFL&product=CLI&issuedby=MIA",
    series: ["KXHIGHMIA","HIGHMIA","KXLOWMIA","KXLOWTMIA","KXRAINMIAM","KXMIASNOWM","KXTEMPMIAH","KXHURMIA","HURMIA","EMERGENCYMIA","KXEMERGENCYMIA"] },
  { code: "ATL", name: "Atlanta",      lat: 33.7490, lng: -84.3880, timezone: "America/New_York", stationId: "KATL", climateStation: "ATL", climateReportUrl: "https://forecast.weather.gov/product.php?site=FFC&product=CLI&issuedby=ATL",
    series: ["KXHIGHTATL","KXLOWTATL"] },
  { code: "AUS", name: "Austin",       lat: 30.2672, lng: -97.7431, timezone: "America/Chicago", stationId: "KAUS", climateStation: "AUS", climateReportUrl: "https://forecast.weather.gov/product.php?site=EWX&product=CLI&issuedby=AUS",
    series: ["KXHIGHAUS","HIGHAUS","KXLOWAUS","KXLOWTAUS","KXRAINAUSM","KXAUSSNOWM"] },
  { code: "DAL", name: "Dallas",       lat: 32.7767, lng: -96.7970, timezone: "America/Chicago", stationId: "KDFW", climateStation: "DFW", climateReportUrl: "https://forecast.weather.gov/product.php?site=FWD&product=CLI&issuedby=DFW",
    series: ["KXHIGHTDAL","KXLOWTDAL","KXRAINDALM","KXDALSNOWM"] },
  { code: "PHL", name: "Philadelphia", lat: 39.9526, lng: -75.1652, timezone: "America/New_York", stationId: "KPHL", climateStation: "PHL", climateReportUrl: "https://forecast.weather.gov/product.php?site=PHI&product=CLI&issuedby=PHL",
    series: ["KXPHILHIGH","KXHIGHPHIL","KXLOWPHIL","KXLOWTPHIL","KXPHILSNOWM","EMERGENCYPHIL","KXEMERGENCYPHIL"] },
  { code: "PHX", name: "Phoenix",      lat: 33.4484, lng: -112.0740, timezone: "America/Phoenix", stationId: "KPHX", climateStation: "PHX", climateReportUrl: "https://forecast.weather.gov/product.php?site=PSR&product=CLI&issuedby=PHX",
    series: ["KXHIGHTPHX","KXLOWTPHX","KXSNOWAZ"] },
  { code: "SEA", name: "Seattle",      lat: 47.6062, lng: -122.3321, timezone: "America/Los_Angeles", stationId: "KSEA", climateStation: "SEA", climateReportUrl: "https://forecast.weather.gov/product.php?site=SEW&product=CLI&issuedby=SEA",
    series: ["KXHIGHTSEA","KXLOWTSEA","KXRAINSEA","RAINSEA","KXRAINSEAM","KXSEASNOWM"] },
  { code: "BOS", name: "Boston",       lat: 42.3601, lng: -71.0589, timezone: "America/New_York", stationId: "KBOS", climateStation: "BOS", climateReportUrl: "https://forecast.weather.gov/product.php?site=BOX&product=CLI&issuedby=BOS",
    series: ["KXHIGHTBOS","KXLOWTBOS","KXBOSSNOWM","KXBOSSNOWXMAS","KXTEMPBOSH"] },
  { code: "DCA", name: "Washington DC",lat: 38.9072, lng: -77.0369, timezone: "America/New_York", stationId: "KDCA", climateStation: "DCA", climateReportUrl: "https://forecast.weather.gov/product.php?site=LWX&product=CLI&issuedby=DCA",
    series: ["KXHIGHTDC","KXLOWTDC","KXDCSNOWM","KXTEMPDCH"] },
  { code: "MSP", name: "Minneapolis",  lat: 44.9778, lng: -93.2650, timezone: "America/Chicago", stationId: "KMSP", climateStation: "MSP", climateReportUrl: "https://forecast.weather.gov/product.php?site=MPX&product=CLI&issuedby=MSP",
    series: ["KXHIGHTMIN","KXLOWTMIN"] },
  { code: "MSY", name: "New Orleans",  lat: 29.9511, lng: -90.0715, timezone: "America/Chicago", stationId: "KMSY", climateStation: "MSY", climateReportUrl: "https://forecast.weather.gov/product.php?site=LIX&product=CLI&issuedby=MSY",
    series: ["KXHIGHTNOLA","KXLOWTNOLA","KXHURNO","HURNO","EMERGENCYNOLA","KXEMERGENCYNOLA"] },
  { code: "OKC", name: "Oklahoma City",lat: 35.4676, lng: -97.5164, timezone: "America/Chicago", stationId: "KOKC", climateStation: "OKC", climateReportUrl: "https://forecast.weather.gov/product.php?site=OUN&product=CLI&issuedby=OKC",
    series: ["KXHIGHTOKC","KXLOWTOKC"] },
  { code: "SAT", name: "San Antonio",  lat: 29.4241, lng: -98.4936, timezone: "America/Chicago", stationId: "KSAT", climateStation: "SAT", climateReportUrl: "https://forecast.weather.gov/product.php?site=EWX&product=CLI&issuedby=SAT",
    series: ["KXHIGHTSATX","KXLOWTSATX"] },
  { code: "LAS", name: "Las Vegas",    lat: 36.1699, lng: -115.1398, timezone: "America/Los_Angeles", stationId: "KLAS", climateStation: "LAS", climateReportUrl: "https://forecast.weather.gov/product.php?site=VEF&product=CLI&issuedby=LAS",
    series: ["KXHIGHTLV","KXLOWTLV"] },
  { code: "DVF", name: "Death Valley", lat: 36.4626, lng: -116.8672, timezone: "America/Los_Angeles", climateStation: "DVF", climateReportUrl: "https://forecast.weather.gov/product.php?site=VEF&product=CLI&issuedby=LAS",
    series: ["KXDVHIGH"] },
  { code: "DTW", name: "Detroit",      lat: 42.3314, lng: -83.0458,
    series: ["KXDETSNOWM"] },
  { code: "SLC", name: "Salt Lake City",lat: 40.7608, lng: -111.8910,
    series: ["KXSLCSNOWM"] },
  { code: "JAC", name: "Jackson WY",   lat: 43.4799, lng: -110.7624,
    series: ["KXJACWSNOWM","KXEMERGENCYJAC","EMERGENCYJAC"] },
  { code: "ASE", name: "Aspen",        lat: 39.1911, lng: -106.8175,
    series: ["KXASPSNOWM"] },
  { code: "DSM", name: "Des Moines",   lat: 41.5868, lng: -93.6250,
    series: ["EMERGENCYDES","KXEMERGENCYDES"] },
  { code: "STL", name: "St. Louis",    lat: 38.6270, lng: -90.1994,
    series: ["EMERGENCYSTL","KXEMERGENCYSTL"] },
  { code: "CMH", name: "Columbus",     lat: 39.9612, lng: -82.9988,
    series: ["EMERGENCYCOL","KXEMERGENCYCOL"] },
  { code: "SDF", name: "Louisville",   lat: 38.2527, lng: -85.7585,
    series: ["EMERGENCYLOU","KXEMERGENCYLOU"] },
  { code: "RAP", name: "Rapid City",   lat: 44.0805, lng: -103.2310,
    series: ["EMERGENCYRAP","KXEMERGENCYRAP"] },
  { code: "ILM", name: "Wilmington",   lat: 34.2257, lng: -77.9447,
    series: ["HURWIL","KXHURWIL","EMERGENCYWIL","KXEMERGENCYWIL"] },
  { code: "ORL", name: "Orlando",      lat: 28.5383, lng: -81.3792,
    series: ["HURORL","KXHURORL"] },
  { code: "TPA", name: "Tampa",        lat: 27.9506, lng: -82.4572,
    series: ["HURTB","KXHURTB"] },
  { code: "JAX", name: "Jacksonville", lat: 30.3322, lng: -81.6557,
    series: ["HURJACKFL","KXHURJACKFL"] },
  { code: "CHS", name: "Charleston",   lat: 32.8998, lng: -80.0406, timezone: "America/New_York", stationId: "KCHS", climateStation: "CHS", climateReportUrl: "https://forecast.weather.gov/product.php?site=CHS&product=CLI&issuedby=CHS",
    series: ["HURCHARL","KXHURCHARL"] },
  { code: "SAV", name: "Savannah",     lat: 32.0809, lng: -81.0912,
    series: ["HURSAV","KXHURSAV"] },
  { code: "MYR", name: "Myrtle Beach", lat: 33.6891, lng: -78.8867,
    series: ["HURMYR","KXHURMYR"] },
  { code: "ORF", name: "Norfolk",      lat: 36.8508, lng: -76.2859,
    series: ["HURNOR","KXHURNOR"] },
  { code: "HAT", name: "Hatteras",     lat: 35.2193, lng: -75.6909,
    series: ["HURHAT","KXHURHAT"] },
];

// Map from series_ticker → city, built once.
const SERIES_TO_CITY = new Map<string, WeatherCity>();
for (const c of CITIES) for (const s of c.series) SERIES_TO_CITY.set(s, c);

/** Extract the series ticker from a market ticker, e.g.
 *  "KXHIGHDEN-26APR21-T75" → "KXHIGHDEN"
 *  "HIGHNY-26APR20-75"     → "HIGHNY"
 */
export function seriesFromTicker(ticker: string): string {
  return (ticker || "").split("-")[0];
}

export function cityForTicker(ticker: string): WeatherCity | null {
  return SERIES_TO_CITY.get(seriesFromTicker(ticker)) || null;
}

/** Classify a series ticker as HIGH / LOW / RAIN / SNOW / HUR / EMERGENCY / OTHER. */
export function eventKindFromSeries(series: string): string {
  const s = series.toUpperCase();
  if (s.includes("SNOW")) return "SNOW";
  if (s.includes("RAIN")) return "RAIN";
  if (s.startsWith("KXHUR") || s.startsWith("HUR")) return "HUR";
  if (s.startsWith("KXEMERGENCY") || s.startsWith("EMERGENCY")) return "EMERGENCY";
  if (s.includes("HIGH")) return "HIGH";
  if (s.includes("LOW") || s.includes("MIN")) return "LOW";
  if (s.includes("TEMP")) return "TEMP";
  if (s.includes("QUAKE")) return "QUAKE";
  return "OTHER";
}
