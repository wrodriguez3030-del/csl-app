"use client"

import { useEffect, useMemo, useState } from "react"
import { Edit, Eye, MessageCircle, Plus, Printer, Trash2 } from "lucide-react"
import { FichaDermatologiaForm } from "@/components/ficha-dermatologia-form"
import { LinkGeneratorDialog } from "@/components/link-generator-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SeqBadge } from "@/components/seq-badge"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import type { Business, ClienteCosmiatria } from "@/lib/types"
import { displayPhone, displayDocumento } from "@/lib/formatters"
import type { FichaDermoCosmiatrica } from "@/lib/dermo-cosmiatria"
import { normalizeSearchText, normalizeDigits } from "@/lib/cliente-search"

type SortKey = "fecha" | "nombre" | "sucursal" | "operadora" | "estado"

// Sort interactivo desde los headers de la tabla — los dropdowns de
// "Ordenar por" + Asc/Desc se removieron para simplificar el toolbar.

function sortValue(record: FichaDermoCosmiatrica, key: SortKey) {
  return String(record[key] || "").toLowerCase()
}

function uniqueText(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"))
}

function getOperadoraName(record: Record<string, unknown>) {
  return String(record.Nombre || record.nombre || record.Operadora || record.operadora || "").trim()
}

function normalizeCliente(raw: Record<string, unknown>): ClienteCosmiatria {
  return {
    ClienteID: String(raw.ClienteID ?? raw.cliente_id ?? raw.id ?? ""),
    NumeroCliente: String(raw.NumeroCliente ?? raw.numero_cliente ?? ""),
    DocumentoIdentidad: String(raw.DocumentoIdentidad ?? raw.documento_identidad ?? ""),
    Email: String(raw.Email ?? raw.email ?? ""),
    Nombre: String(raw.Nombre ?? raw.nombre ?? ""),
    Apellido: String(raw.Apellido ?? raw.apellido ?? ""),
    Telefono: String(raw.Telefono ?? raw.telefono ?? ""),
    Telefono2: String(raw.Telefono2 ?? raw.telefono2 ?? ""),
    Direccion: String(raw.Direccion ?? raw.direccion ?? ""),
    Localidad: String(raw.Localidad ?? raw.localidad ?? ""),
    Ciudad: String(raw.Ciudad ?? raw.ciudad ?? ""),
    Region: String(raw.Region ?? raw.region ?? ""),
    FechaNacimiento: String(raw.FechaNacimiento ?? raw.fecha_nacimiento ?? ""),
    Edad: Number(raw.Edad ?? raw.edad ?? 0),
    Genero: String(raw.Genero ?? raw.genero ?? ""),
    Sucursal: String(raw.Sucursal ?? raw.sucursal ?? ""),
    PuedeAgendar: Boolean(raw.PuedeAgendar ?? raw.puede_agendar ?? true),
    ClienteDesde: String(raw.ClienteDesde ?? raw.cliente_desde ?? ""),
    Estado: (String(raw.Estado ?? raw.estado ?? "Activo") === "Inactivo" ? "Inactivo" : "Activo") as ClienteCosmiatria["Estado"],
    Notas: String(raw.Notas ?? raw.notas ?? ""),
  }
}

function DetailItem({ label, value }: { label: string; value?: string | string[] }) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(", ") : value
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{text || "-"}</p>
    </div>
  )
}

