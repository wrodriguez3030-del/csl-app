"use client"

import { useState } from "react"
import { CheckCircle2, Download, FileSignature, Loader2, Send, UserRound } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/signature-pad"
import { displayPhone, displayDocumento } from "@/lib/formatters"
import { getBusinessBranding } from "@/lib/business"

// Public form de Consentimiento Masajes. Igual al de Ficha Dermatológica:
// el cliente solo ve "Cliente vinculado" + documento formal + declaración +
// firma. Los campos clínicos (tipo de masaje, alergias, contraindicaciones,
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

export interface PublicMasajesPrefill {
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
  prefill?: PublicMasajesPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
  /** Slug del tenant para branding multi-tenant. Default "csl". */
  businessSlug?: string
}

const TITULO_DOC = "Consentimiento informado para masajes"

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
  return `consentimiento-masajes-${slug}-${today}`
}

function buildPrintHtml(args: {
  cliente: Required<PublicMasajesPrefill>
  fechaFirma: string
  firmaDataUrl: string
  recordId: string
  businessName?: string
  logoUrl?: string
  primaryColor?: string
}) {
  const {
    cliente, fechaFirma, firmaDataUrl, recordId,
    businessName = "CIBAO SPA LASER", logoUrl = "", primaryColor = "#00897b",
  } = args
  const logoSrc = logoUrl ? `${typeof window !== "undefined" ? window.location.origin : ""}${logoUrl}` : ""
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(buildPdfBaseName(cliente.nombre))}</title>
<style>
  @page { size: letter; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .header { border-bottom: 3px solid ${primaryColor}; padding-bottom: 10px; margin-bottom: 14px; }
  .brand-logo { max-height: 66px; max-width: 220px; object-fit: contain; display: block; margin: 0 auto 6px; }
  .logo { font-size: 18px; font-weight: 800; color: ${primaryColor}; letter-spacing: .02em; }
  .center { text-align: center; }
  .meta { color: #475569; font-size: 10px; margin-top: 2px; }
  h1 { font-size: 14px; margin: 6px 0 2px; }
  h2 { font-size: 11.5px; background: ${primaryColor}; color: white; padding: 5px 8px; margin: 10px 0 5px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; break-after: avoid; page-break-after: avoid; }
  p { margin: 3px 0; line-height: 1.4; text-align: justify; }
  ul, ol { margin: 3px 0 3px 18px; line-height: 1.45; break-inside: auto; page-break-inside: auto; }
  li { margin: 2px 0; break-inside: avoid; page-break-inside: avoid; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 4px 0; }
  .field { padding: 3px 0; border-bottom: 1px dotted #aab6c5; }
  .field b { color: #0f172a; min-width: 100px; display: inline-block; }
  .sign-box { margin-top: 12px; border: 1px solid #d7dee8; border-radius: 6px; padding: 10px; break-inside: avoid; page-break-inside: avoid; }
  .sign-img { max-width: 320px; max-height: 110px; object-fit: contain; display: block; margin: 6px auto; border-bottom: 1px solid #111827; }
  .sign-cap { text-align: center; font-weight: 700; font-size: 10px; color: #334155; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header center">
  ${logoSrc ? `<img class="brand-logo" src="${escapeHtml(logoSrc)}" alt="${escapeHtml(businessName)}" onerror="this.style.display='none'" />` : ""}
  <div class="logo">${escapeHtml(businessName.toUpperCase())}</div>
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
  <div class="field"><b>Especialista en masajes:</b> ${escapeHtml(cliente.especialista || "—")}</div>
</div>

<h2>Procedimiento</h2>
<p>Masajes.</p>

<h2>Descripción del procedimiento</h2>
<p>Los masajes son técnicas diseñadas para mejorar el bienestar físico y mental. Estos procedimientos pueden ayudar a relajar la musculatura, aliviar tensiones, mejorar la circulación y promover una sensación general de bienestar, de acuerdo con las necesidades del cliente y las recomendaciones del personal especializado.</p>

<h2>Declaraciones del cliente</h2>
<ol>
  <li>Confirmo que Cibao Spa Láser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del procedimiento a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
  <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
  <li>Comprendo que los resultados están relacionados directamente con la respuesta individual de mi organismo y con las técnicas aplicadas.</li>
  <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de Cibao Spa Láser.</li>
  <li>Acepto que Cibao Spa Láser pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
  <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Láser antes, durante y después del procedimiento.</li>
  <li>Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.</li>
</ol>

<h2>Instrucciones antes del procedimiento</h2>
<ul>
  <li>Se recomienda llegar al menos 15 minutos antes de la cita para registrarse, completar cualquier información necesaria y relajarse antes del masaje.</li>
  <li>Durante la consulta inicial, informar de manera honesta sobre necesidades, preocupaciones y condiciones médicas.</li>
  <li>Informar al terapeuta sobre cualquier condición médica, lesión, dolor muscular, problema de piel o antecedente de salud relevante.</li>
  <li>Asegurarse de estar bien hidratado antes del masaje, tomando agua en las horas previas.</li>
  <li>Si va a comer antes del procedimiento, optar por una comida ligera.</li>
  <li>Evitar comidas pesadas o grasosas que puedan causar incomodidad durante el masaje.</li>
  <li>Se recomienda no ingerir alimentos al menos dos horas antes del procedimiento.</li>
  <li>Usar ropa cómoda y ligera al llegar al spa.</li>
  <li>Si es posible, tomar una ducha antes de la cita para sentirse fresco y limpio.</li>
  <li>Evitar alcohol y drogas antes del masaje, ya que pueden afectar la percepción del dolor y la capacidad de relajación.</li>
  <li>Dedicar unos minutos a relajarse mentalmente antes del procedimiento.</li>
  <li>Practicar respiraciones profundas o visualizar un lugar tranquilo antes de iniciar.</li>
  <li>Apagar o silenciar el teléfono móvil para mantener un ambiente calmado.</li>
  <li>Mantener silencio en áreas compartidas y respetar la privacidad de otros clientes.</li>
  <li>Comunicar al terapeuta cualquier preferencia sobre presión del masaje, áreas a trabajar, áreas a evitar o técnicas deseadas.</li>
</ul>

<h2>Contraindicaciones</h2>
<p>El cliente reconoce que existen condiciones en las que algunos tipos de masajes pueden no ser recomendables o deben realizarse con precaución, incluyendo:</p>
<ul>
  <li>Embarazo: algunos tipos de masajes no son recomendables durante el embarazo, especialmente masajes reductores.</li>
  <li>Enfermedades infecciosas: infecciones en la piel o enfermedades contagiosas pueden empeorar con el masaje y representar riesgo para el terapeuta u otros clientes.</li>
  <li>Fracturas y lesiones recientes: las áreas afectadas por fracturas, esguinces o lesiones recientes deben evitar masajes hasta sanar completamente.</li>
  <li>Problemas circulatorios: personas con trombosis venosa profunda, várices severas u otros trastornos circulatorios deben evitar masajes intensos.</li>
  <li>Cáncer: personas en tratamiento oncológico o con diagnóstico reciente deben consultar a su médico antes de recibir masaje.</li>
  <li>Enfermedades cardíacas o hipertensión: ciertos masajes pueden aumentar la frecuencia cardíaca o la presión arterial.</li>
  <li>Piel sensible o lesiones cutáneas: condiciones como dermatitis, eczema, quemaduras o lesiones pueden agravarse con fricción o presión.</li>
  <li>Fiebre o malestar general: realizar masaje durante un episodio febril o malestar puede afectar la recuperación.</li>
  <li>Uso de medicamentos anticoagulantes: quienes toman medicamentos que afectan la coagulación deben evitar masajes intensos.</li>
  <li>Problemas psicológicos severos: personas con ansiedad severa, PTSD u otras condiciones pueden sentirse incómodas con el contacto físico sin la debida precaución.</li>
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
<p>He sido informado/a sobre el procedimiento de masajes, incluyendo sus riesgos, posibles molestias, contraindicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias.</p>
<p>Entiendo que los resultados pueden variar de una persona a otra.</p>
<p>Doy mi consentimiento para realizar el procedimiento en Cibao Spa Láser y libero a Cibao Spa Láser y a su personal de cualquier responsabilidad legal, penal o civil en caso de complicaciones que puedan surgir durante o después del tratamiento, siempre que se haya actuado conforme a los protocolos establecidos.</p>

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
  // Red de seguridad: cualquier "Cibao Spa Laser/Láser" embebido en el cuerpo
  // legal se reemplaza por la marca del tenant.
  return html.replace(/Cibao Spa L[aá]ser/g, businessName)
}

export function PublicMasajesConsentForm({ prefill = {}, onSubmit, businessSlug = "csl" }: Props) {
  const branding = getBusinessBranding(businessSlug)
  const businessName = branding.name
  const cliente: Required<PublicMasajesPrefill> = {
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
      // Payload mínimo con shape ConsentimientoRecord (masajes). El backend
      // (consentToDb + schema fallback) acepta el resto vacío; el especialista
      // completa los campos clínicos después desde el sistema interno.
      const id = `CM-${Date.now()}`
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
        tipoMasaje: cliente.servicio || "",
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
      businessName,
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
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
              Gracias. {businessName} recibió tu consentimiento de masajes firmado.
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
      {/* Encabezado de marca del tenant */}
      <div className="flex flex-col items-center gap-2 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={branding.logoUrl} alt={businessName} className="h-16 w-auto object-contain" />
        <p className="text-sm font-semibold text-muted-foreground">{businessName}</p>
      </div>

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
          {cliente.especialista ? <ReadOnlyField label="Especialista en masajes" value={cliente.especialista} /> : null}
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
            <p>Masajes.</p>
          </Section>

          <Section title="Descripción del procedimiento">
            <p>
              Los masajes son técnicas diseñadas para mejorar el bienestar físico y mental. Estos
              procedimientos pueden ayudar a relajar la musculatura, aliviar tensiones, mejorar la
              circulación y promover una sensación general de bienestar, de acuerdo con las
              necesidades del cliente y las recomendaciones del personal especializado.
            </p>
          </Section>

          <Section title="Declaraciones del cliente">
            <ol className="ml-5 list-decimal space-y-2">
              <li>Confirmo que {businessName} me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del procedimiento a realizar, incluyendo posibles riesgos, molestias, alternativas de tratamiento cuando existan y cuidados posteriores. Todas las preguntas que he formulado libremente sobre el procedimiento han sido contestadas a mi satisfacción.</li>
              <li>Acepto y consiento que, al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento correspondiente.</li>
              <li>Comprendo que los resultados están relacionados directamente con la respuesta individual de mi organismo y con las técnicas aplicadas.</li>
              <li>Consiento aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico, registro e historia clínica, propiedad de {businessName}.</li>
              <li>Acepto que {businessName} pueda retrasar o suspender el procedimiento si lo considera necesario.</li>
              <li>Me comprometo a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por {businessName} antes, durante y después del procedimiento.</li>
              <li>Entiendo que el personal médico, especialistas y asistentes se basarán en las declaraciones hechas por mí para determinar si el procedimiento puede ser seguro y efectivo para mi persona.</li>
            </ol>
          </Section>

          <Section title="Instrucciones antes del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              <li>Se recomienda llegar al menos 15 minutos antes de la cita para registrarse, completar cualquier información necesaria y relajarse antes del masaje.</li>
              <li>Durante la consulta inicial, informar de manera honesta sobre necesidades, preocupaciones y condiciones médicas.</li>
              <li>Informar al terapeuta sobre cualquier condición médica, lesión, dolor muscular, problema de piel o antecedente de salud relevante.</li>
              <li>Asegurarse de estar bien hidratado antes del masaje, tomando agua en las horas previas.</li>
              <li>Si va a comer antes del procedimiento, optar por una comida ligera.</li>
              <li>Evitar comidas pesadas o grasosas que puedan causar incomodidad durante el masaje.</li>
              <li>Se recomienda no ingerir alimentos al menos dos horas antes del procedimiento.</li>
              <li>Usar ropa cómoda y ligera al llegar al spa.</li>
              <li>Si es posible, tomar una ducha antes de la cita para sentirse fresco y limpio.</li>
              <li>Evitar alcohol y drogas antes del masaje, ya que pueden afectar la percepción del dolor y la capacidad de relajación.</li>
              <li>Dedicar unos minutos a relajarse mentalmente antes del procedimiento.</li>
              <li>Practicar respiraciones profundas o visualizar un lugar tranquilo antes de iniciar.</li>
              <li>Apagar o silenciar el teléfono móvil para mantener un ambiente calmado.</li>
              <li>Mantener silencio en áreas compartidas y respetar la privacidad de otros clientes.</li>
              <li>Comunicar al terapeuta cualquier preferencia sobre presión del masaje, áreas a trabajar, áreas a evitar o técnicas deseadas.</li>
            </ul>
          </Section>

          <Section title="Contraindicaciones">
            <p>
              El cliente reconoce que existen condiciones en las que algunos tipos de masajes pueden
              no ser recomendables o deben realizarse con precaución, incluyendo:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li><b>Embarazo:</b> algunos tipos de masajes no son recomendables durante el embarazo, especialmente masajes reductores.</li>
              <li><b>Enfermedades infecciosas:</b> infecciones en la piel o enfermedades contagiosas pueden empeorar con el masaje y representar riesgo para el terapeuta u otros clientes.</li>
              <li><b>Fracturas y lesiones recientes:</b> las áreas afectadas por fracturas, esguinces o lesiones recientes deben evitar masajes hasta sanar completamente.</li>
              <li><b>Problemas circulatorios:</b> personas con trombosis venosa profunda, várices severas u otros trastornos circulatorios deben evitar masajes intensos.</li>
              <li><b>Cáncer:</b> personas en tratamiento oncológico o con diagnóstico reciente deben consultar a su médico antes de recibir masaje.</li>
              <li><b>Enfermedades cardíacas o hipertensión:</b> ciertos masajes pueden aumentar la frecuencia cardíaca o la presión arterial.</li>
              <li><b>Piel sensible o lesiones cutáneas:</b> condiciones como dermatitis, eczema, quemaduras o lesiones pueden agravarse con fricción o presión.</li>
              <li><b>Fiebre o malestar general:</b> realizar masaje durante un episodio febril o malestar puede afectar la recuperación.</li>
              <li><b>Uso de medicamentos anticoagulantes:</b> quienes toman medicamentos que afectan la coagulación deben evitar masajes intensos.</li>
              <li><b>Problemas psicológicos severos:</b> personas con ansiedad severa, PTSD u otras condiciones pueden sentirse incómodas con el contacto físico sin la debida precaución.</li>
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
              {businessName} podrá enviar información, respuestas a consultas y contactos
              generales mientras dure nuestra relación y cuente con el consentimiento del
              destinatario. Los datos personales no serán cedidos a terceros, salvo obligación legal.
            </p>
          </Section>

          <Section title="Autorización">
            <p>
              He sido informado/a sobre el procedimiento de masajes, incluyendo sus riesgos,
              posibles molestias, contraindicaciones y beneficios. He tenido la oportunidad de
              hacer preguntas y he recibido respuestas satisfactorias.
            </p>
            <p>Entiendo que los resultados pueden variar de una persona a otra.</p>
            <p>
              Doy mi consentimiento para realizar el procedimiento en {businessName} y libero a
              {businessName} y a su personal de cualquier responsabilidad legal, penal o civil en
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
            a {businessName} y a su personal a realizar el procedimiento descrito.
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
