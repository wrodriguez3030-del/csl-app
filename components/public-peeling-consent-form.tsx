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

// Public form de Consentimiento Informado para Peeling. Igual al de masajes:
// el cliente solo ve "Cliente vinculado" + documento formal + declaración +
// firma. Los campos clínicos (tipo de peeling, zona, contraindicaciones, etc.)
// los completa el especialista después desde el sistema interno.

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

export interface PublicPeelingPrefill {
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
  prefill?: PublicPeelingPrefill
  onSubmit: (payload: Record<string, unknown>) => Promise<{ recordId?: string } | void>
  /** Slug del tenant para branding multi-tenant. Default "csl". */
  businessSlug?: string
}

const TITULO_DOC = "Consentimiento informado para peeling"

const PROPOSITO: ReadonlyArray<string> = [
  "Favorecer la renovación celular de la piel.",
  "Mejorar la textura, luminosidad y apariencia general del rostro o zona tratada.",
  "Ayudar a disminuir manchas superficiales, poros obstruidos, grasa, comedones, marcas leves de acné o líneas finas, según el tipo de piel y el protocolo aplicado.",
  "Preparar y complementar otros tratamientos estéticos cuando el personal calificado lo considere adecuado.",
]

const CONTRAINDICACIONES: ReadonlyArray<string> = [
  "Embarazo, sospecha de embarazo o lactancia.",
  "Uso actual o reciente de isotretinoína, retinoides, ácidos exfoliantes, despigmentantes fuertes o medicamentos fotosensibilizantes.",
  "Herpes activo, heridas abiertas, quemaduras solares, irritación severa, dermatitis, infección cutánea o enfermedad activa de la piel en la zona a tratar.",
  "Alergia conocida a ácidos, productos cosméticos, anestésicos tópicos, despigmentantes o cualquier componente del tratamiento.",
  "Tendencia a cicatrización queloide, manchas postinflamatorias o antecedentes de cicatrices anormales.",
  "Exposición solar intensa, cámaras de bronceado o bronceado reciente.",
  "Tratamientos oncológicos, inmunosupresión, diabetes no controlada, enfermedades autoinmunes, anticoagulantes o condiciones médicas que puedan contraindicar el procedimiento.",
  "Procedimientos recientes en la zona como láser, depilación con cera, microdermoabrasión, dermapen, cirugía, rellenos o toxina botulínica que deban evaluarse antes.",
  "No se realizará peeling si la zona está recién rasurada o recién depilada.",
  "Debe haber transcurrido al menos 1 semana desde el rasurado de la zona a tratar.",
  "Debe haber transcurrido un mínimo de 45 días desde cualquier tratamiento láser realizado en la zona.",
  "Suspender la depilación con cera antes y durante el protocolo de peeling, según indicación de la especialista.",
  "Zona con sensibilidad, irritación, ardor, inflamación, heridas, quemadura solar o reacción activa.",
]

const CUIDADOS_ANTES: ReadonlyArray<string> = [
  "Evitar exposición solar intensa o bronceado antes del procedimiento.",
  "Suspender exfoliantes, retinoides, ácidos, productos irritantes o despigmentantes fuertes según indicación de la especialista.",
  "Informar si estoy usando medicamentos, cremas medicadas, tratamientos dermatológicos o si me he realizado procedimientos recientes.",
  "Asistir con la piel limpia, sin maquillaje pesado, sin cremas irritantes y sin lesiones activas en la zona a tratar.",
  "Si tengo antecedentes de herpes labial, debo informarlo para recibir orientación preventiva antes del tratamiento.",
]

const CUIDADOS_DESPUES: ReadonlyArray<string> = [
  "Usar protector solar de amplio espectro y reaplicarlo durante el día, especialmente si hay exposición a luz solar o calor.",
  "Evitar sol directo, bronceado, sauna, vapor, piscina, playa, ejercicio intenso o calor excesivo por el tiempo indicado por la especialista.",
  "No retirar costras, no halar la descamación y no rascar la zona tratada.",
  "Mantener la piel hidratada con los productos recomendados y evitar productos irritantes hasta recibir autorización.",
  "No usar exfoliantes, retinoides, ácidos, despigmentantes fuertes, perfumes o maquillaje irritante durante los días indicados.",
  "Informar de inmediato a Cibao Spa Láser si presento dolor intenso, ampollas, secreción, inflamación severa, manchas marcadas, fiebre, infección o cualquier reacción fuera de lo esperado.",
]