const consentimientoCosmiatria = [
  "CONSENTIMIENTO INFORMADO",
  "PROCEDIMIENTO: LIMPIEZA FACIAL Y/O TRATAMIENTOS DE COSMIATRÍA",
  "El tratamiento de cosmiatría en Cibao Spa Laser puede incluir limpieza facial profunda, peelings químicos, tratamientos con láser, aparatología estética, extracción, hidratación, despigmentantes, protocolos antiacné, rejuvenecimiento y otros procedimientos diseñados para mejorar la apariencia y salud de la piel.",
  "Confirmo que Cibao Spa Laser me ha explicado en palabras comprensibles la naturaleza del procedimiento, su finalidad, beneficios esperados, limitaciones, alternativas disponibles, molestias normales y cuidados necesarios antes y después del tratamiento.",
  "Declaro que he informado de manera completa y verdadera mis antecedentes médicos, medicamentos, alergias, cirugías, embarazo, lactancia, enfermedades de la piel, exposición solar reciente, tratamientos estéticos previos y cualquier condición que pueda influir en el procedimiento.",
  "Comprendo que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar resultados perfectos, permanentes o idénticos entre personas. Los resultados dependen de mi tipo de piel, hábitos, seguimiento de indicaciones y respuesta individual.",
  "Se me han informado posibles efectos secundarios como enrojecimiento, ardor, sensibilidad, resequedad, descamación, brotes, irritación, hinchazón, hematomas, hiperpigmentación, hipopigmentación, infección, cicatriz, reacción alérgica o resultado no deseado.",
  "Autorizo a Cibao Spa Laser a tomar y conservar datos, fotografías, evolución clínica y firma digital como parte de mi expediente estético. Este material será usado para diagnóstico, seguimiento, control interno y respaldo de la historia del tratamiento.",
  "Me comprometo a seguir las instrucciones indicadas antes, durante y después del procedimiento, incluyendo el uso de protector solar, hidratación, evitar exposición solar directa, saunas, calor excesivo, manipulación de la piel o productos no indicados cuando aplique.",
  "Entiendo que debo notificar de inmediato cualquier molestia intensa, reacción inesperada, lesión, alergia, cambio de medicación o condición médica nueva antes de continuar con nuevas sesiones.",
  "Acepto que Cibao Spa Laser puede retrasar, modificar o suspender el procedimiento si el personal considera que existe riesgo, contraindicación, falta de información clínica o incumplimiento de cuidados.",
  "Reconozco que se me ha dado oportunidad de hacer preguntas, que mis dudas fueron respondidas satisfactoriamente y que firmo este consentimiento libre y voluntariamente.",
  "Autorizo la realización del procedimiento en Cibao Spa Laser y libero al centro y a su personal de responsabilidad por complicaciones derivadas de información omitida, indicaciones incumplidas o reacciones individuales no previsibles.",
  "Este consentimiento aplica a la ficha dermo-cosmiátrica registrada y a los procedimientos relacionados con la evaluación y tratamiento indicado para mi caso, sin sustituir una consulta médica dermatológica cuando sea necesaria.",
]

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function printValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ")
  return String(value ?? "")
}

function printField(label: string, value: unknown) {
  return `<div class="f"><b>${escapeHtml(label)}:</b> ${escapeHtml(printValue(value))}</div>`
}

function printRow(...fields: string[]) {
  return `<div class="row">${fields.join("")}</div>`
}

