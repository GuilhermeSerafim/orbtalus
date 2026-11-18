import type { Feature, Polygon } from "geojson";
import { circle as turfCircle } from "@turf/turf";

export type RiskLevel = "baixo" | "medio" | "alto";

type FactorScores = {
  topography?: number;
  water_frequency?: number;
  soil_permeability?: number;
};
export type RiskCalculation = {
  confidence?: number;
  total_score?: number;
  component_scores?: FactorScores;
  weights_applied?: FactorScores;
};
export type EnvironmentalData = {
  soil?: { class_id?: number | null; class_name?: string; is_permeable?: boolean };
  water_frequency?: { years?: number; confidence?: number };
  data_source?: string;
  provider_status?: string;
};
export type RiskResponse = {
  distancia_rio_m: number;
  queda_relativa_m: number | null;
  rio_mais_proximo: string;
  resposta_ia: string;
  risk_level: RiskLevel | string;
  tipo_hidrografia?: string;
  debug_coords?: { rio_lat: number; rio_lon: number };
  score_total?: number;
  total_score?: number;
  risk_score?: number;
  score?: number;
  topografia_score?: number;
  topography_score?: number;
  agua_score?: number;
  water_score?: number;
  solo_score?: number;
  soil_score?: number;
  water_frequency_years?: number;
  risk_model_version?: string;
  risk_calculation?: RiskCalculation;
  environmental_data?: EnvironmentalData;
};

// Only local copy is shown to the user; never reflect URLs or upstream text.
const MESSAGES = {
  config: "Serviço de análise indisponível. Tente novamente mais tarde.",
  input: "Área de análise inválida. Revise a seleção.",
  response: "Resposta da análise inválida. Tente novamente mais tarde.",
  network: "Não foi possível conectar ao serviço de análise. Tente novamente mais tarde.",
  generic: "Não foi possível concluir a análise. Tente novamente mais tarde.",
};
const UNAVAILABLE_MESSAGES: Record<string, string> = {
  CONFIG_UNAVAILABLE: MESSAGES.config,
  DATA_UNAVAILABLE: "Dados necessários à análise estão indisponíveis. Tente novamente mais tarde.",
  DATABASE_UNAVAILABLE: MESSAGES.generic,
  AI_UNAVAILABLE: "Parecer técnico indisponível. Tente novamente mais tarde.",
};

type RecordValue = Record<string, unknown>;
type Validator = (value: unknown) => boolean;
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegative: Validator = value => finite(value) && value >= 0;
const string: Validator = value => typeof value === "string";
const text: Validator = value => typeof value === "string" && value.trim().length > 0;
const score: Validator = value => finite(value) && value >= 0 && value <= 100;
const fraction: Validator = value => finite(value) && value >= 0 && value <= 1;
const latitude: Validator = value => finite(value) && Math.abs(value) <= 90;
const longitude: Validator = value => finite(value) && Math.abs(value) <= 180;
const optional = (value: RecordValue, fields: Record<string, Validator>) =>
  Object.entries(fields).every(([key, validate]) => !(key in value) || validate(value[key]));
const nested = (fields: Record<string, Validator>): Validator => value => record(value) && optional(value, fields);
const factorFields = (validate: Validator) => ({topography: validate, water_frequency: validate, soil_permeability: validate});
const aliasGroups = [
  ["score_total", "total_score", "risk_score", "score"],
  ["topografia_score", "topography_score"],
  ["agua_score", "water_score"],
  ["solo_score", "soil_score"],
];
const normalizeScore = (value: number) => value <= 1 ? value : value / 100;
function agree(values: Array<number | undefined>, normalize = (value: number) => value) {
  const present = values.filter((value): value is number => value !== undefined).map(normalize);
  return present.every(value => Math.abs(value - present[0]) <= 1e-9);
}

