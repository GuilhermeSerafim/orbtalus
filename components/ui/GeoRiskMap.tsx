"use client"

import mapboxgl, * as MapboxGL from "mapbox-gl"
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder"
import * as turf from "@turf/turf"
import {
  Box,
  Droplets,
  Eye,
  Layers,
  Loader2,
  Minimize2,
  Mountain,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Waves,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import ReactMarkdown from "react-markdown"
import type { Feature, Polygon } from "geojson"

import { postRiskByCenterRadius, type RiskLevel, type RiskResponse } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
const DEFAULT_CENTER = { lng: -51.9253, lat: -14.235 }
const DEFAULT_RADIUS = 100
const MAX_RADIUS = 4000
const MIN_RADIUS = 100
const DAY_MAP_STYLE = "mapbox://styles/mapbox/streets-v12"
const DARK_MAP_STYLE = "mapbox://styles/mapbox/dark-v11"
const MAP_LOAD_TIMEOUT_MS = 20000
const MAP_UNAVAILABLE_MESSAGE = "Não foi possível carregar o mapa. Verifique sua conexão e tente novamente."
const RISK_FACTOR_WEIGHTS = {
  topography: 0.5,
  water: 0.3,
  soil: 0.2,
} as const

if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN
}

type MapCenter = { lng: number; lat: number }

const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 0,
}
const USER_LOCATION_ZOOM = 16
const BRAZIL_OVERVIEW_ZOOM = 4.2
const AUTO_ANALYZE_DEDUP_WINDOW_MS = 4000
const subscribeToHydration = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

type InitialLocationResult = {
  center: MapCenter | null
  error: string | null
}

let initialLocationPromise: Promise<InitialLocationResult> | null = null
let cachedInitialLocationResult: InitialLocationResult | null = null
let lastAutoAnalyzeCenter: MapCenter | null = null
let lastAutoAnalyzeAt = 0

function getGeolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Permissao de localizacao negada. Exibindo o mapa no Brasil."
  }
  if (error.code === error.TIMEOUT) {
    return "Tempo limite ao buscar localizacao. Exibindo o mapa no Brasil."
  }
  return "Nao foi possivel obter sua localizacao. Exibindo o mapa no Brasil."
}

function getInitialUserLocation() {
  if (cachedInitialLocationResult) {
    return Promise.resolve(cachedInitialLocationResult)
  }
  if (initialLocationPromise) {
    return initialLocationPromise
  }
  if (typeof window === "undefined" || !("geolocation" in window.navigator)) {
    const unsupportedResult: InitialLocationResult = {
      center: null,
      error: "Geolocalizacao indisponivel no navegador. Exibindo o mapa no Brasil.",
    }
    cachedInitialLocationResult = unsupportedResult
    return Promise.resolve(unsupportedResult)
  }

  initialLocationPromise = new Promise<InitialLocationResult>((resolve) => {
    window.navigator.geolocation.getCurrentPosition(
      (position) => {
        const successResult: InitialLocationResult = {
          center: {
            lng: position.coords.longitude,
            lat: position.coords.latitude,
          },
          error: null,
        }
        cachedInitialLocationResult = successResult
        resolve(successResult)
      },
      (geoError) => {
        const errorResult: InitialLocationResult = {
          center: null,
          error: getGeolocationErrorMessage(geoError),
        }
        cachedInitialLocationResult = errorResult
        resolve(errorResult)
      },
      GEOLOCATION_OPTIONS
    )
  }).finally(() => {
    initialLocationPromise = null
  })

  return initialLocationPromise
}

function shouldAutoAnalyze(center: MapCenter) {
  const now = Date.now()
  const hasSameCenter =
    lastAutoAnalyzeCenter !== null &&
    Math.abs(lastAutoAnalyzeCenter.lng - center.lng) < 0.000001 &&
    Math.abs(lastAutoAnalyzeCenter.lat - center.lat) < 0.000001

  if (hasSameCenter && now - lastAutoAnalyzeAt < AUTO_ANALYZE_DEDUP_WINDOW_MS) {
    return false
  }

  lastAutoAnalyzeCenter = center
  lastAutoAnalyzeAt = now
  return true
}

type RiskDisplay = {
  label: string
  color: string
  badge: string
  pulse?: boolean
}

type FactorScoreAppearance = {
  label: string
  text: string
  badge: string
  fill: string
  panel: string
  indicator: string
}

type OverallRiskAppearance = {
  label: string
  badge: string
  text: string
  panel: string
  indicator: string
  icon: typeof Layers
  pulse?: boolean
}

function normalizeRiskLevel(level: string | undefined): RiskLevel | undefined {
  if (!level) return undefined

  const normalized = level
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  if (normalized.startsWith("ba") || normalized === "low") return "baixo"
  if (normalized.startsWith("me") || normalized === "medium") return "medio"
  if (normalized.startsWith("al") || normalized === "high") return "alto"

  return undefined
}

function deriveRiskLevel(level: string | undefined, totalScore: number | null): RiskLevel | undefined {
  const normalizedLevel = normalizeRiskLevel(level)
  if (normalizedLevel) return normalizedLevel
  const normalizedScore = normalizeScore(totalScore)
  if (normalizedScore === null) return undefined
  if (normalizedScore >= 0.7) return "alto"
  if (normalizedScore >= 0.4) return "medio"
  return "baixo"
}

function getMapStyle(theme: string | undefined) {
  return theme === "dark" ? DARK_MAP_STYLE : DAY_MAP_STYLE
}

function getRiskDisplay(params: {
  level: RiskLevel | undefined
  isLoading: boolean
  hasSelection: boolean
  hasError: boolean
}): RiskDisplay {
  if (params.isLoading) {
    return {
      label: "Analisando...",
      color: "#0284c7",
      badge:
        "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200",
      pulse: true,
    }
  }

  if (params.hasError) {
    return {
      label: "Falha na analise",
      color: "#dc2626",
      badge:
        "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/60 dark:text-red-200",
    }
  }

  if (!params.hasSelection) {
    return {
      label: "Aguardando ponto",
      color: "#0284c7",
      badge:
        "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200",
      pulse: true,
    }
  }

  switch (params.level) {
    case "baixo":
      return {
        label: "Baixo risco",
        color: "#16a34a",
        badge:
          "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950/60 dark:text-green-200",
      }
    case "medio":
      return {
        label: "Risco medio",
        color: "#d97706",
        badge:
          "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
      }
    case "alto":
      return {
        label: "Alto risco",
        color: "#dc2626",
        badge:
          "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/60 dark:text-red-200",
      }
    default:
      return {
        label: "Classificacao pendente",
        color: "#0284c7",
        badge:
          "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/60 dark:text-sky-200",
      }
  }
}

function pickNumber(...values: Array<number | undefined | null>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }
  return null
}

function normalizeScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null
  const normalized = score <= 1 ? score : score / 100
  return Math.min(1, Math.max(0, normalized))
}

function toPercentage(score: number | null | undefined) {
  const normalized = normalizeScore(score)
  if (normalized === null) return null
  return Math.round(normalized * 100)
}

function formatPercent(score: number | null | undefined) {
  const percentage = toPercentage(score)
  if (percentage === null) return "-"
  return `${percentage}%`
}

function formatDistance(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A"
  return `${value.toFixed(1)} m`
}

