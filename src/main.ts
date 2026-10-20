/**
 * Google Earth clone — application bootstrap and UI wiring.
 */

import { Cartesian2, Cartesian3, Cartographic, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer } from 'cesium';
// Cesium's widget stylesheet sizes .cesium-viewer to fill its container. Without
// it the canvas collapses to the 300x150 default.
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { Globe, createViewer } from './globe';
import { buildBuildingsForTile, tilesForView } from './buildings';
import { searchPlaces, type SearchResult } from './search';
import { fetchStreetPhotos, stepSequence, type StreetPhoto } from './streetlevel';
import {
  BASEMAPS,
  DEFAULT_VIEW,
  GIBS_LAYERS,
  PRESET_PLACES,
  type BasemapId,
} from './config';

const viewer: Viewer = createViewer(document.getElementById('cesiumContainer')!);
const globe = new Globe(viewer);

viewer.camera.setView({
  destination: Cartesian3.fromDegrees(
    DEFAULT_VIEW.longitude,
    DEFAULT_VIEW.latitude,
    DEFAULT_VIEW.height,
  ),
});

/* ------------------------------------------------------------------ *
 * DOM helpers
 * ------------------------------------------------------------------ */

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const searchInput = el<HTMLInputElement>('searchInput');
const searchResults = el<HTMLUListElement>('searchResults');
const coordReadout = el<HTMLSpanElement>('coordReadout');
const heightReadout = el<HTMLSpanElement>('heightReadout');
const zoomReadout = el<HTMLSpanElement>('zoomReadout');
const statusPill = el<HTMLSpanElement>('statusPill');
const gibsPanel = el<HTMLDivElement>('gibsPanel');
const gibsDateInput = el<HTMLInputElement>('gibsDate');
const gibsLayerSelect = el<HTMLSelectElement>('gibsLayer');
const streetPanel = el<HTMLDivElement>('streetPanel');
const streetImage = el<HTMLImageElement>('streetImage');
const streetMeta = el<HTMLDivElement>('streetMeta');
const streetPrev = el<HTMLButtonElement>('streetPrev');
const streetNext = el<HTMLButtonElement>('streetNext');
const streetClose = el<HTMLButtonElement>('streetClose');
const buildingsToggle = el<HTMLInputElement>('buildingsToggle');
const terrainToggle = el<HTMLInputElement>('terrainToggle');
const gibsToggle = el<HTMLInputElement>('gibsToggle');
const layersRow = el<HTMLDivElement>('layersRow');
const hintToast = el<HTMLDivElement>('hintToast');

let streetPhotos: StreetPhoto[] = [];
let currentStreetPhotoId = '';

/* ------------------------------------------------------------------ *
 * Basemap buttons
 * ------------------------------------------------------------------ */

for (const basemap of Object.values(BASEMAPS)) {
  const button = document.createElement('button');
  button.className = 'basemap-btn';
  button.textContent = basemap.label;
  button.dataset.id = basemap.id;
  button.addEventListener('click', async () => {
    setStatus('Loading imagery…');
    await globe.setBasemap(basemap.id as BasemapId);
    for (const other of layersRow.querySelectorAll('.basemap-btn')) {
      other.classList.toggle('active', other === button);
    }
    setStatus('');
  });
  layersRow.appendChild(button);
}
layersRow.querySelector('.basemap-btn')?.classList.add('active');

/* ------------------------------------------------------------------ *
 * GIBS time machine
 * ------------------------------------------------------------------ */

for (const layer of GIBS_LAYERS) {
  const option = document.createElement('option');
  option.value = layer.id;
  option.textContent = layer.label;
  gibsLayerSelect.appendChild(option);
}

const today = new Date();
const maxDate = today.toISOString().slice(0, 10);
gibsDateInput.max = maxDate;
gibsDateInput.value = maxDate;

gibsPanel.classList.add('hidden');
gibsToggle.addEventListener('change', async () => {
  if (gibsToggle.checked) {
    gibsPanel.classList.remove('hidden');
    await applyGibs();
  } else {
    gibsPanel.classList.add('hidden');
    await globe.setGibsLayer(null);
  }
});

gibsLayerSelect.addEventListener('change', () => void applyGibs());
gibsDateInput.addEventListener('change', () => void applyGibs());

async function applyGibs(): Promise<void> {
  const layer = GIBS_LAYERS.find((l) => l.id === gibsLayerSelect.value);
  if (!layer) return;
  const date = new Date(`${gibsDateInput.value}T00:00:00Z`);
  setStatus('Loading NASA imagery…');
  try {
    await globe.setGibsLayer(layer, date);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('NASA imagery failed');
  }
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

let searchAbort: AbortController | null = null;
let searchTimer: number | undefined;

searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void runSearch(), 280);
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void runSearch();
  }
  if (event.key === 'Escape') {
    searchResults.classList.add('hidden');
  }
});

