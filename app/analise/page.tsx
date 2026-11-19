import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import ThemeToggle from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import GeoRiskMap from "@/components/ui/GeoRiskMap"


export const metadata: Metadata = {
  title: "Analise interativa",
  description:
    "Explore o contexto hidrologico no OrbTalus com mapa, raio customizavel e explicacao tecnica dos resultados.",
}

export default function AnalisePage() {
  return (
    <main className="min-h-dvh flex flex-col">
      <header className="border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4">
          <div className="min-w-0 flex items-center gap-3">
            <Link href="/" className="shrink-0" aria-label="OrbTalus — início">
              <Image src="/orbtalus-simbolo-escuro-teal-v1.svg" alt="OrbTalus" width={64} height={64} className="h-14 w-14 object-contain dark:hidden sm:h-16 sm:w-16" priority />
              <Image src="/orbtalus-simbolo-branco-teal-v1.svg" alt="OrbTalus" width={64} height={64} className="hidden h-14 w-14 object-contain dark:block sm:h-16 sm:w-16" priority />
            </Link>
            <div className="hidden sm:block h-5 w-px bg-border/60" />
            <h1 className="truncate text-base font-semibold md:text-xl">Analise hidrologica</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="outline" size="icon" className="h-9 w-9">
              <Link href="/" aria-label="Voltar para landing page">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex h-[calc(100dvh-81px)] w-full max-w-[1280px] flex-col p-0 sm:h-[calc(100dvh-97px)] sm:p-4">
        <GeoRiskMap />
      </section>
    </main>
  )
}
