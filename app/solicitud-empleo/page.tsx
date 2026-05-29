import type { Metadata } from "next"
import { BUSINESS_FALLBACK } from "@/lib/business"
import { SolicitudEmpleoPublicaPage } from "./solicitud-empleo-form"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface PageProps {
  searchParams: Promise<{ empresa?: string }>
}

/**
 * Metadata dinámica del formulario público de solicitud de empleo.
 *
 * WhatsApp, Facebook, Twitter y otros scrapers leen estos tags al expandir
 * el link. Antes del fix mostraban el default del RootLayout ("Sistema
 * Integral de Mantenimientos"), por eso un link Depicenter compartido en
 * WhatsApp salía con branding genérico.
 *
 * Resolvemos searchParams server-side y devolvemos title/og/twitter
 * específicos al tenant del query param `?empresa=`. Si falta o es
 * inválido, cae a CSL como default seguro.
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams
  const slug = (sp.empresa || "csl").toLowerCase()
  const business = BUSINESS_FALLBACK[slug as keyof typeof BUSINESS_FALLBACK] || BUSINESS_FALLBACK.csl
  const title = `${business.name} · Solicitud de empleo`
  const description = `Completa tu solicitud de empleo para formar parte de ${business.name}.`
  // URL absoluta al logo para que WhatsApp/Facebook puedan descargarla.
  // Vercel siempre expone los assets bajo public/ con la URL del deployment.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://csl-app-eta.vercel.app"
  const ogImage = `${baseUrl}${business.logoUrl}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: business.name,
      url: `${baseUrl}/solicitud-empleo?empresa=${business.slug}`,
      images: [{ url: ogImage, width: 800, height: 600, alt: business.name }],
      locale: "es_DO",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
    robots: {
      // Link público estable — sí indexable, a diferencia de los tokens
      // efímeros de consentimientos.
      index: true,
      follow: true,
      googleBot: { index: true, follow: true },
    },
  }
}

export default function Page() {
  return <SolicitudEmpleoPublicaPage />
}
