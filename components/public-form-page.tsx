"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react"
import { FichaDermatologiaForm } from "@/components/ficha-dermatologia-form"
import { PublicConsentForm, PublicConsentSuccess } from "@/components/public-consent-form"
import { emptyFichaDermo, type FichaDermoCosmiatrica } from "@/lib/dermo-cosmiatria"

type FormType =
  | "ficha_dermatologica"
  | "consentimiento_masajes"
  | "consentimiento_tatuajes_cejas"

type LinkStatus = "valido" | "usado" | "expirado" | "cancelado" | "invalido" | "loading" | "error"

interface VerifyResponse {
  ok: boolean
  status: Exclude<LinkStatus, "loading" | "error">
  formType: FormType | null
  clienteNombre: string | null
  clienteTelefono: string | null
  expiraEn: string | null
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
  const [success, setSuccess] = useState<{ formType: FormType } | null>(null)

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
    let result: { ok?: boolean; error?: string; status?: string; formType?: FormType } = {}
    try { result = raw ? JSON.parse(raw) : {} } catch { result = { error: raw } }
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Error ${response.status}`)
    }
    if (result.formType) setSuccess({ formType: result.formType })
  }, [token])

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (success) {
    if (success.formType === "ficha_dermatologica") {
      return (
        <main className="min-h-screen bg-background px-4 py-10">
          <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-500" />
            <h1 className="text-2xl font-bold">Ficha enviada correctamente</h1>
            <p className="mt-2 text-muted-foreground">Gracias. Cibao Spa Laser recibió tu ficha dermo-cosmiátrica firmada.</p>
          </div>
        </main>
      )
    }
    const kind = success.formType === "consentimiento_masajes" ? "masajes" : "tatuajes"
    return <PublicConsentSuccess kind={kind} />
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

  if (formType === "ficha_dermatologica") {
    // Pre-llenar nombre/teléfono si el operador los puso al generar el link.
    // emptyFichaDermo provee todos los campos requeridos por TS.
    const initial: FichaDermoCosmiatrica = {
      ...emptyFichaDermo,
      id: `dermo_${Date.now()}`,
      fecha: new Date().toISOString().slice(0, 10),
      nombre: linkState.clienteNombre || "",
      telefono: linkState.clienteTelefono || "",
    }
    return (
      <main className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto max-w-5xl">
          <FichaDermatologiaForm
            initialValue={initial}
            // El form requiere onSubmit, no operadoras ni clientes (no auth aquí).
            operadoras={[]}
            clientes={[]}
            onSubmit={async (value) => { await submit(value as unknown as Record<string, unknown>) }}
          />
        </div>
      </main>
    )
  }

  const kind = formType === "consentimiento_masajes" ? "masajes" : "tatuajes"
  return (
    <main className="min-h-screen bg-background">
      <PublicConsentForm
        kind={kind}
        initialNombre={linkState.clienteNombre || ""}
        initialTelefono={linkState.clienteTelefono || ""}
        onSubmit={submit}
      />
    </main>
  )
}
