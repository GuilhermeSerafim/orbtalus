import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test, type TestContext } from 'node:test';
import type { RiskResponse } from '../lib/api';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
// SDK interception and DOM must precede imports of RTL and the actual component.
import { state, restore } from './support/map-environment.mjs';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import React from 'react';
const loadModule = createRequire(import.meta.url);

type Pending = { resolve: (value: Response) => void; reject: (reason: Error) => void; body: unknown };
let requests: Pending[];
const guardedFetch = globalThis.fetch;
let GeoRiskMap: React.ComponentType;
beforeEach(() => {
  state.maps.length = state.geocoders.length = state.markers.length = 0;
  state.constructionHosts.length = 0;
  state.theme = 'light'; state.locate = state.locationError = null;
  state.failConstruction = false;
  requests = [];
  globalThis.fetch = (_url, options) => new Promise<Response>((resolve, reject) => {
    assert.equal(_url, 'https://api.example.test/geo/risk');
    assert.equal(options?.method, 'POST');
    requests.push({ resolve, reject, body: JSON.parse(String(options?.body)) });
  });
  delete loadModule.cache[loadModule.resolve('../components/ui/GeoRiskMap')];
  GeoRiskMap = loadModule('../components/ui/GeoRiskMap').default;
});
afterEach(() => {
  cleanup(); globalThis.fetch = guardedFetch;
  for (const map of state.maps) assert.equal(map.operationsAfterRemove, 0, 'no attempted SDK operations after remove, including swallowed errors');
  for (const map of state.maps) assert.equal(map.operationsBeforeStyle, 0, 'no attempted mutations before the style document loads');
});
after(restore);

function response(name = 'CURRENT_REPORT', overrides: Partial<RiskResponse> = {}): RiskResponse {
  return { distancia_rio_m: 0, queda_relativa_m: 0, rio_mais_proximo: 'Rio local', resposta_ia: name,
    risk_level: 'baixo', tipo_hidrografia: 'river',
    risk_calculation: { confidence: 0, total_score: 0, component_scores: { topography: 0, water_frequency: 0, soil_permeability: 0 },
      weights_applied: { topography: 0.5, water_frequency: 0.3, soil_permeability: 0.2 } },
    environmental_data: { soil: { class_id: 0, class_name: '', is_permeable: false }, water_frequency: { years: 0, confidence: 0 }, data_source: '', provider_status: '' },
    debug_coords: { rio_lat: 0, rio_lon: 0 }, ...overrides };
}
function mount() {
  const view = render(<GeoRiskMap />);
  const map = state.maps.at(-1);
  assert.ok(map, 'real component constructs SDK double');
  act(() => map.emit('load'));
  const geocoder = state.geocoders.at(-1);
  assert.ok(geocoder);
  return { view, map, geocoder };
}
function click(map: typeof state.maps[number], lng = -46, lat = -23) { act(() => map.emit('click', { lngLat: { lng, lat } })); }
async function resolve(index: number, data = response()) { await act(async () => { requests[index].resolve(new Response(JSON.stringify(data))); }); }
async function reject(index: number) { await act(async () => { requests[index].reject(new Error('SECRET_UPSTREAM')); }); }
function text(view: ReturnType<typeof render>) { return view.container.textContent ?? ''; }
function lastCenter() { return state.markers.at(-1)?.center; }
function color(map: typeof state.maps[number]) { return map.paints.at(-1)?.[2]; }
function assertAnalysis(map: typeof state.maps[number], requestIndex: number, center: [number, number], expectedColor: string) {
  const source = map.getSource('analysis-circle');
  assert.ok(source, 'analysis source must be recreated in the current style');
  assert.equal(source.type, 'geojson');
  assert.equal(source.data.type, 'Feature');
  assert.equal(source.data.geometry.type, 'Polygon');
  assert.equal(source.data.geometry.coordinates[0].length, 65);
  assert.deepEqual({ polygon: source.data.geometry }, requests[requestIndex].body, 'current selection geometry, not the old circle');
  for (const [id, type, property] of [['analysis-circle', 'fill', 'fill-color'], ['analysis-circle-outline', 'line', 'line-color']]) {
    const layer = map.getLayer(id);
    assert.ok(layer, `${id} must exist in the current style`);
    assert.equal(layer.type, type); assert.equal(layer.source, 'analysis-circle');
    assert.equal(layer.paint[property], expectedColor);
  }
  assert.deepEqual(lastCenter(), center);
  assert.match(state.markers.at(-1)?.options.element.innerHTML ?? '', new RegExp(expectedColor));
}
async function locate() { const callback = state.locate; assert.ok(callback); await act(async () => callback({ coords: { longitude: -40, latitude: -10 } })); }

