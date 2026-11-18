import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { Polygon } from 'geojson';
import { isRiskResponse, postRiskPolygon, postRiskByCenterRadius } from '../lib/api';

const messages = {
  config: 'Serviço de análise indisponível. Tente novamente mais tarde.',
  input: 'Área de análise inválida. Revise a seleção.',
  response: 'Resposta da análise inválida. Tente novamente mais tarde.',
  network: 'Não foi possível conectar ao serviço de análise. Tente novamente mais tarde.',
  generic: 'Não foi possível concluir a análise. Tente novamente mais tarde.',
};
const minimal = { distancia_rio_m: 0, queda_relativa_m: null, rio_mais_proximo: 'Rio de teste', resposta_ia: 'Parecer de teste.', risk_level: 'baixo' };
const complete = {
  ...minimal, queda_relativa_m: -8, tipo_hidrografia: 'river',
  risk_calculation: { confidence: 1, total_score: 0.5,
    component_scores: { topography: 0.5, water_frequency: 0, soil_permeability: 1 },
    weights_applied: { topography: 0.5, water_frequency: 0.3, soil_permeability: 0.2 } },
  environmental_data: { soil: { class_id: null, class_name: 'Teste', is_permeable: false },
    water_frequency: { years: 0, confidence: 1 }, data_source: 'Teste local', provider_status: 'available' },
  debug_coords: { rio_lat: -23, rio_lon: -46 },
};
const polygon: Polygon = { type: 'Polygon', coordinates: [[[-46,-23],[-46.001,-23],[-46,-23.001],[-46,-23]]] };
const center = { lat: -23, lng: -46, radiusMeters: 100 };
let calls: Array<{ url: string; init?: RequestInit }>;
let reply: () => Promise<Response>;
beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://analysis.example.test';
  delete process.env.NEXT_PUBLIC_API_RISK_ENDPOINT;
  calls = [];
  reply = async () => new Response(JSON.stringify(minimal));
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({url, init});
    return reply();
  });
});
afterEach(() => { mock.restoreAll(); });
// JSON supports numeric overflow (1e400), unlike the Infinity literal.
const succeedsWith = (value: unknown) => { reply = async () => new Response(JSON.stringify(value, (_key, item) => item === Infinity ? '__overflow__' : item).replaceAll('"__overflow__"', '1e400')); };
const rejects = async (message: string, request = () => postRiskPolygon(polygon)) => {
  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, message);
    return true;
  });
};

