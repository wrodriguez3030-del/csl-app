"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSignature, Loader2, Send, UserRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"
import { displayPhone, displayDocumento } from "@/lib/formatters"

// Public form de Consentimiento de Depilación Láser (eliminación del vello no
// deseado). Mismo modelo que Tatuajes/Cejas: el cliente solo ve "Cliente
// vinculado" (lectura) + documento formal + aceptación de políticas + firma.
// Los campos clínicos (zona, fototipo, sesiones, etc.) los completa el
// especialista después desde el sistema interno.

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

export interface PublicDepilacionLaserPrefill {
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
  prefill?: PublicDepilacionLaserPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
  businessSlug?: string
}

const BUSINESS_NAME_BY_SLUG: Record<string, string> = {
  csl: "Cibao Spa Laser",
  depicenter: "Depicenter Skin Láser",
}

// Título visible (web). El PDF usa el encabezado formal de dos líneas.
const TITULO_DOC = "Consentimiento informado para eliminación del vello no deseado"
const PDF_TITULO = "CONSENTIMIENTO INFORMADO"
const PDF_SUBTITULO = "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO"

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
  return `consentimiento-depilacion-laser-${slug}-${today}`
}

function buildPrintHtml(args: {
  cliente: Required<PublicDepilacionLaserPrefill>
  fechaFirma: string
  firmaDataUrl: string
  recordId: string
  businessName?: string
}) {
  const { cliente, fechaFirma, firmaDataUrl, recordId, businessName = "CIBAO SPA LASER" } = args
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
  .subtitle { font-size: 11.5px; font-weight: 700; color: #00695c; margin: 0 0 2px; }
  h2 { font-size: 11.5px; background: #00897b; color: white; padding: 5px 8px; margin: 10px 0 5px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; break-after: avoid; page-break-after: avoid; }
  p { margin: 3px 0; line-height: 1.4; text-align: justify; }
  ul, ol { margin: 3px 0 3px 18px; line-height: 1.45; break-inside: auto; page-break-inside: auto; }
  li { margin: 2px 0; break-inside: avoid; page-break-inside: avoid; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 4px 0; }
  .field { padding: 3px 0; border-bottom: 1px dotted #aab6c5; break-inside: avoid; page-break-inside: avoid; }
  .field b { color: #0f172a; min-width: 100px; display: inline-block; }
  .accept { margin-top: 6px; padding: 6px 8px; border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 4px; font-weight: 700; color: #0f766e; }
  .sign-box { margin-top: 12px; border: 1px solid #d7dee8; border-radius: 6px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
  .sign-img { max-width: 320px; max-height: 110px; object-fit: contain; display: block; margin: 6px auto; border-bottom: 1px solid #111827; }
  .sign-cap { text-align: center; font-weight: 700; font-size: 10px; color: #334155; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header center">
  <div class="logo">${escapeHtml(businessName.toUpperCase())}</div>
  <h1>${escapeHtml(PDF_TITULO)}</h1>
  <div class="subtitle">${escapeHtml(PDF_SUBTITULO)}</div>
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

<h2>Descripción del procedimiento</h2>
<p>La depilación láser es un procedimiento estético que utiliza la energía de un haz de luz láser para destruir de forma selectiva el folículo piloso, reduciendo el crecimiento del vello no deseado. La luz es absorbida por el pigmento (melanina) del vello y transformada en calor, dañando la estructura que produce el pelo. Es un tratamiento progresivo que requiere varias sesiones, ya que el láser actúa principalmente sobre el vello que se encuentra en fase de crecimiento activo.</p>

<h2>Confirmación del cliente</h2>
<ol>
  <li>Confirmo que ${escapeHtml(businessName)} me ha explicado de manera detallada y en palabras comprensibles la naturaleza del procedimiento de depilación láser, incluyendo sus posibles riesgos, molestias, alternativas y cuidados posteriores. Todas mis preguntas han sido contestadas a mi satisfacción.</li>
  <li>Comprendo que la depilación láser es un proceso estético progresivo y que nadie puede garantizar la eliminación total o permanente del vello.</li>
  <li>Entiendo que los resultados dependen de factores individuales como el tipo de piel, el color y grosor del vello, la zona tratada, los cambios hormonales y el cumplimiento de las indicaciones.</li>
  <li>Consiento aportar mis datos personales y de salud antes y durante el tratamiento, los cuales forman parte de mi historia clínica y son propiedad de ${escapeHtml(businessName)}.</li>
  <li>Me comprometo a seguir fielmente las instrucciones impartidas por el personal antes, durante y después de cada sesión.</li>
  <li>Acepto que ${escapeHtml(businessName)} pueda retrasar o suspender una sesión si lo considera necesario para mi seguridad.</li>
  <li>Entiendo que el personal se basará en la información que yo declare para determinar si el procedimiento es seguro para mí.</li>
</ol>

<h2>Instrucciones antes del procedimiento</h2>
<ul>
  <li>Evitar la exposición solar y las camas bronceadoras en la zona a tratar durante al menos dos semanas antes de la sesión.</li>
  <li>No aplicar autobronceadores ni cremas bronceadoras en la zona durante las dos semanas previas.</li>
  <li>Rasurar (afeitar) la zona a tratar entre 12 y 24 horas antes de la sesión. No depilar con cera, pinza, hilo ni decolorar el vello en las semanas previas, ya que el láser necesita la raíz intacta.</li>
  <li>No aplicar cremas, lociones, perfumes, maquillaje ni desodorante en la zona el día de la sesión.</li>
  <li>Informar al especialista sobre cualquier medicamento que esté tomando, especialmente fotosensibilizantes, anticoagulantes, isotretinoína o antibióticos.</li>
  <li>Informar sobre embarazo, lactancia, tatuajes, lunares, infecciones activas, herpes u otras condiciones de la piel en la zona a tratar.</li>
  <li>Mantener la piel limpia, hidratada y sin lesiones el día del procedimiento.</li>
</ul>

<h2>Cuidados después del tratamiento</h2>
<ul>
  <li>Evitar la exposición solar directa en la zona tratada durante al menos dos semanas y aplicar protector solar SPF 30 o superior.</li>
  <li>Evitar saunas, jacuzzis, baños calientes, piscinas y ejercicio intenso durante 24 a 48 horas.</li>
  <li>No frotar, rascar ni exfoliar la zona tratada; mantenerla limpia e hidratada con productos suaves recomendados por el especialista.</li>
  <li>No depilar con cera, pinza ni hilo entre sesiones. Solo se permite el rasurado.</li>
  <li>Evitar el uso de perfumes, desodorantes con alcohol y productos irritantes sobre la zona durante las primeras 24 a 48 horas.</li>
  <li>Es normal que aparezca enrojecimiento leve o sensación similar a una quemadura solar durante las primeras horas.</li>
  <li>Acudir a las sesiones en los intervalos recomendados por el especialista para lograr mejores resultados.</li>
  <li>Comunicarse con el centro si presenta ampollas, costras, dolor intenso, signos de infección u otra reacción inusual.</li>
</ul>

<h2>Consideraciones generales</h2>
<ul>
  <li>La depilación láser requiere varias sesiones porque el vello crece en distintas fases y el láser actúa sobre el que está en crecimiento activo.</li>
  <li>El número de sesiones varía según la zona, el tipo de piel y vello, y la respuesta individual de cada persona.</li>
  <li>El intervalo entre sesiones suele ser de cuatro a ocho semanas según la zona tratada.</li>
  <li>Los cambios hormonales (embarazo, síndrome de ovario poliquístico, medicamentos hormonales) pueden estimular nuevo crecimiento de vello y requerir sesiones de mantenimiento.</li>
  <li>El vello rubio, canoso, pelirrojo o muy fino responde con menor eficacia porque contiene poca melanina.</li>
  <li>El procedimiento es realizado por personal capacitado siguiendo los protocolos de seguridad del centro.</li>
</ul>

<h2>Beneficios</h2>
<ul>
  <li>Reducción progresiva y duradera del vello no deseado.</li>
  <li>Disminución de la irritación, foliculitis y vellos encarnados asociados a otros métodos de depilación.</li>
  <li>Piel más suave y mejor apariencia estética de la zona tratada.</li>
  <li>Ahorro de tiempo y comodidad frente a métodos tradicionales como la cera o el afeitado frecuente.</li>
</ul>

<h2>Probabilidad de éxito</h2>
<p>La depilación láser logra en la mayoría de los casos una reducción significativa y duradera del vello, especialmente en pieles claras con vello oscuro y grueso. Sin embargo, no se garantiza la eliminación del 100% del vello. Algunos folículos pueden reactivarse con el tiempo o por cambios hormonales, por lo que pueden ser necesarias sesiones de mantenimiento. Los resultados varían de una persona a otra.</p>

<h2>Riesgos y posibles complicaciones</h2>
<p>A pesar de tomar las precauciones adecuadas, el procedimiento de depilación láser puede conllevar ciertos riesgos y complicaciones, incluyendo, pero no limitado a:</p>
<ul>
  <li>Enrojecimiento, hinchazón o irritación temporal en la zona tratada.</li>
  <li>Sensación de calor, ardor o molestia durante y después de la sesión.</li>
  <li>Cambios temporales o permanentes en la pigmentación de la piel (hipopigmentación o hiperpigmentación), más frecuentes en pieles oscuras o bronceadas.</li>
  <li>Formación de ampollas, costras o, en casos excepcionales, quemaduras.</li>
  <li>Riesgo de infección si no se siguen los cuidados indicados.</li>
  <li>Cicatrices en casos poco frecuentes.</li>
  <li>Reactivación de herpes en personas predispuestas.</li>
  <li>Foliculitis (inflamación del folículo) transitoria.</li>
  <li>Crecimiento paradójico del vello en zonas adyacentes, poco frecuente.</li>
  <li>Eliminación incompleta del vello o necesidad de sesiones adicionales.</li>
  <li>Aumento de la sensibilidad al sol en la zona tratada.</li>
</ul>

<h2>Contraindicaciones</h2>
<ul>
  <li>Embarazo y lactancia.</li>
  <li>Piel bronceada o exposición solar reciente en la zona a tratar.</li>
  <li>Uso reciente de isotretinoína u otros medicamentos fotosensibilizantes.</li>
  <li>Infecciones activas, herpes, heridas abiertas o lesiones en la zona.</li>
  <li>Antecedentes de queloides o cicatrización anormal.</li>
  <li>Enfermedades de la piel activas en la zona (dermatitis, psoriasis, vitíligo en fase activa).</li>
  <li>Tatuajes o micropigmentación en la zona a tratar (el láser no debe aplicarse sobre la tinta).</li>
  <li>Condiciones médicas que el especialista considere de riesgo según la evaluación individual.</li>
</ul>

<h2>Políticas y procedimientos</h2>
<ul>
  <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
  <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
  <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
  <li>Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.</li>
  <li>Los precios en ${escapeHtml(businessName)} no incluyen ITBIS.</li>
  <li>El tiempo de la cita no puede extenderse si afecta el itinerario programado.</li>
  <li>Si el retraso es responsabilidad del centro, el tiempo será repuesto.</li>
  <li>Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.</li>
</ul>

<h2>Protección de datos</h2>
<p>${escapeHtml(businessName)} podrá enviar información, respuestas a consultas y contactos generales mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.</p>

<h2>Autorización</h2>
<p>He sido informado/a sobre el procedimiento de eliminación del vello no deseado, incluidos los riesgos, complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias. Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza la eliminación completa del vello no deseado.</p>
<p>Doy mi consentimiento para realizar el procedimiento en Cibao Spa Laser y libero a Cibao Spa Laser y su personal de cualquier responsabilidad Legal en lo Penal y Civil en caso de complicaciones que puedan surgir durante o después del tratamiento.</p>

<h2>Aceptación de políticas y firma</h2>
<p>Declaro que he leído, comprendido y aceptado el contenido de este consentimiento informado, así como las políticas de la empresa. Confirmo que la información suministrada es verdadera y completa, y autorizo a ${escapeHtml(businessName)} y a su personal a realizar el procedimiento descrito.</p>
<div class="accept">ACEPTO LAS POLÍTICAS DE LA EMPRESA</div>

<div class="sign-box">
  ${firmaDataUrl ? `<img class="sign-img" src="${firmaDataUrl}" alt="Firma del cliente" />` : '<div class="sign-img"></div>'}
  <div class="sign-cap">Firma del cliente — ${escapeHtml(cliente.nombre || "Cliente")}</div>
</div>

<div class="footer">
  ${escapeHtml(businessName)} · cibaospalaser@gmail.com · Documento generado el ${escapeHtml(new Date().toLocaleString("es-DO"))} · Ref ${escapeHtml(recordId)}
</div>

</body></html>`
}

export function PublicDepilacionLaserConsentForm({ prefill = {}, onSubmit, businessSlug = "csl" }: Props) {
  const businessName = BUSINESS_NAME_BY_SLUG[businessSlug] || BUSINESS_NAME_BY_SLUG.csl
  const cliente: Required<PublicDepilacionLaserPrefill> = {
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
    if (!aceptado) return setError("Debes aceptar las políticas de la empresa antes de firmar.")
    if (!firma) return setError("Debes firmar antes de enviar.")
    setSubmitting(true)
    try {
      const id = `CDL-${Date.now()}`
      const payload = {
        id,
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
        // Aceptación única "ACEPTO LAS POLÍTICAS DE LA EMPRESA" — sincronizamos
        // los flags legales para que el contrato quede cumplido a nivel DB.
        aceptaPoliticas: true,
        aceptaProcedimiento: true,
        aceptaRiesgos: true,
        aceptaProteccionDatos: true,
        declaracionAceptada: true,
        autorizacionAceptada: true,
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
      businessName,
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
              Gracias. {businessName} recibió tu consentimiento de depilación láser firmado.
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
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PDF_SUBTITULO}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 text-[13px] leading-relaxed text-foreground/90">
          <Section title="Descripción del procedimiento">
            <p>
              La depilación láser es un procedimiento estético que utiliza la energía de un haz de
              luz láser para destruir de forma selectiva el folículo piloso, reduciendo el
              crecimiento del vello no deseado. La luz es absorbida por el pigmento (melanina) del
              vello y transformada en calor, dañando la estructura que produce el pelo. Es un
              tratamiento progresivo que requiere varias sesiones, ya que el láser actúa
              principalmente sobre el vello que se encuentra en fase de crecimiento activo.
            </p>
          </Section>

          <Section title="Confirmación del cliente">
            <ol className="ml-5 list-decimal space-y-2">
              <li>Confirmo que {businessName} me ha explicado de manera detallada y en palabras comprensibles la naturaleza del procedimiento de depilación láser, incluyendo sus posibles riesgos, molestias, alternativas y cuidados posteriores. Todas mis preguntas han sido contestadas a mi satisfacción.</li>
              <li>Comprendo que la depilación láser es un proceso estético progresivo y que nadie puede garantizar la eliminación total o permanente del vello.</li>
              <li>Entiendo que los resultados dependen de factores individuales como el tipo de piel, el color y grosor del vello, la zona tratada, los cambios hormonales y el cumplimiento de las indicaciones.</li>
              <li>Consiento aportar mis datos personales y de salud antes y durante el tratamiento, los cuales forman parte de mi historia clínica y son propiedad de {businessName}.</li>
              <li>Me comprometo a seguir fielmente las instrucciones impartidas por el personal antes, durante y después de cada sesión.</li>
              <li>Acepto que {businessName} pueda retrasar o suspender una sesión si lo considera necesario para mi seguridad.</li>
              <li>Entiendo que el personal se basará en la información que yo declare para determinar si el procedimiento es seguro para mí.</li>
            </ol>
          </Section>

          <Section title="Instrucciones antes del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Evitar la exposición solar y las camas bronceadoras en la zona a tratar durante al menos dos semanas antes de la sesión.</li>
              <li>No aplicar autobronceadores ni cremas bronceadoras en la zona durante las dos semanas previas.</li>
              <li>Rasurar (afeitar) la zona a tratar entre 12 y 24 horas antes de la sesión. No depilar con cera, pinza, hilo ni decolorar el vello en las semanas previas, ya que el láser necesita la raíz intacta.</li>
              <li>No aplicar cremas, lociones, perfumes, maquillaje ni desodorante en la zona el día de la sesión.</li>
              <li>Informar al especialista sobre cualquier medicamento que esté tomando, especialmente fotosensibilizantes, anticoagulantes, isotretinoína o antibióticos.</li>
              <li>Informar sobre embarazo, lactancia, tatuajes, lunares, infecciones activas, herpes u otras condiciones de la piel en la zona a tratar.</li>
              <li>Mantener la piel limpia, hidratada y sin lesiones el día del procedimiento.</li>
            </ul>
          </Section>

          <Section title="Cuidados después del tratamiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Evitar la exposición solar directa en la zona tratada durante al menos dos semanas y aplicar protector solar SPF 30 o superior.</li>
              <li>Evitar saunas, jacuzzis, baños calientes, piscinas y ejercicio intenso durante 24 a 48 horas.</li>
              <li>No frotar, rascar ni exfoliar la zona tratada; mantenerla limpia e hidratada con productos suaves recomendados por el especialista.</li>
              <li>No depilar con cera, pinza ni hilo entre sesiones. Solo se permite el rasurado.</li>
              <li>Evitar el uso de perfumes, desodorantes con alcohol y productos irritantes sobre la zona durante las primeras 24 a 48 horas.</li>
              <li>Es normal que aparezca enrojecimiento leve o sensación similar a una quemadura solar durante las primeras horas.</li>
              <li>Acudir a las sesiones en los intervalos recomendados por el especialista para lograr mejores resultados.</li>
              <li>Comunicarse con el centro si presenta ampollas, costras, dolor intenso, signos de infección u otra reacción inusual.</li>
            </ul>
          </Section>

          <Section title="Consideraciones generales">
            <ul className="ml-5 list-disc space-y-1">
              <li>La depilación láser requiere varias sesiones porque el vello crece en distintas fases y el láser actúa sobre el que está en crecimiento activo.</li>
              <li>El número de sesiones varía según la zona, el tipo de piel y vello, y la respuesta individual de cada persona.</li>
              <li>El intervalo entre sesiones suele ser de cuatro a ocho semanas según la zona tratada.</li>
              <li>Los cambios hormonales (embarazo, síndrome de ovario poliquístico, medicamentos hormonales) pueden estimular nuevo crecimiento de vello y requerir sesiones de mantenimiento.</li>
              <li>El vello rubio, canoso, pelirrojo o muy fino responde con menor eficacia porque contiene poca melanina.</li>
              <li>El procedimiento es realizado por personal capacitado siguiendo los protocolos de seguridad del centro.</li>
            </ul>
          </Section>

          <Section title="Beneficios">
            <ul className="ml-5 list-disc space-y-1">
              <li>Reducción progresiva y duradera del vello no deseado.</li>
              <li>Disminución de la irritación, foliculitis y vellos encarnados asociados a otros métodos de depilación.</li>
              <li>Piel más suave y mejor apariencia estética de la zona tratada.</li>
              <li>Ahorro de tiempo y comodidad frente a métodos tradicionales como la cera o el afeitado frecuente.</li>
            </ul>
          </Section>

          <Section title="Probabilidad de éxito">
            <p>
              La depilación láser logra en la mayoría de los casos una reducción significativa y
              duradera del vello, especialmente en pieles claras con vello oscuro y grueso. Sin
              embargo, no se garantiza la eliminación del 100% del vello. Algunos folículos pueden
              reactivarse con el tiempo o por cambios hormonales, por lo que pueden ser necesarias
              sesiones de mantenimiento. Los resultados varían de una persona a otra.
            </p>
          </Section>

          <Section title="Riesgos y posibles complicaciones">
            <p>
              A pesar de tomar las precauciones adecuadas, el procedimiento de depilación láser
              puede conllevar ciertos riesgos y complicaciones, incluyendo, pero no limitado a:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>Enrojecimiento, hinchazón o irritación temporal en la zona tratada.</li>
              <li>Sensación de calor, ardor o molestia durante y después de la sesión.</li>
              <li>Cambios temporales o permanentes en la pigmentación de la piel (hipopigmentación o hiperpigmentación), más frecuentes en pieles oscuras o bronceadas.</li>
              <li>Formación de ampollas, costras o, en casos excepcionales, quemaduras.</li>
              <li>Riesgo de infección si no se siguen los cuidados indicados.</li>
              <li>Cicatrices en casos poco frecuentes.</li>
              <li>Reactivación de herpes en personas predispuestas.</li>
              <li>Foliculitis (inflamación del folículo) transitoria.</li>
              <li>Crecimiento paradójico del vello en zonas adyacentes, poco frecuente.</li>
              <li>Eliminación incompleta del vello o necesidad de sesiones adicionales.</li>
              <li>Aumento de la sensibilidad al sol en la zona tratada.</li>
            </ul>
          </Section>

          <Section title="Contraindicaciones">
            <ul className="ml-5 list-disc space-y-1">
              <li>Embarazo y lactancia.</li>
              <li>Piel bronceada o exposición solar reciente en la zona a tratar.</li>
              <li>Uso reciente de isotretinoína u otros medicamentos fotosensibilizantes.</li>
              <li>Infecciones activas, herpes, heridas abiertas o lesiones en la zona.</li>
              <li>Antecedentes de queloides o cicatrización anormal.</li>
              <li>Enfermedades de la piel activas en la zona (dermatitis, psoriasis, vitíligo en fase activa).</li>
              <li>Tatuajes o micropigmentación en la zona a tratar (el láser no debe aplicarse sobre la tinta).</li>
              <li>Condiciones médicas que el especialista considere de riesgo según la evaluación individual.</li>
            </ul>
          </Section>

          <Section title="Políticas y procedimientos">
            <ul className="ml-5 list-disc space-y-1">
              <li>Reservas y cancelaciones deben realizarse con 48 horas de antelación.</li>
              <li>Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m. y sábados de 8:00 a.m. a 4:00 p.m.</li>
              <li>Si la cancelación o reprogramación no es comunicada, la sesión se dará por realizada.</li>
              <li>Los pagos pueden realizarse en efectivo, transferencia o tarjeta de crédito.</li>
              <li>Los precios en {businessName} no incluyen ITBIS.</li>
              <li>El tiempo de la cita no puede extenderse si afecta el itinerario programado.</li>
              <li>Si el retraso es responsabilidad del centro, el tiempo será repuesto.</li>
              <li>Si el retraso es responsabilidad del cliente, será atendido solo durante el tiempo restante de su cita.</li>
            </ul>
          </Section>

          <Section title="Protección de datos">
            <p>
              {businessName} podrá enviar información, respuestas a consultas y contactos generales
              mientras dure nuestra relación y cuente con el consentimiento del destinatario. Los
              datos personales no serán cedidos a terceros, salvo obligación legal.
            </p>
          </Section>

          <Section title="Autorización">
            <p>
              He sido informado/a sobre el procedimiento de eliminación del vello no deseado,
              incluidos los riesgos, complicaciones y beneficios. He tenido la oportunidad de hacer
              preguntas y he recibido respuestas satisfactorias. Entiendo que los resultados pueden
              variar de una persona a otra y que no se garantiza la eliminación completa del vello
              no deseado.
            </p>
            <p>
              Doy mi consentimiento para realizar el procedimiento en Cibao Spa Laser y libero a
              Cibao Spa Laser y su personal de cualquier responsabilidad Legal en lo Penal y Civil
              en caso de complicaciones que puedan surgir durante o después del tratamiento.
            </p>
          </Section>
        </CardContent>
      </Card>

      {/* 3) Aceptación de políticas y firma */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature className="h-4 w-4" /> Aceptación de políticas y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-2xl border bg-primary/5 p-4 text-sm leading-relaxed text-muted-foreground">
            Declaro que he leído, comprendido y aceptado el contenido de este consentimiento
            informado, así como las políticas de la empresa. Confirmo que la información
            suministrada es verdadera y completa, y autorizo a {businessName} y a su personal a
            realizar el procedimiento descrito.
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
              ACEPTO LAS POLÍTICAS DE LA EMPRESA
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
            {!aceptado ? <li>Marcar la casilla "ACEPTO LAS POLÍTICAS DE LA EMPRESA"</li> : null}
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