function captureMapTimeouts(t: TestContext) {
  const timers: Array<() => void> = []; const cleared: number[] = [];
  const schedule = window.setTimeout.bind(window); const cancel = window.clearTimeout.bind(window);
  t.mock.method(window, 'setTimeout', (callback: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms === 20000) { assert.equal(typeof callback, 'function'); timers.push(callback as () => void); return -timers.length; }
    return schedule(callback, ms, ...args);
  });
  t.mock.method(window, 'clearTimeout', (id: number) => { cleared.push(id); cancel(id); });
  return { timers, cleared };
}

function contextEvent(map: typeof state.maps[number], type: 'webglcontextlost' | 'webglcontextrestored') {
  // Native canvas event -> SDK event bridge, without an accompanying error event.
  act(() => map.canvas.dispatchEvent(new window.Event(type, { cancelable: true })));
}

test('shows a single quota warning directly on the map after HTTP 429', async () => {
  const { view, map } = mount();
  click(map);
  await act(async () => { requests[0].resolve(new Response(null, {status: 429})); });
  assert.equal(view.getAllByText('Limite diário de análises atingido. Tente novamente mais tarde.').length, 1);
  assert.doesNotMatch(text(view), /Falha na analise/);
});

test('explains insufficient local hydrography directly on the map without a risk score', async () => {
  const { view, map } = mount();
  click(map);
  await act(async () => { requests[0].resolve(Response.json({ detail: { code: 'HYDROLOGY_UNAVAILABLE' } }, { status: 503 })); });
  const notice = view.getAllByRole('status').find(element => element.textContent?.includes('rios e córregos'));
  assert.ok(notice, 'the map announces the reason even before opening an analysis panel');
  assert.match(notice.textContent ?? '', /insuficientes para classificar o risco/);
  assert.doesNotMatch(text(view), /Score [\d,]+%|cota é renovada/i);
});

test('successful theme replacement completes the SDK full-load lifecycle without false timeout or report loss', async (t) => {
  const { timers } = captureMapTimeouts(t);
  const { view, map } = mount(); click(map); await resolve(0, response('THEME_REPORT'));
  for (const theme of ['dark', 'light']) {
    state.theme = theme; view.rerender(<GeoRiskMap />);
    await act(async () => {});
    assert.match(text(view), /Carregando mapa/);
    act(() => map.emit('style.load'));
    assert.doesNotMatch(text(view), /Carregando mapa|Mapa indisponível/);
    act(() => timers.forEach(callback => callback()));
    assert.equal(view.queryByRole('alert'), null);
    assertAnalysis(map, 0, [-46, -23], '#16a34a');
  }
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /THEME_REPORT/); assert.equal(requests.length, 1);
});

test('partial constructor failures discard each host before retries, success and unmount', async () => {
  state.failConstruction = true;
  const view = render(<GeoRiskMap />);
  for (let attempt = 0; attempt < 3; attempt++) {
    await act(async () => {});
    const host = state.constructionHosts.at(-1); assert.ok(host);
    assert.equal(host.isConnected, false, 'failed SDK host and its canvas/listeners must be detached');
    assert.equal(view.container.querySelectorAll('.mapboxgl-canvas').length, 0);
    assert.equal(new Set(state.constructionHosts).size, attempt + 1, 'each attempt has an exclusive host');
    if (attempt === 2) state.failConstruction = false;
    fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  }
  const map = state.maps[0]; assert.ok(map); act(() => map.emit('load'));
  assert.equal(view.container.querySelectorAll('.mapboxgl-canvas').length, 1);
  assert.equal(view.container.querySelectorAll('.mapboxgl-control-container').length, 1);
  assert.equal(new Set(state.constructionHosts).size, 4);
  view.unmount(); assert.ok(state.constructionHosts.every(host => !host.isConnected));
});

test('unmount after partial constructor failure releases its host and ignores queued failure', () => {
  state.failConstruction = true; const view = render(<GeoRiskMap />);
  const host = state.constructionHosts[0]; assert.ok(host);
  assert.equal(host.isConnected, false); view.unmount();
  assert.equal(host.isConnected, false);
});

