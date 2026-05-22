"use client"

import { useState } from "react"
import { CheckCircle2, FileSignature, Loader2, Send } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SignaturePad } from "@/components/signature-pad"

// Texto canónico del consentimiento por tipo. Mantener corto y legal — el
// detalle clínico lo captura el especialista internamente; acá el cliente
// solo confirma que entendió y firma.
const CONSENT_TEXT: Record<"masajes" | "tatuajes", string[]> = {
  masajes: [
    "Autorizo voluntariamente la realización del procedimiento de masaje en Cibao Spa Laser y declaro haber recibido información clara sobre la naturaleza, beneficios esperados, posibles molestias y cuidados antes y después de la sesión.",
    "Declaro que he informado de manera completa y verdadera mis antecedentes médicos relevantes (alergias, embarazo, lesiones, cirugías, medicamentos, condiciones de piel u otras).",
    "Entiendo que los resultados pueden variar según mi respuesta individual y que el centro no garantiza resultados específicos.",
    "Acepto seguir las indicaciones del personal y notificar cualquier molestia inusual durante o después del procedimiento.",
    "Autorizo a Cibao Spa Laser a registrar mi firma digital como respaldo del presente consentimiento.",
  ],
  tatuajes: [
    "Autorizo voluntariamente el procedimiento de eliminación de tatuajes y/o pigmentos en cejas mediante láser, y declaro haber recibido información sobre el procedimiento, alternativas y posibles riesgos (enrojecimiento, ampollas, cambios de pigmentación, cicatrices, infección, resultado parcial).",
    "Declaro que he informado mis antecedentes médicos, medicamentos, alergias, embarazo/lactancia, queloides, exposición solar reciente y otros datos relevantes.",
    "Entiendo que pueden requerirse varias sesiones y que los resultados varían según tipo de tinta, profundidad, antigüedad y respuesta individual de mi piel.",
    "Acepto seguir las instrucciones de cuidados pre y post procedimiento, evitar exposición solar y aplicar las indicaciones del personal.",
    "Autorizo a Cibao Spa Laser a registrar mi firma digital como respaldo del presente consentimiento.",
  ],
}

const TITLE: Record<"masajes" | "tatuajes", string> = {
  masajes: "Consentimiento — Masajes",
  tatuajes: "Consentimiento — Eliminación de Tatuajes y Cejas",
}

interface Props {
  kind: "masajes" | "tatuajes"
  initialNombre?: string
  initialTelefono?: string
  onSubmit: (payload: Record<string, unknown>) => Promise<void>
}

interface FormState {
  nombreCliente: string
  documento: string
  telefono: string
  correo: string
  fechaNacimiento: string
  direccion: string
  zonaTratar: string
  observaciones: string
  declaracionAceptada: boolean
  firmaCliente: string
}

export function PublicConsentForm({ kind, initialNombre = "", initialTelefono = "", onSubmit }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<FormState>({
    nombreCliente: initialNombre,
    documento: "",
    telefono: initialTelefono,
    correo: "",
    fechaNacimiento: "",
    direccion: "",
    zonaTratar: "",
    observaciones: "",
    declaracionAceptada: false,
    firmaCliente: "",
  })
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const update = (patch: Partial<FormState>) => setForm((c) => ({ ...c, ...patch }))

  const submit = async () => {
    setError("")
    if (!form.nombreCliente.trim()) return setError("Tu nombre es obligatorio.")
    if (!form.telefono.trim()) return setError("Tu teléfono es obligatorio.")
    if (!form.declaracionAceptada) return setError("Debes aceptar la declaración para firmar.")
    if (!form.firmaCliente) return setError("Debes firmar antes de enviar.")
    setSubmitting(true)
    try {
      await onSubmit({
        fecha: today,
        sucursal: "",
        nombreCliente: form.nombreCliente.trim(),
        documento: form.documento.trim(),
        telefono: form.telefono.trim(),
        correo: form.correo.trim(),
        fechaNacimiento: form.fechaNacimiento || "",
        direccion: form.direccion.trim(),
        zonaTratar: form.zonaTratar.trim(),
        observaciones: form.observaciones.trim(),
        textoConsentimiento: CONSENT_TEXT[kind].join("\n\n"),
        declaracionAceptada: true,
        firmaCliente: form.firmaCliente,
        firmaEspecialista: "",
        fechaRegistro: new Date().toISOString(),
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo enviar el formulario")
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 text-sm">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSignature className="h-5 w-5 text-primary" />
            {TITLE[kind]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Completa los datos, lee y acepta la declaración, firma y envía. El especialista
            completará los detalles médicos internamente.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Datos del cliente</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Nombre completo *</Label>
            <Input value={form.nombreCliente} onChange={(e) => update({ nombreCliente: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Cédula / Documento</Label>
            <Input value={form.documento} onChange={(e) => update({ documento: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Teléfono *</Label>
            <Input value={form.telefono} onChange={(e) => update({ telefono: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Correo</Label>
            <Input type="email" value={form.correo} onChange={(e) => update({ correo: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Fecha de nacimiento</Label>
            <Input type="date" value={form.fechaNacimiento} onChange={(e) => update({ fechaNacimiento: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label>Zona a tratar</Label>
            <Input value={form.zonaTratar} onChange={(e) => update({ zonaTratar: e.target.value })} placeholder="Ej. espalda, cejas..." className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label>Dirección</Label>
            <Input value={form.direccion} onChange={(e) => update({ direccion: e.target.value })} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label>Observaciones</Label>
            <Textarea value={form.observaciones} onChange={(e) => update({ observaciones: e.target.value })} className="mt-1 min-h-[60px]" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Declaración informada</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border bg-muted/30 p-3 text-[13px] leading-relaxed">
            {CONSENT_TEXT[kind].map((paragraph, idx) => (
              <p key={idx} className={idx > 0 ? "mt-2" : ""}>{paragraph}</p>
            ))}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.declaracionAceptada}
              onChange={(e) => update({ declaracionAceptada: e.target.checked })}
              className="mt-1"
            />
            <span>He leído y acepto la declaración anterior. Autorizo el procedimiento.</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Firma del cliente</CardTitle></CardHeader>
        <CardContent>
          <SignaturePad
            label="Firma del cliente"
            value={form.firmaCliente}
            onChange={(value) => update({ firmaCliente: value })}
          />
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          ⚠ {error}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t bg-white/95 px-4 py-3 backdrop-blur">
        <Button
          onClick={submit}
          disabled={submitting || !form.firmaCliente || !form.declaracionAceptada}
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

export function PublicConsentSuccess({ kind }: { kind: "masajes" | "tatuajes" }) {
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
