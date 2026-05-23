"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSignature, Loader2, Send, UserRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"

// Read-only display de un campo cliente — el cliente ve los datos
// pre-cargados por el operador, NO puede editarlos.
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

export interface PublicFichaPrefill {
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string
  motivoConsulta?: string
}

interface Props {
  prefill?: PublicFichaPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
}

const TITULO_DOC = "Consentimiento informado para procedimiento dermatológico / cosmiatría"

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildPdfBaseName(nombre: string): string {
  const today = new Date().toISOString().slice(0, 10)
  const slug = (nombre || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "cliente"
  return `consentimiento-dermatologia-${slug}-${today}`
}

function buildPrintHtml(args: {
  cliente: Required<PublicFichaPrefill>
  fechaFirma: string
  firmaDataUrl: string
  recordId: string
}) {
  const { cliente, fechaFirma, firmaDataUrl, recordId } = args
  return `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(buildPdfBaseName(cliente.nombre))}</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .header { border-bottom: 3px solid #00897b; padding-bottom: 10px; margin-bottom: 14px; }
  .logo { font-size: 18px; font-weight: 800; color: #00897b; letter-spacing: .02em; }
  .center { text-align: center; }
  .meta { color: #475569; font-size: 10px; margin-top: 2px; }
  h1 { font-size: 14px; margin: 6px 0 2px; }
  h2 { font-size: 11.5px; background: #00897b; color: white; padding: 5px 8px; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; }
  p { margin: 4px 0; line-height: 1.45; text-align: justify; }
  ul, ol { margin: 4px 0 4px 18px; line-height: 1.5; }
  li { margin: 2px 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 4px 0; }
  .field { padding: 3px 0; border-bottom: 1px dotted #aab6c5; }
  .field b { color: #0f172a; min-width: 100px; display: inline-block; }
  .sign-box { margin-top: 16px; border: 1px solid #d7dee8; border-radius: 6px; padding: 12px; }
  .sign-img { max-width: 320px; max-height: 110px; object-fit: contain; display: block; margin: 6px auto; border-bottom: 1px solid #111827; }
  .sign-cap { text-align: center; font-weight: 700; font-size: 10px; color: #334155; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header center">
  <div class="logo">CIBAO SPA LASER</div>
  <h1>${escapeHtml(TITULO_DOC)}</h1>
  <div class="meta">Fecha de firma: ${escapeHtml(fechaFirma)} · Ref: ${escapeHtml(recordId)}</div>
</div>

<h2>Datos del cliente</h2>
<div class="grid2">
  <div class="field"><b>Nombre:</b> ${escapeHtml(cliente.nombre || "—")}</div>
  <div class="field"><b>Teléfono:</b> ${escapeHtml(cliente.telefono || "—")}</div>
  <div class="field"><b>Cédula / Doc:</b> ${escapeHtml(cliente.documento || "—")}</div>
  <div class="field"><b>Correo:</b> ${escapeHtml(cliente.correo || "—")}</div>
  <div class="field" style="grid-column: 1 / -1"><b>Dirección:</b> ${escapeHtml(cliente.direccion || "—")}</div>
  <div class="field"><b>Sucursal:</b> ${escapeHtml(cliente.sucursal || "—")}</div>
  <div class="field"><b>Especialista:</b> ${escapeHtml(cliente.especialista || "—")}</div>
</div>

<h2>Procedimiento</h2>
<p>Limpieza facial y/o tratamientos de cosmiatría.</p>

<h2>Descripción del procedimiento</h2>
<p>El tratamiento de cosmiatría en Cibao Spa Láser puede incluir, pero no se limita a, limpieza facial profunda, peelings químicos y tratamientos con láser, entre otros. Estos procedimientos están diseñados para mejorar la apariencia de la piel y abordar condiciones como arrugas, manchas, cicatrices y otros signos de envejecimiento.</p>

<h2>Declaraciones del cliente</h2>
<ol>
  <li>Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del o los procedimientos a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
  <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
  <li>Entiendo que el procedimiento solicitado tiene como objetivo mejorar mi apariencia física.</li>
  <li>Comprendo que los resultados están relacionados con la respuesta individual de mi organismo y que los procesos estéticos no son una ciencia exacta, por lo que no se puede garantizar perfección absoluta ni resultados idénticos en todas las personas.</li>
  <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.</li>
  <li>Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
  <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.</li>
</ol>

<h2>Instrucciones antes del procedimiento</h2>
<ul>
  <li>Asistir a la consulta para determinar el tratamiento adecuado según sus necesidades.</li>
  <li>Informar al profesional sobre enfermedades, alergias, tratamientos médicos previos y uso de medicamentos.</li>
  <li>Evitar la exposición solar y el uso de camas solares al menos dos semanas antes del tratamiento.</li>
  <li>Aplicar bloqueador solar de amplio espectro según indicación profesional.</li>
  <li>Evitar medicamentos antiinflamatorios, anticoagulantes y productos que contengan ácidos, como retinoides, al menos cinco días antes del tratamiento, siempre bajo supervisión médica.</li>
  <li>Mantener una buena hidratación bebiendo suficiente agua en los días previos al tratamiento.</li>
  <li>Evitar alcohol y tabaco 48 horas antes del procedimiento.</li>
  <li>Lavar el rostro con un limpiador suave el día del tratamiento y evitar el uso de maquillaje.</li>
</ul>

<h2>Cuidados después del tratamiento</h2>
<ul>
  <li>Evitar la exposición solar directa en la zona tratada durante al menos dos semanas.</li>
  <li>Aplicar bloqueador solar según las indicaciones recibidas.</li>
  <li>No tocar, rascar ni manipular la piel tratada para prevenir complicaciones.</li>
  <li>Utilizar la crema hidratante recomendada por el especialista para ayudar en la recuperación de la piel.</li>
  <li>Evitar actividades físicas intensas, saunas o baños calientes durante al menos 48 horas después del tratamiento.</li>
  <li>Seguir las recomendaciones sobre productos específicos para el cuidado posterior.</li>
  <li>Informar al centro si presenta síntomas inusuales, molestias importantes o cualquier reacción inesperada.</li>
</ul>

<h2>Riesgos y posibles efectos secundarios</h2>
<p>Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta. Se me han informado los riesgos, posibles complicaciones y efectos secundarios, que pueden incluir:</p>
<ul>
  <li>Enrojecimiento o irritación de la piel.</li>
  <li>Hinchazón.</li>
  <li>Hipersensibilidad.</li>
  <li>Infecciones.</li>
  <li>Resultados no deseados o insatisfactorios.</li>
</ul>
<p>También entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.</p>

<h2>Políticas y procedimientos</h2>
<ul>
  <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
  <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
  <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
  <li>La validez de los servicios es de dos años desde la fecha de compra, cuando aplique.</li>
  <li>Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.</li>
  <li>Los precios en Cibao Spa Láser no incluyen ITBIS.</li>
  <li>El tiempo de la cita no puede extenderse si afecta el itinerario programado.</li>
  <li>Si el retraso es responsabilidad del centro, el tiempo será repuesto.</li>
  <li>Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.</li>
</ul>

<h2>Protección de datos</h2>
<p>Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos generales mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.</p>

<h2>Autorización</h2>
<p>He sido informado/a sobre el procedimiento, incluyendo sus riesgos, posibles complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias.</p>
<p>Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza un resultado específico o absoluto.</p>
<p>Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil, en caso de complicaciones que puedan surgir durante o después del tratamiento, siempre que se haya actuado conforme a los protocolos establecidos.</p>

<h2>Declaración y firma</h2>
<p>Declaro que he leído, comprendido y acepto el contenido de este consentimiento informado. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.</p>

<div class="sign-box">
  ${firmaDataUrl ? `<img class="sign-img" src="${firmaDataUrl}" alt="Firma del cliente" />` : '<div class="sign-img"></div>'}
  <div class="sign-cap">Firma del cliente — ${escapeHtml(cliente.nombre || "Cliente")}</div>
</div>

<div class="footer">
  Cibao Spa Láser · Documento generado el ${escapeHtml(new Date().toLocaleString("es-DO"))} · Ref ${escapeHtml(recordId)}
</div>

</body></html>`
}

export function PublicFichaConsentForm({ prefill = {}, onSubmit }: Props) {
  const cliente: Required<PublicFichaPrefill> = {
    nombre: prefill.nombre || "",
    telefono: prefill.telefono || "",
    documento: prefill.documento || "",
    correo: prefill.correo || "",
    direccion: prefill.direccion || "",
    sucursal: prefill.sucursal || "",
    especialista: prefill.especialista || "",
    motivoConsulta: prefill.motivoConsulta || "",
  }

  const [firma, setFirma] = useState("")
  const [aceptado, setAceptado] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ recordId: string; fechaFirma: string; firma: string } | null>(null)

  const submit = async () => {
    setError("")
    if (!cliente.nombre.trim()) return setError("Falta el nombre del cliente. Comuníquese con recepción.")
    if (!cliente.telefono.trim()) return setError("Falta el teléfono. Comuníquese con recepción.")
    if (!cliente.sucursal) return setError("Falta la sucursal. Comuníquese con recepción.")
    if (!aceptado) return setError("Debes marcar la aceptación antes de firmar.")
    if (!firma) return setError("Debes firmar antes de enviar.")
    setSubmitting(true)
    try {
      // Construimos un payload con shape FichaDermoCosmiatrica mínimo. El
      // backend (fichaDermoToDb) acepta el resto vacío; el especialista
      // completa los campos clínicos después desde el sistema interno.
      const id = `dermo_${Date.now()}`
      const payload = {
        id,
        fecha: new Date().toISOString().slice(0, 10),
        sucursal: cliente.sucursal,
        operadora: cliente.especialista,
        especialista: cliente.especialista,
        nombreEspecialista: cliente.especialista,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        cedula: cliente.documento,
        documento: cliente.documento,
        email: cliente.correo,
        direccion: cliente.direccion,
        motivoConsulta: cliente.motivoConsulta,
        firma,
        firmaEspecialista: "",
        declaracionAceptada: true,
        // estado lo fuerza el backend a "Pendiente de revisión"
      } as unknown as Record<string, unknown>
      const result = await onSubmit(payload)
      const recordId = (result && typeof result === "object" && "recordId" in result && result.recordId) ? String(result.recordId) : id
      setSuccess({ recordId, fechaFirma: new Date().toLocaleString("es-DO"), firma })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo enviar el formulario")
      setSubmitting(false)
    }
  }

  const downloadPdf = () => {
    if (!success) return
    const html = buildPrintHtml({
      cliente,
      fechaFirma: success.fechaFirma,
      firmaDataUrl: success.firma,
      recordId: success.recordId,
    })
    const popup = window.open("", "_blank", "width=1000,height=900")
    if (!popup) return
    popup.document.write(html)
    popup.document.close()
    popup.onload = () => {
      try { popup.document.title = buildPdfBaseName(cliente.nombre) } catch {}
      setTimeout(() => popup.print(), 400)
    }
  }

  if (success) {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-md space-y-4">
          <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
            <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-500" />
            <h1 className="text-2xl font-bold">Consentimiento firmado correctamente</h1>
            <p className="mt-2 text-muted-foreground">
              Gracias. Cibao Spa Laser recibió tu consentimiento dermatológico firmado.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Ref: {success.recordId}</p>
          </div>
          <Button onClick={downloadPdf} variant="outline" className="w-full gap-2">
            <Download className="h-4 w-4" /> Descargar PDF formal
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Se abrirá el diálogo de impresión — elige "Guardar como PDF" para conservar tu copia.
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-5 text-sm">
      {/* 1) Cliente vinculado (solo lectura) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4" /> Cliente vinculado
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Estos datos fueron cargados por el personal. Si algún dato es
            incorrecto, comuníquese con recepción.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Nombre" value={cliente.nombre} />
          <ReadOnlyField label="Teléfono" value={cliente.telefono} />
          <ReadOnlyField label="Cédula / Documento" value={cliente.documento} />
          <ReadOnlyField label="Correo" value={cliente.correo} />
          <ReadOnlyField label="Dirección" value={cliente.direccion} className="sm:col-span-2" />
          <ReadOnlyField label="Sucursal" value={cliente.sucursal} />
          {cliente.especialista ? <ReadOnlyField label="Especialista" value={cliente.especialista} /> : null}
          {cliente.motivoConsulta ? (
            <ReadOnlyField label="Motivo de consulta" value={cliente.motivoConsulta} className="sm:col-span-2" />
          ) : null}
        </CardContent>
      </Card>

      {/* 2) Documento formal completo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{TITULO_DOC}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-[13px] leading-relaxed text-foreground/90">
          <Section title="Procedimiento">
            <p>Limpieza facial y/o tratamientos de cosmiatría.</p>
          </Section>

          <Section title="Descripción del procedimiento">
            <p>
              El tratamiento de cosmiatría en Cibao Spa Láser puede incluir, pero no se limita a,
              limpieza facial profunda, peelings químicos y tratamientos con láser, entre otros.
              Estos procedimientos están diseñados para mejorar la apariencia de la piel y abordar
              condiciones como arrugas, manchas, cicatrices y otros signos de envejecimiento.
            </p>
          </Section>

          <Section title="Declaraciones del cliente">
            <ol className="ml-5 list-decimal space-y-2">
              <li>Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del o los procedimientos a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
              <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
              <li>Entiendo que el procedimiento solicitado tiene como objetivo mejorar mi apariencia física.</li>
              <li>Comprendo que los resultados están relacionados con la respuesta individual de mi organismo y que los procesos estéticos no son una ciencia exacta, por lo que no se puede garantizar perfección absoluta ni resultados idénticos en todas las personas.</li>
              <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.</li>
              <li>Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
              <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.</li>
            </ol>
          </Section>

          <Section title="Instrucciones antes del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Asistir a la consulta para determinar el tratamiento adecuado según sus necesidades.</li>
              <li>Informar al profesional sobre enfermedades, alergias, tratamientos médicos previos y uso de medicamentos.</li>
              <li>Evitar la exposición solar y el uso de camas solares al menos dos semanas antes del tratamiento.</li>
              <li>Aplicar bloqueador solar de amplio espectro según indicación profesional.</li>
              <li>Evitar medicamentos antiinflamatorios, anticoagulantes y productos que contengan ácidos, como retinoides, al menos cinco días antes del tratamiento, siempre bajo supervisión médica.</li>
              <li>Mantener una buena hidratación bebiendo suficiente agua en los días previos al tratamiento.</li>
              <li>Evitar alcohol y tabaco 48 horas antes del procedimiento.</li>
              <li>Lavar el rostro con un limpiador suave el día del tratamiento y evitar el uso de maquillaje.</li>
            </ul>
          </Section>

          <Section title="Cuidados después del tratamiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Evitar la exposición solar directa en la zona tratada durante al menos dos semanas.</li>
              <li>Aplicar bloqueador solar según las indicaciones recibidas.</li>
              <li>No tocar, rascar ni manipular la piel tratada para prevenir complicaciones.</li>
              <li>Utilizar la crema hidratante recomendada por el especialista para ayudar en la recuperación de la piel.</li>
              <li>Evitar actividades físicas intensas, saunas o baños calientes durante al menos 48 horas después del tratamiento.</li>
              <li>Seguir las recomendaciones sobre productos específicos para el cuidado posterior.</li>
              <li>Informar al centro si presenta síntomas inusuales, molestias importantes o cualquier reacción inesperada.</li>
            </ul>
          </Section>

          <Section title="Riesgos y posibles efectos secundarios">
            <p>
              Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede
              garantizar la perfección absoluta. Se me han informado los riesgos, posibles
              complicaciones y efectos secundarios, que pueden incluir:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Enrojecimiento o irritación de la piel.</li>
              <li>Hinchazón.</li>
              <li>Hipersensibilidad.</li>
              <li>Infecciones.</li>
              <li>Resultados no deseados o insatisfactorios.</li>
            </ul>
            <p>
              También entiendo que el personal médico, especialistas y asistentes se basarán en las
              declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y
              efectivo para mi persona.
            </p>
          </Section>

          <Section title="Políticas y procedimientos">
            <ul className="ml-5 list-disc space-y-1">
              <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
              <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
              <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
              <li>La validez de los servicios es de dos años desde la fecha de compra, cuando aplique.</li>
              <li>Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.</li>
              <li>Los precios en Cibao Spa Láser no incluyen ITBIS.</li>
              <li>El tiempo de la cita no puede extenderse si afecta el itinerario programado.</li>
              <li>Si el retraso es responsabilidad del centro, el tiempo será repuesto.</li>
              <li>Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.</li>
            </ul>
          </Section>

          <Section title="Protección de datos">
            <p>
              Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos
              generales mientras dure nuestra relación y cuente con el consentimiento del
              destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.
            </p>
          </Section>

          <Section title="Autorización">
            <p>
              He sido informado/a sobre el procedimiento, incluyendo sus riesgos, posibles
              complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido
              respuestas satisfactorias.
            </p>
            <p>
              Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza
              un resultado específico o absoluto.
            </p>
            <p>
              Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a
              Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil, en
              caso de complicaciones que puedan surgir durante o después del tratamiento, siempre
              que se haya actuado conforme a los protocolos establecidos.
            </p>
          </Section>
        </CardContent>
      </Card>

      {/* 3) Declaración y firma — campos requeridos marcados en rojo
          mientras no se completen (cliente ve qué falta antes de Enviar). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" /> Declaración y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            Declaro que he leído, comprendido y acepto el contenido de este consentimiento
            informado. Confirmo que la información suministrada es verdadera y completa, y autorizo
            a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.
          </p>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-white p-3 text-sm transition-colors ${
              aceptado
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-rose-400 bg-rose-50/40 ring-1 ring-rose-200"
            }`}
          >
            <Checkbox checked={aceptado} onCheckedChange={(c) => setAceptado(c === true)} />
            <span className="flex-1">
              Declaro que he leído y acepto este consentimiento informado.
              {!aceptado ? (
                <span className="mt-1 block text-[11px] font-semibold text-rose-600">
                  Pendiente — marca esta casilla para poder enviar.
                </span>
              ) : null}
            </span>
          </label>
          <div className={!firma ? "rounded-xl ring-2 ring-rose-400 ring-offset-2" : ""}>
            <SignaturePad label="Firma del cliente *" value={firma} onChange={setFirma} />
          </div>
          {!firma ? (
            <p className="text-[11px] font-semibold text-rose-600">
              Pendiente — firma en el recuadro de arriba para poder enviar.
            </p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            La firma del especialista la completará el personal al finalizar el consentimiento.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          ⚠ {error}
        </div>
      ) : null}

      {/* Lista resumen de pendientes — visible cuando algo falta. Color
          rojo coherente con el highlight inline en cada campo. */}
      {!submitting && (!aceptado || !firma) ? (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3 text-sm">
          <p className="font-bold text-rose-700">⚠ Para firmar y enviar, completa:</p>
          <ul className="mt-1 list-disc pl-5 text-rose-700">
            {!aceptado ? <li>Marcar la casilla de aceptación del consentimiento</li> : null}
            {!firma ? <li>Firmar en el recuadro de Firma del cliente</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-3 border-t bg-white/95 px-3 py-3 backdrop-blur">
        <Button
          onClick={submit}
          disabled={submitting || !aceptado || !firma}
          className="w-full gap-2"
          size="lg"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? "Enviando..." : "Firmar y enviar consentimiento"}
        </Button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 font-heading text-xs font-black uppercase tracking-wider text-[color:var(--brand-primary-dark)]">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}