test('WebGL loss clears a displayed report; restoration reloads current selection, theme and 3D once', async () => {
  const { view, map } = mount(); click(map); await resolve(0, response('BEFORE_LOSS'));
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /BEFORE_LOSS/);
  const oldLost = map.callbacks('webglcontextlost')[0];
  const oldRestored = map.callbacks('webglcontextrestored')[0];
  contextEvent(map, 'webglcontextlost');
  assert.ok(view.getByRole('alert')); assert.doesNotMatch(text(view), /BEFORE_LOSS|Baixo risco|Aguardando ponto|Clique no mapa/);
  fireEvent.click(view.getByRole('button', { name: 'Desativar modo 3D do mapa' }));
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  contextEvent(map, 'webglcontextrestored');
  assert.match(text(view), /Carregando mapa/); assert.equal(view.queryByRole('alert'), null);
  const next = state.maps.at(-1); assert.ok(next); assert.notEqual(next, map);
  assert.equal(next.options.style, 'mapbox://styles/mapbox/dark-v11');
  assert.deepEqual(next.options.center, [-46, -23]); assert.equal(next.options.pitch, 0);
  act(() => { oldLost(); oldRestored(); next.emit('load'); next.emit('load'); });
  assert.equal(requests.length, 2); assert.equal(next.terrain.at(-1), null);
  await resolve(1, response('AFTER_RESTORE'));
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /AFTER_RESTORE/); assert.doesNotMatch(text(view), /BEFORE_LOSS/);
});

for (const outcome of ['success', 'error'] as const) {
  test(`WebGL loss invalidates pending ${outcome} and late style/click/geocoder callbacks`, async () => {
    const { view, map, geocoder } = mount(); click(map);
    state.theme = 'dark'; view.rerender(<GeoRiskMap />);
    const lateStyle = map.callbacks('style.load')[0]; const lateClick = map.callbacks('click')[0];
    const lateGeocoder = geocoder.callbacks('result')[0];
    contextEvent(map, 'webglcontextlost'); assert.ok(view.getByRole('alert'));
    act(() => { lateStyle(); lateClick({ lngLat: { lng: 1, lat: 2 } }); lateGeocoder({ result: { center: [1, 2] } }); });
    await locate(); assert.equal(requests.length, 1);
    contextEvent(map, 'webglcontextrestored');
    const next = state.maps.at(-1); assert.ok(next); act(() => next.emit('load'));
    assert.equal(requests.length, 2); await resolve(1, response('CURRENT_AFTER_CONTEXT'));
    if (outcome === 'success') await resolve(0, response('OBSOLETE_CONTEXT')); else await reject(0);
    fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
    assert.match(text(view), /CURRENT_AFTER_CONTEXT/); assert.doesNotMatch(text(view), /OBSOLETE_CONTEXT|Falha na analise/);
    assert.deepEqual(lastCenter(), [-46, -23]);
  });
}

test('WebGL restoration timeout permits manual retry; detached callbacks and timers cannot revive old maps', (t) => {
  const { timers, cleared } = captureMapTimeouts(t);
  const { view, map } = mount();
  const oldCallbacks = [...map.callbacks('webglcontextlost'), ...map.callbacks('webglcontextrestored')];
  contextEvent(map, 'webglcontextlost'); assert.ok(view.getByRole('alert'));
  contextEvent(map, 'webglcontextrestored');
  const restoring = state.maps.at(-1); assert.ok(restoring); assert.notEqual(restoring, map);
  act(() => timers.at(-1)?.()); assert.ok(view.getByRole('alert'));
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  const next = state.maps.at(-1); assert.ok(next); assert.notEqual(next, restoring);
  act(() => { oldCallbacks.forEach(fn => fn()); next.emit('load'); timers.forEach(fn => fn()); });
  assert.equal(view.queryByRole('alert'), null); assert.ok(cleared.includes(-timers.length));
  const queued = [...next.callbacks('webglcontextlost'), ...next.callbacks('webglcontextrestored')];
  view.unmount(); act(() => { queued.forEach(fn => fn()); timers.forEach(fn => fn()); });
  for (const instance of state.maps) {
    for (const name of ['load', 'error', 'click', 'style.load', 'webglcontextlost', 'webglcontextrestored']) assert.equal(instance.callbacks(name).length, 0, name);
    assert.equal(instance.options.container.isConnected, false);
  }
});

