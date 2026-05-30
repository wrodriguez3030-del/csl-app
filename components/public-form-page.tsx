"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Clock, Loader2 } from "lucide-react"
import { PublicFichaConsentForm } from "@/components/public-ficha-consent-form"
import { PublicMasajesConsentForm } from "@/components/public-masajes-consent-form"
import { PublicTatuajesConsentForm } from "@/components/public-tatuajes-consent-form"
import { SolicitudEmpleoPublicaPage } from "@/app/solicitud-empleo/solicitud-empleo-form"

type FormType =
  | "ficha_dermatologica"
  | "consentimiento_masajes"
  | "consentimiento_tatuajes_cejas"
  | "solicitud_empleo"

type LinkStatus = "valido" | "usado" | "expirado" | "cancelado" | "invalido" | "loading" | "error"

interface PrefillPayload {
  clienteId?: string
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string
  motivoConsulta?: string
  servicio?: string
}

interface VerifyResponse {
  ok: boolean
  status: Exclude<LinkStatus, "loading" | "error">
  formType: FormType | null
  clienteNombre: string | null
  clienteTelefono: string | null
  prefillPayload: PrefillPayload | null
  expiraEn: string | null
  /** Slug del tenant (csl | depicenter | …) — se inyecta a los 3 forms
   *  públicos para que rendereen la marca correcta en lugar del hardcoded
   *  "CIBAO SPA LASER". */
  businessSlug?: string | null
}

function StatusCard({
  icon,
  title,
  description,
  tone,
}: {
  icon: React.ReactNode
  title: string
  description: string
  tone: "ok" | "warn" | "error"
}) {
  const colors = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    error: "border-rose-200 bg-rose-50 text-rose-700",
  }[tone]
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className={`mx-auto max-w-md rounded-2xl border p-8 text-center shadow-sm ${colors}`}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">{icon}</div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm">{description}</p>
      </div>
    </main>
  )
}

export function PublicFormPage({ token }: { token: string }) {
  const [linkState, setLinkState] = useState<VerifyResponse | null>(null)
  const [status, setStatus] = useState<LinkStatus>("loading")

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const response = await fetch(`/api/public-form-links/${encodeURIComponent(token)}`, {
          method: "GET",
          cache: "no-store",
        })
        const result = (await response.json().catch(() => null)) as VerifyResponse | null
        if (!active) return
        if (!result || !result.ok) {
          setStatus("error")
          return
        }
        setLinkState(result)
        setStatus(result.status)
      } catch {
        if (active) setStatus("error")
      }
    })()
    return () => { active = false }
  }, [token])

  const submit = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch(`/api/public-form-links/${encodeURIComponent(token)}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const raw = await response.text()
    let result: { ok?: boolean; error?: string; status?: string; formType?: FormType; recordId?: string } = {}
    try { result = raw ? JSON.parse(raw) : {} } catch { result = { error: raw } }
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Error ${response.status}`)
    }
    // Los tres forms (ficha + masajes + tatuajes) manejan su propio success
    // localmente — muestran botón "Descargar PDF formal". La página NO
    // intercepta success aquí.
    return { recordId: result.recordId }
  }, [token])

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (status === "usado") {
    return (
      <StatusCard
        tone="warn"
        icon={<AlertCircle className="h-12 w-12 text-amber-500" />}
        title="Este enlace ya fue utilizado"
        description="Si necesitas firmar de nuevo, solicita un nuevo enlace al personal del centro."
      />
    )
  }

  if (status === "expirado") {
    return (
      <StatusCard
        tone="warn"
        icon={<Clock className="h-12 w-12 text-amber-500" />}
        title="Este enlace expiró"
        description="Los enlaces son válidos por 12 horas. Solicita uno nuevo al personal del centro."
      />
    )
  }

  if (status === "cancelado") {
    return (
      <StatusCard
        tone="warn"
        icon={<AlertCircle className="h-12 w-12 text-amber-500" />}
        title="Este enlace fue cancelado"
        description="Solicita un enlace nuevo al personal del centro."
      />
    )
  }

  if (status === "invalido" || status === "error" || !linkState?.formType) {
    return (
      <StatusCard
        tone="error"
        icon={<AlertCircle className="h-12 w-12 text-rose-500" />}
        title="Enlace inválido"
        description="El enlace no es válido. Verifica que sea el correcto o solicita uno nuevo."
      />
    )
  }

  const formType = linkState.formType

  // Pre-fill rico — todos los campos que el operador haya llenado al generar
  // el link aparecen ya cargados en el form. El cliente puede corregirlos.
  const pf = linkState.prefillPayload || {}

  if (formType === "solicitud_empleo") {
    return (
      <SolicitudEmpleoPublicaPage
        forcedBusinessSlug={linkState.businessSlug || "csl"}
        onSubmit={async (payload) => {
          const result = await submit(payload)
          return result
        }}
      />
    )
  }

  if (formType === "ficha_dermatologica") {
    // Form público de Ficha Dermatológica = consentimiento formal +
    // declaración + firma del cliente. Los campos clínicos (antecedentes,
    // alergias, evaluación, etc.) los completa el especialista después
    // desde el sistema interno. El cliente ve solo el documento legal.
    return (
      <main className="min-h-screen bg-background">
        <PublicFichaConsentForm
          businessSlug={linkState.businessSlug || "csl"}
          prefill={{
            clienteId: pf.clienteId || "",
            nombre: pf.nombre || linkState.clienteNombre || "",
            telefono: pf.telefono || linkState.clienteTelefono || "",
            documento: pf.documento || "",
            correo: pf.correo || "",
            direccion: pf.direccion || "",
            sucursal: pf.sucursal || "",
            especialista: pf.especialista || "",
            motivoConsulta: pf.motivoConsulta || "",
          }}
          onSubmit={async (value) => {
            await submit(value)
          }}
        />
      </main>
    )
  }

  // Consentimientos (masajes + tatuajes/cejas): mismo modelo "sólo documento
  // formal + firma" que la ficha. El cliente NO ve formularios clínicos —
  // los completa el especialista internamente.
  const commonPrefill = {
    clienteId: pf.clienteId || "",
    nombre: pf.nombre || linkState.clienteNombre || "",
    telefono: pf.telefono || linkState.clienteTelefono || "",
    documento: pf.documento || "",
    correo: pf.correo || "",
    direccion: pf.direccion || "",
    sucursal: pf.sucursal || "",
    especialista: pf.especialista || "",
    servicio: pf.servicio || "",
  }
  const businessSlug = linkState.businessSlug || "csl"
  if (formType === "consentimiento_masajes") {
    return (
      <main className="min-h-screen bg-background">
        <PublicMasajesConsentForm businessSlug={businessSlug} prefill={commonPrefill} onSubmit={async (value) => { await submit(value) }} />
      </main>
    )
  }
  return (
    <main className="min-h-screen bg-background">
      <PublicTatuajesConsentForm businessSlug={businessSlug} prefill={commonPrefill} onSubmit={async (value) => { await submit(value) }} />
    </main>
  )
}