function formatElevation(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A"
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} m`
}

function getRiskWidgetTone(isDarkMode: boolean) {
  if (isDarkMode) {
    return {
      shell:
        "border-slate-800 bg-[#111827] text-slate-50 shadow-[0_18px_50px_rgba(2,6,23,0.42)]",
      title: "text-slate-50",
      description: "text-slate-400",
      summaryBase: "bg-gradient-to-br from-slate-950 via-slate-900 to-slate-900",
      eyebrow: "text-slate-400",
      copy: "text-slate-400",
      factorBase: "bg-slate-900/80 shadow-[inset_0_1px_0_rgba(148,163,184,0.04)]",
      factorTitle: "text-slate-100",
      factorSubtitle: "text-slate-400",
      impactBadge: "border-slate-700/80 bg-slate-950/80 text-slate-300",
      progressTrack: "bg-slate-800/90",
      progressLegend: "text-slate-500",
      divider: "border-slate-800/80",
      soilPermeable: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      soilImpermeable: "border-rose-400/20 bg-rose-400/10 text-rose-100",
      soilClass: "border-violet-400/20 bg-violet-400/10 text-violet-100",
    }
  }

  return {
    shell:
      "border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.08)]",
    title: "text-slate-900",
    description: "text-slate-500",
    summaryBase: "bg-gradient-to-br from-white via-slate-50 to-slate-100",
    eyebrow: "text-slate-500",
    copy: "text-slate-500",
    factorBase: "bg-white/95 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]",
    factorTitle: "text-slate-900",
    factorSubtitle: "text-slate-500",
    impactBadge: "border-slate-200 bg-slate-100/90 text-slate-600",
    progressTrack: "bg-slate-200/90",
    progressLegend: "text-slate-400",
    divider: "border-slate-200/80",
    soilPermeable: "border-emerald-200 bg-emerald-50 text-emerald-700",
    soilImpermeable: "border-rose-200 bg-rose-50 text-rose-700",
    soilClass: "border-violet-200 bg-violet-50 text-violet-700",
  }
}

function getFactorScoreAppearance(
  score: number | null | undefined,
  isDarkMode: boolean
): FactorScoreAppearance {
  const percentage = toPercentage(score)

  if (percentage === null) {
    return isDarkMode
      ? {
          label: "Aguardando leitura",
          text: "text-slate-200",
          badge: "border-slate-600/80 bg-slate-800/90 text-slate-300",
          fill: "from-slate-600 to-slate-500",
          panel: "border-slate-800 bg-slate-900/75",
          indicator: "border-slate-700/80 bg-slate-900/90 text-slate-300",
        }
      : {
          label: "Aguardando leitura",
          text: "text-slate-700",
          badge: "border-slate-300 bg-slate-100 text-slate-700",
          fill: "from-slate-400 to-slate-500",
          panel: "border-slate-200 bg-white",
          indicator: "border-slate-200 bg-slate-50 text-slate-600",
        }
  }

  if (percentage <= 30) {
    return isDarkMode
      ? {
          label: "Seguro",
          text: "text-emerald-300",
          badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100",
          fill: "from-emerald-500 via-emerald-400 to-emerald-300",
          panel: "border-emerald-400/15 bg-slate-900/75",
          indicator: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
        }
      : {
          label: "Seguro",
          text: "text-emerald-700",
          badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
          fill: "from-emerald-500 via-teal-400 to-emerald-300",
          panel: "border-emerald-100 bg-emerald-50/40",
          indicator: "border-emerald-200 bg-emerald-50 text-emerald-700",
        }
  }

  if (percentage <= 60) {
    return isDarkMode
      ? {
          label: "Atencao",
          text: "text-amber-300",
          badge: "border-amber-400/25 bg-amber-400/10 text-amber-100",
          fill: "from-amber-500 via-amber-400 to-amber-300",
          panel: "border-amber-400/15 bg-slate-900/75",
          indicator: "border-amber-400/20 bg-amber-400/10 text-amber-200",
        }
      : {
          label: "Atencao",
          text: "text-amber-700",
          badge: "border-amber-200 bg-amber-50 text-amber-700",
          fill: "from-amber-500 via-yellow-400 to-amber-300",
          panel: "border-amber-100 bg-amber-50/40",
          indicator: "border-amber-200 bg-amber-50 text-amber-700",
        }
  }

  return isDarkMode
    ? {
        label: "Critico",
        text: "text-rose-300",
        badge: "border-rose-400/25 bg-rose-400/10 text-rose-100",
        fill: "from-rose-600 via-red-500 to-orange-400",
        panel: "border-rose-400/15 bg-slate-900/75",
        indicator: "border-rose-400/20 bg-rose-400/10 text-rose-200",
      }
    : {
        label: "Critico",
        text: "text-rose-700",
        badge: "border-rose-200 bg-rose-50 text-rose-700",
        fill: "from-rose-500 via-red-500 to-orange-400",
        panel: "border-rose-100 bg-rose-50/40",
        indicator: "border-rose-200 bg-rose-50 text-rose-700",
      }
}

function getOverallRiskAppearance(params: {
  level: RiskLevel | undefined
  isLoading: boolean
  hasSelection: boolean
  hasError: boolean
  isDarkMode: boolean
}): OverallRiskAppearance {
  const display = getRiskDisplay(params)

  if (params.isLoading) {
    return params.isDarkMode
      ? {
          label: display.label,
          badge: display.badge,
          text: "text-sky-300",
          panel: "border-sky-400/15 bg-slate-900/75",
          indicator: "border-sky-400/20 bg-sky-400/10 text-sky-200",
          icon: Layers,
          pulse: true,
        }
      : {
          label: display.label,
          badge: display.badge,
          text: "text-sky-700",
          panel: "border-sky-100 bg-sky-50/40",
          indicator: "border-sky-200 bg-sky-50 text-sky-700",
          icon: Layers,
          pulse: true,
        }
  }

  if (params.hasError) {
    return params.isDarkMode
      ? {
          label: display.label,
          badge: display.badge,
          text: "text-rose-300",
          panel: "border-rose-400/15 bg-slate-900/75",
          indicator: "border-rose-400/20 bg-rose-400/10 text-rose-200",
          icon: ShieldAlert,
        }
      : {
          label: display.label,
          badge: display.badge,
          text: "text-rose-700",
          panel: "border-rose-100 bg-rose-50/40",
          indicator: "border-rose-200 bg-rose-50 text-rose-700",
          icon: ShieldAlert,
        }
  }

  if (!params.hasSelection) {
    return params.isDarkMode
      ? {
          label: display.label,
          badge: display.badge,
          text: "text-sky-300",
          panel: "border-sky-400/15 bg-slate-900/75",
          indicator: "border-sky-400/20 bg-sky-400/10 text-sky-200",
          icon: Layers,
          pulse: true,
        }
      : {
          label: display.label,
          badge: display.badge,
          text: "text-sky-700",
          panel: "border-sky-100 bg-sky-50/40",
          indicator: "border-sky-200 bg-sky-50 text-sky-700",
          icon: Layers,
          pulse: true,
        }
  }

  switch (params.level) {
    case "baixo":
      return params.isDarkMode
        ? {
            label: display.label,
            badge: display.badge,
            text: "text-emerald-300",
            panel: "border-emerald-400/15 bg-slate-900/75",
            indicator: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
            icon: ShieldCheck,
          }
        : {
            label: display.label,
            badge: display.badge,
            text: "text-emerald-700",
            panel: "border-emerald-100 bg-emerald-50/40",
            indicator: "border-emerald-200 bg-emerald-50 text-emerald-700",
            icon: ShieldCheck,
          }
    case "medio":
      return params.isDarkMode
        ? {
            label: display.label,
            badge: display.badge,
            text: "text-amber-300",
            panel: "border-amber-400/15 bg-slate-900/75",
            indicator: "border-amber-400/20 bg-amber-400/10 text-amber-200",
            icon: ShieldAlert,
          }
        : {
            label: display.label,
            badge: display.badge,
            text: "text-amber-700",
            panel: "border-amber-100 bg-amber-50/40",
            indicator: "border-amber-200 bg-amber-50 text-amber-700",
            icon: ShieldAlert,
          }
    case "alto":
      return params.isDarkMode
        ? {
            label: display.label,
            badge: display.badge,
            text: "text-rose-300",
            panel: "border-rose-400/15 bg-slate-900/75",
            indicator: "border-rose-400/20 bg-rose-400/10 text-rose-200",
            icon: ShieldAlert,
            pulse: true,
          }
        : {
            label: display.label,
            badge: display.badge,
            text: "text-rose-700",
            panel: "border-rose-100 bg-rose-50/40",
            indicator: "border-rose-200 bg-rose-50 text-rose-700",
            icon: ShieldAlert,
            pulse: true,
          }
    default:
      return params.isDarkMode
        ? {
            label: display.label,
            badge: display.badge,
            text: "text-slate-200",
            panel: "border-slate-800 bg-slate-900/75",
            indicator: "border-slate-700/80 bg-slate-900/90 text-slate-300",
            icon: Layers,
          }
        : {
            label: display.label,
            badge: display.badge,
            text: "text-slate-700",
            panel: "border-slate-200 bg-white",
            indicator: "border-slate-200 bg-slate-50 text-slate-600",
            icon: Layers,
          }
  }
}

function getTotalScore(data: RiskResponse | null | undefined) {
  const apiTotal = normalizeScore(
    pickNumber(
      data?.score_total,
      data?.total_score,
      data?.risk_score,
      data?.score,
      data?.risk_calculation?.total_score
    )
  )

  if (apiTotal !== null) {
    return apiTotal
  }

  const topography = normalizeScore(
    pickNumber(
      data?.topografia_score,
      data?.topography_score,
      data?.risk_calculation?.component_scores?.topography
    )
  )
  const water = normalizeScore(
    pickNumber(
      data?.agua_score,
      data?.water_score,
      data?.risk_calculation?.component_scores?.water_frequency
    )
  )
  const soil = normalizeScore(
    pickNumber(
      data?.solo_score,
      data?.soil_score,
      data?.risk_calculation?.component_scores?.soil_permeability
    )
  )

  if (topography === null || water === null || soil === null) {
    return null
  }

  return (
    topography * RISK_FACTOR_WEIGHTS.topography +
    water * RISK_FACTOR_WEIGHTS.water +
    soil * RISK_FACTOR_WEIGHTS.soil
  )
}

function parseRadius(inputValue: string) {
  const parsed = Number.parseInt(inputValue, 10)
  if (Number.isNaN(parsed)) {
    return MIN_RADIUS
  }
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, parsed))
}

export default function GeoRiskMap() {
  const { resolvedTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot)
  const effectiveResolvedTheme = mounted ? resolvedTheme : undefined
  const isDarkMode = effectiveResolvedTheme === "dark"
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const mapStyleRef = useRef<string>(DAY_MAP_STYLE)
  const cancelStyleLoadRef = useRef<(() => void) | null>(null)
  // style.load signals a usable style document; optional tiles can still be loading.
  const styleReadyRef = useRef(false)
  const mapStatusRef = useRef<"loading" | "ready" | "error">(MAPBOX_TOKEN ? "loading" : "error")
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(MAPBOX_TOKEN ? "loading" : "error")
  const [mapAttempt, setMapAttempt] = useState(0)
  const mapGenerationRef = useRef(0)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const radiusRef = useRef(DEFAULT_RADIUS)
  const latestRequestRef = useRef(0)
  const userInitialCenterRef = useRef<MapCenter | null>(cachedInitialLocationResult?.center ?? null)

  const [center, setCenter] = useState<MapCenter>(DEFAULT_CENTER)
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [riskData, setRiskData] = useState<RiskResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLocatingUser, setIsLocatingUser] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(cachedInitialLocationResult?.error ?? null)
  const [hasSelection, setHasSelection] = useState(false)
  const [is3DMode, setIs3DMode] = useState(true)
  const [isDesktopAnalysisOpen, setIsDesktopAnalysisOpen] = useState(false)

  const totalScore = getTotalScore(riskData)
  const normalizedRiskLevel = deriveRiskLevel(riskData?.risk_level, totalScore)
  const currentMapStateRef = useRef({ center, radius, requestedRadius: radius, normalizedRiskLevel, isLoading, hasSelection, error, is3DMode, effectiveResolvedTheme })
  // Preserve an existing selection when Fast Refresh re-runs effects.
  currentMapStateRef.current.requestedRadius ??= radius
  // SDK callbacks can run before React commits. Update this snapshot at each
  // transition; a passive render snapshot must never overwrite newer events.
  useEffect(() => {
    currentMapStateRef.current.effectiveResolvedTheme = effectiveResolvedTheme
  }, [effectiveResolvedTheme])
  const markMapUnavailable = useCallback(() => {
    mapStatusRef.current = "error"
    styleReadyRef.current = false
    latestRequestRef.current += 1
    Object.assign(currentMapStateRef.current, { normalizedRiskLevel: undefined, isLoading: false, error: null })
    setMapStatus("error")
    setRiskData(null)
    setError(null)
    setIsLoading(false)
    setIsLocatingUser(false)
    setIsDesktopAnalysisOpen(false)
  }, [])
  const retryMap = useCallback(() => {
    if (mapStatusRef.current !== "error") return
    latestRequestRef.current += 1
    mapGenerationRef.current += 1
    mapStatusRef.current = MAPBOX_TOKEN ? "loading" : "error"
    setMapStatus(mapStatusRef.current)
    setMapAttempt((attempt) => attempt + 1)
  }, [])
  const mapStatusLabel = mapStatus === "error" ? "Mapa indisponível" : "Carregando mapa..."
  const mapStatusMessage = mapStatus === "error" ? MAP_UNAVAILABLE_MESSAGE : "Aguarde o carregamento do mapa."
  const topographyScore = pickNumber(
    riskData?.topografia_score,
    riskData?.topography_score,
    riskData?.risk_calculation?.component_scores?.topography
  )
  const waterScore = pickNumber(
    riskData?.agua_score,
    riskData?.water_score,
    riskData?.risk_calculation?.component_scores?.water_frequency
  )
  const soilScore = pickNumber(
    riskData?.solo_score,
    riskData?.soil_score,
    riskData?.risk_calculation?.component_scores?.soil_permeability
  )
  const riskDisplay = getRiskDisplay({
    level: normalizedRiskLevel,
    isLoading,
    hasSelection,
    hasError: Boolean(error),
  })
  const statusBadgeLabel = mapStatus !== "ready" ? mapStatusLabel : isLocatingUser ? "Localizando você..." : riskDisplay.label
  const showStatusSpinner = mapStatus === "loading" || isLoading || isLocatingUser
  const desktopPanelId = "desktop-analysis-panel"
  const openDesktopAnalysis = () => {
    setIsDesktopAnalysisOpen(true)
    requestAnimationFrame(() => document.getElementById(`${desktopPanelId}-content`)?.focus())
  }
  const closeDesktopAnalysis = () => {
    setIsDesktopAnalysisOpen(false)
    requestAnimationFrame(() => document.getElementById(`${desktopPanelId}-trigger`)?.focus())
  }
  const soilData = riskData?.environmental_data?.soil
  const widgetTone = getRiskWidgetTone(isDarkMode)
  const hasAiFeedback = Boolean(riskData?.resposta_ia?.trim())
  const mobileStatusScoreLabel =
    totalScore !== null ? formatPercent(totalScore) : error ? "--" : hasSelection || showStatusSpinner ? "..." : "--"
  const mobileStatusPanelTone = error
    ? isDarkMode
      ? "border-red-500/20 bg-slate-950/82 text-red-50 shadow-[0_18px_45px_rgba(2,6,23,0.48)]"
      : "border-red-200/70 bg-white/92 text-red-950 shadow-[0_18px_40px_rgba(248,113,113,0.16)]"
    : showStatusSpinner
      ? isDarkMode
        ? "border-sky-400/20 bg-slate-950/82 text-slate-50 shadow-[0_18px_45px_rgba(2,6,23,0.48)]"
        : "border-sky-200/80 bg-white/92 text-slate-900 shadow-[0_18px_40px_rgba(14,165,233,0.14)]"
      : hasSelection
        ? isDarkMode
          ? "border-white/10 bg-slate-950/82 text-slate-50 shadow-[0_18px_45px_rgba(2,6,23,0.48)]"
          : "border-slate-200/80 bg-white/92 text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
        : isDarkMode
          ? "border-white/8 bg-slate-950/78 text-slate-100 shadow-[0_18px_45px_rgba(2,6,23,0.42)]"
          : "border-slate-200/70 bg-white/90 text-slate-900 shadow-[0_16px_34px_rgba(15,23,42,0.1)]"
  const mobileStatusIconTone = error
    ? isDarkMode
      ? "border-red-500/20 bg-red-500/10 text-red-200"
      : "border-red-200 bg-red-50 text-red-700"
    : showStatusSpinner
      ? isDarkMode
        ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
        : "border-sky-200 bg-sky-50 text-sky-700"
      : hasSelection
        ? isDarkMode
          ? "border-white/10 bg-white/5 text-slate-100"
          : "border-slate-200 bg-slate-50 text-slate-700"
        : isDarkMode
          ? "border-slate-800 bg-slate-900/90 text-slate-300"
          : "border-slate-200 bg-slate-50 text-slate-600"
  const mobileFeedbackStateLabel = mapStatus !== "ready" ? mapStatusLabel : error
    ? "Falha na leitura"
    : showStatusSpinner
      ? hasAiFeedback
        ? "Atualizando"
        : "Processando"
      : hasAiFeedback
        ? "Sintese pronta"
        : hasSelection
          ? "Em preparo"
          : "Aguardando ponto"
  const mobileFeedbackStateTone = error
    ? isDarkMode
      ? "border-red-500/20 bg-red-500/10 text-red-100"
      : "border-red-200 bg-red-50 text-red-700"
    : showStatusSpinner
      ? isDarkMode
        ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
        : "border-sky-200 bg-sky-50 text-sky-700"
      : hasAiFeedback
        ? isDarkMode
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
        : isDarkMode
          ? "border-white/10 bg-white/5 text-slate-200"
          : "border-slate-200 bg-slate-100 text-slate-600"
  const mobileFeedbackHelperText = mapStatus !== "ready" ? mapStatusMessage : error
    ? error
    : showStatusSpinner
      ? hasAiFeedback
        ? "Mantendo a ultima sintese enquanto atualizamos a leitura do ponto."
        : isLocatingUser
          ? "Estamos identificando sua localizacao para iniciar a leitura."
          : "Estamos gerando a sintese interpretativa do ponto selecionado."
      : hasAiFeedback
        ? "Leitura interpretativa com contexto do ponto analisado."
        : hasSelection
          ? "A sintese aparecera aqui assim que a leitura tecnica for concluida."
          : "Selecione um ponto no mapa ou pesquise um endereco para receber uma leitura interpretativa."
  const mobileFeedbackEmptyTitle = mapStatus !== "ready" ? mapStatusLabel : error
    ? "Nao foi possivel concluir a sintese"
    : showStatusSpinner
      ? isLocatingUser
        ? "Localizando o ponto"
        : "Gerando feedback da IA"
      : hasSelection
        ? "Aguardando conclusao da analise"
        : "Pronto para receber a leitura"
  const mobileFeedbackEmptyCopy = mapStatus !== "ready" ? mapStatusMessage : error
    ? error
    : showStatusSpinner
      ? isLocatingUser
        ? "Assim que a localizacao estiver disponivel, vamos iniciar a analise automaticamente."
        : "Assim que a leitura terminar, a sintese interpretativa aparecera aqui."
      : hasSelection
        ? "A sintese interpretativa aparecera aqui assim que a leitura tecnica for concluida."
        : "Selecione um ponto no mapa ou pesquise um endereco para receber uma sintese explicativa."
  type InsightBadge = {
    label: string
    className: string
    icon?: typeof Droplets
  }

  const soilBadges: InsightBadge[] = []

  if (typeof soilData?.is_permeable === "boolean") {
    soilBadges.push({
      label: soilData.is_permeable ? "Permeavel" : "Impermeavel",
      className: soilData.is_permeable ? widgetTone.soilPermeable : widgetTone.soilImpermeable,
      icon: Droplets,
    })
  }

  if (soilData?.class_name) {
    soilBadges.push({
      label: soilData.class_name,
      className: widgetTone.soilClass,
    })
  }

  const overallRiskAppearance = getOverallRiskAppearance({
    level: normalizedRiskLevel,
    isLoading,
    hasSelection,
    hasError: Boolean(error),
    isDarkMode,
  })
  const SummaryIcon = overallRiskAppearance.icon
  const riskFactors: Array<{
    id: string
    title: string
    weight: number
    score: number | null
    icon: typeof Mountain
    badges: InsightBadge[]
  }> = [
    {
      id: "topography",
      title: "Topografia",
      weight: 50,
      score: topographyScore,
      icon: Mountain,
      badges: [],
    },
    {
      id: "water",
      title: "Historico de agua",
      weight: 30,
      score: waterScore,
      icon: Waves,
      badges: [],
    },
    {
      id: "soil",
      title: "Solo",
      weight: 20,
      score: soilScore,
      icon: Layers,
      badges: soilBadges,
    },
  ]

  function clearCircleLayers() {
    const map = mapRef.current
    if (!map) return
    if (map.getLayer("analysis-circle-outline")) {
      map.removeLayer("analysis-circle-outline")
    }
    if (map.getLayer("analysis-circle")) {
      map.removeLayer("analysis-circle")
    }
    if (map.getSource("analysis-circle")) {
      map.removeSource("analysis-circle")
    }
  }

  const drawCircle = useCallback((nextCenter: MapCenter, nextRadius: number, color: string) => {
    const map = mapRef.current
    if (!map || !styleReadyRef.current) return

    const circle = turf.circle([nextCenter.lng, nextCenter.lat], nextRadius / 1000, {
      steps: 64,
      units: "kilometers",
    })

    if (map.getSource("analysis-circle")) {
      ;(map.getSource("analysis-circle") as mapboxgl.GeoJSONSource).setData(circle as Feature<Polygon>)
    } else {
      map.addSource("analysis-circle", { type: "geojson", data: circle })
      map.addLayer({
        id: "analysis-circle",
        type: "fill",
        source: "analysis-circle",
        paint: {
          "fill-color": color,
          "fill-opacity": 0.18,
        },
      })
      map.addLayer({
        id: "analysis-circle-outline",
        type: "line",
        source: "analysis-circle",
        paint: {
          "line-color": color,
          "line-width": 2,
        },
      })
    }

    map.setPaintProperty("analysis-circle", "fill-color", color)
    map.setPaintProperty("analysis-circle-outline", "line-color", color)

    markerRef.current?.remove()
    const wrapper = document.createElement("div")
    wrapper.className = "relative flex items-center justify-center w-12 h-12 cursor-pointer group pointer-events-auto"
    wrapper.innerHTML = `
      <div class="absolute w-full h-full rounded-full opacity-25 animate-[ping_3s_ease-in-out_infinite] group-hover:opacity-40 transition-opacity" style="background-color: ${color};"></div>
      <div class="absolute inset-[8px] rounded-full border-2 border-white/60 shadow-[0_0_15px_rgba(0,0,0,0.3)] backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:border-white/90" style="background-color: ${color}40;"></div>
      <div class="absolute inset-[15px] rounded-full transition-transform duration-300 group-hover:scale-95 shadow-[inset_0_2px_4px_rgba(255,255,255,0.4)]" style="background-color: ${color}; box-shadow: 0 0 10px ${color};"></div>
      <div class="absolute inset-[21px] rounded-full bg-white shadow-sm"></div>
    `

    markerRef.current = new mapboxgl.Marker({ element: wrapper })
      .setLngLat([nextCenter.lng, nextCenter.lat])
      .addTo(map)
  }, [])

  function disable3DMode() {
    const map = mapRef.current
    if (!map || !styleReadyRef.current) return

    map.easeTo({ pitch: 0, bearing: 0, duration: 800 })
    map.setTerrain(null)
    if (map.getLayer("3d-buildings")) {
      map.removeLayer("3d-buildings")
    }
    if (map.getLayer("sky")) {
      map.removeLayer("sky")
    }
  }

  const enable3DMode = useCallback(() => {
    const map = mapRef.current
    if (!map || !styleReadyRef.current) return

    if (!map.getSource("mapbox-dem")) {
      map.addSource("mapbox-dem", {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      })
    }

    map.setTerrain({ source: "mapbox-dem", exaggeration: 1.35 })

    if (!map.getLayer("sky")) {
      map.addLayer({
        id: "sky",
        type: "sky",
        paint: {
          "sky-type": "atmosphere",
          "sky-atmosphere-sun": [0, 0],
          "sky-atmosphere-sun-intensity": 18,
        },
      })
    }

    const layers = map.getStyle().layers ?? []
    const labelLayerId = layers.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"])?.id

    if (!map.getLayer("3d-buildings")) {
      map.addLayer(
        {
          id: "3d-buildings",
          source: "composite",
          "source-layer": "building",
          filter: ["==", "extrude", "true"],
          type: "fill-extrusion",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": "#6b7280",
            "fill-extrusion-height": ["get", "height"],
            "fill-extrusion-base": ["get", "min_height"],
            "fill-extrusion-opacity": 0.62,
          },
        },
        labelLayerId
      )
    }

    map.easeTo({ pitch: 58, bearing: -18, duration: 800 })
  }, [])

  const drawAndAnalyze = useCallback(async (nextCenter: MapCenter, nextRadius: number) => {
    const map = mapRef.current
    if (!map || mapStatusRef.current === "error") return

    const requestId = ++latestRequestRef.current
    Object.assign(currentMapStateRef.current, {
      center: nextCenter, radius: nextRadius, requestedRadius: nextRadius, normalizedRiskLevel: undefined,
      isLoading: true, hasSelection: true, error: null,
    })
    setRiskData(null)
    setIsDesktopAnalysisOpen(false)
    setIsLoading(true)
    setError(null)

    drawCircle(nextCenter, nextRadius, "#0284c7")

    try {
      const data = await postRiskByCenterRadius({
        lat: nextCenter.lat,
        lng: nextCenter.lng,
        radiusMeters: nextRadius,
      })

      if (requestId !== latestRequestRef.current) return

      const dataLevel = deriveRiskLevel(data.risk_level, getTotalScore(data))
      Object.assign(currentMapStateRef.current, { normalizedRiskLevel: dataLevel, isLoading: false, error: null })
      setRiskData(data)
      const dataColor = getRiskDisplay({
        level: dataLevel,
        isLoading: false,
        hasSelection: true,
        hasError: false,
      }).color
      drawCircle(nextCenter, nextRadius, dataColor)
    } catch (apiError) {
      if (requestId !== latestRequestRef.current) return

      const message = apiError instanceof Error ? apiError.message : "Falha ao consultar a API de risco."
      Object.assign(currentMapStateRef.current, { normalizedRiskLevel: undefined, isLoading: false, error: message })
      setRiskData(null)
      setError(message)
      drawCircle(nextCenter, nextRadius, "#64748b")
    } finally {
      if (requestId === latestRequestRef.current) {
        currentMapStateRef.current.isLoading = false
        setIsLoading(false)
      }
    }
  }, [drawCircle])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    if (!MAPBOX_TOKEN) return

    const initialStyle = getMapStyle(currentMapStateRef.current.effectiveResolvedTheme)
    mapStyleRef.current = initialStyle

    const current = currentMapStateRef.current
    let isMapDisposed = false
    const generation = mapGenerationRef.current
    // The SDK can throw after adding canvas/host listeners, before new returns
    // an instance we can remove. Detach that entire DOM ownership boundary.
    const mapHost = document.createElement("div")
    mapHost.className = "h-full w-full"
    mapContainerRef.current.appendChild(mapHost)
    let map: mapboxgl.Map
    try {
      map = new mapboxgl.Map({
        container: mapHost,
        style: initialStyle,
        center: [current.center.lng, current.center.lat],
        zoom: current.hasSelection ? USER_LOCATION_ZOOM : BRAZIL_OVERVIEW_ZOOM,
        pitch: current.is3DMode ? 58 : 0,
        bearing: current.is3DMode ? -18 : 0,
        antialias: true,
      })
    } catch {
      mapHost.remove()
      queueMicrotask(() => {
        if (!isMapDisposed && generation === mapGenerationRef.current) markMapUnavailable()
      })
      return () => { isMapDisposed = true; mapHost.remove() }
    }

    mapRef.current = map
    let hasManualSelection = current.hasSelection
    let hasRequestedInitialLocation = false
    let geocoder: MapboxGeocoder | null = null
    let hasLostContext = false
    const isCurrentMap = () => !isMapDisposed && generation === mapGenerationRef.current && mapRef.current === map && mapStatusRef.current !== "error"
    const loadTimeout = window.setTimeout(() => {
      if (isCurrentMap() && !hasRequestedInitialLocation) markMapUnavailable()
    }, MAP_LOAD_TIMEOUT_MS)
    const handleMapError = (event: { error: Error; sourceId?: string; tile?: unknown }) => {
      // Source/tile errors alone do not mean the base style is unavailable.
      if (!isCurrentMap() || event.sourceId || event.tile || styleReadyRef.current) return
      markMapUnavailable()
    }
    map.on("error", handleMapError)
    const handleContextLost = () => {
      if (!isCurrentMap()) return
      hasLostContext = true
      window.clearTimeout(loadTimeout)
      cancelStyleLoadRef.current?.()
      cancelStyleLoadRef.current = null
      markMapUnavailable()
    }
    const handleContextRestored = () => {
      if (!hasLostContext || isMapDisposed || generation !== mapGenerationRef.current || mapRef.current !== map) return
      // Restored GL resources do not establish that the style is usable. A fresh
      // attempt shares manual retry's load gate, timeout and request invalidation.
      hasLostContext = false
      retryMap()
    }
    map.on("webglcontextlost", handleContextLost)
    map.on("webglcontextrestored", handleContextRestored)

    const handleMapClick = (event: mapboxgl.MapMouseEvent) => {
      if (!isCurrentMap()) return
      hasManualSelection = true
      setIsLocatingUser(false)
      setLocationError(null)
      const nextCenter = { lng: event.lngLat.lng, lat: event.lngLat.lat }
      setCenter(nextCenter)
      setHasSelection(true)
      void drawAndAnalyze(nextCenter, radiusRef.current)
    }

    const handleGeocoderResult = (event: { result?: { center?: [number, number] } }) => {
      if (!isCurrentMap()) return
      const resultCenter = event.result?.center
      if (!resultCenter) return

      hasManualSelection = true
      setIsLocatingUser(false)
      setLocationError(null)
      const nextCenter = { lng: resultCenter[0], lat: resultCenter[1] }
      setCenter(nextCenter)
      setHasSelection(true)
      map.flyTo({ center: resultCenter, zoom: 14.5, duration: 900 })
      void drawAndAnalyze(nextCenter, radiusRef.current)
    }

    const handleMapLoad = () => {
      if (!isCurrentMap() || hasRequestedInitialLocation) return
      hasRequestedInitialLocation = true
      window.clearTimeout(loadTimeout)
      styleReadyRef.current = true
      mapStatusRef.current = "ready"
      setMapStatus("ready")
      map.on("click", handleMapClick)

      geocoder = new MapboxGeocoder({
        accessToken: mapboxgl.accessToken as string,
        mapboxgl: MapboxGL,
        marker: false,
        placeholder: "Busque endereco, bairro ou coordenada...",
      })

      geocoder.on("result", handleGeocoderResult)
      map.addControl(geocoder, "top-left")

      if (currentMapStateRef.current.is3DMode) {
        enable3DMode()
      } else {
        disable3DMode()
      }

      if (currentMapStateRef.current.hasSelection) {
        const selection = currentMapStateRef.current
        if (selection.normalizedRiskLevel) {
          // Recreating the map must not discard a completed result or call providers again.
          drawCircle(selection.center, selection.radius, getRiskDisplay({
            level: selection.normalizedRiskLevel, isLoading: false, hasSelection: true, hasError: false,
          }).color)
          return
        }
        void drawAndAnalyze(selection.center, selection.radius)
        return
      }

      setIsLocatingUser(true)
      setLocationError(null)

      void getInitialUserLocation().then((result) => {
        if (!isCurrentMap()) return

        setIsLocatingUser(false)
        if (hasManualSelection) return
        setLocationError(result.error)

        if (!result.center) {
          return
        }

        userInitialCenterRef.current = result.center
        Object.assign(currentMapStateRef.current, { center: result.center, hasSelection: true })
        setCenter(result.center)
        setHasSelection(true)
        map.flyTo({
          center: [result.center.lng, result.center.lat],
          zoom: USER_LOCATION_ZOOM,
          duration: 900,
        })

        if (shouldAutoAnalyze(result.center)) {
          void drawAndAnalyze(result.center, DEFAULT_RADIUS)
        }
      })
    }
    map.on("load", handleMapLoad)

    return () => {
      isMapDisposed = true
      window.clearTimeout(loadTimeout)
      styleReadyRef.current = false
      latestRequestRef.current += 1
      cancelStyleLoadRef.current?.()
      cancelStyleLoadRef.current = null
      map.off("load", handleMapLoad)
      map.off("error", handleMapError)
      map.off("webglcontextlost", handleContextLost)
      map.off("webglcontextrestored", handleContextRestored)
      map.off("click", handleMapClick)
      if (geocoder) {
        geocoder.off("result", handleGeocoderResult)
        map.removeControl(geocoder)
      }
      markerRef.current?.remove()
      markerRef.current = null
      map.remove()
      mapHost.remove()
      mapRef.current = null
    }
  }, [drawAndAnalyze, enable3DMode, mapAttempt, markMapUnavailable, retryMap])

  useEffect(() => {
    const selection = currentMapStateRef.current
    if (!selection.hasSelection || selection.requestedRadius === radius) return

    const timeout = window.setTimeout(() => {
      const current = currentMapStateRef.current
      if (current.hasSelection) void drawAndAnalyze(current.center, radius)
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [radius, drawAndAnalyze])

  useEffect(() => {
    const map = mapRef.current
    if (!map || mapStatusRef.current === "error") return

    const nextStyle = getMapStyle(effectiveResolvedTheme)
    if (nextStyle === mapStyleRef.current) return

    mapStyleRef.current = nextStyle
    styleReadyRef.current = false
    mapStatusRef.current = "loading"

    let isCancelled = false
    const generation = mapGenerationRef.current
    queueMicrotask(() => {
      if (!isCancelled && generation === mapGenerationRef.current && mapRef.current === map) setMapStatus(mapStatusRef.current)
    })
    const styleTimeout = window.setTimeout(() => {
      if (!isCancelled && generation === mapGenerationRef.current && mapRef.current === map && !styleReadyRef.current) markMapUnavailable()
    }, MAP_LOAD_TIMEOUT_MS)
    const handleStyleLoad = () => {
      if (isCancelled || generation !== mapGenerationRef.current || mapRef.current !== map || mapStatusRef.current === "error") return
      window.clearTimeout(styleTimeout)
      map.off("style.load", handleStyleLoad)
      styleReadyRef.current = true
      mapStatusRef.current = "ready"
      setMapStatus("ready")
      const current = currentMapStateRef.current
      const color = getRiskDisplay({
        level: current.normalizedRiskLevel,
        isLoading: current.isLoading,
        hasSelection: current.hasSelection,
        hasError: Boolean(current.error),
      }).color

      if (current.hasSelection) {
        drawCircle(current.center, current.radius, color)
      }

      if (current.is3DMode) {
        enable3DMode()
      } else {
        disable3DMode()
      }
    }
    map.on("style.load", handleStyleLoad)
    const cancelStyleLoad = () => {
      if (isCancelled) return
      isCancelled = true
      window.clearTimeout(styleTimeout)
      map.off("style.load", handleStyleLoad)
    }
    cancelStyleLoadRef.current = cancelStyleLoad
    try {
      // Successful SDK diffs do not emit style.load, which gates this lifecycle.
      // 3.16 types require both font fields: preserve the constructor's SDK defaults.
      map.setStyle(nextStyle, {
        diff: false,
        localFontFamily: null,
        localIdeographFontFamily: "sans-serif",
      })
    } catch {
      queueMicrotask(() => {
        if (!isCancelled && generation === mapGenerationRef.current && mapRef.current === map) markMapUnavailable()
      })
    }
    return cancelStyleLoad
  }, [effectiveResolvedTheme, drawCircle, enable3DMode, markMapUnavailable])

  function handleRadiusChange(value: string) {
    const nextRadius = parseRadius(value)
    radiusRef.current = nextRadius
    currentMapStateRef.current.radius = nextRadius
    setRadius(nextRadius)
  }

  function handleReset() {
    const map = mapRef.current
    const resetCenter = userInitialCenterRef.current ?? DEFAULT_CENTER
    const resetZoom = userInitialCenterRef.current ? USER_LOCATION_ZOOM : BRAZIL_OVERVIEW_ZOOM
    radiusRef.current = DEFAULT_RADIUS
    Object.assign(currentMapStateRef.current, {
      center: resetCenter, radius: DEFAULT_RADIUS, normalizedRiskLevel: undefined,
      isLoading: false, error: null, hasSelection: false, is3DMode: false,
    })
    setCenter(resetCenter)
    setRadius(DEFAULT_RADIUS)
    setRiskData(null)
    setIsLoading(false)
    setError(null)
    setHasSelection(false)
    setIs3DMode(false)
    setIsDesktopAnalysisOpen(false)
    latestRequestRef.current += 1

    if (!map) return

    map.flyTo({ center: [resetCenter.lng, resetCenter.lat], zoom: resetZoom, duration: 800 })
    disable3DMode()
    clearCircleLayers()
    markerRef.current?.remove()
    markerRef.current = null
  }

  function toggle3D() {
    const map = mapRef.current
    if (!map) return

    const nextMode = !currentMapStateRef.current.is3DMode
    currentMapStateRef.current.is3DMode = nextMode
    setIs3DMode(nextMode)
    if (nextMode) {
      enable3DMode()
    } else {
      disable3DMode()
    }
  }

  const renderRiskEngineContent = () => (
    <div className="space-y-4">
      <Card className={cn("gap-4 overflow-hidden py-4 border-none lg:gap-3 lg:py-3 lg:border-solid", widgetTone.shell)}>
        <CardHeader className="px-4">
          <CardTitle className={cn("text-base tracking-tight", widgetTone.title)}>Motor de risco</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4 text-sm">
          <div className="space-y-3">
            {riskFactors.map((factor) => {
              const appearance = getFactorScoreAppearance(factor.score, isDarkMode)
              const Icon = factor.icon
              const percentage = toPercentage(factor.score) ?? 0

              return (
                <div
                  key={factor.id}
                  className={cn(
                    "rounded-[1.25rem] border p-4 lg:p-3",
                    widgetTone.factorBase,
                    appearance.panel
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border lg:h-8 lg:w-8",
                          appearance.indicator
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className={cn("font-medium", widgetTone.factorTitle)}>{factor.title}</p>
                      </div>
                    </div>

                    <span
                      className={cn(
                        "inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        widgetTone.impactBadge
                      )}
                    >
                      Impacto: {factor.weight}%
                    </span>
                  </div>

                  <div className="mt-4 flex items-baseline justify-between gap-3 lg:mt-2">
                    <span className={cn("text-2xl font-semibold tracking-tight", appearance.text)}>
                      {formatPercent(factor.score)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-1 text-xs font-medium",
                        appearance.badge
                      )}
                    >
                      {appearance.label}
                    </span>
                  </div>

                  <div className="mt-3 lg:mt-2">
                    <div
                      className={cn("h-2.5 overflow-hidden rounded-full", widgetTone.progressTrack)}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percentage}
                      aria-label={`${factor.title} em ${percentage}%`}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out",
                          appearance.fill
                        )}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>

                    <div
                      className={cn("mt-2 flex items-center justify-between text-[11px] lg:mt-1", widgetTone.progressLegend)}
                    >
                      <span>0% seguro</span>
                      <span>100% critico</span>
                    </div>
                  </div>

                  {factor.badges.length > 0 && (
                    <div className={cn("mt-3 flex flex-wrap gap-2 border-t pt-3 lg:mt-2 lg:pt-2", widgetTone.divider)}>
                      {factor.badges.map((badge) => {
                        const BadgeIcon = badge.icon

                        return (
                          <span
                            key={badge.label}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                              badge.className
                            )}
                          >
                            {BadgeIcon && <BadgeIcon className="h-3 w-3" />}
                            {badge.label}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )

  const renderAiFeedback = () => (
    <section
      className={cn(
        "rounded-[1.5rem] border p-4 shadow-[0_18px_42px_rgba(14,165,233,0.14)]",
        isDarkMode
          ? "border-sky-400/15 bg-[linear-gradient(160deg,rgba(2,132,199,0.18),rgba(15,23,42,0.96)_32%,rgba(8,47,73,0.72))]"
          : "border-sky-200/80 bg-[linear-gradient(160deg,rgba(240,249,255,0.98),rgba(255,255,255,0.98)_45%,rgba(240,253,250,0.96))]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
            isDarkMode
              ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
              : "border-sky-200 bg-white/85 text-sky-700"
          )}
        >
          {error ? (
            <ShieldAlert className="h-5 w-5" />
          ) : showStatusSpinner && !hasAiFeedback ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("text-base font-semibold tracking-tight", isDarkMode ? "text-slate-50" : "text-slate-900")}>
              Feedback da IA
            </h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
                mobileFeedbackStateTone
              )}
            >
              {mobileFeedbackStateLabel}
            </span>
          </div>
          <p className={cn("mt-1 text-sm leading-5", isDarkMode ? "text-slate-300" : "text-slate-600")}>
            {mobileFeedbackHelperText}
          </p>
        </div>
      </div>

      {riskData ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div
              className={cn(
                "col-span-2 rounded-[1.15rem] border p-3.5",
                isDarkMode ? "border-white/8 bg-slate-950/45" : "border-white/90 bg-white/85"
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Corpo d&apos;agua
              </span>
              <p
                className={cn(
                  "mt-2 text-sm font-semibold leading-tight break-words",
                  isDarkMode ? "text-slate-100" : "text-slate-900"
                )}
                title={riskData.rio_mais_proximo}
              >
                {riskData.rio_mais_proximo}
              </p>
            </div>

            <div
              className={cn(
                "rounded-[1.15rem] border p-3.5",
                isDarkMode ? "border-white/8 bg-slate-950/45" : "border-white/90 bg-white/85"
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Distancia
              </span>
              <p className={cn("mt-2 text-sm font-semibold", isDarkMode ? "text-slate-100" : "text-slate-900")}>
                {formatDistance(riskData.distancia_rio_m)}
              </p>
            </div>

            <div
              className={cn(
                "rounded-[1.15rem] border p-3.5",
                isDarkMode ? "border-white/8 bg-slate-950/45" : "border-white/90 bg-white/85"
              )}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Elevacao
              </span>
              <p className={cn("mt-2 text-sm font-semibold", isDarkMode ? "text-slate-100" : "text-slate-900")}>
                {formatElevation(riskData.queda_relativa_m)}
              </p>
            </div>
          </div>

          <div
            className={cn(
              "mt-4 rounded-[1.25rem] border p-4",
              isDarkMode ? "border-white/8 bg-slate-950/55" : "border-white/90 bg-white/92"
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border",
                  isDarkMode ? "border-sky-400/20 bg-sky-400/10 text-sky-100" : "border-sky-200 bg-sky-50 text-sky-700"
                )}
              >
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Sintese guiada pela IA
                </p>
                <p className={cn("text-sm font-semibold", isDarkMode ? "text-slate-100" : "text-slate-900")}>
                  Leitura interpretativa do ponto selecionado
                </p>
              </div>
            </div>

            <div
              className={cn(
                "feedback-markdown mt-4 prose prose-sm max-w-none leading-relaxed",
                isDarkMode
                  ? "prose-invert prose-headings:text-white prose-p:text-slate-300 prose-strong:text-white prose-li:text-slate-300"
                  : "prose-slate prose-headings:text-slate-900 prose-p:text-slate-700 prose-strong:text-slate-900 prose-li:text-slate-700"
              )}
            >
              <ReactMarkdown>{riskData.resposta_ia?.trim() || "Sem sintese textual disponivel para este ponto."}</ReactMarkdown>
            </div>
          </div>
        </>
      ) : (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mt-4 rounded-[1.25rem] border px-4 py-4",
            isDarkMode ? "border-white/8 bg-slate-950/55" : "border-white/90 bg-white/92"
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                error
                  ? isDarkMode
                    ? "border-red-500/20 bg-red-500/10 text-red-100"
                    : "border-red-200 bg-red-50 text-red-700"
                  : showStatusSpinner
                    ? isDarkMode
                      ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
                      : "border-sky-200 bg-sky-50 text-sky-700"
                    : isDarkMode
                      ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
                      : "border-sky-200 bg-sky-50 text-sky-700"
              )}
            >
              {error ? (
                <ShieldAlert className="h-4 w-4" />
              ) : showStatusSpinner ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </div>

            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", isDarkMode ? "text-slate-100" : "text-slate-900")}>
                {mobileFeedbackEmptyTitle}
              </p>
              <p className={cn("mt-1 text-sm leading-5", isDarkMode ? "text-slate-300" : "text-slate-600")}>
                {mobileFeedbackEmptyCopy}
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )

  return (
    <section className="grid h-full min-h-0 overflow-hidden rounded-2xl border border-border/80 bg-card/85 shadow-2xl shadow-primary/10 lg:min-h-min lg:grid-cols-[360px_1fr] lg:grid-rows-1">
      <aside
        aria-label="Motor de risco"
        tabIndex={0}
        className="hidden min-h-0 space-y-4 overflow-visible border-r border-border/70 bg-background/90 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary lg:block"
      >
        {renderRiskEngineContent()}
      </aside>

      <div className="relative min-h-[360px] flex-1 overflow-hidden lg:min-h-0">
        <div ref={mapContainerRef} className="h-full w-full" />

        {mapStatus !== "ready" && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/90 p-4">
            <div role={mapStatus === "error" ? "alert" : "status"} className="w-full max-w-sm rounded-xl border border-border bg-background p-5 text-center text-foreground shadow-lg">
              <p className="font-semibold">{mapStatusLabel}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {mapStatusMessage}
              </p>
              {mapStatus === "error" ? (
                <Button className="mt-4 min-h-11" onClick={retryMap}>Tentar novamente</Button>
              ) : (
                <Loader2 aria-hidden="true" className="mx-auto mt-4 h-5 w-5 animate-spin" />
              )}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-3 top-16 z-[1] lg:hidden">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "flex items-center justify-between gap-3 rounded-[1.15rem] border px-3.5 py-2.5 backdrop-blur-xl",
              mobileStatusPanelTone
            )}
          >
            <div className="min-w-0 flex items-center gap-2.5">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border", mobileStatusIconTone)}>
                {showStatusSpinner ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: riskDisplay.color }} />
                )}
              </div>

              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Status da analise</p>
                <p className={cn("truncate text-sm font-semibold", isDarkMode ? "text-slate-100" : "text-slate-900")}>
                  {statusBadgeLabel}
                </p>
              </div>
            </div>

            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold shadow-sm",
                riskDisplay.badge
              )}
            >
              {mobileStatusScoreLabel}
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute right-3 top-3 z-20 hidden lg:block sm:right-4 sm:top-4">
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium shadow-sm",
              riskDisplay.pulse && "animate-pulse",
              riskDisplay.badge
            )}
          >
            {showStatusSpinner && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {statusBadgeLabel}
            {totalScore !== null ? ` | Score ${formatPercent(totalScore)}` : ""}
          </div>
        </div>

        <div
          className={cn(
            "absolute bottom-8 left-4 z-20 sm:bottom-8 sm:left-5",
            !hasSelection && "lg:bottom-32"
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle3D}
            aria-label={is3DMode ? "Desativar modo 3D do mapa" : "Ativar modo 3D do mapa"}
            aria-pressed={is3DMode}
            className={cn(
              "group relative h-11 w-11 cursor-pointer overflow-hidden rounded-2xl border p-0 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-sky-400/70 sm:h-12 sm:w-12",
              is3DMode
                ? "border-sky-300/60 bg-[linear-gradient(145deg,rgba(14,165,233,0.96),rgba(34,211,238,0.86))] text-white shadow-[0_14px_30px_rgba(14,165,233,0.36),inset_0_1px_1px_rgba(255,255,255,0.4)] hover:shadow-[0_18px_36px_rgba(14,165,233,0.44),inset_0_1px_1px_rgba(255,255,255,0.52)]"
                : isDarkMode
                  ? "border-white/10 bg-slate-950/55 text-slate-300 shadow-[0_10px_22px_rgba(2,6,23,0.38),inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-sky-400/30 hover:bg-slate-900/75 hover:text-white"
                  : "border-slate-200/80 bg-white/82 text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.92)] hover:border-sky-300/60 hover:bg-white hover:text-slate-900"
            )}
            title={is3DMode ? "Desativar modo 3D" : "Ativar modo 3D"}
          >
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-[1px] rounded-[15px] transition-opacity duration-300",
                is3DMode
                  ? "bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.36),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.22),transparent_58%)] opacity-100"
                  : "opacity-0"
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300",
                is3DMode
                  ? "opacity-100 shadow-[0_0_0_1px_rgba(255,255,255,0.18)_inset,0_0_22px_rgba(34,211,238,0.32)]"
                  : "opacity-0"
              )}
            />
            <Box
              className={cn(
                "relative h-5 w-5 transition-all duration-300 sm:h-[1.35rem] sm:w-[1.35rem]",
                is3DMode
                  ? "scale-100 drop-shadow-[0_4px_12px_rgba(8,47,73,0.42)]"
                  : "group-hover:scale-110"
              )}
            />
          </Button>
        </div>

        {/* MOBILE DRAWER TRIGGER */}
        <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 lg:hidden">
          <Drawer>
            <DrawerTrigger asChild>
              <Button size="lg" className="min-h-[48px] rounded-full px-6 shadow-xl">
                <Eye className="mr-2 h-4 w-4" />
                Analise Completa
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[88vh] overflow-hidden">
              <DrawerHeader className="relative shrink-0 pb-2 pr-16 text-left">
                <DrawerTitle>Analise Completa</DrawerTitle>
                <DrawerDescription>Feedback da IA primeiro, seguido pelos fatores tecnicos da leitura.</DrawerDescription>
                <DrawerClose asChild>
                  <Button variant="ghost" size="icon" className="absolute right-4 top-4 h-11 w-11" aria-label="Fechar analise">
                    <X className="h-4 w-4" />
                  </Button>
                </DrawerClose>
              </DrawerHeader>
              <div
                role="region"
                aria-label="Conteúdo completo da análise"
                tabIndex={0}
                data-vaul-no-drag
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="space-y-4">
                  {renderAiFeedback()}
                  {renderRiskEngineContent()}
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </div>

        {!hasSelection && mapStatus === "ready" && (
          <div className="pointer-events-none hidden lg:block absolute bottom-8 left-3 z-20 max-w-xs rounded-lg border border-border/70 bg-background/90 p-3 text-sm text-muted-foreground shadow-lg lg:bottom-9 lg:left-4">
            {isLocatingUser
              ? "Detectando sua localizacao para iniciar automaticamente..."
              : locationError
                ? `${locationError} Clique no mapa para calcular o risco ou busque um endereco para iniciar.`
                : "Clique no mapa para calcular o risco ou busque um endereco para iniciar."}
          </div>
        )}

        {riskData && !isDesktopAnalysisOpen && (
          <div className="hidden lg:flex absolute bottom-8 right-8 z-20">
            <Button
              variant="outline"
              size="sm"
              id={`${desktopPanelId}-trigger`}
              aria-expanded={isDesktopAnalysisOpen}
              aria-controls={desktopPanelId}
              className={cn(
                "group h-12 rounded-full border px-5 cursor-pointer shadow-lg backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl",
                isDarkMode
                  ? "border-white/10 bg-slate-950/60 text-slate-100 hover:border-sky-500/50 hover:bg-slate-900/80"
                  : "border-slate-200/80 bg-white/70 text-slate-800 hover:border-sky-400/50 hover:bg-white/90"
              )}
              onClick={openDesktopAnalysis}
            >
              <Eye className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
              <span className="font-semibold tracking-tight">Ver Analise Completa</span>
            </Button>
          </div>
        )}

        {riskData && isDesktopAnalysisOpen && (
          <div
            id={desktopPanelId}
            role="region"
            aria-label="Análise completa"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                closeDesktopAnalysis()
              }
            }}
            className={cn(
              "hidden lg:flex flex-col absolute bottom-8 right-8 z-20 w-[440px] max-h-[calc(100%_-_4rem)] rounded-[24px] border shadow-2xl backdrop-blur-2xl transition-all duration-500 animate-in fade-in slide-in-from-bottom-8",
              isDarkMode 
                ? "border-white/10 bg-slate-950/75 shadow-black/80" 
                : "border-slate-200/60 bg-white/80 shadow-slate-300/50"
            )}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-border/10 shrink-0">
              <div className="flex items-center gap-3 w-full">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full border", overallRiskAppearance.indicator)}>
                  <SummaryIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className={cn("text-base font-semibold tracking-tight", isDarkMode ? "text-slate-100" : "text-slate-900")}>Analise de Risco</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", riskDisplay.pulse && "animate-pulse")} style={{ backgroundColor: riskDisplay.color }} />
                    <span className="text-xs font-medium text-muted-foreground truncate">{riskDisplay.label} {totalScore !== null && `· Score ${formatPercent(totalScore)}`}</span>
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar analise"
                className={cn(
                  "h-11 w-11 shrink-0 rounded-full cursor-pointer ml-3 transition-all duration-200 hover:rotate-90",
                  isDarkMode ? "hover:bg-white/10 text-slate-400 hover:text-white" : "hover:bg-slate-200/80 text-slate-500 hover:text-slate-900"
                )}
                onClick={closeDesktopAnalysis}
              >
                <Minimize2 className="h-4 w-4" />
              </Button>
            </div>

            <div
              id={`${desktopPanelId}-content`}
              role="region"
              aria-label="Texto completo da análise"
              tabIndex={0}
              className="min-h-0 overflow-y-auto overscroll-y-contain p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/50 [&::-webkit-scrollbar-thumb]:rounded-full">
              <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-3 mb-6 items-stretch">
                <div className={cn("flex min-h-[98px] flex-col justify-between gap-3 rounded-2xl border p-3", isDarkMode ? "border-white/5 bg-white/[0.02]" : "border-slate-200/50 bg-slate-50/50")}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Corpo d&apos;Agua</span>
                  <span className={cn("text-sm font-semibold line-clamp-2 leading-tight break-words", isDarkMode ? "text-slate-200" : "text-slate-800")} title={riskData.rio_mais_proximo}>{riskData.rio_mais_proximo}</span>
                </div>
                <div className={cn("flex min-h-[98px] flex-col justify-between gap-3 rounded-2xl border p-3", isDarkMode ? "border-white/5 bg-white/[0.02]" : "border-slate-200/50 bg-slate-50/50")}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Distancia</span>
                  <span className={cn("text-sm font-semibold", isDarkMode ? "text-slate-200" : "text-slate-800")}>{riskData.distancia_rio_m.toFixed(1)}m</span>
                </div>
                <div className={cn("flex min-h-[98px] flex-col justify-between gap-3 rounded-2xl border p-3", isDarkMode ? "border-white/5 bg-white/[0.02]" : "border-slate-200/50 bg-slate-50/50")}>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Elevacao</span>
                  <span className={cn("text-sm font-semibold", isDarkMode ? "text-slate-200" : "text-slate-800")}>
                    {riskData.queda_relativa_m === null ? "N/A" : `${riskData.queda_relativa_m > 0 ? '+' : ''}${riskData.queda_relativa_m.toFixed(1)}m`}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                  <div className="h-px w-3 bg-muted-foreground/30"></div>
                  Sintese da Inteligencia
                  <div className="h-px flex-1 bg-muted-foreground/30"></div>
                </h4>
                <div className={cn(
                  "prose prose-sm max-w-none text-sm leading-relaxed",
                  isDarkMode 
                    ? "prose-invert prose-p:text-slate-300 prose-strong:text-white prose-li:text-slate-300" 
                    : "prose-slate prose-p:text-slate-600 prose-strong:text-slate-900 prose-li:text-slate-600"
                )}>
                  <ReactMarkdown>{riskData.resposta_ia}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