test('WebGL loss before initial load allows manual retry and rejects restore before React flush', () => {
  const view = render(<GeoRiskMap />); const map = state.maps[0];
  const lateLoad = map.callbacks('load')[0];
  contextEvent(map, 'webglcontextlost'); assert.ok(view.getByRole('alert'));
  act(() => {
    view.getByRole('button', { name: 'Tentar novamente' }).click();
    map.emit('webglcontextrestored'); lateLoad();
  });
  assert.equal(state.maps.length, 2); assert.equal(state.geocoders.length, 0);
  const next = state.maps[1]; act(() => next.emit('load'));
  assert.equal(view.queryByRole('alert'), null); assert.equal(state.geocoders.length, 1);
});

test('original full zero response renders zero scores, distance/elevation and false permeability', async () => {
  const { view, map } = mount(); click(map); await resolve(0);
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /CURRENT_REPORT/);
  assert.match(text(view), /0\.0m/);
  assert.match(text(view), /0%/);
  assert.match(text(view), /Impermeavel/);
  const circle = map.getSource('analysis-circle').data.geometry;
  assert.equal(circle.type, 'Polygon'); assert.equal(circle.coordinates[0].length, 65);
  assert.deepEqual(requests[0].body, { polygon: circle });
});
test('null elevation and omitted optionals render without trim/toFixed crashes', async () => {
  const { view, map } = mount(); click(map);
  await resolve(0, { distancia_rio_m: 0, queda_relativa_m: null, rio_mais_proximo: 'Rio', resposta_ia: 'MINIMAL_REPORT', risk_level: 'baixo' });
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /MINIMAL_REPORT/); assert.match(text(view), /N\/A/);
});
test('starting another request removes old report immediately; failure keeps it absent', async () => {
  const { view, map } = mount(); click(map); await resolve(0, response('OLD_REPORT'));
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /OLD_REPORT/);
  click(map, -45); assert.doesNotMatch(text(view), /OLD_REPORT/);
  await reject(1); assert.doesNotMatch(text(view), /OLD_REPORT|SECRET_UPSTREAM/);
  assert.match(text(view), /Falha/);
});
for (const oldResult of ['success', 'error'] as const) {
  test(`old ${oldResult} and finally cannot stop the current loading state`, async () => {
    const { view, map } = mount(); click(map); click(map, -45);
    if (oldResult === 'success') await resolve(0, response('OBSOLETE')); else await reject(0);
    assert.match(text(view), /Analisando/); assert.doesNotMatch(text(view), /OBSOLETE|Falha na analise/);
    assert.equal(color(map), '#0284c7');
    await resolve(1); assert.match(text(view), /Baixo risco/); assert.deepEqual(lastCenter(), [-45, -23]);
  });
  test(`old ${oldResult} cannot replace a newer success`, async () => {
    const { view, map } = mount(); click(map); click(map, -45); await resolve(1);
    if (oldResult === 'success') await resolve(0, response('OBSOLETE', { risk_level: 'alto' })); else await reject(0);
    fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
    assert.match(text(view), /CURRENT_REPORT/); assert.doesNotMatch(text(view), /OBSOLETE|Falha na analise/);
    assert.deepEqual(lastCenter(), [-45, -23]); assert.equal(color(map), '#16a34a');
  });
}
for (const selection of ['click', 'geocoder'] as const) {
  test(`late geolocation cannot overwrite manual ${selection}`, async () => {
    const { map, geocoder } = mount();
    if (selection === 'click') click(map, -45); else act(() => geocoder.emit('result', { result: { center: [-45, -23] } }));
    const flights = map.flights.length;
    await locate();
    assert.equal(requests.length, 1); assert.equal(map.flights.length, flights); assert.deepEqual(lastCenter(), [-45, -23]);
  });
}
test('initial geolocation still selects and analyzes automatically when no manual choice exists', async () => {
  const { map } = mount(); await locate(); assert.equal(requests.length, 1); assert.deepEqual(lastCenter(), [-40, -10]);
  assert.deepEqual(map.flights.at(-1).center, [-40, -10]);
});
for (const result of ['success', 'loading', 'error'] as const) {
  test(`delayed style.load uses current center and ${result} state`, async () => {
    const { view, map } = mount(); click(map); await resolve(0);
    state.theme = 'dark'; view.rerender(<GeoRiskMap />);
    click(map, -44, -22);
    if (result === 'success') await resolve(1, response('NEW_REPORT', { risk_level: 'alto' }));
    if (result === 'error') await reject(1);
    map.loaded = true; act(() => map.emit('style.load'));
    assertAnalysis(map, 1, [-44, -22], { success: '#dc2626', loading: '#0284c7', error: '#dc2626' }[result]);
  });
}
test('replacing a pending style removes the old callback and rehydrates only the current style', async () => {
  const { view, map } = mount(); click(map);
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  const obsoleteCallback = map.callbacks('style.load')[0];
  state.theme = 'light'; view.rerender(<GeoRiskMap />);
  assert.equal(map.callbacks('style.load').length, 1);
  click(map, -42, -21); await resolve(1, response('REPLACED_STYLE', { risk_level: 'medio' }));
  map.loaded = true;
  act(() => obsoleteCallback());
  assert.equal(map.getSource('analysis-circle'), undefined, 'cancelled callback must not recreate layers');
  act(() => map.emit('style.load'));
  assert.equal(map.callbacks('style.load').length, 0);
  assertAnalysis(map, 1, [-42, -21], '#d97706');
});