async function runSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) {
    searchResults.classList.add('hidden');
    return;
  }

  searchAbort?.abort();
  searchAbort = new AbortController();

  try {
    const results = await searchPlaces(query);
    renderSearchResults(results);
  } catch (err) {
    console.error('Search failed:', err);
    searchResults.classList.add('hidden');
  }
}

function renderSearchResults(results: SearchResult[]): void {
  searchResults.innerHTML = '';
  if (results.length === 0) {
    searchResults.classList.add('hidden');
    return;
  }

  for (const result of results) {
    const item = document.createElement('li');
    item.className = 'search-item';

    const name = document.createElement('span');
    name.className = 'search-name';
    name.textContent = result.name;

    const context = document.createElement('span');
    context.className = 'search-context';
    context.textContent = result.context || result.kind;

    item.append(name, context);
    item.addEventListener('click', () => {
      flyTo(result.longitude, result.latitude, 2500);
      searchResults.classList.add('hidden');
      searchInput.blur();
    });

    searchResults.appendChild(item);
  }
  searchResults.classList.remove('hidden');
}

document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (!el('searchBox').contains(target)) {
    searchResults.classList.add('hidden');
  }
});

/* ------------------------------------------------------------------ *
 * Camera helpers
 * ------------------------------------------------------------------ */

function flyTo(longitude: number, latitude: number, height = 4000): void {
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(longitude, latitude, height),
    duration: 1.6,
  });
}

/* ------------------------------------------------------------------ *
 * Preset places
 * ------------------------------------------------------------------ */

const placesList = el<HTMLDivElement>('placesList');
for (const place of PRESET_PLACES) {
  const button = document.createElement('button');
  button.className = 'place-btn';
  button.textContent = place.name;
  button.addEventListener('click', () => flyTo(place.longitude, place.latitude, place.height ?? 8000));
  placesList.appendChild(button);
}

/* ------------------------------------------------------------------ *
 * 3D buildings
 * ------------------------------------------------------------------ */

let buildingPrimitives: { primitive: { show: boolean }; key: string }[] = [];
let buildingsEnabled = false;
let lastBuildingTileKey = '';

buildingsToggle.addEventListener('change', () => {
  buildingsEnabled = buildingsToggle.checked;
  if (!buildingsEnabled) {
    for (const p of buildingPrimitives) p.primitive.show = false;
    return;
  }
  void refreshBuildings(true);
});

