import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"

import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  metadataBase: new URL("https://orbtalus.vercel.app"),
  title: {
    default: "OrbTalus | Inteligencia territorial",
    template: "%s | OrbTalus",
  },
  description:
    "Contexto geoespacial para triagem preliminar de risco hidrologico e conversas sobre operacao territorial.",
  applicationName: "OrbTalus",
  keywords: [
    "risco hidrologico",
    "analise geoespacial",
    "mapa de risco",
    "seguradoras",
    "mercado imobiliario",
    "flood risk",
    "climate risk",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: "/",
    title: "OrbTalus | Inteligencia territorial",
    description:
      "Explore o territorio e consulte os fatores usados na triagem preliminar de risco hidrologico.",
    siteName: "OrbTalus",
  },
  twitter: {
    card: "summary",
    title: "OrbTalus",
    description:
      "Contexto geoespacial para triagem preliminar de risco hidrologico.",
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          storageKey="orbtalus-theme"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