for (const selection of ['click', 'geocoder'] as const) {
  test(`style.load before React flush uses the new ${selection} and loading state`, async () => {
    const { view, map, geocoder } = mount(); click(map); await resolve(0);
    state.theme = 'dark'; view.rerender(<GeoRiskMap />);
    act(() => {
      if (selection === 'click') map.emit('click', { lngLat: { lng: -44, lat: -22 } });
      else geocoder.emit('result', { result: { center: [-44, -22] } });
      assert.match(text(view), /Baixo risco/, 'React has not rendered the new selection yet');
      map.loaded = true; map.emit('style.load');
      assertAnalysis(map, 1, [-44, -22], '#0284c7');
    });
    assertAnalysis(map, 1, [-44, -22], '#0284c7');
    state.theme = 'light'; view.rerender(<GeoRiskMap />);
    map.loaded = true; act(() => map.emit('style.load'));
    assertAnalysis(map, 1, [-44, -22], '#0284c7');
  });
}

for (const outcome of ['success', 'error'] as const) {
  test(`style.load after ${outcome} but before React flush uses the settled result`, async () => {
    const { view, map } = mount(); click(map); await resolve(0);
    state.theme = 'dark'; view.rerender(<GeoRiskMap />); click(map, -44, -22);
    await act(async () => {
      if (outcome === 'success') requests[1].resolve(new Response(JSON.stringify(response('NEW_REPORT', { risk_level: 'medio' }))));
      else requests[1].reject(new Error('SECRET_UPSTREAM'));
      // Drain the real fetch/JSON/client promise chain while act holds React's commit.
      await setImmediate();
      assert.match(text(view), /Analisando/, 'React has not rendered the settled response yet');
      map.loaded = true; map.emit('style.load');
      assertAnalysis(map, 1, [-44, -22], outcome === 'success' ? '#d97706' : '#dc2626');
    });
    assertAnalysis(map, 1, [-44, -22], outcome === 'success' ? '#d97706' : '#dc2626');
  });
}
test('delayed style.load respects the latest 3D toggle without adding controls', () => {
  const { view, map } = mount();
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  const beforeToggle = map.terrain.length;
  fireEvent.click(view.getByRole('button', { name: 'Desativar modo 3D do mapa' }));
  const terrainCalls = map.terrain.length;
  assert.equal(terrainCalls, beforeToggle, 'unready style must not be mutated');
  map.loaded = true; act(() => map.emit('style.load'));
  assert.equal(map.terrain.length, terrainCalls + 1); assert.equal(map.terrain.at(-1), null);
  assert.equal(view.queryByRole('slider'), null); assert.equal(view.queryByRole('spinbutton'), null);
});

test('style.load before React flush respects the new 3D toggle', () => {
  const { view, map } = mount();
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  const beforeToggle = map.terrain.length;
  act(() => {
    view.getByRole('button', { name: 'Desativar modo 3D do mapa' }).click();
    assert.ok(view.getByRole('button', { name: 'Desativar modo 3D do mapa' }), 'toggle has not rendered yet');
    const calls = map.terrain.length;
    assert.equal(calls, beforeToggle, 'unready style must not be mutated');
    map.loaded = true; map.emit('style.load');
    assert.equal(map.terrain.length, calls + 1, 'style callback must apply the queued disable exactly once');
    assert.equal(map.terrain.at(-1), null);
  });
});