for (const [name, value] of Object.entries({ minimal, complete, zero: {...minimal, queda_relativa_m: 0} })) {
  test(`accepts original ${name} response unchanged without envelope`, async () => {
    succeedsWith(value);
    assert.deepEqual(await postRiskPolygon(polygon), value);
  });
}
test('sends Polygon from Feature without properties and normalizes /docs/', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = ' https://analysis.example.test/api/docs/ ';
  process.env.NEXT_PUBLIC_API_RISK_ENDPOINT = 'geo/risk';
  await postRiskPolygon({ type: 'Feature', geometry: polygon, properties: {private: 'not sent'} });
  assert.equal(calls[0].url, 'https://analysis.example.test/api/geo/risk');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {polygon});
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(calls[0].init?.headers, {'Content-Type': 'application/json'});
  assert.equal(calls[0].init?.cache, 'no-store');
});
test('center/radius keeps real Turf 64 steps and meters-to-km conversion', async () => {
  await postRiskByCenterRadius({lat: 0, lng: 0, radiusMeters: 1000});
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.polygon.type, 'Polygon');
  const ring = body.polygon.coordinates[0];
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], ring[64]);
  assert.ok(Math.abs(ring[0][1] - 0.00899320363724538) < 1e-10);
  assert.equal(ring[0][0], 0);
});
const polygon3D: Polygon = {
  type: 'Polygon', coordinates: [[[-46,-23,0],[-46.001,-23,8],[-46,-23.001,-8],[-46,-23,0]]],
};
for (const feature of [false, true]) {
  test(`preserves all 3D coordinates in ${feature ? 'Feature' : 'Polygon'} payload`, async () => {
    const input = feature ? {type: 'Feature' as const, geometry: polygon3D, properties: {label: 'not sent'}} : polygon3D;
    assert.deepEqual(await postRiskPolygon(input), minimal);
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {polygon: polygon3D});
  });
}
for (const z of [NaN, Infinity, -Infinity, null, '0', true, undefined]) {
  test(`rejects invalid Z=${String(z)} before fetch`, async () => {
    const input = structuredClone(polygon3D);
    input.coordinates[0][1][2] = z as number;
    await rejects(messages.input, () => postRiskPolygon(input));
    assert.equal(calls.length, 0);
  });
}
for (const closing of [[-46,-23,1], [-46,-23], [-46,-23,0,0]]) {
  test(`rejects incomplete 3D ring closure ${JSON.stringify(closing)}`, async () => {
    const input = structuredClone(polygon3D);
    input.coordinates[0][3] = closing;
    await rejects(messages.input, () => postRiskPolygon(input));
    assert.equal(calls.length, 0);
  });
}
test('rejects four-dimensional interior position before fetch', async () => {
  const input = structuredClone(polygon3D);
  input.coordinates[0][1].push(1);
  await rejects(messages.input, () => postRiskPolygon(input));
  assert.equal(calls.length, 0);
});
for (const base of [undefined, '', ' ', 'not-url', 'ftp://example.test', '//example.test', 'https://u:p@example.test', 'https://example.test?token=secret', 'https://example.test#secret', 'https://example.test/?', 'https://example.test/#', 'https:\\example.test', 'https://example.test/\npath']) {
  test(`rejects invalid base ${JSON.stringify(base)} before fetch`, async () => {
    if (base === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = base;
    await rejects(messages.config);
    assert.equal(calls.length, 0);
  });
}
for (const endpoint of ['https://evil.test/geo/risk', '//evil.test/risk', '\\evil.test', '/geo/risk#secret', '/geo/risk?token=secret', '../risk', '/geo/../risk', '/geo/%2e%2e/risk', '/geo/%2frisk', '/geo/\nrisk', '']) {
  test(`rejects invalid endpoint ${JSON.stringify(endpoint)} before fetch`, async () => {
    process.env.NEXT_PUBLIC_API_RISK_ENDPOINT = endpoint;
    await rejects(messages.config);
    assert.equal(calls.length, 0);
  });
}
for (const [field, values] of Object.entries({lat: [NaN, Infinity, -91, 91, '0', null], lng: [NaN, Infinity, -181, 181, '0', null], radiusMeters: [0, -1, NaN, Infinity, '100', null]})) {
  for (const value of values) test(`rejects invalid ${field}=${String(value)} before fetch`, async () => {
    await rejects(messages.input, () => postRiskByCenterRadius({...center, [field]: value} as typeof center));
    assert.equal(calls.length, 0);
  });
}
for (const invalid of [null, [], {type: 'Point', coordinates:[0,0]}, {type:'Polygon', coordinates:[]}, {type:'Feature', geometry:null}, {type:'Polygon', coordinates:[[[0,0],[1,0],[0,1]]]}]) {
  test(`rejects malformed geometry ${JSON.stringify(invalid)}`, async () => {
    await rejects(messages.input, () => postRiskPolygon(invalid as Polygon));
    assert.equal(calls.length, 0);
  });
}
const malformed: Array<[string, unknown]> = [
  ['null', null], ['array', []], ['envelope', {data:minimal}],
  ...['distancia_rio_m', 'queda_relativa_m', 'rio_mais_proximo', 'resposta_ia', 'risk_level'].map(key => {
    const value: Record<string, unknown> = {...minimal}; delete value[key]; return [`missing ${key}`, value] as [string, unknown];
  }),
  ...Object.entries({distancia_rio_m:['0', -1, null, false, NaN, Infinity], queda_relativa_m:['0', false, Infinity], rio_mais_proximo:[{}, null, ' '], resposta_ia:[{}, null, ' '], risk_level:[{}, null, ' ']}).flatMap(([key, values]) => values.map(value => [`bad ${key} ${String(value)}`, {...minimal, [key]:value}] as [string,unknown])),
  ['soil class_name', {...complete, environmental_data:{soil:{class_name:{bad:true}}}}],
  ['soil class_id', {...complete, environmental_data:{soil:{class_id:1.5}}}],
  ['soil boolean', {...complete, environmental_data:{soil:{is_permeable:0}}}],
  ['debug coords', {...complete, debug_coords:{rio_lat:'-23',rio_lon:-46}}],
  ['hydro type', {...complete, tipo_hidrografia:{}}],
  ...['risk_calculation','environmental_data'].flatMap(key => [null, [], 'text', 0].map(value => [`bad object ${key} ${String(value)}`, {...minimal,[key]:value}] as [string,unknown])),
  ...['component_scores','weights_applied'].flatMap(key => [null, [], {topography:'0'}, {water_frequency:Infinity}, {soil_permeability:false}].map(value => [`bad ${key} ${JSON.stringify(value)}`, {...minimal,risk_calculation:{[key]:value}}] as [string,unknown])),
  ...['soil','water_frequency'].flatMap(key => [null, [], 'text'].map(value => [`bad environmental ${key} ${String(value)}`, {...minimal,environmental_data:{[key]:value}}] as [string,unknown])),
  ...['data_source','provider_status'].map(key => [`bad ${key}`, {...minimal,environmental_data:{[key]:{}}}] as [string,unknown]),
  ['bad water years', {...minimal, environmental_data:{water_frequency:{years:'0'}}}],
  ['bad confidence', {...minimal, risk_calculation:{confidence:'1'}}],
  ['bad water confidence', {...minimal, environmental_data:{water_frequency:{confidence:false}}}],
  ['bad model version', {...minimal,risk_model_version:{}}],
];
for (const [label, value] of malformed) test(`rejects malformed success: ${label}`, async () => {
  succeedsWith(value);
  await rejects(messages.response);
});
const groups = [
  ['score_total','total_score','risk_score','score'],
  ['topografia_score','topography_score'], ['agua_score','water_score'], ['solo_score','soil_score'],
];
for (const names of groups) {
  for (const value of [0,0.5,50]) test(`accepts coherent aliases ${names.join('/')}=${value}`, async () => {
    const payload = {...minimal, ...Object.fromEntries(names.map((name,index) => [name,index === 0 && value === 50 ? 0.5 : value]))};
    succeedsWith(payload); assert.deepEqual(await postRiskPolygon(polygon),payload);
  });
  test(`rejects contradictory aliases ${names.join('/')}`, async () => {
    succeedsWith({...minimal,[names[0]]:0,[names[1]]:0.5}); await rejects(messages.response);
  });
  for (const name of names) for (const value of ['0',null,false,-1,101]) test(`rejects malformed alias ${name}=${String(value)}`, async () => {
    succeedsWith({...minimal,[name]:value}); await rejects(messages.response);
  });
}
test('accepts aliases consistent with nested original scores and zero water years', async () => {
  const payload = {...complete,score_total:50,topography_score:50,water_score:0,soil_score:100,water_frequency_years:0};
  succeedsWith(payload); assert.deepEqual(await postRiskPolygon(polygon),payload);
});
for (const field of ['score_total','topography_score','water_score','soil_score','water_frequency_years']) test(`rejects alias conflict with nested original ${field}`, async () => {
  succeedsWith({...complete,[field]:0.25}); await rejects(messages.response);
});
const safeCodes: Record<string,string> = {
  CONFIG_UNAVAILABLE: messages.config,
  DATA_UNAVAILABLE: 'Dados necessários à análise estão indisponíveis. Tente novamente mais tarde.',
  DATABASE_UNAVAILABLE: messages.generic,
  AI_UNAVAILABLE: 'Parecer técnico indisponível. Tente novamente mais tarde.',
};
for (const [code,message] of Object.entries(safeCodes)) test(`503 ${code} uses local fixed text`, async () => {
  reply = async () => new Response(JSON.stringify({detail:{code,message:'postgres://secret:token@private/traceback'}}),{status:503});
  await rejects(message);
});
for (const status of [422,503,500,401]) for (const body of ['<html>secret token postgres://dsn</html>', JSON.stringify({detail:{code:'UNKNOWN',message:'secret'}})]) test(`safe error ${status} with untrusted body ${body[0]}`, async () => {
  reply = async () => new Response(body,{status});
  await rejects(status === 422 ? messages.input : status === 503 ? messages.config : messages.generic);
});
test('does not trust error codes for an unrelated status', async () => {
  reply = async () => new Response(JSON.stringify({detail:{code:'AI_UNAVAILABLE'}}),{status:500});
  await rejects(messages.generic);
});
test('invalid JSON gives a fixed response message', async () => {
  reply = async () => new Response('<html>secret</html>'); await rejects(messages.response);
});
test('network exception gives a fixed message and does not log raw errors', async () => {
  const logger = mock.method(console,'error',() => {});
  reply = async () => {throw new Error('https://secret:token@private');};
  await rejects(messages.network); assert.equal(logger.mock.callCount(),0);
});
test('HTTP error does not log the response body', async () => {
  const logger = mock.method(console,'error',() => {});
  reply = async () => new Response('postgres://secret:token@private',{status:503});
  await rejects(messages.config); assert.equal(logger.mock.callCount(),0);
});

for (const field of ['distancia_rio_m','queda_relativa_m']) for (const value of [NaN,Infinity,-Infinity]) test(`guard rejects nonfinite ${field}=${String(value)} directly`, () => {
  assert.equal(isRiskResponse({...minimal,[field]:value}),false);
});
test('allows original optional strings to be empty without changing their type', async () => {
  const payload = {...minimal, tipo_hidrografia:'', risk_model_version:'', environmental_data:{soil:{class_name:''}, data_source:'',provider_status:''}};
  succeedsWith(payload); assert.deepEqual(await postRiskPolygon(polygon),payload);
});
for (const base of ['https:example.test','https:/example.test','https:///example.test']) test(`rejects ambiguous base ${base}`, async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = base;
  await rejects(messages.config); assert.equal(calls.length,0);
});
test('accepts an HTTP base with port and trailing slash', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://127.0.0.1:18090/';
  await postRiskPolygon(polygon);
  assert.equal(calls[0].url,'http://127.0.0.1:18090/geo/risk');
});
for (const code of ['__proto__','constructor','toString',{},null]) test(`503 rejects non-allowlisted code ${String(code)}`, async () => {
  reply = async () => new Response(JSON.stringify({detail:{code}}),{status:503});
  await rejects(messages.config);
});
for (const value of [null,[],{detail:null},{detail:[]},{detail:{}}]) test(`503 safely handles detail shape ${JSON.stringify(value)}`, async () => {
  reply = async () => new Response(JSON.stringify(value),{status:503});
  await rejects(messages.config);
});
for (const value of [NaN,Infinity,-Infinity,'0',null,false,{},[]]) test(`guard rejects malformed nested numeric ${String(value)}`, () => {
  assert.equal(isRiskResponse({...minimal,risk_calculation:{total_score:value}}),false);
  assert.equal(isRiskResponse({...minimal,risk_calculation:{confidence:value}}),false);
  assert.equal(isRiskResponse({...minimal,environmental_data:{water_frequency:{confidence:value,years:value}}}),false);
});
