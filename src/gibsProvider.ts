/**
 * A Cesium imagery provider for NASA GIBS true-colour layers.
 *
 * GIBS has two quirks that a plain UrlTemplateImageryProvider cannot handle:
 *
 * 1. **Coverage is region-dependent.** A given sensor/date may have data over
 *    Australia down to z9 but nothing over the Atlantic. Deeper levels than the
 *    sensor's swath produce an *opaque black* placeholder tile rather than a 404,
 *    which would paint over the basemap and make the globe look broken.
 *
 * 2. **The archive is not uniform.** Some (layer, date) pairs have no tile at all
 *    for a region, and GIBS answers with the same black placeholder.
 *
 * The provider therefore uses a `TileDiscardPolicy` to drop tiles that are the
 * black "no data" placeholder. Cesium then falls back to the imagery layer
 * underneath instead of covering it with a black square.
 */

import {
  Credit,
  DefaultProxy,
  Event,
  Proxy,
  Rectangle,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type ImageryTypes,
  type Request,
  type TileDiscardPolicy,
  type TilingScheme,
} from 'cesium';

export interface GibsImageryProviderOptions {
  /** GIBS layer identifier, e.g. `VIIRS_SNPP_CorrectedReflectance_TrueColor`. */
  layer: string;
  /** Tile matrix set, e.g. `GoogleMapsCompatible_Level9`. */
  tileMatrixSet: string;
  /** ISO date (YYYY-MM-DD) used for the GIBS `Time` dimension. */
  time: string;
  /** Deepest zoom the layer should be requested at. */
  maximumLevel?: number;
  credit?: Credit | string;
  /** Base URL of the GIBS WMTS endpoint. */
  baseUrl?: string;
}

/** A pixel is considered "black placeholder" below this 0-255 level. */
const BLACK_THRESHOLD = 12;

/** Number of sample points per axis when probing a tile for emptiness. */
const SAMPLE_GRID = 8;

/**
 * Discards GIBS's opaque black "no data" tiles.
 *
 * Cesium calls `shouldDiscardImage` with the decoded tile; a discarded tile is
 * simply not drawn, so the basemap below shows through.
 *
 * `TileDiscardPolicy` is an interface in Cesium, not an instantiable class, so
 * this is a plain object implementing its two methods.
 */
const gibsDiscardPolicy = {
  isReady(): boolean {
    return true;
  },
  shouldDiscardImage(image: HTMLImageElement): boolean {
    return isBlackPlaceholderSource(image);
  },
};

/**
 * Decide whether an image source is entirely (near) black.
 *
 * Works for HTMLImageElement by drawing it to a small canvas and sampling a grid.
 */
function isBlackPlaceholderSource(image: HTMLImageElement): boolean {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return false;

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_GRID;
  canvas.height = SAMPLE_GRID;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  try {
    ctx.drawImage(image, 0, 0, SAMPLE_GRID, SAMPLE_GRID);
  } catch {
    return false;
  }

  const { data } = ctx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // fully transparent -> nothing here
    if (Math.max(data[i], data[i + 1], data[i + 2]) > BLACK_THRESHOLD) return false;
  }
  return true;
}

export class GibsImageryProvider implements ImageryProvider {
  readonly tilingScheme: TilingScheme = new WebMercatorTilingScheme();
  readonly rectangle: Rectangle = this.tilingScheme.rectangle;
  readonly tileWidth = 256;
  readonly tileHeight = 256;
  readonly maximumLevel: number;
  readonly minimumLevel = 0;
  readonly errorEvent = new Event();
  readonly credit: Credit;
  readonly hasAlphaChannel = true;
  readonly ready: boolean = true;
  readonly proxy: Proxy = new DefaultProxy('');
  readonly tileDiscardPolicy: TileDiscardPolicy = gibsDiscardPolicy;

  private readonly layer: string;
  private readonly tileMatrixSet: string;
  private readonly baseUrl: string;
  private time: string;

  constructor(options: GibsImageryProviderOptions) {
    this.layer = options.layer;
    this.tileMatrixSet = options.tileMatrixSet;
    this.time = options.time;
    this.maximumLevel = options.maximumLevel ?? 9;
    this.baseUrl =
      options.baseUrl ?? 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
    this.credit =
      typeof options.credit === 'string'
        ? new Credit(options.credit)
        : (options.credit ?? new Credit('NASA EOSDIS GIBS'));
  }

  /** Change the archived date. New tile requests will use it. */
  setTime(time: string): void {
    this.time = time;
  }

  getTime(): string {
    return this.time;
  }

  getTileCredits(_x: number, _y: number, _level: number): Credit[] {
    return [this.credit];
  }

  pickFeatures(): undefined {
    return undefined;
  }

  /**
   * Request a GIBS tile.
   *
   * GIBS answers "no coverage" with an opaque black tile rather than a 404. That
   * tile is returned as-is and caught by the tile discard policy, which marks it
   * INVALID so Cesium falls back to the imagery layer underneath instead of
   * showing a black square.
   */
  requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<ImageryTypes> | undefined {
    const url =
      `${this.baseUrl}/${this.layer}/default/${this.tileMatrixSet}` +
      `/${level}/${y}/${x}.jpg?Time=${this.time}`;

    const promise = fetch(url)
      .then((res) => {
        if (!res.ok) {
          // No tile for this area/date — let the basemap show through.
          if (res.status === 404 || res.status === 400) return undefined;
          throw new Error(`GIBS tile ${level}/${y}/${x} -> ${res.status}`);
        }
        return res.blob();
      })
      .then(async (blob) => {
        if (!blob) return TRANSPARENT_TILE();
        const image = await blobToImageElement(blob);
        // GIBS answers "no coverage" with an opaque black tile. The tile discard
        // policy detects that and marks the tile INVALID, so Cesium falls back
        // to the imagery layer underneath instead of showing a black square.
        return image;
      })
      .catch((err) => {
        console.warn('GIBS tile request failed:', err);
        return TRANSPARENT_TILE();
      });

    return promise;
  }
}

/** A 1x1 fully transparent tile — Cesium treats it as "nothing here". */
let transparentTile: HTMLCanvasElement | null = null;
function TRANSPARENT_TILE(): HTMLCanvasElement {
  if (!transparentTile) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    transparentTile = canvas;
  }
  return transparentTile;
}

/** Decode a blob into an HTMLImageElement (the type Cesium's discard policy expects). */
function blobToImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode GIBS tile'));
    };
    image.src = url;
  });
}