test('queued geolocation error after unmount performs zero SDK operations', async () => {
  const { view, map } = mount(); const callback = state.locationError; assert.ok(callback);
  view.unmount();
  await act(async () => callback({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }));
  assert.equal(map.operationsAfterRemove, 0); assert.equal(requests.length, 0);
});
test('late geolocation error after a manual choice cannot add a location failure', async () => {
  const { view, map } = mount(); click(map); await resolve(0);
  const callback = state.locationError; assert.ok(callback);
  await act(async () => callback({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3 }));
  assert.doesNotMatch(text(view), /Permissao|Localizando/); assert.match(text(view), /Baixo risco/);
});
test('invalid API data fails safely in the real mounted component with no old report', async () => {
  const { view, map } = mount(); click(map); await resolve(0, response('OLD_REPORT'));
  click(map, -43);
  await act(async () => requests[1].resolve(new Response('{"rio_mais_proximo":null,"resposta_ia":{"secret":"PRIVATE"}}')));
  fireEvent.click(view.getByRole('button', { name: 'Analise Completa' }));
  assert.match(view.baseElement.textContent ?? '', /Resposta da análise inválida/);
  assert.doesNotMatch(view.baseElement.textContent ?? '', /OLD_REPORT|PRIVATE/);
});
test('React StrictMode cleanup leaves one live map and initial location analysis still works', async () => {
  const view = render(<React.StrictMode><GeoRiskMap /></React.StrictMode>);
  assert.equal(state.maps.length, 2); assert.ok(state.maps[0].removed);
  assert.equal(state.maps[0].callbacks('load').length, 0);
  const map = state.maps[1]; act(() => map.emit('load')); await locate();
  assert.equal(requests.length, 1); await resolve(0); assert.match(text(view), /Baixo risco/);
});
test('late request rejection after unmount does not redraw or leave SDK callbacks', async () => {
  const { view, map } = mount(); click(map); view.unmount();
  const paintCount = map.paints.length; await reject(0); assert.equal(map.paints.length, paintCount);
  assert.equal(map.operationsAfterRemove, 0);
});
test('cleanup removes callbacks, marker and control; queued callbacks and requests cannot touch disposed map', async () => {
  const { view, map, geocoder } = mount(); click(map);
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  const queued = [...map.callbacks('load'), ...map.callbacks('style.load')];
  const clickCallback = map.callbacks('click')[0]; const geocoderCallback = geocoder.callbacks('result')[0];
  view.unmount();
  for (const event of ['load', 'click', 'style.load']) assert.equal(map.callbacks(event).length, 0, event);
  assert.equal(geocoder.callbacks('result').length, 0); assert.equal(map.control, null);
  assert.ok(map.removed); assert.ok(state.markers.every((marker: { removed: boolean }) => marker.removed));
  await act(async () => {
    queued.forEach(callback => callback()); clickCallback({ lngLat: { lng: 1, lat: 2 } });
    geocoderCallback({ result: { center: [1, 2] } });
  });
  await locate(); await resolve(0); assert.equal(requests.length, 1);
  assert.equal(map.operationsAfterRemove, 0);
});
test('unmount before load prevents queued load from creating controls or geolocation', () => {
  const view = render(<GeoRiskMap />); const map = state.maps[0]; const queued = map.callbacks('load')[0];
  view.unmount(); act(() => queued()); assert.equal(state.geocoders.length, 0); assert.equal(state.locate, null);
  assert.equal(map.operationsAfterRemove, 0);
});

test('initial map failure offers shared responsive retry, reloads the SDK and ignores disposed callbacks', () => {
  const view = render(<GeoRiskMap />); const first = state.maps[0];
  const oldLoad = first.callbacks('load')[0];
  act(() => first.emit('error', { error: new Error('PRIVATE_STYLE_URL_TOKEN') }));
  assert.match(view.getByRole('alert').textContent ?? '', /Não foi possível carregar o mapa/);
  assert.doesNotMatch(text(view), /PRIVATE_STYLE|Clique no mapa|Aguardando ponto/);
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  const next = state.maps.at(-1); assert.ok(next); assert.notEqual(next, first); assert.ok(first.removed);
  assert.match(text(view), /Carregando mapa/); assert.equal(view.queryByRole('alert'), null);
  act(() => oldLoad()); assert.equal(state.geocoders.length, 0);
  act(() => next.emit('load'));
  assert.equal(view.queryByRole('alert'), null); assert.doesNotMatch(text(view), /Carregando mapa/);
  click(next); assert.equal(requests.length, 1);
});

