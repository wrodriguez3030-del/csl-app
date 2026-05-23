"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, FileSignature, Loader2, Send } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SignaturePad } from "@/components/signature-pad"
// REUTILIZAMOS las MISMAS secciones que el formulario interno — para que el
// cliente vía WhatsApp llene EXACTAMENTE el mismo cuestionario que el equipo
// llenaría adentro. Ver consentimientos-page.tsx para el contenido.
import {
  Field,
  MasajesTemplateSections,
  TatuajesTemplateSections,
  emptyRecord,
  type ConsentimientoRecord,
  type ConsentKind,
} from "@/components/consentimientos-page"

const TITLE: Record<ConsentKind, string> = {
  masajes: "Consentimiento — Masajes",
  tatuajes: "Consentimiento — Eliminación de Tatuajes y Cejas",
}

// Sucursales habituales — el form interno las trae del db.sucursales, pero
// el público no tiene sesión; usamos un fallback razonable. El operador
// puede ajustar la sucursal después si hace falta desde el módulo interno.
const SUCURSALES_FALLBACK = ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]

export interface PublicConsentPrefill {
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  servicio?: string  // se mapea a observaciones del procedimiento si aplica
}

interface Props {
  kind: ConsentKind
  prefill?: PublicConsentPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}

export function PublicConsentForm({ kind, prefill = {}, onSubmit }: Props) {
  // Estado del form: usa la MISMA shape ConsentimientoRecord que el interno,
  // para que el backend reciba exactamente lo mismo (consentToDb maneja todos
  // los campos sin omitir).
  const [form, setForm] = useState<ConsentimientoRecord>(() => ({
    ...emptyRecord(kind, prefill.sucursal || ""),
    nombreCliente: prefill.nombre || "",
    telefono: prefill.telefono || "",
    documento: prefill.documento || "",
    correo: prefill.correo || "",
    direccion: prefill.direccion || "",
    // Si vino "servicio" del operador y aplica al kind, lo pre-cargamos
    // en observaciones del procedimiento (el cliente lo puede ajustar).
    observaciones: prefill.servicio || "",
  }))
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Si llega prefill después del primer render (linkState async), hidratamos
  // solo los campos vacíos para no pisar nada que el cliente ya haya escrito.
  useEffect(() => {
    setForm((current) => ({
      ...current,
      nombreCliente: current.nombreCliente || prefill.nombre || "",
      telefono: current.telefono || prefill.telefono || "",
      documento: current.documento || prefill.documento || "",
      correo: current.correo || prefill.correo || "",
      direccion: current.direccion || prefill.direccion || "",
      sucursal: current.sucursal || prefill.sucursal || "",
      observaciones: current.observaciones || prefill.servicio || "",
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.nombre, prefill.telefono, prefill.documento, prefill.correo, prefill.direccion, prefill.sucursal, prefill.servicio])

  const update = (patch: Partial<ConsentimientoRecord>) => setForm((c) => ({ ...c, ...patch }))

  const submit = async () => {
    setError("")
    if (!form.nombreCliente.trim()) return setError("Tu nombre es obligatorio.")
    if (!form.telefono.trim()) return setError("Tu teléfono es obligatorio.")
    if (!form.sucursal) return setError("Selecciona la sucursal donde se realizará el procedimiento.")
    if (!form.firmaCliente) return setError("Debes firmar antes de enviar.")
    // Bloqueo clínico (mismo criterio que el form interno).
    if (kind === "masajes" && form.embarazo === "Sí") {
      return setError("No podemos continuar con el tratamiento durante el embarazo. Por favor consulte con el personal antes de enviar este formulario.")
    }
    if (kind === "tatuajes" && form.embarazoLactanciaSiNo === "Sí") {
      return setError("No podemos continuar con el tratamiento durante el embarazo o lactancia. Por favor consulte con el personal antes de enviar este formulario.")
    }
    // Validaciones específicas por tipo: las mismas que aplica el form interno.
    if (kind === "tatuajes") {
      if (!form.declaracionResultadosAceptada || !form.autorizacionFotograficaAceptada || !form.autorizacionProcedimientoAceptada) {
        return setError("Debes aceptar las declaraciones del consentimiento para enviar.")
      }
    } else if (kind === "masajes") {
      if (!form.declaracionAceptada || !form.autorizacionAceptada) {
        return setError("Debes aceptar las declaraciones del consentimiento para enviar.")
      }
    }
    setSubmitting(true)
    try {
      // El payload es la ConsentimientoRecord completa. El endpoint público
      // /api/public-form-links/[token]/submit lo pasa por consentToDb (el
      // mismo mapper que usa el handler interno saveConsentMasajes/...).
      await onSubmit({
        ...form,
        estado: "Firmado",
        fechaRegistro: form.fechaRegistro || new Date().toISOString(),
      } as unknown as Record<string, unknown>)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo enviar el formulario")
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-5 text-sm">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSignature className="h-5 w-5 text-primary" />
            {TITLE[kind]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Completa todos los campos. Cuando termines, firma y envía. El
            personal completará su firma en el sistema interno.
          </p>
        </CardContent>
      </Card>

      {/* Datos generales mínimos: fecha (auto), sucursal (obligatoria para
          que el registro quede correctamente asignado). ID y Estado se
          ocultan — son administrativos. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Datos generales</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha">
            <Input type="date" value={form.fecha} onChange={(e) => update({ fecha: e.target.value })} />
          </Field>
          <Field label="Sucursal *">
            <Select value={form.sucursal} onValueChange={(value) => update({ sucursal: value })}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
              <SelectContent>
                {SUCURSALES_FALLBACK.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {/* Datos del cliente — los mismos campos que el form interno. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Datos del cliente</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre completo *">
            <Input value={form.nombreCliente} onChange={(e) => update({ nombreCliente: e.target.value })} />
          </Field>
          <Field label="Cédula / Documento">
            <Input value={form.documento} onChange={(e) => update({ documento: e.target.value })} />
          </Field>
          <Field label="Teléfono *">
            <Input value={form.telefono} onChange={(e) => update({ telefono: e.target.value })} />
          </Field>
          <Field label="Correo">
            <Input type="email" value={form.correo} onChange={(e) => update({ correo: e.target.value })} />
          </Field>
          <Field label="Fecha de nacimiento">
            <Input type="date" value={form.fechaNacimiento} onChange={(e) => update({ fechaNacimiento: e.target.value })} />
          </Field>
          <Field label="Edad">
            <Input value={form.edad} onChange={(e) => update({ edad: e.target.value })} />
          </Field>
          <Field label="Dirección" className="sm:col-span-2">
            <Input value={form.direccion} onChange={(e) => update({ direccion: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      {/* Secciones específicas: REUTILIZAN el componente del interno. */}
      {kind === "masajes" ? (
        <MasajesTemplateSections form={form} onUpdate={update} />
      ) : (
        <TatuajesTemplateSections form={form} onUpdate={update} />
      )}

      {/* Firmas — la del especialista queda en blanco; la completa el
          personal después desde el sistema interno. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Firma del cliente</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <SignaturePad
            label="Firma del cliente"
            value={form.firmaCliente}
            onChange={(value) => update({ firmaCliente: value, estado: value ? "Firmado" : form.estado })}
          />
          <p className="text-[11px] text-muted-foreground">
            La firma del especialista se completará internamente al recibir tu envío.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          ⚠ {error}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-3 border-t bg-white/95 px-3 py-3 backdrop-blur">
        <Button
          onClick={submit}
          disabled={submitting || !form.firmaCliente}
          className="w-full gap-2"
          size="lg"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? "Enviando..." : "Enviar consentimiento firmado"}
        </Button>
      </div>
    </div>
  )
}

export function PublicConsentSuccess({ kind }: { kind: ConsentKind }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-500" />
        <h1 className="text-2xl font-bold">Formulario enviado correctamente</h1>
        <p className="mt-2 text-muted-foreground">
          Gracias. Cibao Spa Laser recibió tu {kind === "masajes" ? "consentimiento de masajes" : "consentimiento de eliminación de tatuajes/cejas"} firmado.
        </p>
      </div>
    </main>
  )
}