const RIESGOS: ReadonlyArray<string> = [
  "Enrojecimiento, ardor, picor, sensibilidad, tirantez, inflamación o calor temporal en la zona tratada.",
  "Resequedad, descamación, costras superficiales o sensación de piel áspera durante los días posteriores.",
  "Oscurecimiento o aclaramiento temporal de la piel, especialmente con exposición al sol o sin protector solar.",
  "Irritación, brote de acné, dermatitis, reacción alérgica o sensibilidad a alguno de los productos utilizados.",
  "Reactivación de herpes en personas con antecedentes de herpes labial o lesiones herpéticas.",
  "Quemaduras superficiales, ampollas, infección, manchas persistentes, cicatrices o cambios de pigmentación (poco frecuentes).",
  "Insatisfacción con los resultados o necesidad de varias sesiones para lograr el objetivo deseado.",
]

const POLITICAS: ReadonlyArray<string> = [
  "Reservas, cancelaciones o reprogramaciones deben comunicarse con 48 horas de antelación; de lo contrario la sesión podrá darse por realizada.",
  "Horario: lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 9:00 a.m. a 4:00 p.m.; domingos cerrado.",
  "Los pagos se realizan en efectivo, transferencia o tarjeta de crédito. Los precios no incluyen ITBIS.",
  "El tiempo de la cita no puede extenderse bajo ningún motivo porque perjudica el itinerario programado.",
  "Si hay retraso por responsabilidad del centro, el tiempo será repuesto; si el retraso es del cliente, se atenderá solo el tiempo restante.",
  "La validez de servicios prepagados será según las políticas comerciales vigentes al momento de la compra.",
]

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
  return `consentimiento-peeling-${slug}-${today}`
}

function listHtml(items: ReadonlyArray<string>) {
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
}