test('constructor failure is contained without SDK details and retry creates a map', async () => {
  state.failConstruction = true;
  const view = render(<GeoRiskMap />);
  await act(async () => {});
  assert.match(view.getByRole('alert').textContent ?? '', /Não foi possível carregar o mapa/);
  assert.doesNotMatch(text(view), /PRIVATE_SDK_FAILURE/);
  state.failConstruction = false;
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  assert.equal(state.maps.length, 1); act(() => state.maps[0].emit('load'));
  assert.equal(view.queryByRole('alert'), null);
});

test('3D preference before initial load does not mutate an unready style', () => {
  const view = render(<GeoRiskMap />); const map = state.maps[0];
  fireEvent.click(view.getByRole('button', { name: 'Desativar modo 3D do mapa' }));
  assert.equal(map.operationsBeforeStyle, 0); assert.equal(map.terrain.length, 0);
  act(() => map.emit('load'));
  assert.equal(map.getLayer('3d-buildings'), undefined);
  assert.equal(map.terrain.at(-1), null, 'queued initial 2D preference must be applied when ready');
  fireEvent.click(view.getByRole('button', { name: 'Ativar modo 3D do mapa' }));
  assert.ok(map.getLayer('3d-buildings')); assert.equal(map.operationsBeforeStyle, 0);
});

test('optional tile failure on a usable map keeps selection and analysis available', async () => {
  const { view, map } = mount(); click(map); await resolve(0);
  map.loaded = false; // SDK isStyleLoaded can be false while optional sources are pending.
  act(() => map.emit('error', { sourceId: 'mapbox-dem', tile: {}, error: new Error('OPTIONAL_TILE') }));
  assert.equal(view.queryByRole('alert'), null); assert.match(text(view), /Baixo risco/);
  click(map, -44); assert.equal(requests.length, 2);
});

test('failed theme style invalidates pending analysis; retry preserves selection and rejects late callbacks', async () => {
  const { view, map, geocoder } = mount(); click(map, -44, -22);
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  const lateStyle = map.callbacks('style.load')[0];
  const lateGeocoder = geocoder.callbacks('result')[0];
  act(() => map.emit('error', { error: new Error('PRIVATE_STYLE') }));
  assert.ok(view.getByRole('alert'));
  await resolve(0, response('OBSOLETE_AFTER_FAILURE'));
  assert.doesNotMatch(text(view), /OBSOLETE_AFTER_FAILURE|Baixo risco/);
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  const next = state.maps.at(-1); assert.ok(next); assert.notEqual(next, map);
  act(() => { lateStyle(); lateGeocoder({ result: { center: [1, 2] } }); });
  assert.equal(requests.length, 1);
  act(() => next.emit('load'));
  assert.equal(next.options.style, 'mapbox://styles/mapbox/dark-v11');
  assert.deepEqual(next.options.center, [-44, -22]);
  assert.equal(requests.length, 2); await resolve(1, response('RECOVERED_REPORT'));
  fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
  assert.match(text(view), /RECOVERED_REPORT/); assert.doesNotMatch(text(view), /OBSOLETE_AFTER_FAILURE/);
});

test('retry rejects queued load even before React flush and removes error listeners on cleanup', () => {
  const view = render(<GeoRiskMap />); const map = state.maps[0];
  const queuedLoad = map.callbacks('load')[0]; const queuedError = map.callbacks('error')[0];
  act(() => map.emit('error', { error: new Error('STYLE_FAILURE') }));
  act(() => {
    view.getByRole('button', { name: 'Tentar novamente' }).click();
    queuedLoad(); queuedError({ error: new Error('LATE_ERROR') });
    assert.equal(state.geocoders.length, 0, 'old map must not recover during retry');
  });
  const next = state.maps.at(-1); assert.ok(next);
  assert.match(text(view), /Carregando mapa/); assert.equal(map.callbacks('error').length, 0);
  const lateError = next.callbacks('error')[0]; view.unmount();
  act(() => lateError({ error: new Error('AFTER_UNMOUNT') }));
  assert.equal(next.callbacks('error').length, 0);
});

test('late analysis rejection and geolocation cannot affect failed or recovered map', async () => {
  const { view, map } = mount(); click(map);
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  act(() => map.emit('error', { error: new Error('STYLE_FAILURE') }));
  await locate(); await reject(0);
  assert.match(text(view), /Mapa indisponível/); assert.doesNotMatch(text(view), /Falha na analise|Localizando/);
  const count = requests.length;
  click(map); assert.equal(requests.length, count);
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  const next = state.maps.at(-1); assert.ok(next); act(() => next.emit('load'));
  assert.equal(requests.length, count + 1); assert.deepEqual(lastCenter(), [-46, -23]);
});

