/**
 * Street-level imagery from KartaView (open, keyless).
 *
 * The `2.0/photo` endpoint answers with photos captured very close to the query
 * point — the effective radius is only a few hundred metres, so a single query
 * at an arbitrary clicked point usually comes back empty even in a city with
 * plenty of coverage. To make the feature usable we therefore probe a small
 * ring of offsets around the requested point and keep the first hit.
 */

import { KARTAVIEW_URL } from './config';

export interface StreetPhoto {
  id: string;
  lat: number;
  lng: number;
  /** Direct URL to the processed (dewarped) image. */
  url: string;
  sequenceId: string;
  sequenceIndex: number;
  heading: number;
  shotDate: string;
  distance: number;
}

interface KartaViewRecord {
  id: number | string;
  lat: number | string;
  lng: number | string;
  fileurlProc?: string;
  fileurl?: string;
  imageProcUrl?: string;
  sequenceId?: number | string;
  sequenceIndex?: number | string;
  heading?: number | string;
  shotDate?: string;
  distance?: number | string;
  matchLat?: number | string;
  matchLng?: number | string;
}

interface KartaViewResponse {
  status?: { apiCode?: number; httpCode?: number };
  result?: { data?: KartaViewRecord[] };
}

/** Offsets (in degrees) probed around the requested point, nearest first. */
const PROBE_OFFSETS: [number, number][] = [
  [0, 0],
  [0.002, 0],
  [-0.002, 0],
  [0, 0.003],
  [0, -0.003],
  [0.002, 0.002],
  [-0.002, -0.002],
  [0.002, -0.002],
  [-0.002, 0.002],
  [0.004, 0],
  [-0.004, 0],
  [0, 0.006],
  [0, -0.006],
];

/** Normalise the various URL fields KartaView returns into a usable image URL. */
function resolveImageUrl(record: KartaViewRecord): string {
  if (record.fileurlProc) return record.fileurlProc;
  if (record.imageProcUrl) return record.imageProcUrl;
  if (record.fileurl) {
    // fileurl carries a {{sizeprefix}} placeholder — proc/ is the processed variant.
    return record.fileurl.replace('{{sizeprefix}}', 'proc');
  }
  return '';
}

function toStreetPhoto(record: KartaViewRecord): StreetPhoto {
  // KartaView returns coordinates as numbers in most records but as numeric
  // strings in some, so coerce defensively.
  const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    id: String(record.id),
    lat: num(record.matchLat ?? record.lat),
    lng: num(record.matchLng ?? record.lng),
    url: resolveImageUrl(record),
    sequenceId: String(record.sequenceId ?? ''),
    sequenceIndex: num(record.sequenceIndex),
    heading: num(record.heading),
    shotDate: record.shotDate ?? '',
    distance: num(record.distance),
  };
}

/** Query a single point and return the raw records. */
async function queryPoint(lat: number, lng: number): Promise<KartaViewRecord[]> {
  const url = `${KARTAVIEW_URL}?lat=${lat}&lng=${lng}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as KartaViewResponse;
  return json.result?.data ?? [];
}

/**
 * Fetch street-level photos near a coordinate.
 *
 * Probes a small ring of nearby points because the API's effective radius is
 * only a few hundred metres.
 */
export async function fetchStreetPhotos(
  lat: number,
  lng: number,
): Promise<StreetPhoto[]> {
  for (const [dLat, dLng] of PROBE_OFFSETS) {
    let records: KartaViewRecord[];
    try {
      records = await queryPoint(lat + dLat, lng + dLng);
    } catch {
      records = [];
    }
    if (records.length === 0) continue;

    const photos = records.map(toStreetPhoto).filter((p) => p.url.length > 0);
    if (photos.length > 0) return photos;
  }
  return [];
}

/** Move one step along a panosphere sequence. */
export function stepSequence(
  photos: StreetPhoto[],
  currentId: string,
  delta: number,
): StreetPhoto | null {
  if (photos.length === 0) return null;
  const index = photos.findIndex((p) => p.id === currentId);
  if (index === -1) return photos[0];
  const next = (index + delta + photos.length) % photos.length;
  return photos[next];
}
