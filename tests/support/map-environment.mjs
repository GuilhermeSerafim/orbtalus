// Loaded only by the map suite, after the network guard. No real SDK is imported.
import Module from 'node:module';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.example.test', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'CustomEvent']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });

class Events {
  listeners = new Map();
  on(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); return this; }
  off(name, fn) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== fn)); return this; }
  once(name, fn) { const once = (...args) => { this.off(name, once); fn(...args); }; once.original = fn; return this.on(name, once); }
  emit(name, value) { for (const fn of [...(this.listeners.get(name) ?? [])]) fn(value); }
  callbacks(name) { return [...(this.listeners.get(name) ?? [])]; }
}
/** @type {{maps: MapDouble[], constructionHosts: HTMLElement[], geocoders: GeocoderDouble[], markers: MarkerDouble[], theme: string, failConstruction: boolean,
 * locate: null | ((position: {coords: {longitude: number, latitude: number}}) => void),
 * locationError: null | ((error: {code: number, PERMISSION_DENIED: number, TIMEOUT: number}) => void)}} */
const state = { maps: [], constructionHosts: [], geocoders: [], markers: [], theme: 'light', locate: null, locationError: null, failConstruction: false };
class MapDouble extends Events {
  sources = new Map(); layers = new Map(); paints = []; flights = []; terrain = []; removed = false; loaded = false;
  operationsAfterRemove = 0;
  operationsBeforeStyle = 0;
  styleDocumentLoaded = false;
  contextLost = false;
  fullStyleReplacement = true;
  constructor(options) {
    super(); this.options = options;
    // SDK _setupContainer runs before _setupPainter can throw. Window listeners
    // are installed only after that throw; these effects belong to the host.
    const host = options.container; state.constructionHosts.push(host);
    host.classList.add('mapboxgl-map');
    this.canvas = document.createElement('canvas'); this.canvas.className = 'mapboxgl-canvas';
    this.contextLostListener = (event) => { event.preventDefault(); this.emit('webglcontextlost', { originalEvent: event }); };
    this.contextRestoredListener = (event) => this.emit('webglcontextrestored', { originalEvent: event });
    this.scrollListener = () => { host.scrollTop = 0; };
    this.canvas.addEventListener('webglcontextlost', this.contextLostListener);
    this.canvas.addEventListener('webglcontextrestored', this.contextRestoredListener);
    host.addEventListener('scroll', this.scrollListener);
    this.controls = document.createElement('div'); this.controls.className = 'mapboxgl-control-container';
    host.append(this.canvas, this.controls);
    if (state.failConstruction) throw new Error('PRIVATE_SDK_FAILURE');
    state.maps.push(this);
  }
  emit(name, value) {
    // A successful SDK diff does NOT emit style.load. Existing tests also pass
    // through this gate, so an accidental return to default diff is detectable.
    if (name === 'style.load' && !this.fullStyleReplacement) return;
    if (name === 'webglcontextlost') this.contextLost = true;
    if (name === 'webglcontextrestored') this.contextLost = false;
    if (name === 'load') this.loaded = true;
    if (name === 'load' || name === 'style.load') this.styleDocumentLoaded = true;
    super.emit(name, value);
  }
  checkStyle() { this.touch(); if (!this.styleDocumentLoaded || this.contextLost) { this.operationsBeforeStyle++; throw new Error('Style is not done loading'); } }
  touch() { if (this.removed) { this.operationsAfterRemove++; throw new Error('SDK_USED_AFTER_REMOVE'); } }
  on(name, fn) { this.touch(); return super.on(name, fn); }
  off(name, fn) { this.touch(); return super.off(name, fn); }
  isStyleLoaded() { this.touch(); return this.loaded; }
  getSource(id) { this.touch(); return this.sources.get(id); }
  addSource(id, spec) {
    this.checkStyle();
    const source = { ...spec };
    source.setData = (data) => { this.touch(); source.data = data; };
    this.sources.set(id, source);
  }
  removeSource(id) { this.touch(); this.sources.delete(id); }
  getLayer(id) { this.touch(); return this.layers.get(id); }
  addLayer(layer) { this.checkStyle(); this.layers.set(layer.id, layer); }
  removeLayer(id) { this.touch(); this.layers.delete(id); }
  setPaintProperty(id, property, value) {
    this.touch();
    const layer = this.layers.get(id);
    if (!layer) throw new Error(`PAINT_TARGET_MISSING: ${id}`);
    layer.paint[property] = value;
    this.paints.push([id, property, value]);
  }
  getStyle() { this.touch(); return { layers: [...this.layers.values()] }; }
  setTerrain(value) { this.checkStyle(); this.terrain.push(value); }
  easeTo() { this.touch(); }
  flyTo(value) { this.touch(); this.flights.push(value); }
  addControl(control) { this.touch(); this.control = control; }
  removeControl(control) { this.touch(); if (this.control === control) this.control = null; }
  setStyle(style, options = {}) {
    this.touch(); this.style = style; this.fullStyleReplacement = options.diff === false;
    if (this.fullStyleReplacement) { this.loaded = false; this.styleDocumentLoaded = false; this.sources.clear(); this.layers.clear(); }
  }
  remove() {
    this.touch(); this.removed = true;
    this.canvas.removeEventListener('webglcontextlost', this.contextLostListener);
    this.canvas.removeEventListener('webglcontextrestored', this.contextRestoredListener);
    this.options.container.removeEventListener('scroll', this.scrollListener);
    this.canvas.remove(); this.controls.remove();
  }
}
class GeocoderDouble extends Events { constructor() { super(); state.geocoders.push(this); } }
class MarkerDouble {
  constructor(options) { this.options = options; this.removed = false; state.markers.push(this); }
  setLngLat(center) { this.map?.touch(); this.center = center; return this; }
  addTo(map) { map.touch(); this.map = map; return this; }
  remove() { this.map?.touch(); this.removed = true; }
}
const sdk = { Map: MapDouble, Marker: MarkerDouble, accessToken: '' };
const originalLoad = Module._load;
Module._load = function(request, ...args) {
  if (request === 'mapbox-gl') return sdk;
  if (request === '@mapbox/mapbox-gl-geocoder') return GeocoderDouble;
  if (request === 'next-themes') return { useTheme: () => ({ resolvedTheme: state.theme }) };
  if (request.includes('@vercel/analytics')) throw new Error('ANALYTICS_IMPORT_FORBIDDEN');
  return originalLoad.call(this, request, ...args);
};
Object.defineProperty(navigator, 'geolocation', { value: {
  getCurrentPosition(success, error) { state.locate = success; state.locationError = error; },
}, configurable: true });
process.env.NEXT_PUBLIC_MAPBOX_TOKEN = 'invalid-offline-test-token';
process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example.test';
process.env.NEXT_PUBLIC_API_RISK_ENDPOINT = '/geo/risk';
const restore = () => { Module._load = originalLoad; dom.window.close(); };
export { state, dom, restore };
