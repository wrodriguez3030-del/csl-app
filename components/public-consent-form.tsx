"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, FileSignature, Loader2, Send } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"

// Read-only display de un campo cliente (modo público — no editable).
function ReadOnlyField({ label, value, className }: { label: string; value?: string; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className="mt-1 min-h-[40px] rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        {value && value.trim() ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  )
}
// REUTILIZAMOS las MISMAS secciones que el formulario interno — para que el
// cliente vía WhatsApp llene EXACTAMENTE el mismo cuestionario que el equipo
// llenaría adentro. Ver consentimientos-page.tsx para el contenido.
import {
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


export interface PublicConsentPrefill {
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string  // recepción ya eligió quién atiende
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
    nombreEspecialista: prefill.especialista || "",
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
      nombreEspecialista: current.nombreEspecialista || prefill.especialista || "",
      observaciones: current.observaciones || prefill.servicio || "",
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill.nombre, prefill.telefono, prefill.documento, prefill.correo, prefill.direccion, prefill.sucursal, prefill.especialista, prefill.servicio])

  const update = (patch: Partial<ConsentimientoRecord>) => setForm((c) => ({ ...c, ...patch }))

  // Estado unificado de la declaración final. Al togglearlo, sincronizamos
  // TODOS los campos de aceptación legacy del shape ConsentimientoRecord para
  // que el backend (consentToDb) reciba lo mismo que recibiría desde el form
  // interno. El cliente acepta UNA sola vez, pero internamente queda cumplido
  // el contrato legal multi-acceptance.
  const [declaracionUnificada, setDeclaracionUnificada] = useState(false)
  const handleDeclaracionUnificada = (checked: boolean) => {
    setDeclaracionUnificada(checked)
    update({
      declaracionAceptada: checked,
      autorizacionAceptada: checked,
      declaracionResultadosAceptada: checked,
      autorizacionFotograficaAceptada: checked,
      autorizacionProcedimientoAceptada: checked,
    })
  }

  const submit = async () => {
    setError("")
    if (!form.nombreCliente.trim()) return setError("Falta el nombre del cliente. Comuníquese con recepción.")
    if (!form.telefono.trim()) return setError("Falta el teléfono. Comuníquese con recepción.")
    if (!form.sucursal) return setError("Falta la sucursal. Comuníquese con recepción.")
    // Bloqueo clínico (mismo criterio que el form interno).
    if (kind === "masajes" && form.embarazo === "Sí") {
      return setError("No podemos continuar con el tratamiento durante el embarazo. Por favor consulte con el personal antes de enviar este formulario.")
    }
    if (kind === "tatuajes" && form.embarazoLactanciaSiNo === "Sí") {
      return setError("No podemos continuar con el tratamiento durante el embarazo o lactancia. Por favor consulte con el personal antes de enviar este formulario.")
    }
    // Declaración unificada — reemplaza las múltiples checks anteriores.
    if (!declaracionUnificada) {
      return setError("Debes aceptar la declaración antes de firmar y enviar.")
    }
    if (!form.firmaCliente) return setError("Debes firmar antes de enviar.")
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
          ocultan — son administrativos.
          Card "Datos generales" REMOVIDA en público — fecha = hoy (auto),
          sucursal = pre-cargada por el operador. El cliente las ve dentro
          de "Cliente vinculado" como solo lectura. */}

      {/* Cliente vinculado — el operador ya seleccionó al cliente y pre-cargó
          sus datos al generar el link. SOLO LECTURA en público: el cliente
          NO puede editar; si algo está mal, llama a recepción. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cliente vinculado</CardTitle>
          <p className="text-xs text-muted-foreground">
            Estos datos fueron cargados por el personal. Si algún dato es
            incorrecto, comuníquese con recepción.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Nombre completo" value={form.nombreCliente} />
          <ReadOnlyField label="Teléfono" value={form.telefono} />
          <ReadOnlyField label="Cédula / Documento" value={form.documento} />
          <ReadOnlyField label="Correo" value={form.correo} />
          <ReadOnlyField label="Dirección" value={form.direccion} className="sm:col-span-2" />
          {form.sucursal ? <ReadOnlyField label="Sucursal" value={form.sucursal} /> : null}
          {form.nombreEspecialista ? <ReadOnlyField label="Especialista" value={form.nombreEspecialista} /> : null}
        </CardContent>
      </Card>

      {/* Secciones específicas: REUTILIZAN el componente del interno. */}
      {kind === "masajes" ? (
        <MasajesTemplateSections form={form} onUpdate={update} />
      ) : (
        <TatuajesTemplateSections form={form} onUpdate={update} />
      )}

      {/* Declaración y firma — unificada: una sola autorización + un solo
          checkbox que cubre todas las aceptaciones legacy (declaración,
          autorización fotográfica, políticas, autorización final). El cliente
          solo firma; la firma del especialista la completa el personal. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" />
            Declaración y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              {kind === "masajes"
                ? "Declaro que la información suministrada es verdadera y completa. Confirmo que he leído y comprendido este consentimiento, y que se me han explicado los beneficios, posibles molestias y cuidados antes y después del procedimiento de masaje."
                : "Declaro que la información suministrada es verdadera y completa. Confirmo que he leído y comprendido este consentimiento, y que se me han explicado los beneficios, riesgos (enrojecimiento, ampollas, cambios pigmentarios, cicatrices, infección, resultado parcial) y cuidados antes y después del procedimiento de eliminación de tatuajes o cejas."}
            </p>
            <p className="mt-2 font-semibold text-foreground">
              Autorizo a Cibao Spa Laser y a su personal a realizar el procedimiento descrito.
            </p>
          </div>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-white p-3 text-sm transition-colors ${
              declaracionUnificada
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-rose-400 bg-rose-50/40 ring-1 ring-rose-200"
            }`}
          >
            <Checkbox checked={declaracionUnificada} onCheckedChange={(checked) => handleDeclaracionUnificada(checked === true)} />
            <span className="flex-1">
              Declaro que la información suministrada es verdadera y completa,
              y autorizo el procedimiento descrito.
              {!declaracionUnificada ? (
                <span className="mt-1 block text-[11px] font-semibold text-rose-600">
                  Pendiente — marca esta casilla para poder enviar.
                </span>
              ) : null}
            </span>
          </label>
          <div className={!form.firmaCliente ? "rounded-xl ring-2 ring-rose-400 ring-offset-2" : ""}>
            <SignaturePad
              label="Firma del cliente *"
              value={form.firmaCliente}
              onChange={(value) => update({ firmaCliente: value, estado: value ? "Firmado" : form.estado })}
            />
          </div>
          {!form.firmaCliente ? (
            <p className="text-[11px] font-semibold text-rose-600">
              Pendiente — firma en el recuadro de arriba para poder enviar.
            </p>
          ) : null}
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

      {!submitting && (!declaracionUnificada || !form.firmaCliente) ? (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-sm">
          <p className="font-bold text-rose-700">⚠ Para enviar, completa:</p>
          <ul className="mt-1 list-disc pl-5 text-rose-700">
            {!declaracionUnificada ? <li>Marcar la casilla de aceptación del consentimiento</li> : null}
            {!form.firmaCliente ? <li>Firmar en el recuadro de Firma del cliente</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-3 border-t bg-white/95 px-3 py-3 backdrop-blur">
        <Button
          onClick={submit}
          disabled={submitting || !form.firmaCliente || !declaracionUnificada}
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