function printTable(title: string, headers: string[], rows: unknown[][]) {
  return `<h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(printValue(cell))}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}">&nbsp;</td></tr>`
  }</tbody></table>`
}

function buildFichaPrintHtml(ficha: FichaDermoCosmiatrica, business?: Business) {
  const isPendiente = ficha.estado === "Pendiente de revisión" || ficha.estado === "Pendiente"
  const watermarkBanner = isPendiente
    ? `<div style="background:#fef3c7;border:2px solid #f59e0b;color:#92400e;padding:8px 12px;margin:0 0 8px;text-align:center;font-weight:bold;font-size:11px;border-radius:6px;">⚠ ${ficha.estado === "Pendiente de revisión" ? "PENDIENTE DE REVISIÓN POR ESPECIALISTA" : "PENDIENTE — falta completar"} · Esta ficha NO está finalizada.</div>`
    : ""
  const brandName = business?.name || "Cibao Spa Laser"
  const brandColor = business?.primaryColor || "#00897b"
  const logoSrc = business?.logoUrl && typeof window !== "undefined" ? `${window.location.origin}${business.logoUrl}` : ""
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Ficha Dermatología - ${escapeHtml(ficha.nombre || ficha.id)}</title><style>
@page{size:letter;margin:10mm;}
*{box-sizing:border-box;}
body{font-family:Arial,Helvetica,sans-serif;margin:0;font-size:9px;color:#111827;background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.header{display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:2px solid ${brandColor};padding-bottom:5px;}
.header img{height:42px;width:auto;object-fit:contain;}
.header-text{flex:1;text-align:left;}
.logo{font-size:14px;font-weight:bold;color:${brandColor};}
h1{font-size:11px;margin:2px 0 0;}
h2{background:${brandColor};color:white;padding:4px 6px;font-size:9.5px;margin:7px 0 4px;text-transform:uppercase;break-after:avoid;page-break-after:avoid;}
.subtitle{margin:2px 0 0;color:#4b5563;font-size:8.5px;}
.row{display:flex;gap:7px;margin:2px 0;break-inside:avoid;page-break-inside:avoid;}
.f{flex:1;min-height:13px;padding:2px;border-bottom:1px dotted #999;}
.f b{color:#555;}
table{width:100%;border-collapse:collapse;margin:4px 0;font-size:8.4px;break-inside:auto;page-break-inside:auto;}
tr{break-inside:avoid;page-break-inside:avoid;}
th{background:${brandColor};color:white;padding:3px;text-align:left;}
td{border:1px solid #ccc;padding:2px 3px;vertical-align:top;}
.consent{margin-top:10px;break-inside:auto;page-break-inside:auto;}
.consent h2{margin-top:0;}
.consent p{margin:4px 0;line-height:1.25;text-align:justify;font-size:8.6px;}
.consent .consent-title{font-weight:bold;color:${brandColor};text-align:center;font-size:10.5px;margin:5px 0;break-after:avoid;page-break-after:avoid;}
.empty{color:#9ca3af;}
.signature{margin-top:14px;border-top:1px solid #111827;padding-top:5px;text-align:center;break-inside:avoid;page-break-inside:avoid;}
.signature h2{margin:0 0 5px;text-align:left;}
.firma-box{margin:3px auto 0;width:360px;max-width:100%;padding-top:3px;break-inside:avoid;page-break-inside:avoid;}
.firma-box img{display:block;margin:0 auto 4px;max-width:300px;max-height:82px;border:1px solid #ccc;background:white;padding:5px;}
.firma-box p{margin:2px 0;font-size:8.5px;}
.meta{margin-top:4px;color:#374151;font-size:8px;}
@media print{button{display:none}}
</style></head><body>
${watermarkBanner}<div class="header">${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(brandName)}" onerror="this.style.display='none'" />` : ""}<div class="header-text"><div class="logo">${escapeHtml(brandName.toUpperCase())}</div><h1>FICHA DERMATOLÓGICA / DERMO-COSMIÁTRICA</h1><p class="subtitle">Documento generado desde el sistema CSL</p></div></div>
${printRow(printField("Fecha", ficha.fecha), printField("Estado", ficha.estado))}
${printRow(printField("Sucursal", ficha.sucursal), printField("Operadora", ficha.operadora), printField("Especialista", ficha.nombreEspecialista || ficha.especialista))}
<h2>Datos del cliente</h2>
${printRow(printField("Nombre", ficha.nombre), printField("Edad", ficha.edad), printField("Cédula", displayDocumento(ficha.cedula || ficha.documento)))}
${printRow(printField("Ciudad", ficha.ciudad), printField("Teléfono", displayPhone(ficha.telefono)), printField("Email", ficha.email))}
${printRow(printField("Fecha nacimiento", ficha.fechaNacimiento), printField("Dirección", ficha.direccion))}
${printRow(printField("Ocupación", ficha.ocupacion))}
${printRow(printField("Motivo de consulta", ficha.motivoConsulta))}
<h2>Evaluación dermatológica</h2>
${printRow(printField("Tipo de piel", ficha.tipoPiel), printField("Fototipo", ficha.fototipo), printField("Estado general", ficha.estadoGeneralPiel))}
${printRow(printField("Sensibilidad", ficha.sensibilidad), printField("Hidratación", ficha.hidratacion), printField("Color piel", ficha.colorPiel))}
${printRow(printField("Manchas", ficha.manchas), printField("Acné", ficha.acne), printField("Rosácea", ficha.rosacea), printField("Melasma", ficha.melasma))}
${printRow(printField("Cicatrices", ficha.cicatrices), printField("Lesiones visibles", ficha.lesionesVisibles), printField("Irritación", ficha.irritacion))}
${printRow(printField("Observaciones de la piel", ficha.observacionesPiel))}
<h2>Hábitos y semiología cutánea</h2>
${printRow(printField("Alcohol", ficha.alcohol), printField("Cigarrillos", ficha.cigarrillos), printField("Café", ficha.cafe))}
${printRow(printField("Calidad de sueño", ficha.calidadSueno), printField("Vasos de agua", ficha.vasosAgua))}
${printRow(printField("Fototipo", ficha.fototipo), printField("Biotipo", ficha.biotipo), printField("Color piel", ficha.colorPiel))}
${printRow(printField("Grasa", ficha.grasa), printField("Seca", ficha.seca), printField("Textura", ficha.textura))}
<h2>Antecedentes médicos</h2>
${printTable("Antecedentes médicos", ["Campo", "Valores"], [["Marcados", ficha.antecedentesMedicos], ["Notas", ficha.antecedentesMedicosNotas]])}
${printRow(printField("Medicamentos", `${ficha.medicamentos || ""} ${ficha.medicamentosCuales || ""}`), printField("Medicamento tópico", `${ficha.medicamentoTopico || ""} ${ficha.medicamentoTopicoCuales || ""}`))}
${printRow(printField("Alergias", `${ficha.alergias || ""} ${ficha.alergiasCuales || ""}`), printField("Cirugías", `${ficha.cirugias || ""} ${ficha.cirugiasCuales || ""}`))}
${printRow(printField("Cáncer de piel", `${ficha.cancerPiel || ""} ${ficha.cancerPielCuales || ""}`), printField("Herpes", ficha.herpes), printField("Embarazada", ficha.embarazada))}
${printRow(printField("Cosmético actual", `${ficha.cosmeticoActual || ""} ${ficha.cosmeticoActualCuales || ""}`))}
${printRow(printField("Tolera jabones, perfumes, cremas", ficha.toleraCosmeticos))}
${printRow(printField("Depilación láser", `${ficha.depilaLaser || ""} ${ficha.reaccionLaser || ""}`))}
<h2>Alergias, medicamentos y condiciones especiales</h2>
${printRow(printField("Alergias", `${ficha.alergias || ""} ${ficha.alergiasNotas || ficha.alergiasCuales || ""}`), printField("Medicamentos", `${ficha.medicamentos || ""} ${ficha.medicamentosNotas || ficha.medicamentosCuales || ""}`))}
${printRow(printField("Fotosensibilizantes", `${ficha.medicamentosFotosensibilizantes || ""} ${ficha.medicamentosFotosensibilizantesNotas || ""}`), printField("Embarazo", `${ficha.embarazo || ficha.embarazada || ""} ${ficha.embarazoNotas || ""}`), printField("Lactancia", `${ficha.lactancia || ""} ${ficha.lactanciaNotas || ""}`))}
${printRow(printField("Piel sensible", `${ficha.pielSensible || ""} ${ficha.pielSensibleNotas || ""}`), printField("Queloides", `${ficha.queloides || ""} ${ficha.queloidesNotas || ""}`), printField("Exposición solar", `${ficha.exposicionSolar || ""} ${ficha.exposicionSolarNotas || ""}`))}
${printTable("Crono y fotoenvejecimiento", ["Campo", "Valores"], [
    ["Se observa", ficha.seObserva],
    ["Tratamientos previos", ficha.tratamientosPrevios],
    ["Modificaciones pigmentarias", ficha.modificacionesPigmentarias],
    ["Lentigo solar", ficha.lentigoSolar],
    ["Involución cutánea", ficha.involucionCutanea],
    ["Alteraciones de textura", ficha.texturaAlteraciones],
    ["Lipidización cutánea", ficha.lipidizacionCutanea],
  ])}
