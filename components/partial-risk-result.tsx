import type { PartialRiskResponse } from "@/lib/api"

const measurement = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

export function PartialRiskResult({ data }: { data: PartialRiskResponse }) {
  const { soil, water_frequency: water, data_source: source } = data.environmental_data
  const missingMeasurement = data.missing_indicators.length === 2
    ? "Faltaram as medições de solo e de frequência histórica de água"
    : `Faltou a medição de ${soil === null ? "solo" : "frequência histórica de água"}`
  const observations = [
    ["Curso d’água mapeado mais próximo", data.rio_mais_proximo],
    ["Distância até o curso d’água", `${measurement.format(data.distancia_rio_m)} m`],
    ["Desnível do ponto em relação ao curso d’água", `${measurement.format(data.queda_relativa_m)} m`],
    ["Solo", soil ? `${soil.class_name} · ${soil.is_permeable ? "permeável" : "impermeável"}` : "Sem medição"],
    ["Frequência histórica de água no entorno", water ? `Equivalente a ${water.years} de 30 anos` : "Sem medição"],
  ]

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 text-sm text-card-foreground">
      <h3 className="font-semibold">Resultado parcial</h3>
      <p>{missingMeasurement}, por isso não foi possível calcular a nota de risco.</p>
      <dl className="space-y-2">
        {observations.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Fonte dos indicadores ambientais: {source}</p>
    </section>
  )
}
