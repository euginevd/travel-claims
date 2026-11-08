// Airport and city suggestions for "Where?", from OurAirports' public-domain data.

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

interface AirportFile {
  countries: string[];
  airports: [string, string, string, number][];
}

/** Read the compact file: each airport is [iata, name, city, country index]. */
export function unpack(file: AirportFile): Airport[] {
  return file.airports.map(([iata, name, city, country]) => ({
    iata,
    name,
    city,
    country: file.countries[country] ?? "",
  }));
}

let loading: Promise<Airport[]> | null = null;

/** The airports, loaded once and only when someone starts typing a place. */
export function loadAirports(): Promise<Airport[]> {
  loading ??= import("./data/airports.json").then((module) =>
    unpack(module.default as AirportFile),
  );
  return loading;
}

/** Lower case with accents removed, so "zürich" and "Zurich" match. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** How well an airport matches what was typed: lower is better, null for no match. */
function score(airport: Airport, query: string): number | null {
  const q = fold(query);
  const city = fold(airport.city);
  if (q.length === 3 && fold(airport.iata) === q) return 0;
  if (city === q) return 1;
  if (city.startsWith(q)) return 2;
  if (fold(airport.iata).startsWith(q)) return 3;
  if (words(airport.name).some((word) => word.startsWith(q))) return 4;
  if (fold(airport.country).startsWith(q)) return 5;
  return null;
}

/** Whether an airport is in the place the trip was to, from the policy's destination text. */
export function onTrip(airport: Airport, destination: string): boolean {
  const place = fold(destination);
  if (!place) return false;
  return (
    place.includes(fold(airport.city)) ||
    (fold(airport.country).length > 3 && place.includes(fold(airport.country)))
  );
}

/** Up to `limit` airports for what was typed, the trip's own places first. */
export function suggest(
  airports: Airport[],
  query: string,
  destination = "",
  limit = 6,
): Airport[] {
  if (fold(query).length < 2) return [];
  return airports
    .map((airport) => ({ airport, rank: score(airport, query) }))
    .filter((entry): entry is { airport: Airport; rank: number } => entry.rank !== null)
    .sort(
      (a, b) =>
        Number(onTrip(b.airport, destination)) - Number(onTrip(a.airport, destination)) ||
        a.rank - b.rank ||
        a.airport.city.localeCompare(b.airport.city),
    )
    .slice(0, limit)
    .map((entry) => entry.airport);
}

/** What a picked airport fills in: "Sydney (SYD), Australia". */
export function placeText(airport: Airport): string {
  return `${airport.city} (${airport.iata}), ${airport.country}`;
}