<h2>Observaciones</h2>
${printRow(printField("Observaciones generales", ficha.observaciones))}
${printRow(printField("Observaciones profesionales", ficha.observacionesProfesionales))}
${printRow(printField("Recomendaciones", ficha.recomendaciones))}
${printRow(printField("Cuidados sugeridos", ficha.cuidadosSugeridos), printField("Recomienda procedimiento", ficha.recomiendaProcedimiento), printField("Próxima evaluación", ficha.proximaEvaluacion))}
<h2>Declaración del cliente</h2>
${printRow(printField("Declaración aceptada", ficha.declaracionAceptada ? "Sí" : "No"))}
<div class="consent">
  <h2>Consentimiento informado</h2>
  ${consentimientoCosmiatria.map((line, index) => index < 2 ? `<p class="consent-title">${escapeHtml(line)}</p>` : `<p>${escapeHtml(line)}</p>`).join("")}
  <div class="signature">
    <h2>Firmas digitales</h2>
    <div class="row">
      <div class="firma-box">
        ${ficha.firma ? `<img src="${escapeHtml(ficha.firma)}" alt="Firma digital del cliente" />` : "<div style='height:70px'></div>"}
        <p><b>${escapeHtml(ficha.nombre || "Cliente")}</b> · Firma del cliente</p>
      </div>
      <div class="firma-box">
        ${ficha.firmaEspecialista ? `<img src="${escapeHtml(ficha.firmaEspecialista)}" alt="Firma especialista" />` : "<div style='height:70px'></div>"}
        <p><b>${escapeHtml(ficha.nombreEspecialista || ficha.especialista || "Especialista")}</b> · Firma del especialista</p>
      </div>
    </div>
    <div class="meta">
      ${printRow(printField("Cédula", displayDocumento(ficha.cedula)), printField("Fecha", ficha.fecha))}
      ${printRow(printField("Sucursal", ficha.sucursal), printField("Operadora", ficha.operadora))}
    </div>
  </div>
