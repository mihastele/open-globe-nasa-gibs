/**
 * Place search via Photon (keyless geocoder) and OSM feature lookup via Overpass.
 */

import { PHOTON_URL, OVERPASS_URL } from './config';

export interface SearchResult {
  name: string;
  longitude: number;
  latitude: number;
  /** Free-form context line, e.g. "Berlin, Deutschland". */
  context: string;
  kind: string;
  /** Bounding box [south, west, north, east] when the geocoder supplies one. */
  bbox?: [number, number, number, number];
}

interface PhotonFeature {
  geometry?: { type: string; coordinates?: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    extent?: number[];
  };
}

/** Search for a place by name. */
export async function searchPlaces(query: string, limit = 6): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${PHOTON_URL}?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photon returned ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const features = json.features ?? [];

  return features.map((f) => {
    const p = f.properties ?? {};
    const [longitude, latitude] = f.geometry?.coordinates ?? [0, 0];

    const contextParts = [
      p.housenumber ? `${p.street ?? ''} ${p.housenumber}`.trim() : p.street,
      p.postcode,
      p.city ?? p.state,
      p.country,
    ].filter(Boolean);

    return {
      name: p.name ?? trimmed,
      longitude,
      latitude,
      context: contextParts.join(', '),
      kind: p.type ?? p.osm_value ?? 'place',
      bbox: p.extent
        ? [p.extent[1], p.extent[0], p.extent[3], p.extent[2]]
        : undefined,
    };
  });
}

export interface OsmFeature {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags: Record<string, string>;
}

interface OverpassResponse {
  elements?: {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    tags?: Record<string, string>;
    center?: { lat: number; lon: number };
  }[];
}

/**
 * Query Overpass for features in a bounding box.
 * The main overpass-api.de instance rejects scripted clients with 406, so we use
 * the overpass.osm.ch mirror.
 */
export async function queryOverpass(
  query: string,
  signal?: AbortSignal,
): Promise<OsmFeature[]> {
  const res = await fetch(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
  const json = (await res.json()) as OverpassResponse;

  return (json.elements ?? []).map((el) => ({
    type: el.type,
    id: el.id,
    lat: el.lat ?? el.center?.lat,
    lon: el.lon ?? el.center?.lon,
    tags: el.tags ?? {},
  }));
}

/** Build an Overpass query for a bounding box and element selector. */
export function buildBoxQuery(
  selector: string,
  south: number,
  west: number,
  north: number,
  east: number,
  timeout = 25,
): string {
  return `[out:json][timeout:${timeout}];${selector}(${south},${west},${north},${east});out body center ${timeout * 1000};`;
}
