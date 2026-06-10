import type { Metadata } from "next"
import { PublicFormPage } from "@/components/public-form-page"
import { verifyPublicFormLink, type FormType } from "@/lib/server/public-form-links"
import { BUSINESS_FALLBACK } from "@/lib/business"
import { getSupabaseAdmin } from "@/lib/server/supabase"

export const dynamic = "force-dynamic"
export const revalidate = 0

interface PageProps {
  params: Promise<{ token: string }>
}

// Etiquetas legales por tipo — espejo de FORM_TYPE_LABEL del helper.
const TITLE_BY_TYPE: Record<FormType, string> = {
  ficha_dermatologica: "Consentimiento Ficha Dermatológica",
  consentimiento_masajes: "Consentimiento Masajes",
  consentimiento_peeling: "Consentimiento Informado para Peeling",
  consentimiento_tatuajes_cejas: "Consentimiento Eliminación de Tatuajes y Cejas",
  solicitud_empleo: "Solicitud de empleo",
}

const DESCRIPTION_BY_TYPE: Record<FormType, string> = {
  ficha_dermatologica: "Complete y firme su consentimiento de Ficha Dermatológica.",
  consentimiento_masajes: "Complete y firme su consentimiento de Masajes.",
  consentimiento_peeling: "Complete y firme su consentimiento informado para Peeling.",
  consentimiento_tatuajes_cejas: "Complete y firme su consentimiento de Eliminación de Tatuajes y Cejas.",
  solicitud_empleo: "Completa tu solicitud de empleo.",
}

const GENERIC_TITLE = "Consentimiento Digital"
const GENERIC_DESCRIPTION = "Complete y firme su consentimiento digital."

/** Resuelve business_id → slug consultando la tabla businesses. Si falla,
 *  cae a "csl" como default. */
async function lookupBusinessSlug(businessId: string | null | undefined): Promise<string> {
  if (!businessId) return "csl"
  try {
    const { data } = await getSupabaseAdmin()
      .from("businesses").select("slug").eq("id", businessId).maybeSingle()
    return data?.slug || "csl"
  } catch {
    return "csl"
  }
}

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
  // Branding por defecto = CSL. Si el token apunta a Depicenter (u otro
  // tenant futuro), se sobreescribe abajo con el slug correcto.
  let siteName = BUSINESS_FALLBACK.csl.name
  let ogImage = BUSINESS_FALLBACK.csl.logoUrl
  try {
    const verified = await verifyPublicFormLink(String(token || ""))
    // Resolver tenant del link → ajustar siteName/logo dinámicamente.
    const slug = await lookupBusinessSlug(verified.link?.business_id)
    const business = BUSINESS_FALLBACK[slug as keyof typeof BUSINESS_FALLBACK] || BUSINESS_FALLBACK.csl
    siteName = business.name
    ogImage = business.logoUrl
    if (verified.formType && TITLE_BY_TYPE[verified.formType]) {
      title = `${TITLE_BY_TYPE[verified.formType]} · ${siteName}`
      description = `${DESCRIPTION_BY_TYPE[verified.formType]} ${siteName}.`
    } else {
      title = `${GENERIC_TITLE} · ${siteName}`
      description = `${GENERIC_DESCRIPTION} ${siteName}.`
    }
  } catch {
    // Mantenemos el title genérico de CSL — nunca cae al default del layout.
    title = `${GENERIC_TITLE} · ${siteName}`
    description = `${GENERIC_DESCRIPTION} ${siteName}.`
  }
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName,
      images: [{ url: ogImage, width: 800, height: 600, alt: siteName }],
      locale: "es_DO",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
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
