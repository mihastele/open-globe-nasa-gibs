/**
 * 3D building footprints from OpenStreetMap vector tiles.
 *
 * Source: OpenFreeMap (keyless, OpenMapTiles schema). The `building` layer carries
 * `render_height` / `render_min_height` in metres, `hide_3d` and a `colour` hint.
 *
 * Vector tiles stop at z14, so buildings are only drawn at zoom <= 14 — beyond that
 * the footprints are simply too small to be worth a network round-trip.
 */

import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  VertexFormat,
  sampleTerrainMostDetailed,
  Cartographic,
  type TerrainProvider,
} from 'cesium';
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { BUILDING_MAX_ZOOM, OPENFREEMAP_TILEJSON } from './config';

/** Height used when OSM has no `render_height` (0 means "unknown" in OpenMapTiles). */
const DEFAULT_BUILDING_HEIGHT = 8;

/** Per-layer colour tint applied to extruded buildings. */
const BUILDING_TINT = Color.fromCssColorString('#c2bcb2');

const TILE_EXTENT_FALLBACK = 4096;

/** A single polygon part: an outer ring plus any holes. */
interface BuildingPart {
  outer: [number, number][];
  holes: [number, number][][];
  height: number;
  minHeight: number;
  color: Color;
}

let tileTemplatePromise: Promise<string> | null = null;

/**
 * Resolve the current OpenFreeMap tile template. The dataset id rotates as
 * OpenFreeMap republishes, so we read it from the TileJSON rather than hardcoding it.
 */
export function resolveTileTemplate(): Promise<string> {
  if (!tileTemplatePromise) {
    tileTemplatePromise = fetch(OPENFREEMAP_TILEJSON)
      .then((r) => {
        if (!r.ok) throw new Error(`OpenFreeMap TileJSON ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const t = json?.tiles?.[0];
        if (typeof t !== 'string') throw new Error('OpenFreeMap TileJSON has no tile template');
        return t;
      })
      .catch((err) => {
        tileTemplatePromise = null; // allow retry
        throw err;
      });
  }
  return tileTemplatePromise;
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
}

function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function parseColor(hex: unknown): Color | null {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return Color.fromCssColorString(hex);
}

/**
 * Decode one vector tile into building parts, in geographic coordinates.
 */
async function decodeBuildings(
  url: string,
  z: number,
  x: number,
  y: number,
): Promise<BuildingPart[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} -> ${res.status}`);
  const buf = await res.arrayBuffer();
  const tile = new VectorTile(new Pbf(buf));
  const layer = tile.layers['building'];
  if (!layer) return [];

  const extent = layer.extent || TILE_EXTENT_FALLBACK;
  const parts: BuildingPart[] = [];

  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const props = feature.properties as Record<string, unknown>;

    // OpenMapTiles marks flat/irrelevant buildings so they can be skipped in 3D.
    if (props.hide_3d === true) continue;

    const rawHeight = typeof props.render_height === 'number' ? props.render_height : 0;
    const rawMin = typeof props.render_min_height === 'number' ? props.render_min_height : 0;
    const height = rawHeight > 0 ? rawHeight : DEFAULT_BUILDING_HEIGHT;
    const minHeight = rawMin > 0 ? rawMin : 0;

    const geom = feature.loadGeometry();
    if (!geom || geom.length === 0) continue;

    // A single OSM feature can be a multipolygon (many outer rings) or a polygon
    // with holes. classifyRings sorts them into [outer, ...holes] groups.
    const polygons = classifyRings(geom);

    for (const polygon of polygons) {
      if (!polygon.length) continue;
      const outerRing = polygon[0];
      if (!outerRing || outerRing.length < 3) continue;

      const outer: [number, number][] = outerRing.map((p) => [
        tileXToLon(x + p.x / extent, z),
        tileYToLat(y + p.y / extent, z),
      ]);
      if (outer.length < 3) continue;

      const holes: [number, number][][] = polygon.slice(1).map(
        (ring) =>
          ring.map(
            (p) =>
              [
                tileXToLon(x + p.x / extent, z),
                tileYToLat(y + p.y / extent, z),
              ] as [number, number],
          ),
      );

      parts.push({
        outer,
        holes,
        height,
        minHeight,
        color: parseColor(props.colour) ?? BUILDING_TINT,
      });
    }
  }

  return parts;
}

/** Average longitude/latitude of a ring — used as the terrain sample point. */
function ringCentroid(ring: [number, number][]): { lon: number; lat: number } {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

/**
 * Sample the terrain height at each building so the volumes sit on the ground
 * instead of floating above (or sinking into) the landscape.
 */
async function sampleBaseHeights(
  parts: BuildingPart[],
  provider: TerrainProvider | undefined,
): Promise<Map<BuildingPart, number>> {
  const heights = new Map<BuildingPart, number>();
  if (!provider) return heights;

  const positions: Cartographic[] = parts.map((part) => {
    const c = ringCentroid(part.outer);
    return Cartographic.fromDegrees(c.lon, c.lat);
  });

  try {
    const sampled = await sampleTerrainMostDetailed(provider, positions);
    parts.forEach((part, index) => {
      heights.set(part, sampled[index]?.height ?? 0);
    });
  } catch {
    // Terrain unavailable — buildings will be placed at sea level instead.
  }
  return heights;
}

/**
 * Build a Cesium primitive of extruded polygons for one tile.
 */
export async function buildBuildingsForTile(
  z: number,
  x: number,
  y: number,
  terrainProvider?: TerrainProvider,
): Promise<Primitive> {
  const template = await resolveTileTemplate();
  const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const parts = await decodeBuildings(url, z, x, y);

  const baseHeights = await sampleBaseHeights(parts, terrainProvider);
  const instances: GeometryInstance[] = [];

  for (const part of parts) {
    const base = baseHeights.get(part) ?? 0;

    const positions = part.outer.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
    const hierarchy = new PolygonHierarchy(positions);

    for (const hole of part.holes) {
      if (hole.length < 3) continue;
      hierarchy.holes.push(
        new PolygonHierarchy(hole.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))),
      );
    }

    const geometry = new PolygonGeometry({
      polygonHierarchy: hierarchy,
      height: base + part.minHeight,
      extrudedHeight: base + part.minHeight + part.height,
      vertexFormat: VertexFormat.POSITION_ONLY,
    });

    instances.push(
      new GeometryInstance({
        geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(part.color.withAlpha(0.95)),
        },
      }),
    );
  }

  return new Primitive({
    geometryInstances: instances,
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
    asynchronous: true,
    allowPicking: false,
  });
}

/**
 * Which tiles to load for the current camera view at a given zoom.
 */
export function tilesForView(
  center: { longitude: number; latitude: number },
  zoom: number,
  tileSize = 3,
): { z: number; x: number; y: number }[] {
  const z = Math.max(0, Math.min(BUILDING_MAX_ZOOM, Math.round(zoom)));
  const n = Math.pow(2, z);

  const cx = lonToTileX(center.longitude, z);
  const cy = latToTileY(center.latitude, z);

  const half = Math.floor(tileSize / 2);
  const tiles: { z: number; x: number; y: number }[] = [];

  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = Math.floor(cx) + dx;
      const y = Math.floor(cy) + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}