</div>
</body></html>`
}

export function CosmiatriaFichaPage() {
  const { apiUrl, dbPulsos, showToast, setIsLoading, setLoadingMessage, incrementFormOpen, decrementFormOpen } = useAppStore()
  const sessionUser = useSessionUser()
  const isUsuario = !!sessionUser && !sessionUser.isAdmin && !sessionUser.isSuperadmin
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<FichaDermoCosmiatrica[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<FichaDermoCosmiatrica | null>(null)
  const [viewing, setViewing] = useState<FichaDermoCosmiatrica | null>(null)
  const [operatorOptions, setOperatorOptions] = useState<string[]>([])
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])
  const [search, setSearch] = useState("")
  const [onlyPendientes, setOnlyPendientes] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("fecha")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  // Dialog "Generar link para cliente" — link único, un uso, 12h, WhatsApp.
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)

  // Consentimientos del cliente cuya ficha se está visualizando.
  const [viewingConsents, setViewingConsents] = useState<{
    masajes: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoMasaje?: string; zonaTratar?: string }>
    tatuajes: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoProcedimiento?: string; zonaTratar?: string }>
  } | null>(null)
  const [viewingConsentsLoading, setViewingConsentsLoading] = useState(false)

  const loadRecords = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    try {
      setIsLoading(true)
      setLoadingMessage("Cargando fichas...")
      const result = await apiJsonp(normalized, { action: "getFichasDermatologia" })
      if (!result?.ok) throw new Error(String((result as { error?: string })?.error || "No se pudieron cargar las fichas"))
      setRecords(((result as { records?: FichaDermoCosmiatrica[] }).records || []))
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error cargando fichas", "error")
    } finally {
      setIsLoading(false)
    }
  }

  const loadOperadoras = async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getAllPulsosData" })
      if (!result?.ok) throw new Error(String((result as { error?: string })?.error || "No se pudieron cargar las operadoras"))
      const recordsFromApi = ((result as { operadoras?: Record<string, unknown>[] }).operadoras || []).map(getOperadoraName)
      setOperatorOptions(uniqueText(recordsFromApi))
    } catch (error) {
      const fallback = dbPulsos.operadoras.map((operadora) => String(operadora.Nombre || "").trim())
      setOperatorOptions(uniqueText(fallback))
      showToast(error instanceof Error ? error.message : "No se pudieron cargar las operadoras", "error")
    }
  }

  const loadClientes = async () => {
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getClientesCosmiatria" })
      if (!result?.ok) throw new Error(String((result as { error?: string })?.error || "No se pudieron cargar los clientes"))
      const rows = ((result as { records?: Record<string, unknown>[] }).records || []).map(normalizeCliente)
      setClientes(rows)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudieron cargar los clientes", "error")
    }
  }

  useEffect(() => {
    void loadRecords()
    void loadOperadoras()
    void loadClientes()
  }, [apiUrl])

  // Auto-refresh silencioso del listado de fichas cada 60s.
  // Pausa cuando el usuario tiene un dialog abierto (form/ver).
  const refreshSilent = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    try {
      const result = await apiJsonp(normalized, { action: "getFichasDermatologia" })
      if (result?.ok) setRecords(((result as { records?: FichaDermoCosmiatrica[] }).records || []))
    } catch {}
  }
  useAutoRefresh(refreshSilent, {
    intervalMs: 60_000,
    skipWhen: () => open || !!viewing,
  })

  useEffect(() => {
    if (open) {
      incrementFormOpen()
      return () => decrementFormOpen()
    }
  }, [open, incrementFormOpen, decrementFormOpen])

  // Carga consentimientos del cliente cuando se abre la vista de una ficha.
  useEffect(() => {
    const clienteId = viewing?.clienteId
    if (!clienteId) {
      setViewingConsents(null)
      return
    }
    let cancelled = false
    setViewingConsentsLoading(true)
    void (async () => {
      try {
        const result = await apiJsonp(normalizeApiUrl(apiUrl), {
          action: "getClienteHistorial",
          clienteId,
        }) as {
          ok?: boolean
          consentMasajes?: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoMasaje?: string; zonaTratar?: string }>
          consentTatuajesCejas?: Array<{ id: string; fecha: string; sucursal: string; estado: string; tipoProcedimiento?: string; zonaTratar?: string }>
        }
        if (cancelled) return
        if (!result?.ok) {
          setViewingConsents({ masajes: [], tatuajes: [] })
          return
        }
        setViewingConsents({
          masajes: Array.isArray(result.consentMasajes) ? result.consentMasajes : [],
          tatuajes: Array.isArray(result.consentTatuajesCejas) ? result.consentTatuajesCejas : [],
        })
      } catch {
        if (!cancelled) setViewingConsents({ masajes: [], tatuajes: [] })
      } finally {
        if (!cancelled) setViewingConsentsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [viewing?.clienteId, apiUrl])

  const sucursales = useMemo(
    () => uniqueText([...records.map((record) => record.sucursal), ...dbPulsos.operadoras.map((operadora) => String(operadora.Sucursal || ""))]),
    [records, dbPulsos.operadoras]
  )

  const operadoras = useMemo(
    () => uniqueText([...operatorOptions, ...records.map((record) => record.operadora)]),
    [operatorOptions, records]
  )

  const filtered = useMemo(() => {
    // Búsqueda sobre fichas — reusa los normalizadores del helper de clientes
    // (tolera acentos, mayúsculas y formato de teléfono/cédula). Los campos
    // específicos de ficha (motivoConsulta, ocupacion, operadora) se concatenan
    // al haystack.
    const needle = normalizeSearchText(search)
    const needleDigits = normalizeDigits(search)
    return records
      .filter((record) => {
        if (onlyPendientes && record.estado !== "Pendiente de revisión") return false
        if (!needle) return true
        const text = normalizeSearchText(
          [
            record.nombre,
            record.email,
            record.ciudad,
            record.ocupacion,
            record.motivoConsulta,
            record.operadora,
            record.sucursal,
            record.estado,
          ]
            .filter(Boolean)
            .join(" "),
        )
        if (text.includes(needle)) return true
        if (needleDigits) {
          const digits = normalizeDigits([record.telefono, record.cedula].filter(Boolean).join(" "))
          if (digits.includes(needleDigits)) return true
        }
        return false
      })
      .sort((a, b) => sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "es", { numeric: true }) * (sortDir === "asc" ? 1 : -1))
  }, [records, search, sortKey, sortDir, onlyPendientes])

  const pendientesCount = useMemo(
    () => records.filter((r) => r.estado === "Pendiente de revisión").length,
    [records]
  )

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((current) => current === "asc" ? "desc" : "asc")
    else {
      setSortKey(key)
      setSortDir(key === "fecha" ? "desc" : "asc")
    }
  }

  const submit = async (value: FichaDermoCosmiatrica) => {
    const result = await apiJsonp(normalizeApiUrl(apiUrl), {
      action: "saveFichaDermatologia",
      data: JSON.stringify(value),
    })
    if (!result?.ok) throw new Error(String((result as { error?: string })?.error || "No se pudo guardar"))
    await loadRecords()
    await loadClientes()
    setOpen(false)
    setEditing(null)
    const email = (result as { email?: { sent?: boolean; warning?: string } }).email
    if (email?.sent) showToast("Ficha guardada y enviada por correo", "success")
    else showToast(email?.warning ? `Ficha guardada, correo no enviado: ${email.warning}` : "Ficha guardada", email?.warning ? "error" : "success")
  }

  const remove = async (id: string) => {
    if (!confirm("¿Eliminar esta ficha?")) return
    const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteFichaDermatologia", id })
    if (!result?.ok) {
      showToast("No se pudo eliminar", "error")
      return
    }
    setRecords((current) => current.filter((record) => record.id !== id))
    showToast("Ficha eliminada", "success")
  }

  const startNew = () => {
    setEditing(null)
    setOpen(true)
  }

  const startEdit = (record: FichaDermoCosmiatrica) => {
    setEditing(record)
    setOpen(true)
  }

  const printFicha = (record: FichaDermoCosmiatrica) => {
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      showToast("El navegador bloqueó la ventana de impresión", "error")
      return
    }
    printWindow.document.write(buildFichaPrintHtml(record, business))
    printWindow.document.close()
    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
    }, 500)
  }

  const sortLabel = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕"

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold">Cosmiatría</h2>
          <p className="text-sm text-muted-foreground">Ficha Dermatología / Dermo-Cosmiátrica</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
          <Button variant="outline" onClick={() => setLinkDialogOpen(true)}><MessageCircle className="mr-2 h-4 w-4" />Generar link para cliente</Button>
          {!isUsuario && <Button onClick={startNew}><Plus className="mr-2 h-4 w-4" />Nueva ficha</Button>}
        </div>
      </div>

      {/* (Card estática "Link para enviar a clientes" removida — el link de
          un solo uso se obtiene desde el botón "Generar link para cliente").
          La data se refresca automáticamente: el shell de la app corre
          auto-refresh cada 60s; este módulo lo aprovecha. */}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total</p><p className="text-3xl font-bold">{records.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Completadas</p><p className="text-3xl font-bold text-green-500">{records.filter((record) => record.estado === "Completada").length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Operadoras</p><p className="text-3xl font-bold">{operadoras.length}</p></CardContent></Card>
      </div>

      {/* Filtros: buscador + chip "Pendientes de revisión" (cuando viene
          de link público y la especialista debe finalizar). El orden y
          filtros por columna están en los headers clickeables. */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <Label>Buscar</Label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cliente, teléfono, cédula, correo, motivo..."
                className="mt-1"
              />
            </div>
            <Button
              type="button"
              variant={onlyPendientes ? "default" : "outline"}
              onClick={() => setOnlyPendientes((v) => !v)}
              className={`shrink-0 gap-2 ${onlyPendientes ? "" : "border-blue-200 text-blue-700 hover:bg-blue-50"}`}
            >
              {onlyPendientes ? "✓ " : ""}Pendientes de revisión
              {pendientesCount > 0 ? (
                <Badge variant="secondary" className={onlyPendientes ? "bg-white/30 text-white" : "bg-blue-100 text-blue-800"}>
                  {pendientesCount}
                </Badge>
              ) : null}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/30">
              <th className="w-12 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">#</th>
              <th className="cursor-pointer px-3 py-2 text-left text-xs" onClick={() => setSort("fecha")}>Fecha{sortLabel("fecha")}</th>
              <th className="cursor-pointer px-3 py-2 text-left text-xs" onClick={() => setSort("nombre")}>Cliente{sortLabel("nombre")}</th>
              <th className="cursor-pointer px-3 py-2 text-left text-xs" onClick={() => setSort("sucursal")}>Sucursal{sortLabel("sucursal")}</th>
              <th className="cursor-pointer px-3 py-2 text-left text-xs" onClick={() => setSort("operadora")}>Operadora{sortLabel("operadora")}</th>
              <th className="cursor-pointer px-3 py-2 text-center text-xs" onClick={() => setSort("estado")}>Estado{sortLabel("estado")}</th>
              <th className="px-3 py-2 text-right text-xs">Acciones</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-muted-foreground">Sin fichas registradas</td></tr> : filtered.map((record, seqIndex) => (
                <tr key={record.id} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2 text-center"><SeqBadge n={seqIndex + 1} /></td>
                  <td className="px-3 py-2 text-xs">{record.fecha}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{record.nombre}</div>
                    <div className="text-xs text-muted-foreground">{record.telefono}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{record.sucursal}</td>
                  <td className="px-3 py-2 text-xs">{record.operadora}</td>
                  <td className="px-3 py-2 text-center">
                    {record.estado === "Pendiente de revisión" ? (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 font-bold text-blue-700">
                        Cliente firmó · falta especialista
                      </Badge>
                    ) : record.estado === "Completada" ? (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{record.estado}</Badge>
                    ) : (
                      <Badge variant="outline">{record.estado}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" title="Ver" onClick={() => setViewing(record)}><Eye className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" title="Editar" onClick={() => startEdit(record)}><Edit className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" title="Imprimir PDF" onClick={() => printFicha(record)}><Printer className="h-4 w-4 text-cyan-500" /></Button>
                      <Button size="sm" variant="ghost" title="Eliminar" onClick={() => void remove(record.id)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setEditing(null) }}>
        <DialogContent className="h-[96dvh] !w-[96vw] !max-w-[1450px] overflow-y-auto p-3 sm:p-5">
          <DialogHeader><DialogTitle>{editing ? "Editar Ficha Dermatología" : "Nueva Ficha Dermatología"}</DialogTitle></DialogHeader>
          <FichaDermatologiaForm
            key={editing?.id || "new-ficha-dermatologia"}
            initialValue={editing || undefined}
            operadoras={operadoras}
            clientes={clientes}
            submitLabel="Guardar y enviar PDF"
            onCancel={() => { setOpen(false); setEditing(null) }}
            onSubmit={submit}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(value) => { if (!value) setViewing(null) }}>
        <DialogContent className="max-h-[92vh] w-[94vw] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Ver Ficha Dermatología</DialogTitle></DialogHeader>
          {viewing ? (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Datos del cliente</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <DetailItem label="Fecha" value={viewing.fecha} />
                  <DetailItem label="Cliente" value={viewing.nombre} />
                  <DetailItem label="Teléfono" value={viewing.telefono} />
                  <DetailItem label="Cédula" value={viewing.cedula} />
                  <DetailItem label="Email" value={viewing.email} />
                  <DetailItem label="Ciudad" value={viewing.ciudad} />
                  <DetailItem label="Sucursal" value={viewing.sucursal} />
                  <DetailItem label="Operadora" value={viewing.operadora} />
                  <DetailItem label="Especialista" value={viewing.nombreEspecialista || viewing.especialista} />
                  <DetailItem label="Estado" value={viewing.estado} />
                  <div className="md:col-span-3"><DetailItem label="Motivo de consulta" value={viewing.motivoConsulta} /></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Evaluación Dermatológica</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <DetailItem label="Tipo de piel" value={viewing.tipoPiel} />
                  <DetailItem label="Fototipo" value={viewing.fototipo} />
                  <DetailItem label="Estado general" value={viewing.estadoGeneralPiel} />
                  <DetailItem label="Sensibilidad" value={viewing.sensibilidad} />
                  <DetailItem label="Hidratación" value={viewing.hidratacion} />
                  <DetailItem label="Biotipo" value={viewing.biotipo} />
                  <DetailItem label="Color piel" value={viewing.colorPiel} />
                  <DetailItem label="Manchas / Acné / Rosácea" value={`${viewing.manchas || "-"} / ${viewing.acne || "-"} / ${viewing.rosacea || "-"}`} />
                  <div className="md:col-span-3"><DetailItem label="Observaciones de piel" value={viewing.observacionesPiel} /></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Antecedentes, alergias y medicamentos</CardTitle></CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <DetailItem label="Antecedentes médicos" value={viewing.antecedentesMedicos} />
                  <DetailItem label="Notas antecedentes" value={viewing.antecedentesMedicosNotas} />
                  <DetailItem label="Medicamentos" value={`${viewing.medicamentos || "-"} ${viewing.medicamentosCuales || ""}`} />
                  <DetailItem label="Alergias" value={`${viewing.alergias || "-"} ${viewing.alergiasCuales || ""}`} />
                  <DetailItem label="Fotosensibilizantes" value={`${viewing.medicamentosFotosensibilizantes || "-"} ${viewing.medicamentosFotosensibilizantesNotas || ""}`} />
                  <DetailItem label="Cirugías" value={`${viewing.cirugias || "-"} ${viewing.cirugiasCuales || ""}`} />
                  <DetailItem label="Embarazo / Lactancia" value={`${viewing.embarazo || viewing.embarazada || "-"} / ${viewing.lactancia || "-"}`} />
                  <DetailItem label="Piel sensible / Queloides" value={`${viewing.pielSensible || "-"} / ${viewing.queloides || "-"}`} />
                  <DetailItem label="Se observa" value={viewing.seObserva} />
                  <DetailItem label="Tratamientos previos" value={viewing.tratamientosPrevios} />
                  <DetailItem label="Modificaciones pigmentarias" value={viewing.modificacionesPigmentarias} />
                  <div className="md:col-span-3"><DetailItem label="Observaciones" value={viewing.observaciones} /></div>
                  <div className="md:col-span-3"><DetailItem label="Observaciones profesionales" value={viewing.observacionesProfesionales} /></div>
                  <div className="md:col-span-3"><DetailItem label="Recomendaciones" value={viewing.recomendaciones} /></div>
                </CardContent>
              </Card>
              {viewing.firma || viewing.firmaEspecialista ? (
                <Card>
                  <CardHeader><CardTitle className="text-base">Firmas digitales</CardTitle></CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {viewing.firma ? <DetailItem label="Firma cliente" value={viewing.nombre} /> : null}
                    {viewing.firmaEspecialista ? <DetailItem label="Firma especialista" value={viewing.nombreEspecialista || viewing.especialista} /> : null}
                    {viewing.firma ? <img src={viewing.firma} alt="Firma del cliente" className="h-28 rounded border bg-white p-2" /> : null}
                    {viewing.firmaEspecialista ? <img src={viewing.firmaEspecialista} alt="Firma del especialista" className="h-28 rounded border bg-white p-2" /> : null}
                  </CardContent>
                </Card>
              ) : null}

              {/* Consentimientos relacionados al cliente de esta ficha */}
              {viewing.clienteId ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      Consentimientos del cliente
                      {viewingConsents ? (
                        <Badge variant="outline">
                          {viewingConsents.masajes.length + viewingConsents.tatuajes.length}
                        </Badge>
                      ) : null}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {viewingConsentsLoading ? (
                      <div className="text-sm text-muted-foreground">Cargando consentimientos…</div>
                    ) : !viewingConsents || (viewingConsents.masajes.length === 0 && viewingConsents.tatuajes.length === 0) ? (
                      <div className="text-sm text-muted-foreground">Sin consentimientos relacionados con este cliente.</div>
                    ) : (
                      <div className="space-y-3">
                        {viewingConsents.masajes.length > 0 ? (
                          <div>
                            <div className="mb-1 text-xs font-black uppercase tracking-wide text-muted-foreground">
                              Masajes ({viewingConsents.masajes.length})
                            </div>
                            <div className="grid gap-2">
                              {viewingConsents.masajes.map((c) => (
                                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                                  <div>
                                    <div className="font-semibold">{c.fecha} · {c.estado}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {c.sucursal} {c.tipoMasaje ? `· ${c.tipoMasaje}` : ""} {c.zonaTratar ? `· ${c.zonaTratar}` : ""}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="font-mono text-[10px]">{c.id}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {viewingConsents.tatuajes.length > 0 ? (
                          <div>
                            <div className="mb-1 text-xs font-black uppercase tracking-wide text-muted-foreground">
                              Tatuajes y cejas ({viewingConsents.tatuajes.length})
                            </div>
                            <div className="grid gap-2">
                              {viewingConsents.tatuajes.map((c) => (
                                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-3 text-sm">
                                  <div>
                                    <div className="font-semibold">{c.fecha} · {c.estado}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {c.sucursal} {c.tipoProcedimiento ? `· ${c.tipoProcedimiento}` : ""} {c.zonaTratar ? `· ${c.zonaTratar}` : ""}
                                    </div>
                                  </div>
                                  <Badge variant="outline" className="font-mono text-[10px]">{c.id}</Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <LinkGeneratorDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        formType="ficha_dermatologica"
        title="Enviar Ficha Dermatológica a un cliente"
      />
    </div>
  )
}
