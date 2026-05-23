import type { Metadata } from "next"
import { PublicFormPage } from "@/components/public-form-page"
import { verifyPublicFormLink, type FormType } from "@/lib/server/public-form-links"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface PageProps {
  params: Promise<{ token: string }>
}

// Etiquetas legales por tipo — espejo de FORM_TYPE_LABEL del helper, pero
// con el prefijo "Consentimiento de" para el contexto del cliente público.
const TITLE_BY_TYPE: Record<FormType, string> = {
  ficha_dermatologica: "Consentimiento Ficha Dermatológica",
  consentimiento_masajes: "Consentimiento Masajes",
  consentimiento_tatuajes_cejas: "Consentimiento Eliminación de Tatuajes y Cejas",
}

const DESCRIPTION_BY_TYPE: Record<FormType, string> = {
  ficha_dermatologica: "Complete y firme su consentimiento de Ficha Dermatológica para Cibao Spa Laser.",
  consentimiento_masajes: "Complete y firme su consentimiento de Masajes para Cibao Spa Laser.",
  consentimiento_tatuajes_cejas: "Complete y firme su consentimiento de Eliminación de Tatuajes y Cejas para Cibao Spa Laser.",
}

const GENERIC_TITLE = "Consentimiento Digital · Cibao Spa Laser"
const GENERIC_DESCRIPTION = "Complete y firme su consentimiento digital de Cibao Spa Laser."
const SITE_NAME = "Cibao Spa Laser"
const OG_IMAGE = "/cibao-spa-laser-logo.jpeg"

/**
 * Metadata dinámica por token — WhatsApp, Twitter y otros scrapers
 * preview-friendly. Sobrescribe el title/description default del
 * RootLayout (que dice "Sistema Integral de Mantenimientos") con el
 * nombre del consentimiento específico.
 *
 * Resolvemos el formType server-side leyendo el token (helper ya cachea
 * mínimo y filtra business_id). Si por alguna razón falla (token
 * inválido), caemos a un title genérico de Cibao Spa Laser — nunca al
 * default del sistema interno.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params
  let title = GENERIC_TITLE
  let description = GENERIC_DESCRIPTION
  try {
    const verified = await verifyPublicFormLink(String(token || ""))
    if (verified.formType && TITLE_BY_TYPE[verified.formType]) {
      title = `${TITLE_BY_TYPE[verified.formType]} · ${SITE_NAME}`
      description = DESCRIPTION_BY_TYPE[verified.formType]
    }
  } catch {
    // Mantenemos el title genérico — nunca cae al default del layout.
  }
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: SITE_NAME,
      images: [{ url: OG_IMAGE, width: 800, height: 600, alt: SITE_NAME }],
      locale: "es_DO",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
    robots: {
      // Links de un solo uso, NO queremos indexarlos.
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
  }
}

export default async function Page({ params }: PageProps) {
  const { token } = await params
  return <PublicFormPage token={token} />
}
