"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSignature, Loader2, Send, UserRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"
import { displayPhone, displayDocumento } from "@/lib/formatters"

// Public form de Consentimiento Eliminación de Tatuajes y Cejas. Igual al de
// Ficha Dermatológica: el cliente solo ve "Cliente vinculado" + documento
// formal + declaración + firma. Los campos clínicos (zona, color, sesiones,
// etc.) los completa el especialista después desde el sistema interno.

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

export interface PublicTatuajesPrefill {
  clienteId?: string
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string
  servicio?: string
}

interface Props {
  prefill?: PublicTatuajesPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
}

const TITULO_DOC = "Consentimiento informado para eliminación de tatuajes y cejas"

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
  return `consentimiento-tatuajes-cejas-${slug}-${today}`
}

function buildPrintHtml(args: {
  cliente: Required<PublicTatuajesPrefill>
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
  h2 { font-size: 11.5px; background: #00897b; color: white; padding: 5px 8px; margin: 10px 0 5px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; break-after: avoid; page-break-after: avoid; }
  p { margin: 3px 0; line-height: 1.4; text-align: justify; }
  ul, ol { margin: 3px 0 3px 18px; line-height: 1.45; break-inside: auto; page-break-inside: auto; }
  li { margin: 2px 0; break-inside: avoid; page-break-inside: avoid; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 4px 0; }
  .field { padding: 3px 0; border-bottom: 1px dotted #aab6c5; break-inside: avoid; page-break-inside: avoid; }
  .field b { color: #0f172a; min-width: 100px; display: inline-block; }
  .sign-box { margin-top: 12px; border: 1px solid #d7dee8; border-radius: 6px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
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
  <div class="field"><b>Teléfono:</b> ${escapeHtml(displayPhone(cliente.telefono) || "—")}</div>
  <div class="field"><b>Cédula / Doc:</b> ${escapeHtml(displayDocumento(cliente.documento) || "—")}</div>
  <div class="field"><b>Correo:</b> ${escapeHtml(cliente.correo || "—")}</div>
  <div class="field" style="grid-column: 1 / -1"><b>Dirección:</b> ${escapeHtml(cliente.direccion || "—")}</div>
  <div class="field"><b>Sucursal:</b> ${escapeHtml(cliente.sucursal || "—")}</div>
  <div class="field"><b>Especialista:</b> ${escapeHtml(cliente.especialista || "—")}</div>
</div>

<h2>Procedimiento</h2>
<p>Eliminación de tatuajes y cejas.</p>

<h2>Descripción del procedimiento</h2>
<p>La eliminación de tatuajes y cejas es un tratamiento que utiliza tecnología láser para romper los pigmentos en la piel, permitiendo que el cuerpo los elimine de forma natural. Este procedimiento puede requerir múltiples sesiones según las características del tatuaje o del microblading de cejas.</p>

<h2>Declaraciones del cliente</h2>
<ol>
  <li>Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del o los procedimientos a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
  <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
  <li>Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta. Se me han informado los riesgos, posibles complicaciones y efectos secundarios relacionados con la eliminación de tatuajes y cejas mediante láser.</li>
  <li>Entiendo que el procedimiento solicitado tiene como objetivo mejorar mi apariencia física.</li>
  <li>Comprendo que los resultados están relacionados directamente con la capacidad de mi organismo para eliminar los pigmentos o materiales aplicados en la piel.</li>
  <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.</li>
  <li>Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
  <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.</li>
  <li>Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.</li>
  <li>Entiendo que la eliminación de tatuajes y cejas mediante tratamiento con láser no es una ciencia exacta y que no se me pueden ofrecer garantías absolutas en cuanto a los resultados de este procedimiento.</li>
</ol>

<h2>Instrucciones antes del procedimiento</h2>
<ul>
  <li>Evitar la exposición al sol en el área a tratar durante al menos dos semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios.</li>
  <li>No utilizar cremas bronceadoras ni autobronceadores en la zona afectada al menos dos semanas antes del tratamiento.</li>
  <li>Informar al médico o especialista sobre cualquier medicamento que esté tomando, especialmente anticoagulantes, o si tiene algún tratamiento de piel en curso.</li>
  <li>Evitar el uso de antiinflamatorios, como aspirina o ibuprofeno, y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas.</li>
  <li>No aplicar cremas, lociones ni maquillaje en el área que será tratada el día del procedimiento.</li>
  <li>Mantener la piel bien hidratada en los días previos al procedimiento, salvo indicación contraria.</li>
  <li>Informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento.</li>
  <li>Considerar llevar acompañante si se siente ansiedad o preocupación por el procedimiento.</li>
  <li>Descansar adecuadamente la noche anterior al procedimiento.</li>
  <li>Preparar cualquier pregunta que desee realizar al profesional antes del procedimiento.</li>
</ul>

<h2>Cuidados después del tratamiento</h2>
<ul>
  <li>Mantener la zona tratada limpia, lavándola suavemente con jabón suave y agua fría.</li>
  <li>Evitar frotar o rascar la zona tratada.</li>
  <li>Aplicar la crema o ungüento recomendado por el especialista para mantener la piel hidratada y evitar la formación de costras.</li>
  <li>Utilizar productos que no contengan fragancias ni alcohol.</li>
  <li>Evitar la exposición solar directa en el área tratada.</li>
  <li>Usar sombrero, gorra o protección física cuando sea necesario.</li>
  <li>Aplicar protector solar SPF 30 o superior en el área tratada dos semanas después del procedimiento, una vez que haya sanado.</li>
  <li>No rascar ni retirar costras, ya que esto puede causar cicatrices o infecciones.</li>
  <li>Evitar saunas, jacuzzis, baños calientes o agua caliente durante al menos una semana.</li>
  <li>Preferir duchas con agua fría o templada en lugar de baños de inmersión.</li>
  <li>Evitar ejercicio intenso durante al menos una semana, ya que el sudor puede irritar la piel y aumentar el riesgo de infección.</li>
  <li>No aplicar maquillaje en el área tratada durante una o dos semanas, o hasta que la piel esté completamente sana.</li>
  <li>Monitorear cualquier signo de infección, como enrojecimiento excesivo, hinchazón, pus o fiebre.</li>
  <li>Contactar al centro o médico si presenta síntomas inusuales o preocupantes.</li>
  <li>Seguir siempre las instrucciones específicas del especialista, ya que cada caso puede requerir cuidados particulares.</li>
  <li>Evitar productos químicos, retinoides, ácidos o exfoliantes durante las primeras semanas si pueden irritar la piel.</li>
</ul>

<h2>Consideraciones generales sobre la eliminación de tatuajes y cejas</h2>
<ul>
  <li>El láser Spectra es una tecnología avanzada utilizada para la eliminación de tatuajes y cejas.</li>
  <li>El procedimiento puede ser realizado por el médico dermatólogo o la cosmiatra capacitada.</li>
  <li>Existen opciones anestésicas personalizadas que pueden aplicarse con el objetivo de reducir molestias durante la sesión.</li>
  <li>Es normal que después de la aplicación del láser aparezca pequeño sangrado, hinchazón o inflamación.</li>
  <li>En algunos casos puede formarse una costra fina que suele sanar en aproximadamente 10 a 15 días.</li>
  <li>El número de sesiones necesarias para eliminar tatuajes o pigmentos es variable.</li>
  <li>Los tatuajes amateurs pueden requerir menos sesiones que los tatuajes profesionales.</li>
  <li>Los tatuajes profesionales o pigmentos claros pueden requerir mayor cantidad de sesiones.</li>
  <li>El intervalo entre sesiones debe ser de al menos cuatro semanas, aunque en ocasiones puede ser recomendable extenderlo.</li>
  <li>No se puede garantizar la eliminación del 100% de la tinta o pigmento.</li>
  <li>El láser puede provocar cambios en el color de la piel tratada, como aclaramiento u oscurecimiento.</li>
  <li>Estos cambios suelen mejorar con el tiempo, pero excepcionalmente pueden ser permanentes.</li>
  <li>Aunque es poco probable, el procedimiento con láser puede dejar cicatrices visibles.</li>
  <li>Las cicatrices pueden producirse especialmente si no se siguen los cuidados indicados o no se acude a los controles correspondientes.</li>
  <li>Durante el tratamiento no debo exponer al sol la zona tratada al menos dos semanas después de cada sesión, salvo que use protección solar adecuada.</li>
  <li>Me comprometo a realizar las curas siguiendo fielmente las instrucciones del especialista y asistir a las revisiones recomendadas.</li>
</ul>

<h2>Riesgos y posibles complicaciones</h2>
<p>A pesar de que se tomen precauciones, la eliminación de tatuajes y cejas con láser puede conllevar ciertos riesgos y complicaciones, incluyendo, pero no limitado a:</p>
<ul>
  <li>Enrojecimiento o irritación en el área tratada.</li>
  <li>Hinchazón o inflamación alrededor de la zona tratada.</li>
  <li>Dolor o molestia durante y después del procedimiento.</li>
  <li>Riesgo de formación de cicatrices.</li>
  <li>Posibilidad de infección en el sitio tratado.</li>
  <li>Cambios temporales o permanentes en la pigmentación de la piel.</li>
  <li>Hipopigmentación o hiperpigmentación.</li>
  <li>Reacciones alérgicas a anestésicos locales o productos utilizados.</li>
  <li>Formación de ampollas.</li>
  <li>Formación de costras.</li>
  <li>Aumento de sensibilidad al sol en el área tratada.</li>
  <li>Quemaduras solares si no se protege adecuadamente la zona.</li>
  <li>Falta de efectividad o eliminación incompleta del tatuaje o pigmento.</li>
  <li>Daño en capas más profundas de la piel.</li>
  <li>Cambios en la textura de la piel, como asperezas o irregularidades.</li>
  <li>Formación de queloides en personas predispuestas.</li>
  <li>Infección sistémica en casos raros.</li>
  <li>Pigmentación irregular o color desigual en la piel.</li>
  <li>Riesgo de contaminación si no se siguen protocolos de higiene.</li>
  <li>Necrosis de la piel tratada en casos excepcionales.</li>
  <li>Ansiedad o insatisfacción si los resultados no cumplen con las expectativas.</li>
  <li>Reacciones sistémicas al láser, aunque son poco frecuentes.</li>
</ul>

<h2>Políticas y procedimientos</h2>
<ul>
  <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
  <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
  <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
  <li>Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.</li>
  <li>Los precios en Cibao Spa Láser no incluyen ITBIS.</li>
  <li>El tiempo de la cita no puede extenderse si afecta el itinerario programado.</li>
  <li>Si el retraso es responsabilidad del centro, el tiempo será repuesto.</li>
  <li>Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.</li>
</ul>

<h2>Protección de datos</h2>
<p>Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos generales mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.</p>

<h2>Autorización</h2>
<p>He sido informado/a sobre el procedimiento de eliminación de tatuajes y cejas, incluyendo sus riesgos, posibles complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias.</p>
<p>Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza la eliminación completa del tatuaje, cejas o pigmento.</p>
<p>Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil en caso de complicaciones que puedan surgir durante o después del tratamiento, siempre que se haya actuado conforme a los protocolos establecidos.</p>

<h2>Declaración y firma</h2>
<p>Declaro que he leído, comprendido y acepto el contenido de este consentimiento informado. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.</p>

<div class="sign-box">
  ${firmaDataUrl ? `<img class="sign-img" src="${firmaDataUrl}" alt="Firma del cliente" />` : '<div class="sign-img"></div>'}
  <div class="sign-cap">Firma del cliente — ${escapeHtml(cliente.nombre || "Cliente")}</div>
</div>

<div class="footer">
  Cibao Spa Láser · cibaospa.consentimientos@gmail.com · Documento generado el ${escapeHtml(new Date().toLocaleString("es-DO"))} · Ref ${escapeHtml(recordId)}
</div>

</body></html>`
}

export function PublicTatuajesConsentForm({ prefill = {}, onSubmit }: Props) {
  const cliente: Required<PublicTatuajesPrefill> = {
    clienteId: prefill.clienteId || "",
    nombre: prefill.nombre || "",
    telefono: prefill.telefono || "",
    documento: prefill.documento || "",
    correo: prefill.correo || "",
    direccion: prefill.direccion || "",
    sucursal: prefill.sucursal || "",
    especialista: prefill.especialista || "",
    servicio: prefill.servicio || "",
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
      // Payload mínimo con shape ConsentimientoRecord (tatuajes). El backend
      // (consentToDb + schema fallback) acepta el resto vacío; el especialista
      // completa los campos clínicos después desde el sistema interno.
      const id = `CTC-${Date.now()}`
      const payload = {
        id,
        // clienteId del prefill — clave para que ensureCliente lo encuentre
        // por PK y NO intente insertar duplicado (evita unique violation
        // sobre documento_identidad si el cliente ya existe).
        clienteId: cliente.clienteId,
        cliente_id: cliente.clienteId,
        fecha: new Date().toISOString().slice(0, 10),
        sucursal: cliente.sucursal,
        nombreCliente: cliente.nombre,
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        documento: cliente.documento,
        cedula: cliente.documento,
        correo: cliente.correo,
        email: cliente.correo,
        direccion: cliente.direccion,
        nombreEspecialista: cliente.especialista,
        especialista: cliente.especialista,
        observaciones: cliente.servicio || "",
        firmaCliente: firma,
        firmaEspecialista: "",
        // Aceptación unificada — el cliente firma UNA vez; sincronizamos
        // los flags legacy para que el contrato legal multi-acceptance quede
        // cumplido a nivel DB (espejo de PublicConsentForm).
        declaracionAceptada: true,
        autorizacionAceptada: true,
        declaracionResultadosAceptada: true,
        autorizacionFotograficaAceptada: true,
        autorizacionProcedimientoAceptada: true,
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
              Gracias. Cibao Spa Laser recibió tu consentimiento de eliminación de tatuajes y cejas firmado.
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
          <ReadOnlyField label="Teléfono" value={displayPhone(cliente.telefono)} />
          <ReadOnlyField label="Cédula / Documento" value={displayDocumento(cliente.documento)} />
          <ReadOnlyField label="Correo" value={cliente.correo} />
          <ReadOnlyField label="Dirección" value={cliente.direccion} className="sm:col-span-2" />
          <ReadOnlyField label="Sucursal" value={cliente.sucursal} />
          {cliente.especialista ? <ReadOnlyField label="Especialista" value={cliente.especialista} /> : null}
          {cliente.servicio ? (
            <ReadOnlyField label="Servicio" value={cliente.servicio} className="sm:col-span-2" />
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
            <p>Eliminación de tatuajes y cejas.</p>
          </Section>

          <Section title="Descripción del procedimiento">
            <p>
              La eliminación de tatuajes y cejas es un tratamiento que utiliza tecnología láser para
              romper los pigmentos en la piel, permitiendo que el cuerpo los elimine de forma natural.
              Este procedimiento puede requerir múltiples sesiones según las características del
              tatuaje o del microblading de cejas.
            </p>
          </Section>

          <Section title="Declaraciones del cliente">
            <ol className="ml-5 list-decimal space-y-2">
              <li>Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del o los procedimientos a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
              <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
              <li>Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta. Se me han informado los riesgos, posibles complicaciones y efectos secundarios relacionados con la eliminación de tatuajes y cejas mediante láser.</li>
              <li>Entiendo que el procedimiento solicitado tiene como objetivo mejorar mi apariencia física.</li>
              <li>Comprendo que los resultados están relacionados directamente con la capacidad de mi organismo para eliminar los pigmentos o materiales aplicados en la piel.</li>
              <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.</li>
              <li>Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
              <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.</li>
              <li>Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.</li>
              <li>Entiendo que la eliminación de tatuajes y cejas mediante tratamiento con láser no es una ciencia exacta y que no se me pueden ofrecer garantías absolutas en cuanto a los resultados de este procedimiento.</li>
            </ol>
          </Section>

          <Section title="Instrucciones antes del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Evitar la exposición al sol en el área a tratar durante al menos dos semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios.</li>
              <li>No utilizar cremas bronceadoras ni autobronceadores en la zona afectada al menos dos semanas antes del tratamiento.</li>
              <li>Informar al médico o especialista sobre cualquier medicamento que esté tomando, especialmente anticoagulantes, o si tiene algún tratamiento de piel en curso.</li>
              <li>Evitar el uso de antiinflamatorios, como aspirina o ibuprofeno, y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas.</li>
              <li>No aplicar cremas, lociones ni maquillaje en el área que será tratada el día del procedimiento.</li>
              <li>Mantener la piel bien hidratada en los días previos al procedimiento, salvo indicación contraria.</li>
              <li>Informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento.</li>
              <li>Considerar llevar acompañante si se siente ansiedad o preocupación por el procedimiento.</li>
              <li>Descansar adecuadamente la noche anterior al procedimiento.</li>
              <li>Preparar cualquier pregunta que desee realizar al profesional antes del procedimiento.</li>
            </ul>
          </Section>

          <Section title="Cuidados después del tratamiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Mantener la zona tratada limpia, lavándola suavemente con jabón suave y agua fría.</li>
              <li>Evitar frotar o rascar la zona tratada.</li>
              <li>Aplicar la crema o ungüento recomendado por el especialista para mantener la piel hidratada y evitar la formación de costras.</li>
              <li>Utilizar productos que no contengan fragancias ni alcohol.</li>
              <li>Evitar la exposición solar directa en el área tratada.</li>
              <li>Usar sombrero, gorra o protección física cuando sea necesario.</li>
              <li>Aplicar protector solar SPF 30 o superior en el área tratada dos semanas después del procedimiento, una vez que haya sanado.</li>
              <li>No rascar ni retirar costras, ya que esto puede causar cicatrices o infecciones.</li>
              <li>Evitar saunas, jacuzzis, baños calientes o agua caliente durante al menos una semana.</li>
              <li>Preferir duchas con agua fría o templada en lugar de baños de inmersión.</li>
              <li>Evitar ejercicio intenso durante al menos una semana, ya que el sudor puede irritar la piel y aumentar el riesgo de infección.</li>
              <li>No aplicar maquillaje en el área tratada durante una o dos semanas, o hasta que la piel esté completamente sana.</li>
              <li>Monitorear cualquier signo de infección, como enrojecimiento excesivo, hinchazón, pus o fiebre.</li>
              <li>Contactar al centro o médico si presenta síntomas inusuales o preocupantes.</li>
              <li>Seguir siempre las instrucciones específicas del especialista, ya que cada caso puede requerir cuidados particulares.</li>
              <li>Evitar productos químicos, retinoides, ácidos o exfoliantes durante las primeras semanas si pueden irritar la piel.</li>
            </ul>
          </Section>

          <Section title="Consideraciones generales sobre la eliminación de tatuajes y cejas">
            <ul className="ml-5 list-disc space-y-1">
              <li>El láser Spectra es una tecnología avanzada utilizada para la eliminación de tatuajes y cejas.</li>
              <li>El procedimiento puede ser realizado por el médico dermatólogo o la cosmiatra capacitada.</li>
              <li>Existen opciones anestésicas personalizadas que pueden aplicarse con el objetivo de reducir molestias durante la sesión.</li>
              <li>Es normal que después de la aplicación del láser aparezca pequeño sangrado, hinchazón o inflamación.</li>
              <li>En algunos casos puede formarse una costra fina que suele sanar en aproximadamente 10 a 15 días.</li>
              <li>El número de sesiones necesarias para eliminar tatuajes o pigmentos es variable.</li>
              <li>Los tatuajes amateurs pueden requerir menos sesiones que los tatuajes profesionales.</li>
              <li>Los tatuajes profesionales o pigmentos claros pueden requerir mayor cantidad de sesiones.</li>
              <li>El intervalo entre sesiones debe ser de al menos cuatro semanas, aunque en ocasiones puede ser recomendable extenderlo.</li>
              <li>No se puede garantizar la eliminación del 100% de la tinta o pigmento.</li>
              <li>El láser puede provocar cambios en el color de la piel tratada, como aclaramiento u oscurecimiento.</li>
              <li>Estos cambios suelen mejorar con el tiempo, pero excepcionalmente pueden ser permanentes.</li>
              <li>Aunque es poco probable, el procedimiento con láser puede dejar cicatrices visibles.</li>
              <li>Las cicatrices pueden producirse especialmente si no se siguen los cuidados indicados o no se acude a los controles correspondientes.</li>
              <li>Durante el tratamiento no debo exponer al sol la zona tratada al menos dos semanas después de cada sesión, salvo que use protección solar adecuada.</li>
              <li>Me comprometo a realizar las curas siguiendo fielmente las instrucciones del especialista y asistir a las revisiones recomendadas.</li>
            </ul>
          </Section>

          <Section title="Riesgos y posibles complicaciones">
            <p>
              A pesar de que se tomen precauciones, la eliminación de tatuajes y cejas con láser
              puede conllevar ciertos riesgos y complicaciones, incluyendo, pero no limitado a:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Enrojecimiento o irritación en el área tratada.</li>
              <li>Hinchazón o inflamación alrededor de la zona tratada.</li>
              <li>Dolor o molestia durante y después del procedimiento.</li>
              <li>Riesgo de formación de cicatrices.</li>
              <li>Posibilidad de infección en el sitio tratado.</li>
              <li>Cambios temporales o permanentes en la pigmentación de la piel.</li>
              <li>Hipopigmentación o hiperpigmentación.</li>
              <li>Reacciones alérgicas a anestésicos locales o productos utilizados.</li>
              <li>Formación de ampollas.</li>
              <li>Formación de costras.</li>
              <li>Aumento de sensibilidad al sol en el área tratada.</li>
              <li>Quemaduras solares si no se protege adecuadamente la zona.</li>
              <li>Falta de efectividad o eliminación incompleta del tatuaje o pigmento.</li>
              <li>Daño en capas más profundas de la piel.</li>
              <li>Cambios en la textura de la piel, como asperezas o irregularidades.</li>
              <li>Formación de queloides en personas predispuestas.</li>
              <li>Infección sistémica en casos raros.</li>
              <li>Pigmentación irregular o color desigual en la piel.</li>
              <li>Riesgo de contaminación si no se siguen protocolos de higiene.</li>
              <li>Necrosis de la piel tratada en casos excepcionales.</li>
              <li>Ansiedad o insatisfacción si los resultados no cumplen con las expectativas.</li>
              <li>Reacciones sistémicas al láser, aunque son poco frecuentes.</li>
            </ul>
          </Section>

          <Section title="Políticas y procedimientos">
            <ul className="ml-5 list-disc space-y-1">
              <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
              <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
              <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
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
              He sido informado/a sobre el procedimiento de eliminación de tatuajes y cejas,
              incluyendo sus riesgos, posibles complicaciones y beneficios. He tenido la
              oportunidad de hacer preguntas y he recibido respuestas satisfactorias.
            </p>
            <p>
              Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza
              la eliminación completa del tatuaje, cejas o pigmento.
            </p>
            <p>
              Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a
              Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil en
              caso de complicaciones que puedan surgir durante o después del tratamiento, siempre
              que se haya actuado conforme a los protocolos establecidos.
            </p>
          </Section>
        </CardContent>
      </Card>

      {/* 3) Declaración y firma */}
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
            className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 bg-white p-4 transition-colors ${
              aceptado
                ? "border-emerald-300 bg-emerald-50/30"
                : "border-rose-400 bg-rose-50/40 ring-1 ring-rose-200"
            }`}
          >
            <Checkbox checked={aceptado} onCheckedChange={(c) => setAceptado(c === true)} className="mt-1 h-5 w-5" />
            <span className="flex-1 text-base font-bold leading-snug text-foreground">
              Declaro que he leído y acepto este consentimiento informado.
              {!aceptado ? (
                <span className="mt-1.5 block text-xs font-semibold text-rose-600">
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