export function isRiskResponse(value: unknown): value is RiskResponse {
  if (!record(value) || !nonnegative(value.distancia_rio_m) ||
      !(value.queda_relativa_m === null || finite(value.queda_relativa_m)) ||
      !text(value.rio_mais_proximo) || !text(value.resposta_ia) || !text(value.risk_level)) return false;
  if (!optional(value, {
    ...Object.fromEntries(aliasGroups.flat().map(key => [key, score])),
    tipo_hidrografia: string,
    risk_model_version: string,
    water_frequency_years: nonnegative,
    debug_coords: coords => record(coords) && latitude(coords.rio_lat) && longitude(coords.rio_lon),
    risk_calculation: nested({confidence: fraction, total_score: score,
      component_scores: nested(factorFields(score)), weights_applied: nested(factorFields(fraction))}),
    environmental_data: nested({
      soil: nested({class_id: id => id === null || (finite(id) && Number.isInteger(id)),
        class_name: string, is_permeable: flag => typeof flag === "boolean"}),
      water_frequency: nested({years: nonnegative, confidence: fraction}),
      data_source: string, provider_status: string,
    }),
  })) return false;
  // All known fields are validated before this projection. Preserve original values.
  const data = value as RiskResponse;
  const components = data.risk_calculation?.component_scores;
  const originalScores = [data.risk_calculation?.total_score, components?.topography,
    components?.water_frequency, components?.soil_permeability];
  return aliasGroups.every((group, index) => agree(
    [...group.map(key => value[key] as number | undefined), originalScores[index]], normalizeScore,
  )) && agree([data.water_frequency_years, data.environmental_data?.water_frequency?.years]);
}

function riskUrl(): string {
  try {
    const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    const rawEndpoint = process.env.NEXT_PUBLIC_API_RISK_ENDPOINT ?? "/geo/risk";
    if (!rawBase || !/^https?:\/\/[^/]/i.test(rawBase.trim()) || /[\u0000-\u001f\u007f\\?#]/.test(rawBase) ||
        /[\s\\?#]/.test(rawEndpoint) || !rawEndpoint || rawEndpoint.startsWith("//")) throw new Error();
    const base = new URL(rawBase.trim());
    if (!/^https?:$/.test(base.protocol) || !base.hostname || base.username || base.password) throw new Error();
    const endpoint = rawEndpoint.startsWith("/") ? rawEndpoint : `/${rawEndpoint}`;
    for (const segment of endpoint.slice(1).split("/")) {
      const decoded = decodeURIComponent(segment);
      if (decoded === "." || decoded === ".." || /[\s\u0000-\u001f\u007f/:\\?#%]/.test(decoded)) throw new Error();
    }
    const path = base.pathname.replace(/\/+$/, "").replace(/\/docs$/, "");
    return `${base.origin}${path}${endpoint}`;
  } catch {
    throw new Error(MESSAGES.config);
  }
}

function polygonGeometry(value: unknown): Polygon {
  const geometry = record(value) && value.type === "Feature" ? value.geometry : value;
  if (!record(geometry) || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length === 0 || !geometry.coordinates.every(ring => {
        if (!Array.isArray(ring) || ring.length < 4 || !ring.every(point =>
          Array.isArray(point) && (point.length === 2 || point.length === 3) &&
          longitude(point[0]) && latitude(point[1]) && (point.length === 2 || finite(point[2])))) return false;
        const first = ring[0]; const last = ring[ring.length - 1];
        if (first.length !== last.length || !first.every((coordinate: unknown, index: number) => coordinate === last[index])) return false;
        const area = ring.slice(1).reduce((sum, point, index) => sum +
          ring[index][0] * point[1] - point[0] * ring[index][1], 0);
        return area !== 0;
      })) throw new Error(MESSAGES.input);
  return geometry as unknown as Polygon;
}

export async function postRiskPolygon(polygon: Polygon | Feature<Polygon>): Promise<RiskResponse> {
  const url = riskUrl();
  const geometry = polygonGeometry(polygon);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST", headers: {"Content-Type": "application/json"}, cache: "no-store",
      body: JSON.stringify({polygon: geometry}),
    });
  } catch {
    throw new Error(MESSAGES.network);
  }
  if (!res.ok) {
    if (res.status === 422) throw new Error(MESSAGES.input);
    if (res.status === 503) {
      const body: unknown = await res.json().catch(() => null);
      const code = record(body) && record(body.detail) ? body.detail.code : undefined;
      const message = typeof code === "string" && Object.hasOwn(UNAVAILABLE_MESSAGES, code)
        ? UNAVAILABLE_MESSAGES[code] : MESSAGES.config;
      throw new Error(message);
    }
    throw new Error(MESSAGES.generic);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!isRiskResponse(data)) throw new Error(MESSAGES.response);
  return data;
}

export async function postRiskByCenterRadius(params: {
  lat: number; lng: number; radiusMeters: number;
}): Promise<RiskResponse> {
  if (!params || !latitude(params.lat) || !longitude(params.lng) ||
      !finite(params.radiusMeters) || params.radiusMeters <= 0) throw new Error(MESSAGES.input);
  const circleFeature = turfCircle([params.lng, params.lat], params.radiusMeters / 1000, {
    steps: 64, units: "kilometers",
  });
  return postRiskPolygon(circleFeature.geometry);
}