async function refreshBuildings(force = false): Promise<void> {
  if (!buildingsEnabled) return;

  const camera = viewer.camera;
  const carto = camera.positionCartographic;
  const zoom = currentZoom();

  if (zoom > 14.5) {
    // Too far in for the vector tiles to exist; clear what we have.
    for (const p of buildingPrimitives) p.primitive.show = false;
    buildingPrimitives = [];
    lastBuildingTileKey = '';
    return;
  }

  const tiles = tilesForView({ longitude: carto.longitude, latitude: carto.latitude }, zoom, 3);
  const key = tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join('|');
  if (!force && key === lastBuildingTileKey) return;
  lastBuildingTileKey = key;

  const target = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
  // Hide primitives that are no longer needed.
  for (const entry of buildingPrimitives) {
    if (!target.has(entry.key)) entry.primitive.show = false;
  }

  const existing = new Set(buildingPrimitives.map((p) => p.key));
  const wanted = tiles.filter((t) => !existing.has(`${t.z}/${t.x}/${t.y}`));

  await Promise.all(
    wanted.map(async (tile) => {
      const tileKey = `${tile.z}/${tile.x}/${tile.y}`;
      try {
        const primitive = await buildBuildingsForTile(
          tile.z,
          tile.x,
          tile.y,
          viewer.terrainProvider,
        );
        viewer.scene.primitives.add(primitive);
        buildingPrimitives.push({ primitive, key: tileKey });
      } catch (err) {
        console.warn('building tile failed', tileKey, err);
      }
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Terrain toggle
 * ------------------------------------------------------------------ */

terrainToggle.addEventListener('change', async () => {
  setStatus('Loading terrain…');
  try {
    await globe.setTerrain(terrainToggle.checked);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Terrain unavailable');
    terrainToggle.checked = false;
  }
});

/* ------------------------------------------------------------------ *
 * Street level
 * ------------------------------------------------------------------ */

streetPanel.classList.add('hidden');

async function openStreetLevel(lat: number, lng: number): Promise<void> {
  setStatus('Loading street view…');
  try {
    streetPhotos = await fetchStreetPhotos(lat, lng);
    if (streetPhotos.length === 0) {
      setStatus('No street-level imagery here');
      window.setTimeout(() => setStatus(''), 2600);
      return;
    }
    currentStreetPhotoId = streetPhotos[0].id;
    showStreetPhoto(streetPhotos[0]);
    streetPanel.classList.remove('hidden');
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('Street view failed');
    window.setTimeout(() => setStatus(''), 2600);
  }
}

function showStreetPhoto(photo: StreetPhoto): void {
  currentStreetPhotoId = photo.id;
  streetImage.src = photo.url;
  streetImage.alt = `Street-level photo at ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`;
  streetMeta.innerHTML = '';
  const lines = [
    `${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}`,
    photo.shotDate ? `captured ${photo.shotDate.slice(0, 10)}` : '',
    `heading ${Math.round(photo.heading)}°`,
  ].filter(Boolean);
  streetMeta.textContent = lines.join(' · ');
}

streetPrev.addEventListener('click', () => {
  const next = stepSequence(streetPhotos, currentStreetPhotoId, -1);
  if (next) showStreetPhoto(next);
});

streetNext.addEventListener('click', () => {
  const next = stepSequence(streetPhotos, currentStreetPhotoId, 1);
  if (next) showStreetPhoto(next);
});

streetClose.addEventListener('click', () => {
  streetPanel.classList.add('hidden');
});

/* ------------------------------------------------------------------ *
 * Map clicks
 * ------------------------------------------------------------------ */

const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement: { position: Cartesian2 }) => {
  const ray = viewer.camera.getPickRay(movement.position);
  if (!ray) return;
  const carto = viewer.scene.globe.pick(ray, viewer.scene);
  if (!carto) return;
  // Cartographic stores radians; the geocoding APIs expect degrees.
  const position = Cartographic.fromCartesian(carto);
  const latitude = CesiumMath.toDegrees(position.latitude);
  const longitude = CesiumMath.toDegrees(position.longitude);
  void openStreetLevel(latitude, longitude);
}, ScreenSpaceEventType.LEFT_CLICK);
/* ------------------------------------------------------------------ *
 * Readouts
 * ------------------------------------------------------------------ */

function currentZoom(): number {
  const height = Math.max(1, viewer.camera.positionCartographic.height);
  // Web-Mercator zoom for a 45°-tilted default camera.
  return CesiumMath.log2((156543.03392 * 1.2) / height);
}

let readoutTimer: number | undefined;
function updateReadouts(): void {
  const carto = viewer.camera.positionCartographic;
  const lon = CesiumMath.toDegrees(carto.longitude);
  const lat = CesiumMath.toDegrees(carto.latitude);
  coordReadout.textContent = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
  heightReadout.textContent = `${Math.round(carto.height)} m`;
  zoomReadout.textContent = `z${currentZoom().toFixed(1)}`;
}

viewer.camera.changed.addEventListener(() => {
  updateReadouts();
  window.clearTimeout(readoutTimer);
  readoutTimer = window.setTimeout(() => void refreshBuildings(), 400);
});

updateReadouts();

/* ------------------------------------------------------------------ *
 * Status pill
 * ------------------------------------------------------------------ */

let statusTimer: number | undefined;
function setStatus(message: string): void {
  window.clearTimeout(statusTimer);
  if (!message) {
    statusPill.classList.add('hidden');
    statusPill.textContent = '';
    return;
  }
  statusPill.textContent = message;
  statusPill.classList.remove('hidden');
}

/* ------------------------------------------------------------------ *
 * Hint toast
 * ------------------------------------------------------------------ */

window.setTimeout(() => {
  hintToast.classList.add('visible');
}, 900);
window.setTimeout(() => {
  hintToast.classList.remove('visible');
}, 6500);

/* ------------------------------------------------------------------ *
 * Keyboard shortcuts
 * ------------------------------------------------------------------ */

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  switch (event.key) {
    case '/':
      event.preventDefault();
      searchInput.focus();
      break;
    case 'b':
      buildingsToggle.checked = !buildingsToggle.checked;
      buildingsToggle.dispatchEvent(new Event('change'));
      break;
    case 't':
      terrainToggle.checked = !terrainToggle.checked;
      terrainToggle.dispatchEvent(new Event('change'));
      break;
    case 'n':
      gibsToggle.checked = !gibsToggle.checked;
      gibsToggle.dispatchEvent(new Event('change'));
      break;
    case 'Escape':
      streetPanel.classList.add('hidden');
      break;
  }
});

export { viewer, globe };

// Dev-only handle so the app can be driven from the console (and by tests).
if (import.meta.env.DEV) {
  (window as unknown as { earthExplorer?: unknown }).earthExplorer = { viewer, globe };
}
