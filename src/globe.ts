/**
 * Globe setup: Cesium viewer, basemap layers, terrain, and the NASA time-slider imagery.
 */

import {
  ArcGISTiledElevationTerrainProvider,
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidTerrainProvider,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Viewer,
  sampleTerrainMostDetailed,
} from 'cesium';
import { BASEMAPS, TERRAIN_URL, type BasemapId, type GibsLayer } from './config';
import { GibsImageryProvider } from './gibsProvider';

export interface GlobeController {
  viewer: Viewer;
  setBasemap(id: BasemapId): Promise<void>;
  setGibsLayer(layer: GibsLayer | null, date?: Date): Promise<void>;
  setGibsDate(date: Date): void;
  setTerrain(enabled: boolean): Promise<void>;
  getTerrainEnabled(): boolean;
}

/** Build the Cesium viewer with a Google-Earth-like configuration. */
export function createViewer(container: HTMLElement): Viewer {
  const viewer = new Viewer(container, {
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    // The globe starts in 3D; a Google Earth clone should open in 3D.
    sceneMode: 3,
    baseLayer: new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: BASEMAPS.satellite.url,
        maximumLevel: BASEMAPS.satellite.maximumLevel,
        credit: BASEMAPS.satellite.credit,
      }),
    ),
  });

  const scene = viewer.scene;
  scene.globe.baseColor = Color.fromCssColorString('#0a1628');
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.maximumScreenSpaceError = 2; // sharper tiles, a bit more GPU
  scene.backgroundColor = Color.fromCssColorString('#05080f');

  const atmosphere = scene.skyAtmosphere;
  if (atmosphere) {
    atmosphere.hueShift = -0.53;
    atmosphere.saturationShift = 0.15;
    atmosphere.brightnessShift = -0.1;
  }

  scene.fog.enabled = true;
  scene.fog.density = 0.0002;
  scene.highDynamicRange = true;

  viewer.cesiumWidget.creditContainer.setAttribute('style', 'display: none');

  return viewer;
}

/** Attach keyless 3D terrain. Resolves to false if the service is unreachable. */
export async function attachTerrain(viewer: Viewer): Promise<boolean> {
  try {
    const provider = await ArcGISTiledElevationTerrainProvider.fromUrl(TERRAIN_URL);
    viewer.terrainProvider = provider;
    return true;
  } catch (err) {
    console.warn('Terrain provider unavailable:', err);
    return false;
  }
}

export class Globe implements GlobeController {
  viewer: Viewer;

  private basemapLayer: ImageryLayer;
  private gibsLayer: ImageryLayer | null = null;
  private gibsProvider: GibsImageryProvider | null = null;
  private gibsDate: Date = new Date();
  private terrainOn = false;
  private terrainProvider: ArcGISTiledElevationTerrainProvider | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.basemapLayer = viewer.imageryLayers.get(0) as ImageryLayer;
  }

  async setBasemap(id: BasemapId): Promise<void> {
    const basemap = BASEMAPS[id];
    if (!basemap) return;

    const previous = this.basemapLayer;
    const layer = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: basemap.url,
        maximumLevel: basemap.maximumLevel,
        credit: basemap.credit,
      }),
    );

    // Insert above the current basemap, then remove the old one, so there is no
    // visible flash of missing imagery.
    this.viewer.imageryLayers.add(layer, 1);
    this.basemapLayer = layer;
    if (previous) this.viewer.imageryLayers.remove(previous, true);

    const atmosphere = basemap.atmosphere;
    if (atmosphere) {
      const sky = this.viewer.scene.skyAtmosphere;
      if (sky) {
        sky.hueShift = atmosphere.hue;
        sky.saturationShift = atmosphere.saturation;
        sky.brightnessShift = atmosphere.brightness;
      }
    }
  }

  /**
   * Add or update a NASA GIBS true-colour layer. GIBS exposes a `Time` dimension,
   * so the same layer can show any archived date.
   */
  async setGibsLayer(layer: GibsLayer | null, date?: Date): Promise<void> {
    if (this.gibsLayer) {
      this.viewer.imageryLayers.remove(this.gibsLayer, true);
      this.gibsLayer = null;
      this.gibsProvider = null;
    }
    if (!layer) return;

    if (date) this.gibsDate = date;
    const time = this.gibsDate.toISOString().slice(0, 10);

    const provider = new GibsImageryProvider({
      layer: layer.layer,
      tileMatrixSet: layer.tileMatrixSet,
      time,
      maximumLevel: layer.maximumLevel,
      credit: layer.credit,
    });
    this.gibsProvider = provider;

    const imageryLayer = new ImageryLayer(provider);
    // GIBS's "no coverage" tiles are pure black. Making black transparent at the
    // shader level lets the basemap underneath show through instead of the
    // globe turning into a black void.
    imageryLayer.colorToAlpha = Color.BLACK;
    imageryLayer.colorToAlphaThreshold = 0.06;
    this.viewer.imageryLayers.add(imageryLayer, 1);
    this.gibsLayer = imageryLayer;
  }

  /**
   * Change the date of the active GIBS layer. The provider reads its time on every
   * tile request, so the layer picks the new date up as tiles are re-requested.
   */
  setGibsDate(date: Date): void {
    this.gibsDate = date;
    if (!this.gibsLayer || !this.gibsProvider) return;

    this.gibsProvider.setTime(date.toISOString().slice(0, 10));

    // Force the imagery layer to re-request its tiles with the new Time value.
    this.gibsLayer.show = false;
    this.gibsLayer.show = true;
  }

  async setTerrain(enabled: boolean): Promise<void> {
    if (enabled === this.terrainOn) return;
    if (enabled) {
      if (!this.terrainProvider) {
        this.terrainProvider = await ArcGISTiledElevationTerrainProvider.fromUrl(TERRAIN_URL);
      }
      this.viewer.terrainProvider = this.terrainProvider;
    } else {
      this.viewer.terrainProvider = new EllipsoidTerrainProvider();
    }
    this.terrainOn = enabled;
  }

  getTerrainEnabled(): boolean {
    return this.terrainOn;
  }
}

/** Height of the terrain (or ellipsoid) at a given lon/lat, in metres. */
export async function groundHeightAt(
  viewer: Viewer,
  longitude: number,
  latitude: number,
): Promise<number> {
  const provider = viewer.terrainProvider;
  const cartographic = Cartographic.fromCartesian(Cartesian3.fromDegrees(longitude, latitude));
  try {
    const results = await sampleTerrainMostDetailed(provider, [cartographic]);
    return results[0]?.height ?? 0;
  } catch {
    return 0;
  }
}

/** Convert lon/lat/height to a Cesium cartesian position. */
export function toCartesian(longitude: number, latitude: number, height = 0): Cartesian3 {
  return Cartesian3.fromDegrees(longitude, latitude, height);
}