function buildPrintHtml(args: {
  cliente: Required<PublicPeelingPrefill>
  fechaFirma: string
  firmaDataUrl: string
  recordId: string
  businessName?: string
  logoUrl?: string
  primaryColor?: string
  contactEmail?: string
}) {
  const {
    cliente, fechaFirma, firmaDataUrl, recordId,
    businessName = "CIBAO SPA LASER", logoUrl = "", primaryColor = "#00897b", contactEmail = "",
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
  <div class="field"><b>Especialista:</b> ${escapeHtml(cliente.especialista || "—")}</div>
</div>

<h2>Procedimiento</h2>
<p>Requiero y autorizo a Cibao Spa Láser para que el personal calificado realice en mi persona el tratamiento estético de PEELING, previa evaluación y según mi condición de piel.</p>

<h2>Propósito del procedimiento</h2>
${listHtml(PROPOSITO)}

<h2>Descripción del procedimiento</h2>
<p>El peeling consiste en la aplicación controlada de productos exfoliantes, despigmentantes, enzimáticos o químicos sobre la piel, con el objetivo de producir una renovación superficial o media según la evaluación realizada. Durante el tratamiento puedo sentir ardor, calor, picor, tirantez o molestia temporal. La intensidad del procedimiento dependerá del tipo de piel, sensibilidad, condición tratada y criterio del personal calificado.</p>

<h2>Riesgos, molestias y posibles complicaciones</h2>
${listHtml(RIESGOS)}

<h2>Contraindicaciones o condiciones que debo informar</h2>
${listHtml(CONTRAINDICACIONES)}

<h2>Cuidados antes del peeling</h2>
${listHtml(CUIDADOS_ANTES)}

<h2>Cuidados después del peeling</h2>
${listHtml(CUIDADOS_DESPUES)}

<h2>Políticas y procedimientos</h2>
${listHtml(POLITICAS)}

<h2>Protección de datos</h2>
<p>Cibao Spa Láser podrá enviar información, respuestas a consultas y contactos relacionados con nuestros servicios mientras dure nuestra relación y tengamos su consentimiento como destinatario. No se cederán datos a terceros salvo obligación legal. Correo: cibaospalaser@gmail.com</p>

<h2>Declaración y firma</h2>
<p>He podido aclarar todas mis dudas y he entendido totalmente este documento de consentimiento informado para peeling, reafirmándome en todos y cada uno de sus puntos. Confirmo que la información suministrada es verdadera y completa, y autorizo a Cibao Spa Láser y a su personal a realizar el procedimiento descrito.</p>

<div class="sign-box">
  ${firmaDataUrl ? `<img class="sign-img" src="${firmaDataUrl}" alt="Firma del cliente" />` : '<div class="sign-img"></div>'}
  <div class="sign-cap">Firma del cliente — ${escapeHtml(cliente.nombre || "Cliente")}</div>
</div>

<div class="footer">
  Cibao Spa Láser · Documento generado el ${escapeHtml(new Date().toLocaleString("es-DO"))} · Ref ${escapeHtml(recordId)}
</div>

</body></html>`
  // Red de seguridad: cualquier "Cibao Spa Láser/Laser" (y el correo legado) embebido
  // en el cuerpo legal se reemplaza por la marca/correo del tenant.
  let out = html.replace(/Cibao Spa L[aá]ser/g, businessName)
  if (contactEmail) out = out.replace(/cibaospalaser@gmail\.com/g, contactEmail)
  return out
}

export function PublicPeelingConsentForm({ prefill = {}, onSubmit, businessSlug = "csl" }: Props) {
  const branding = getBusinessBranding(businessSlug)
  const businessName = branding.name
  const contactEmail = branding.contactEmail
  const cliente: Required<PublicPeelingPrefill> = {
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
      // Payload mínimo con shape ConsentimientoRecord (peeling). El backend
      // (consentToDb + schema fallback) acepta el resto vacío; el especialista
      // completa los campos clínicos después desde el sistema interno.
      const id = `CP-${Date.now()}`
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
        tipoPeeling: cliente.servicio || "",
        observaciones: cliente.servicio || "",
        firmaCliente: firma,
        firmaEspecialista: "",
        // Aceptación unificada — el cliente firma UNA vez; marcamos los flags
        // de peeling para que el contrato legal quede cumplido a nivel DB.
        aceptaProcedimiento: true,
        aceptaRiesgos: true,
        aceptaPoliticas: true,
        aceptaProteccionDatos: true,
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
      contactEmail,
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
              Gracias. {businessName} recibió tu consentimiento de peeling firmado.
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
            <p>
              Requiero y autorizo a {businessName} para que el personal calificado realice en mi
              persona el tratamiento estético de PEELING, previa evaluación y según mi condición de piel.
            </p>
          </Section>

          <Section title="Propósito del procedimiento">
            <ul className="ml-5 list-disc space-y-1">
              {PROPOSITO.map((line, idx) => <li key={idx}>{line}</li>)}
            </ul>
          </Section>

          <Section title="Descripción del procedimiento">
            <p>
              El peeling consiste en la aplicación controlada de productos exfoliantes, despigmentantes,
              enzimáticos o químicos sobre la piel, con el objetivo de producir una renovación superficial
              o media según la evaluación realizada. Durante el tratamiento puedo sentir ardor, calor, picor,
              tirantez o molestia temporal. La intensidad del procedimiento dependerá del tipo de piel,
              sensibilidad, condición tratada y criterio del personal calificado.
            </p>
          </Section>

          <Section title="Riesgos, molestias y posibles complicaciones">
            <ul className="ml-5 list-disc space-y-1">
              {RIESGOS.map((line, idx) => <li key={idx}>{line}</li>)}
            </ul>
          </Section>

          <Section title="Contraindicaciones o condiciones que debo informar">
            <ul className="ml-5 list-disc space-y-1">
              {CONTRAINDICACIONES.map((line, idx) => <li key={idx}>{line}</li>)}
            </ul>
          </Section>

          <Section title="Cuidados antes del peeling">
            <ul className="ml-5 list-disc space-y-1">
              {CUIDADOS_ANTES.map((line, idx) => <li key={idx}>{line}</li>)}
            </ul>
          </Section>

          <Section title="Cuidados después del peeling">
            <ul className="ml-5 list-disc space-y-1">
              {CUIDADOS_DESPUES.map((line, idx) => <li key={idx}>{line.replace(/Cibao Spa L[aá]ser/g, businessName)}</li>)}
            </ul>
          </Section>

          <Section title="Políticas y procedimientos">
            <ul className="ml-5 list-disc space-y-1">
              {POLITICAS.map((line, idx) => <li key={idx}>{line}</li>)}
            </ul>
          </Section>

          <Section title="Protección de datos">
            <p>
              {businessName} podrá enviar información, respuestas a consultas y contactos relacionados
              con nuestros servicios mientras dure nuestra relación y tengamos su consentimiento como
              destinatario. No se cederán datos a terceros salvo obligación legal. Correo: {contactEmail}
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
            He podido aclarar todas mis dudas y he entendido totalmente este consentimiento informado
            para peeling, reafirmándome en todos y cada uno de sus puntos. Confirmo que la información
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
              Declaro que he leído y acepto este consentimiento informado para peeling.
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
