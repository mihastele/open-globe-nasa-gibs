/**
 * Data-source configuration for the globe.
 *
 * Every source here is keyless: no Cesium ion token, no MapTiler key, no API registration.
 * If you add a source, prefer one that needs no account.
 */

export type BasemapId = 'satellite' | 'streets' | 'dark' | 'light' | 'blue-marble';

export interface Basemap {
  id: BasemapId;
  label: string;
  /** Cesium imagery URL template. */
  url: string;
  /** Highest zoom level the provider should request. */
  maximumLevel: number;
  credit: string;
  /** Optional style hints for the globe atmosphere. */
  atmosphere?: { hue: number; saturation: number; brightness: number };
}

export const TERRAIN_URL =
  'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/imageServer';

/**
 * Basemaps. `{z}/{y}/{x}` ordering matters for ArcGIS (row-major, y from the top),
 * `{z}/{x}/{y}` for the slippy-map style providers.
 */
export const BASEMAPS: Record<BasemapId, Basemap> = {
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 19,
    credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
    atmosphere: { hue: -0.53, saturation: 0.15, brightness: -0.1 },
  },
  streets: {
    id: 'streets',
    label: 'Streets',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    maximumLevel: 20,
    credit: '© OpenStreetMap contributors © CARTO',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    maximumLevel: 20,
    credit: '© OpenStreetMap contributors © CARTO',
  },
  light: {
    id: 'light',
    label: 'Light',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    maximumLevel: 20,
    credit: '© OpenStreetMap contributors © CARTO',
  },
  'blue-marble': {
    id: 'blue-marble',
    label: 'Blue Marble',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    maximumLevel: 9,
    credit: 'NASA EOSDIS GIBS',
    atmosphere: { hue: -0.53, saturation: 0.2, brightness: -0.05 },
  },
};

/**
 * NASA GIBS true-colour layers. These carry a `Time` dimension, so the app can
 * scrub through history.
 *
 * Coverage is region- and sensor-dependent: VIIRS SNPP over central Europe only
 * has data down to ~z1, while MODIS Terra reaches z9 over Australia and Siberia.
 * `maximumLevel` is therefore the deepest level worth *asking* for; the provider
 * itself drops tiles that come back as the black "no data" placeholder, so the
 * basemap shows through where the sensor has no coverage.
 */
export interface GibsLayer {
  id: string;
  label: string;
  layer: string;
  tileMatrixSet: string;
  maximumLevel: number;
  credit: string;
  /** Approximate archive depth in days, for the date picker's range hint. */
  historyDays: number;
}

export const GIBS_LAYERS: GibsLayer[] = [
  {
    id: 'viirs-snpp',
    label: 'VIIRS SNPP',
    layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maximumLevel: 9,
    credit: 'NASA EOSDIS GIBS',
    historyDays: 400,
  },
  {
    id: 'viirs-noaa20',
    label: 'VIIRS NOAA-20',
    layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maximumLevel: 9,
    credit: 'NASA EOSDIS GIBS',
    historyDays: 200,
  },
  {
    id: 'modis-terra',
    label: 'MODIS Terra',
    layer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maximumLevel: 9,
    credit: 'NASA EOSDIS GIBS',
    historyDays: 2000,
  },
  {
    id: 'modis-aqua',
    label: 'MODIS Aqua',
    layer: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    maximumLevel: 9,
    credit: 'NASA EOSDIS GIBS',
    historyDays: 2000,
  },
  {
    id: 'blue-marble',
    label: 'Blue Marble',
    layer: 'BlueMarble_NextGeneration',
    tileMatrixSet: 'GoogleMapsCompatible_Level8',
    maximumLevel: 8,
    credit: 'NASA EOSDIS GIBS',
    historyDays: 0,
  },
];

/**
 * OpenFreeMap vector tiles carry OSM `render_height`, which is what powers the 3D buildings.
 * The dataset path changes as OpenFreeMap republishes, so we resolve it at runtime
 * from the `planet` TileJSON instead of hardcoding a date.
 */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

/** Vector tiles only exist up to z14, so buildings are only drawn at or below that zoom. */
export const BUILDING_MAX_ZOOM = 14;

/** Overpass mirror that answers (the main overpass-api.de instance returns 406 to scripted clients). */
export const OVERPASS_URL = 'https://overpass.osm.ch/api/interpreter';

/** Photon geocoder — keyless, CORS-friendly. */
export const PHOTON_URL = 'https://photon.komoot.io/api/';

/** KartaView street-level imagery API. */
export const KARTAVIEW_URL = 'https://api.kartaview.org/2.0/photo/';

export const DEFAULT_VIEW = {
  longitude: 14.5058,
  latitude: 46.0513,
  height: 12000,
};

/** Cities offered in the quick-jump menu. */
export const PRESET_PLACES: { name: string; longitude: number; latitude: number; height?: number }[] = [
  { name: 'Ljubljana, Slovenia', longitude: 14.5058, latitude: 46.0513, height: 6000 },
  { name: 'Vienna, Austria', longitude: 16.3738, latitude: 48.2082, height: 8000 },
  { name: 'Berlin, Germany', longitude: 13.405, latitude: 52.52, height: 9000 },
  { name: 'Munich, Germany', longitude: 11.582, latitude: 48.1351, height: 8000 },
  { name: 'Zurich, Switzerland', longitude: 8.5417, latitude: 47.3769, height: 8000 },
  { name: 'Milan, Italy', longitude: 9.19, latitude: 45.4642, height: 8000 },
  { name: 'Oslo, Norway', longitude: 10.7522, latitude: 59.9139, height: 9000 },
  { name: 'Stockholm, Sweden', longitude: 18.0686, latitude: 59.3293, height: 9000 },
  { name: 'Copenhagen, Denmark', longitude: 12.5683, latitude: 55.6761, height: 8000 },
  { name: 'Helsinki, Finland', longitude: 24.9384, latitude: 60.1699, height: 9000 },
  { name: 'Reykjavik, Iceland', longitude: -21.9426, latitude: 64.1466, height: 9000 },
  { name: 'Mount Everest', longitude: 86.925, latitude: 27.9881, height: 30000 },
  { name: 'Grand Canyon', longitude: -112.1129, latitude: 36.1069, height: 20000 },
  { name: 'Manhattan', longitude: -73.9857, latitude: 40.7484, height: 4000 },
  { name: 'San Francisco', longitude: -122.4194, latitude: 37.7749, height: 5000 },
  { name: 'Tokyo', longitude: 139.6917, latitude: 35.6895, height: 9000 },
  { name: 'Sydney', longitude: 151.2093, latitude: -33.8688, height: 12000 },
  { name: 'Cape Town', longitude: 18.4241, latitude: -33.9249, height: 12000 },
];