test('style document load restores layers even while optional tiles are still loading', async () => {
  const { view, map } = mount(); click(map); await resolve(0);
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  assert.equal(map.isStyleLoaded(), false);
  act(() => map.emit('style.load'));
  assertAnalysis(map, 0, [-46, -23], '#16a34a');
  assert.ok(map.getLayer('3d-buildings')); assert.doesNotMatch(text(view), /Carregando mapa/);
});

test('synchronous style replacement failure uses the same recoverable notice', async () => {
  const { view, map } = mount();
  map.setStyle = () => { throw new Error('PRIVATE_STYLE_EXCEPTION'); };
  state.theme = 'dark'; view.rerender(<GeoRiskMap />);
  await act(async () => {});
  assert.match(view.getByRole('alert').textContent ?? '', /Não foi possível carregar o mapa/);
  assert.doesNotMatch(text(view), /PRIVATE_STYLE_EXCEPTION/);
  fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
  const next = state.maps.at(-1); assert.ok(next); act(() => next.emit('load'));
  assert.equal(view.queryByRole('alert'), null);
});

test('missing map configuration shows safe copy without environment details or impossible instructions', () => {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  try {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    delete loadModule.cache[loadModule.resolve('../components/ui/GeoRiskMap')];
    const UnconfiguredMap = loadModule('../components/ui/GeoRiskMap').default;
    const view = render(<UnconfiguredMap />);
    assert.ok(view.getByRole('alert')); assert.equal(state.maps.length, 0);
    assert.doesNotMatch(text(view), /NEXT_PUBLIC|\.env|TOKEN|Clique no mapa|Aguardando ponto/);
    fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
    assert.ok(view.getByRole('alert')); assert.equal(state.maps.length, 0);
  } finally {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = token;
  }
});

for (const phase of ['initial', 'theme'] as const) {
  test(`${phase} load timeout offers retry; old timers cannot fail a replacement or recovered map`, (t) => {
    const timers: Array<() => void> = [];
    const cleared: number[] = [];
    const schedule = window.setTimeout.bind(window); const cancel = window.clearTimeout.bind(window);
    t.mock.method(window, 'setTimeout', (callback: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 20000) { assert.equal(typeof callback, 'function'); timers.push(callback as () => void); return -timers.length; }
      return schedule(callback, ms, ...args);
    });
    t.mock.method(window, 'clearTimeout', (id: number) => { cleared.push(id); cancel(id); });
    const view = render(<GeoRiskMap />); const map = state.maps[0];
    if (phase === 'theme') {
      act(() => map.emit('load'));
      state.theme = 'dark'; view.rerender(<GeoRiskMap />);
    }
    act(() => timers.at(-1)?.()); assert.ok(view.getByRole('alert'));
    const oldTimers = [...timers];
    fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
    act(() => oldTimers.forEach(callback => callback()));
    assert.equal(view.queryByRole('alert'), null); assert.match(text(view), /Carregando mapa/);
    const next = state.maps.at(-1); assert.ok(next); act(() => next.emit('load'));
    act(() => timers.forEach(callback => callback())); assert.equal(view.queryByRole('alert'), null);
    assert.ok(cleared.includes(-timers.length), 'recovered map cancels its timeout');
    view.unmount(); act(() => timers.forEach(callback => callback()));
  });
}

for (const outcome of ['success', 'error'] as const) {
  test(`obsolete analysis ${outcome} after retry cannot replace the recovered report`, async () => {
    const { view, map } = mount(); click(map);
    state.theme = 'dark'; view.rerender(<GeoRiskMap />);
    act(() => map.emit('error', { error: new Error('STYLE_FAILURE') }));
    fireEvent.click(view.getByRole('button', { name: 'Tentar novamente' }));
    const next = state.maps.at(-1); assert.ok(next); act(() => next.emit('load'));
    await resolve(1, response('RECOVERED_CURRENT'));
    if (outcome === 'success') await resolve(0, response('OBSOLETE_MAP_REPORT', { risk_level: 'alto' }));
    else await reject(0);
    fireEvent.click(view.getByRole('button', { name: /Ver analise/i }));
    assert.match(text(view), /RECOVERED_CURRENT/);
    assert.doesNotMatch(text(view), /OBSOLETE_MAP_REPORT|Falha na analise|Analisando/);
    assert.equal(color(next), '#16a34a'); assert.equal(map.operationsAfterRemove, 0);
  });
}
