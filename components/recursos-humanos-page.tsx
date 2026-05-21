"use client"
import { useEffect, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Users, Plus, Pencil, Trash2, Save, X, Search, Download, PenTool, User, MapPin, Users2, GraduationCap, Briefcase, Phone, CheckSquare, FileSignature, Landmark, Link2 } from "lucide-react"
import { RecordActions } from "@/components/record-actions"

interface FamiliarItem { nombre: string; parentesco: string; edad: string; direccion: string; ocupacion: string }
interface EducacionItem { escolaridad: string; institucion: string; curso: string; nivel: string; estado: string }
interface ComplementariaItem { curso: string; institucion: string; ano: string }
interface ExperienciaItem { desde: string; hasta: string; empresa: string; telefono: string; superior: string; inmediato: string; puesto: string; tareas: string }
interface ReferenciaItem { nombre: string; ocupacion: string; telefono: string }

interface Solicitud {
  id: string
  fecha: string
  fechaIngresoLaboral: string
  estado: string
  puestoSolicitado: string
  sucursal: string
  nombre: string
  apellido: string
  cedula: string
  fechaNacimiento: string
  tipoSangre: string
  sexo: string
  estatura: string
  peso: string
  estadoCivil: string
  nacionalidad: string
  telefonoResidencia: string
  celular: string
  calle: string
  numeroDir: string
  sector: string
  ciudad: string
  email: string
  licenciaConducir: string
  categoriaLicencia: string
  perteneceAFP: string
  cualAFP: string
  banco: string
  numeroCuenta: string
  tipoCuenta: string
  otrasPosiciones: string
  pretensionesSalariales: string
  emergenciaContacto: string
  problemaEmocional: string
  enfermedadLargoTiempo: string
  problemasJusticia: string
  familia: FamiliarItem[]
  educacion: EducacionItem[]
  complementarios: ComplementariaItem[]
  excel: boolean
  access: boolean
  word: boolean
  powerPoint: boolean
  windows: boolean
  msDos: boolean
  centralTelefonica: boolean
  fax: boolean
  otrosConocimientos: string
  experiencia: ExperienciaItem[]
  referencias: ReferenciaItem[]
  disponibilidad: string
  firma: string
  observaciones: string
}

const emptyForm: Solicitud = {
  id: "", fecha: new Date().toISOString().split("T")[0], fechaIngresoLaboral: "", estado: "Pendiente", puestoSolicitado: "", sucursal: "",
  nombre: "", apellido: "", cedula: "", fechaNacimiento: "", tipoSangre: "", sexo: "",
  estatura: "", peso: "", estadoCivil: "", nacionalidad: "Dominicana",
  telefonoResidencia: "", celular: "", calle: "", numeroDir: "",
  sector: "", ciudad: "", email: "", licenciaConducir: "", categoriaLicencia: "",
  perteneceAFP: "", cualAFP: "", banco: "", numeroCuenta: "", tipoCuenta: "",
  otrasPosiciones: "", pretensionesSalariales: "",
  emergenciaContacto: "", problemaEmocional: "", enfermedadLargoTiempo: "",
  problemasJusticia: "",
  familia: [], educacion: [], complementarios: [],
  excel: false, access: false, word: false, powerPoint: false,
  windows: false, msDos: false, centralTelefonica: false, fax: false,
  otrosConocimientos: "",
  experiencia: [], referencias: [],
  disponibilidad: "", firma: "", observaciones: ""
}

const puestos = ["Operadora de Láser", "Cosmiatra", "Masajista", "Asistente Adm", "Encargado"]
const opcionesSiNo = ["Si", "No"]

function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "")
}

function formatCedula(value: string) {
  const digits = onlyDigits(value).slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatHeightInput(value: string) {
  const digits = onlyDigits(value).slice(0, 2)
  if (digits.length <= 1) return digits
  return `${digits.slice(0, 1)}'${digits.slice(1)}"`
}

function formatMoney(value: string | number) {
  const amount = Number(String(value ?? "").replace(/[^\d.-]/g, ""))
  if (!Number.isFinite(amount) || amount <= 0) return String(value || "")
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatHeightFeet(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (raw.includes("'") || /pie|ft/i.test(raw)) return raw
  const numeric = Number(raw.replace(/[^\d.]/g, ""))
  if (!Number.isFinite(numeric) || numeric <= 0) return raw
  if (numeric >= 100) {
    const totalInches = Math.round(numeric / 2.54)
    return `${Math.floor(totalInches / 12)}'${totalInches % 12}"`
  }
  return `${raw} pies`
}

function estadoClasses(estado: string) {
  switch (estado) {
    case "Pendiente":
      return "border-yellow-500/40 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
    case "En revisión":
      return "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300"
    case "Entrevista":
      return "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300"
    case "Aprobado":
      return "border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-300"
    case "Rechazado":
      return "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300"
    default:
      return ""
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function normalizeSolicitudRecord(raw: Record<string, unknown>): Solicitud {
  const payloadRaw = typeof raw.PayloadJSON === "string" ? raw.PayloadJSON : ""
  let payload: Partial<Solicitud> = raw as Partial<Solicitud>
  if (payloadRaw) {
    try { payload = { ...payload, ...(JSON.parse(payloadRaw) as Partial<Solicitud>) } } catch {}
  }
  return {
    ...emptyForm,
    ...payload,
    id: String(raw.SolicitudID ?? payload.id ?? ""),
    fecha: String(raw.FechaSolicitud ?? payload.fecha ?? emptyForm.fecha),
    fechaIngresoLaboral: String((payload as Record<string, unknown>).fechaIngresoLaboral ?? (payload as Record<string, unknown>).FechaIngresoLaboral ?? ""),
    estado: String(raw.Estado ?? payload.estado ?? "Pendiente"),
    sucursal: String((payload as Record<string, unknown>).sucursal ?? (payload as Record<string, unknown>).Sucursal ?? ""),
    puestoSolicitado: String(raw.PuestoSolicitado ?? payload.puestoSolicitado ?? ""),
    nombre: String(raw.Nombre ?? payload.nombre ?? ""),
    apellido: String(raw.Apellido ?? payload.apellido ?? ""),
    cedula: String(raw.Cedula ?? payload.cedula ?? ""),
    fechaNacimiento: String(raw.FechaNacimiento ?? payload.fechaNacimiento ?? ""),
    tipoSangre: String((raw as Record<string, unknown>).TipoSangre ?? payload.tipoSangre ?? ""),
    sexo: String(raw.Sexo ?? payload.sexo ?? ""),
    estatura: String((raw as Record<string, unknown>).Estatura ?? payload.estatura ?? ""),
    peso: String((raw as Record<string, unknown>).Peso ?? payload.peso ?? ""),
    nacionalidad: String(raw.Nacionalidad ?? payload.nacionalidad ?? "Dominicana"),
    telefonoResidencia: String(payload.telefonoResidencia ?? raw.Telefono ?? ""),
    celular: String(payload.celular ?? raw.Telefono ?? ""),
    ciudad: String(raw.Ciudad ?? payload.ciudad ?? ""),
    email: String(raw.Email ?? payload.email ?? ""),
    pretensionesSalariales: String(raw.Salario ?? payload.pretensionesSalariales ?? ""),
    observaciones: String(raw.Observaciones ?? payload.observaciones ?? ""),
    banco: String((raw as Record<string, unknown>).Banco ?? payload.banco ?? ""),
    numeroCuenta: String((raw as Record<string, unknown>).NumeroCuenta ?? payload.numeroCuenta ?? ""),
    tipoCuenta: String((raw as Record<string, unknown>).TipoCuenta ?? payload.tipoCuenta ?? ""),
    firma: String(raw.FirmaDigital ?? payload.firma ?? (payload as Record<string, unknown>).firmaDigital ?? ""),
    familia: Array.isArray(payload.familia) ? payload.familia : [],
    educacion: Array.isArray(payload.educacion) ? payload.educacion : [],
    complementarios: Array.isArray(payload.complementarios) ? payload.complementarios : [],
    experiencia: Array.isArray(payload.experiencia) ? payload.experiencia : [],
    referencias: Array.isArray(payload.referencias) ? payload.referencias : [],
  } as Solicitud
}

type TabSection = "personal" | "direccion" | "familia" | "educacion" | "habilidades" | "bancarios" | "experiencia" | "referencias" | "firma"
type SortKey = "nombre" | "cedula" | "puestoSolicitado" | "fechaIngresoLaboral" | "estado"

function sortableDate(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const months: Record<string, string> = {
    ene: "01", enero: "01", feb: "02", febrero: "02", mar: "03", marzo: "03",
    abr: "04", abril: "04", may: "05", mayo: "05", jun: "06", junio: "06",
    jul: "07", julio: "07", ago: "08", agosto: "08", sep: "09", septiembre: "09",
    oct: "10", octubre: "10", nov: "11", noviembre: "11", dic: "12", diciembre: "12",
  }
  const parts = raw.toLowerCase().replace(/,/g, "").split(/\s+/)
  const day = parts.find(part => /^\d{1,2}$/.test(part))
  const month = parts.map(part => months[part]).find(Boolean)
  const year = parts.find(part => /^\d{4}$/.test(part))
  return day && month && year ? `${year}-${month}-${day.padStart(2, "0")}` : raw
}

function formatPdfDate(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (local) return `${local[1].padStart(2, "0")}/${local[2].padStart(2, "0")}/${local[3]}`
  return raw
}

function sortValue(record: Solicitud, key: SortKey) {
  if (key === "fechaIngresoLaboral") return sortableDate(record.fechaIngresoLaboral)
  if (key === "nombre") return `${record.nombre} ${record.apellido}`.toLowerCase()
  if (key === "puestoSolicitado") return record.puestoSolicitado.toLowerCase()
  return String(record[key] || "").toLowerCase()
}

function sortLabel(activeKey: SortKey, currentKey: SortKey, direction: "asc" | "desc") {
  return activeKey === currentKey ? (direction === "asc" ? " ↑" : " ↓") : ""
}

function sortDisplay(activeKey: SortKey, currentKey: SortKey, direction: "asc" | "desc") {
  return activeKey === currentKey ? (direction === "asc" ? " ASC" : " DESC") : " ORDEN"
}

function solicitudRecord(solicitud: Solicitud) {
  const { fecha: _fechaCompletado, ...record } = solicitud
  return record as unknown as Record<string, unknown>
}

export function RecursosHumanosPage() {
  const { showToast, apiUrl, setIsLoading, setLoadingMessage } = useAppStore()
  const sucursalesDb = useAppStore((state) => state.db.sucursales)
  const sucursales = sucursalesDb.length ? sucursalesDb.map((sucursal) => sucursal.Nombre).filter(Boolean) : ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([])
  const [open, setOpen] = useState(false)
  const [showFirma, setShowFirma] = useState(false)
  const [form, setForm] = useState<Solicitud>(emptyForm)
  const [search, setSearch] = useState("")
  const [filterEstado, setFilterEstado] = useState("todos")
  const [sortKey, setSortKey] = useState<SortKey>("nombre")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [activeTab, setActiveTab] = useState<TabSection>("personal")
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)

  const loadSolicitudes = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      setSolicitudes([])
      return
    }

    try {
      setIsLoading(true)
      setLoadingMessage("Cargando solicitudes...")
      const result = await apiJsonp(normalized, { action: "getSolicitudesEmpleo" })
      const records = Array.isArray((result as { records?: unknown[] }).records)
        ? ((result as { records?: Record<string, unknown>[] }).records || [])
        : []
      setSolicitudes(records.map((r) => normalizeSolicitudRecord(r)))
    } catch (error) {
      console.error("No se pudieron cargar las solicitudes", error)
      showToast("Error cargando solicitudes", "error")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSolicitudes()
  }, [apiUrl])


  const setSort = (key: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDir((currentDir) => currentDir === "asc" ? "desc" : "asc")
        return currentKey
      }
      setSortDir(key === "fechaIngresoLaboral" ? "desc" : "asc")
      return key
    })
  }

  const filtered = solicitudes
    .filter(s => {
      if (filterEstado !== "todos" && s.estado !== filterEstado) return false
      if (search) {
        const q = search.toLowerCase()
        return `${s.nombre} ${s.apellido} ${s.cedula} ${s.puestoSolicitado}`.toLowerCase().includes(q)
      }
      return true
    })
    .sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1
      return sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "es", { numeric: true }) * direction
    })

  const handleSave = async () => {
    if (!form.nombre || !form.cedula || !form.puestoSolicitado) {
      showToast("Nombre, Cédula y Puesto son obligatorios", "error")
      return
    }
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      showToast("Configura la URL en Configuración", "error")
      return
    }

    const id = form.id || `sol_${Date.now()}`
    const nueva = { ...form, id }

    try {
      setIsLoading(true)
      setLoadingMessage("Guardando solicitud...")
      const result = await apiJsonp(normalized, {
        action: "saveSolicitudEmpleo",
        data: JSON.stringify(nueva),
      })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string }).error || "No se pudo guardar"))
      }
      await loadSolicitudes()
      const email = (result as { email?: { sent?: boolean; warning?: string } }).email
      if (nueva.estado === "Aprobado" && email?.sent) {
        showToast("Solicitud aprobada, enviada a Empleados y correo enviado", "success")
      } else if (nueva.estado === "Aprobado" && email?.warning) {
        showToast(`Solicitud aprobada. Correo pendiente: ${email.warning}`, "success")
      } else {
        showToast(nueva.estado === "Aprobado" ? "Solicitud guardada y enviada a Empleados" : "Solicitud guardada", "success")
      }
      setOpen(false)
      setForm(emptyForm)
      setActiveTab("personal")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error guardando solicitud", "error")
    } finally {
      setIsLoading(false)
    }
  }

  const openNew = () => { setForm({ ...emptyForm, id: `sol_${Date.now()}` }); setActiveTab("personal"); setOpen(true) }
  const openEdit = (s: Solicitud) => { setForm(s); setActiveTab("personal"); setOpen(true) }
  const copyPublicLink = async () => {
    const link = `${window.location.origin}/solicitud-empleo`
    await navigator.clipboard.writeText(link)
    showToast("Link público copiado", "success")
  }
  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar?")) return
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      showToast("Configura la URL en Configuración", "error")
      return
    }
    try {
      setIsLoading(true)
      setLoadingMessage("Eliminando solicitud...")
      const result = await apiJsonp(normalized, { action: "deleteSolicitudEmpleo", id })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string }).error || "No se pudo eliminar"))
      }
      await loadSolicitudes()
      showToast("Eliminada", "success")
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error eliminando", "error")
    } finally {
      setIsLoading(false)
    }
  }

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    const rect = canvas.getBoundingClientRect()
    ctx.beginPath()
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top)
  }
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    const rect = canvas.getBoundingClientRect()
    ctx.lineWidth = 2
    ctx.lineCap = "round"
    ctx.strokeStyle = "#000"
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top)
    ctx.stroke()
  }
  const stopDrawing = () => { isDrawing.current = false }
  const clearFirma = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  const saveFirma = () => {
    const canvas = canvasRef.current!
    setForm({ ...form, firma: canvas.toDataURL() })
    setShowFirma(false)
    showToast("Firma guardada", "success")
  }

  const addFamilia = () => setForm({ ...form, familia: [...form.familia, { nombre: "", parentesco: "", edad: "", direccion: "", ocupacion: "" }] })
  const addEducacion = () => setForm({ ...form, educacion: [...form.educacion, { escolaridad: "", institucion: "", curso: "", nivel: "", estado: "" }] })
  const addComplementaria = () => setForm({ ...form, complementarios: [...form.complementarios, { curso: "", institucion: "", ano: "" }] })
  const addExperiencia = () => setForm({ ...form, experiencia: [...form.experiencia, { desde: "", hasta: "", empresa: "", telefono: "", superior: "", inmediato: "", puesto: "", tareas: "" }] })
  const addReferencia = () => setForm({ ...form, referencias: [...form.referencias, { nombre: "", ocupacion: "", telefono: "" }] })

  const exportPDF = (solicitud: Solicitud = form) => {
    if (!solicitud.nombre) { showToast("Completa el formulario", "error"); return }
    const e = escapeHtml
    const check = (value: boolean) => value ? "Si" : "No"
    const html = `<html><head><style>
body{font-family:Arial;margin:15px;font-size:11px;}
.header{text-align:center;margin-bottom:20px;border-bottom:2px solid #00897b;padding-bottom:10px;}
.logo{font-size:20px;font-weight:bold;color:#00897b;}
h2{background:#00897b;color:white;padding:6px;font-size:12px;margin-top:15px;}
.row{display:flex;gap:10px;margin:5px 0;}
.f{flex:1;padding:3px;border-bottom:1px dotted #999;}
.f b{color:#555;}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:10px;}
th{background:#00897b;color:white;padding:5px;text-align:left;}
td{border:1px solid #ccc;padding:4px;}
.firma{margin-top:30px;text-align:center;}
.firma img{border:1px solid #ccc;max-width:250px;}
</style></head><body>
<div class="header"><div class="logo">CIBAO SPA LASER</div><h1 style="font-size:16px;">SOLICITUD DE EMPLEO</h1></div>
<div class="row"><div class="f"><b>Puesto:</b> ${e(solicitud.puestoSolicitado)}</div><div class="f"><b>Fecha completado:</b> ${e(formatPdfDate(solicitud.fecha))}</div><div class="f"><b>Fecha ingreso laboral:</b> ${e(formatPdfDate(solicitud.fechaIngresoLaboral))}</div></div>
<h2>DATOS PERSONALES</h2>
<div class="row"><div class="f"><b>Nombres:</b> ${e(solicitud.nombre)}</div><div class="f"><b>Apellidos:</b> ${e(solicitud.apellido)}</div></div>
<div class="row"><div class="f"><b>Cédula:</b> ${e(formatCedula(solicitud.cedula))}</div><div class="f"><b>Fecha Nac:</b> ${e(formatPdfDate(solicitud.fechaNacimiento))}</div><div class="f"><b>Tipo Sangre:</b> ${e(solicitud.tipoSangre)}</div></div>
<div class="row"><div class="f"><b>Sexo:</b> ${e(solicitud.sexo)}</div><div class="f"><b>Estatura:</b> ${e(formatHeightFeet(solicitud.estatura))}</div><div class="f"><b>Peso:</b> ${e(solicitud.peso)}</div></div>
<div class="row"><div class="f"><b>Estado Civil:</b> ${e(solicitud.estadoCivil)}</div><div class="f"><b>Nacionalidad:</b> ${e(solicitud.nacionalidad)}</div></div>
<div class="row"><div class="f"><b>Tel. Residencia:</b> ${e(formatPhone(solicitud.telefonoResidencia))}</div><div class="f"><b>Celular:</b> ${e(formatPhone(solicitud.celular))}</div></div>
<div class="row"><div class="f"><b>Dirección:</b> Calle ${e(solicitud.calle)} No. ${e(solicitud.numeroDir)}, ${e(solicitud.sector)}, ${e(solicitud.ciudad)}</div></div>
<div class="row"><div class="f"><b>Email:</b> ${e(solicitud.email)}</div><div class="f"><b>Licencia:</b> ${e(solicitud.licenciaConducir)} Cat: ${e(solicitud.categoriaLicencia)}</div></div>
<div class="row"><div class="f"><b>AFP:</b> ${e(solicitud.perteneceAFP)} ${e(solicitud.cualAFP)}</div></div>
<div class="row"><div class="f"><b>Pretensiones Salariales:</b> ${e(formatMoney(solicitud.pretensionesSalariales))}</div></div>
<div class="row"><div class="f"><b>Emergencia:</b> ${e(solicitud.emergenciaContacto)}</div></div>
<h2>DATOS BANCARIOS</h2>
<div class="row"><div class="f"><b>Banco:</b> ${e(solicitud.banco)}</div><div class="f"><b>Tipo cuenta:</b> ${e(solicitud.tipoCuenta)}</div><div class="f"><b>No. cuenta:</b> ${e(solicitud.numeroCuenta)}</div></div>
<h2>SALUD Y ANTECEDENTES</h2>
<div class="row"><div class="f"><b>Problema emocional:</b> ${e(solicitud.problemaEmocional)}</div></div>
<div class="row"><div class="f"><b>Enfermedad largo tiempo:</b> ${e(solicitud.enfermedadLargoTiempo)}</div></div>
<div class="row"><div class="f"><b>Problemas con la justicia:</b> ${e(solicitud.problemasJusticia)}</div></div>
<div class="row"><div class="f"><b>Otras posiciones:</b> ${e(solicitud.otrasPosiciones)}</div></div>
<h2>COMPOSICIÓN FAMILIAR</h2>
<table><tr><th>Nombre</th><th>Parentesco</th><th>Edad</th><th>Dirección</th><th>Ocupación</th></tr>
${solicitud.familia.map(f => `<tr><td>${e(f.nombre)}</td><td>${e(f.parentesco)}</td><td>${e(f.edad)}</td><td>${e(f.direccion)}</td><td>${e(f.ocupacion)}</td></tr>`).join("")}
</table>
<h2>ESTUDIOS REALIZADOS</h2>
<table><tr><th>Escolaridad</th><th>Institución</th><th>Curso/Carrera</th><th>Nivel</th><th>C/P</th></tr>
${solicitud.educacion.map(item => `<tr><td>${e(item.escolaridad)}</td><td>${e(item.institucion)}</td><td>${e(item.curso)}</td><td>${e(item.nivel)}</td><td>${e(item.estado)}</td></tr>`).join("")}
</table>
<h2>ESTUDIOS COMPLEMENTARIOS</h2>
<table><tr><th>Curso</th><th>Institución</th><th>Año</th></tr>
${solicitud.complementarios.map(c => `<tr><td>${e(c.curso)}</td><td>${e(c.institucion)}</td><td>${e(c.ano)}</td></tr>`).join("")}
</table>
<h2>INFORMACIÓN COMPLEMENTARIA</h2>
<div class="row"><div class="f">Excel: ${check(solicitud.excel)} | Access: ${check(solicitud.access)} | Word: ${check(solicitud.word)} | Power Point: ${check(solicitud.powerPoint)}</div></div>
<div class="row"><div class="f">Windows: ${check(solicitud.windows)} | MS-DOS: ${check(solicitud.msDos)} | Central Tel: ${check(solicitud.centralTelefonica)} | Fax: ${check(solicitud.fax)}</div></div>
<div class="row"><div class="f"><b>Otros:</b> ${e(solicitud.otrosConocimientos)}</div></div>
<h2>EXPERIENCIA LABORAL</h2>
<table><tr><th>Desde</th><th>Hasta</th><th>Empresa</th><th>Teléfono</th><th>Superior</th><th>Jefe</th><th>Puesto</th><th>Tareas</th></tr>
${solicitud.experiencia.map(item => `<tr><td>${e(formatPdfDate(item.desde))}</td><td>${e(formatPdfDate(item.hasta))}</td><td>${e(item.empresa)}</td><td>${e(formatPhone(item.telefono))}</td><td>${e(item.superior)}</td><td>${e(item.inmediato)}</td><td>${e(item.puesto)}</td><td>${e(item.tareas)}</td></tr>`).join("")}
</table>
<h2>REFERENCIAS PERSONALES</h2>
<table><tr><th>Nombre</th><th>Ocupación</th><th>Teléfono</th></tr>
${solicitud.referencias.map(r => `<tr><td>${e(r.nombre)}</td><td>${e(r.ocupacion)}</td><td>${e(formatPhone(r.telefono))}</td></tr>`).join("")}
</table>
<div class="row"><div class="f"><b>Fecha disponibilidad:</b> ${e(formatPdfDate(solicitud.disponibilidad))}</div></div>
<div class="row"><div class="f"><b>Observaciones:</b> ${e(solicitud.observaciones)}</div></div>
<p style="margin-top:20px;font-size:10px;">Certifico que la información anteriormente suministrada es correcta y autorizo a verificar la misma por todos los medios disponibles.</p>
${solicitud.firma ? `<div class="firma"><p><b>Firma del Solicitante:</b></p><img src="${e(solicitud.firma)}" /></div>` : '<div class="firma"><p>___________________________</p><p><b>Firma del Solicitante</b></p></div>'}
</body></html>`
    const w = window.open("", "_blank")
    w?.document.write(html)
    w?.document.close()
    setTimeout(() => w?.print(), 500)
  }

  // Progreso
  const getProgreso = () => {
    let total = 0, completo = 0
    const campos = [form.nombre, form.apellido, form.cedula, form.puestoSolicitado, form.celular, form.email, form.fechaNacimiento, form.sexo, form.estadoCivil, form.calle, form.ciudad, form.banco, form.numeroCuenta, form.tipoCuenta]
    campos.forEach(c => { total++; if (c) completo++ })
    if (form.familia.length > 0) completo++; total++
    if (form.educacion.length > 0) completo++; total++
    if (form.experiencia.length > 0) completo++; total++
    if (form.referencias.length > 0) completo++; total++
    if (form.firma) completo++; total++
    return Math.round((completo / total) * 100)
  }

  const tabs: { id: TabSection; label: string; icon: any }[] = [
    { id: "personal", label: "Datos Personales", icon: User },
    { id: "direccion", label: "Contacto", icon: MapPin },
    { id: "familia", label: "Familia", icon: Users2 },
    { id: "educacion", label: "Educación", icon: GraduationCap },
    { id: "habilidades", label: "Habilidades", icon: CheckSquare },
    { id: "bancarios", label: "Datos bancarios", icon: Landmark },
    { id: "experiencia", label: "Experiencia", icon: Briefcase },
    { id: "referencias", label: "Referencias", icon: Phone },
    { id: "firma", label: "Firma", icon: FileSignature },
  ]

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" />Recursos Humanos</h2>
          <p className="text-sm text-muted-foreground">Solicitudes de empleo</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" onClick={copyPublicLink}><Link2 className="h-4 w-4 mr-2" />Copiar link público</Button><Button variant="outline" onClick={() => void loadSolicitudes()}>Actualizar</Button><Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Nueva solicitud</Button></div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Total</p><p className="text-2xl font-bold">{solicitudes.length}</p></CardContent></Card>
        <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Pendiente</p><p className="text-2xl font-bold text-yellow-500">{solicitudes.filter(s => s.estado === "Pendiente").length}</p></CardContent></Card>
        <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Entrevista</p><p className="text-2xl font-bold text-purple-500">{solicitudes.filter(s => s.estado === "Entrevista").length}</p></CardContent></Card>
        <Card><CardContent className="pt-3"><p className="text-xs text-muted-foreground">Aprobado</p><p className="text-2xl font-bold text-green-500">{solicitudes.filter(s => s.estado === "Aprobado").length}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="pt-4 pb-3 flex gap-3 items-end">
          <div className="flex-1">
            <Label className="text-xs">Buscar</Label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, cédula..." />
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={filterEstado} onValueChange={setFilterEstado}>
              <SelectTrigger className={`w-40 ${filterEstado !== "todos" ? estadoClasses(filterEstado) : ""}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Pendiente">Pendiente</SelectItem>
                <SelectItem value="En revisión">En revisión</SelectItem>
                <SelectItem value="Entrevista">Entrevista</SelectItem>
                <SelectItem value="Aprobado">Aprobado</SelectItem>
                <SelectItem value="Rechazado">Rechazado</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left text-xs">No.</th>
                <th className="cursor-pointer select-none px-3 py-2 text-left text-xs hover:text-primary" onClick={() => setSort("nombre")}>Nombre{sortDisplay(sortKey, "nombre", sortDir)}</th>
                <th className="cursor-pointer select-none px-3 py-2 text-left text-xs hover:text-primary" onClick={() => setSort("cedula")}>Cédula{sortDisplay(sortKey, "cedula", sortDir)}</th>
                <th className="cursor-pointer select-none px-3 py-2 text-left text-xs hover:text-primary" onClick={() => setSort("puestoSolicitado")}>Puesto{sortDisplay(sortKey, "puestoSolicitado", sortDir)}</th>
                <th className="px-3 py-2 text-left text-xs">Sucursal</th>
                <th className="cursor-pointer select-none px-3 py-2 text-left text-xs hover:text-primary" onClick={() => setSort("fechaIngresoLaboral")}>Ingreso laboral{sortDisplay(sortKey, "fechaIngresoLaboral", sortDir)}</th>
                <th className="cursor-pointer select-none px-3 py-2 text-center text-xs hover:text-primary" onClick={() => setSort("estado")}>Estado{sortDisplay(sortKey, "estado", sortDir)}</th>
                <th className="px-3 py-2 text-right text-xs">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">Sin solicitudes</td></tr>
              ) : filtered.map((s, index) => (
                <tr key={s.id} className="border-b hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs font-mono">{index + 1}</td>
                  <td className="px-3 py-2">{s.nombre} {s.apellido}</td>
                  <td className="px-3 py-2 text-xs font-mono">{formatCedula(s.cedula)}</td>
                  <td className="px-3 py-2 text-xs">{s.puestoSolicitado}</td>
                  <td className="px-3 py-2 text-xs">{s.sucursal || "-"}</td>
                  <td className="px-3 py-2 text-xs">{s.fechaIngresoLaboral || "-"}</td>
                  <td className="px-3 py-2 text-center"><Badge variant="outline" className={estadoClasses(s.estado)}>{s.estado}</Badge></td>
                  <td className="px-3 py-2">
                    <RecordActions
                      title={`Solicitud: ${s.nombre} ${s.apellido}`}
                      record={solicitudRecord(s)}
                      onEdit={() => openEdit(s)}
                      onDelete={() => handleDelete(s.id)}
                      onPrint={() => exportPDF(s)}
                      printTitle={`Solicitud de empleo - ${s.nombre} ${s.apellido}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[95vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="p-6 pb-2 border-b">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Solicitud de Empleo - Cibao Spa Laser
            </DialogTitle>
            {/* Barra de progreso */}
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Progreso</span>
                <span className="text-xs font-bold text-primary">{getProgreso()}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${getProgreso()}%` }}></div>
              </div>
            </div>
          </DialogHeader>

          {/* Tabs horizontales */}
          <div className="border-b bg-muted/20 overflow-x-auto">
            <div className="flex px-4">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Contenido */}
          <div className="flex-1 overflow-y-auto p-6">
            
            {/* Campos superiores siempre visibles */}
            <Card className="mb-4 bg-primary/5 border-primary/30">
              <CardContent className="pt-4 pb-4">
                <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2 2xl:grid-cols-4">
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs font-bold">Puesto Solicitado *</Label>
                    <Select value={form.puestoSolicitado} onValueChange={(value) => setForm({...form, puestoSolicitado: value})}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar puesto" />
                      </SelectTrigger>
                      <SelectContent>
                        {puestos.map((puesto) => <SelectItem key={puesto} value={puesto}>{puesto}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs font-bold">Sucursal</Label>
                    <Select value={form.sucursal} onValueChange={(value) => setForm({...form, sucursal: value})}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccionar sucursal" />
                      </SelectTrigger>
                      <SelectContent>
                        {sucursales.map((sucursal) => <SelectItem key={sucursal} value={sucursal}>{sucursal}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs font-bold">Fecha de ingreso laboral</Label>
                    <Input type="date" value={form.fechaIngresoLaboral} onChange={e => setForm({...form, fechaIngresoLaboral: e.target.value})} />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label className="text-xs font-bold">Estado</Label>
                    <Select value={form.estado} onValueChange={v => setForm({...form, estado: v})}>
                      <SelectTrigger className={`w-full ${estadoClasses(form.estado)}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pendiente">🟡 Pendiente</SelectItem>
                        <SelectItem value="En revisión">🔵 En revisión</SelectItem>
                        <SelectItem value="Entrevista">🟣 Entrevista</SelectItem>
                        <SelectItem value="Aprobado">🟢 Aprobado</SelectItem>
                        <SelectItem value="Rechazado">🔴 Rechazado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* TAB: DATOS PERSONALES */}
            {activeTab === "personal" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4" />Identificación</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">Nombre(s) *</Label><Input value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Ej: María José" /></div>
                      <div><Label className="text-xs">Apellido(s) *</Label><Input value={form.apellido} onChange={e => setForm({...form, apellido: e.target.value})} placeholder="Ej: Pérez García" /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><Label className="text-xs">Cédula *</Label><Input value={form.cedula} onChange={e => setForm({...form, cedula: formatCedula(e.target.value)})} placeholder="001-1234567-8" /></div>
                      <div><Label className="text-xs">Fecha Nacimiento</Label><Input type="date" value={form.fechaNacimiento} onChange={e => setForm({...form, fechaNacimiento: e.target.value})} /></div>
                      <div><Label className="text-xs">Tipo de Sangre</Label>
                        <Select value={form.tipoSangre} onValueChange={v => setForm({...form, tipoSangre: v})}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="O+">O+</SelectItem><SelectItem value="O-">O-</SelectItem>
                            <SelectItem value="A+">A+</SelectItem><SelectItem value="A-">A-</SelectItem>
                            <SelectItem value="B+">B+</SelectItem><SelectItem value="B-">B-</SelectItem>
                            <SelectItem value="AB+">AB+</SelectItem><SelectItem value="AB-">AB-</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Datos Biométricos y Estado Civil</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div><Label className="text-xs">Sexo</Label>
                        <Select value={form.sexo} onValueChange={v => setForm({...form, sexo: v})}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Masculino">Masculino</SelectItem>
                            <SelectItem value="Femenino">Femenino</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">Estatura (pies)</Label><Input value={form.estatura} onChange={e => setForm({...form, estatura: formatHeightInput(e.target.value)})} placeholder={`Ej: 5'6"`} /></div>
                      <div><Label className="text-xs">Peso (lbs)</Label><Input value={form.peso} onChange={e => setForm({...form, peso: e.target.value})} placeholder="Ej: 130" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">Estado Civil</Label>
                        <Select value={form.estadoCivil} onValueChange={v => setForm({...form, estadoCivil: v})}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Soltero">Soltero(a)</SelectItem>
                            <SelectItem value="Casado">Casado(a)</SelectItem>
                            <SelectItem value="Unión Libre">Unión Libre</SelectItem>
                            <SelectItem value="Viudo">Viudo(a)</SelectItem>
                            <SelectItem value="Divorciado">Divorciado(a)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">Nacionalidad</Label><Input value={form.nacionalidad} onChange={e => setForm({...form, nacionalidad: e.target.value})} /></div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Información Adicional</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">Licencia Conducir (Sí/No)</Label>
                        <Select value={form.licenciaConducir} onValueChange={(value) => setForm({...form, licenciaConducir: value, categoriaLicencia: value === "No" ? "" : form.categoriaLicencia})}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>{opcionesSiNo.map((opcion) => <SelectItem key={opcion} value={opcion}>{opcion}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">Categoría de Licencia</Label><Input value={form.categoriaLicencia} onChange={e => setForm({...form, categoriaLicencia: e.target.value})} placeholder="Ej: Categoría 2" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">¿Pertenece a AFP?</Label>
                        <Select value={form.perteneceAFP} onValueChange={(value) => setForm({...form, perteneceAFP: value, cualAFP: value === "No" ? "" : form.cualAFP})}>
                          <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                          <SelectContent>{opcionesSiNo.map((opcion) => <SelectItem key={opcion} value={opcion}>{opcion}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div><Label className="text-xs">¿Cuál AFP?</Label><Input value={form.cualAFP} onChange={e => setForm({...form, cualAFP: e.target.value})} placeholder="Ej: AFP Popular" /></div>
                    </div>
                    <div><Label className="text-xs">Pretensiones Salariales</Label><Input value={form.pretensionesSalariales} onChange={e => setForm({...form, pretensionesSalariales: e.target.value})} onBlur={e => setForm({...form, pretensionesSalariales: formatMoney(e.target.value)})} placeholder="Ej: RD$ 25,000" /></div>
                    <div><Label className="text-xs">Otras posiciones que podría desempeñar</Label><Input value={form.otrasPosiciones} onChange={e => setForm({...form, otrasPosiciones: e.target.value})} /></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Salud y Antecedentes</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div><Label className="text-xs">¿Ha tenido algún problema emocional?</Label><Input value={form.problemaEmocional} onChange={e => setForm({...form, problemaEmocional: e.target.value})} placeholder="Especificar o dejar en blanco" /></div>
                    <div><Label className="text-xs">¿Ha sufrido alguna enfermedad por largo tiempo?</Label><Input value={form.enfermedadLargoTiempo} onChange={e => setForm({...form, enfermedadLargoTiempo: e.target.value})} placeholder="Especificar o dejar en blanco" /></div>
                    <div><Label className="text-xs">¿Ha tenido problemas con la justicia?</Label><Input value={form.problemasJusticia} onChange={e => setForm({...form, problemasJusticia: e.target.value})} placeholder="Especificar o dejar en blanco" /></div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB: CONTACTO */}
            {activeTab === "direccion" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4" />Teléfonos y Email</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">Teléfono Residencia</Label><Input value={form.telefonoResidencia} onChange={e => setForm({...form, telefonoResidencia: formatPhone(e.target.value)})} placeholder="809-000-0000" /></div>
                      <div><Label className="text-xs">Celular</Label><Input value={form.celular} onChange={e => setForm({...form, celular: formatPhone(e.target.value)})} placeholder="809-000-0000" /></div>
                    </div>
                    <div><Label className="text-xs">Correo Electrónico</Label><Input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="correo@ejemplo.com" /></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" />Dirección</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-4 gap-3">
                      <div className="col-span-2"><Label className="text-xs">Calle</Label><Input value={form.calle} onChange={e => setForm({...form, calle: e.target.value})} placeholder="Nombre de la calle" /></div>
                      <div><Label className="text-xs">Número</Label><Input value={form.numeroDir} onChange={e => setForm({...form, numeroDir: e.target.value})} placeholder="No." /></div>
                      <div><Label className="text-xs">Sector</Label><Input value={form.sector} onChange={e => setForm({...form, sector: e.target.value})} placeholder="Sector" /></div>
                    </div>
                    <div><Label className="text-xs">Ciudad</Label><Input value={form.ciudad} onChange={e => setForm({...form, ciudad: e.target.value})} placeholder="Ej: Santiago" /></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Contacto de Emergencia</CardTitle></CardHeader>
                  <CardContent>
                    <div><Label className="text-xs">En caso de emergencia comunicarse con:</Label><Input value={form.emergenciaContacto} onChange={e => setForm({...form, emergenciaContacto: e.target.value})} placeholder="Nombre y teléfono del contacto" /></div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB: FAMILIA */}
            {activeTab === "familia" && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Users2 className="h-4 w-4" />Composición Familiar</CardTitle>
                    <Button size="sm" onClick={addFamilia}><Plus className="h-3 w-3 mr-1" />Agregar familiar</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Padres, Hermanos, Hijos, Cónyuge</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {form.familia.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Users2 className="h-12 w-12 mx-auto mb-2 opacity-20" />
                      <p>No hay familiares agregados</p>
                      <p className="text-xs">Haz clic en "Agregar familiar" para empezar</p>
                    </div>
                  ) : form.familia.map((f, i) => (
                    <Card key={i} className="bg-muted/30">
                      <CardContent className="pt-4 space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-primary">Familiar #{i + 1}</span>
                          <Button size="sm" variant="ghost" onClick={() => setForm({...form, familia: form.familia.filter((_, idx) => idx !== i)})}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label className="text-xs">Nombre Completo</Label><Input value={f.nombre} onChange={e => {const arr = [...form.familia]; arr[i].nombre = e.target.value; setForm({...form, familia: arr})}} /></div>
                          <div><Label className="text-xs">Parentesco</Label><Input value={f.parentesco} onChange={e => {const arr = [...form.familia]; arr[i].parentesco = e.target.value; setForm({...form, familia: arr})}} placeholder="Padre, Madre, Hermano..." /></div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div><Label className="text-xs">Edad</Label><Input type="number" value={f.edad} onChange={e => {const arr = [...form.familia]; arr[i].edad = e.target.value; setForm({...form, familia: arr})}} /></div>
                          <div className="col-span-2"><Label className="text-xs">Ocupación</Label><Input value={f.ocupacion} onChange={e => {const arr = [...form.familia]; arr[i].ocupacion = e.target.value; setForm({...form, familia: arr})}} /></div>
                        </div>
                        <div><Label className="text-xs">Dirección</Label><Input value={f.direccion} onChange={e => {const arr = [...form.familia]; arr[i].direccion = e.target.value; setForm({...form, familia: arr})}} /></div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* TAB: EDUCACIÓN */}
            {activeTab === "educacion" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2"><GraduationCap className="h-4 w-4" />Estudios Realizados</CardTitle>
                      <Button size="sm" onClick={addEducacion}><Plus className="h-3 w-3 mr-1" />Agregar</Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {form.educacion.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        <GraduationCap className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p>Agrega tus estudios</p>
                      </div>
                    ) : form.educacion.map((e, i) => (
                      <Card key={i} className="bg-muted/30">
                        <CardContent className="pt-4 space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-primary">Estudio #{i + 1}</span>
                            <Button size="sm" variant="ghost" onClick={() => setForm({...form, educacion: form.educacion.filter((_, idx) => idx !== i)})}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><Label className="text-xs">Nivel</Label>
                              <Select value={e.escolaridad} onValueChange={v => {const arr = [...form.educacion]; arr[i].escolaridad = v; setForm({...form, educacion: arr})}}>
                                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Primaria">Primaria</SelectItem>
                                  <SelectItem value="Secundaria">Secundaria</SelectItem>
                                  <SelectItem value="Técnico/Comercial">Técnico/Comercial</SelectItem>
                                  <SelectItem value="Universitario">Universitario</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div><Label className="text-xs">Estado</Label>
                              <Select value={e.estado} onValueChange={v => {const arr = [...form.educacion]; arr[i].estado = v; setForm({...form, educacion: arr})}}>
                                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="C">✓ Completado</SelectItem>
                                  <SelectItem value="P">⏳ En Proceso</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div><Label className="text-xs">Institución</Label><Input value={e.institucion} onChange={ev => {const arr = [...form.educacion]; arr[i].institucion = ev.target.value; setForm({...form, educacion: arr})}} placeholder="Nombre de la institución" /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><Label className="text-xs">Curso/Carrera</Label><Input value={e.curso} onChange={ev => {const arr = [...form.educacion]; arr[i].curso = ev.target.value; setForm({...form, educacion: arr})}} /></div>
                            <div><Label className="text-xs">Nivel Obtenido</Label><Input value={e.nivel} onChange={ev => {const arr = [...form.educacion]; arr[i].nivel = ev.target.value; setForm({...form, educacion: arr})}} /></div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">Estudios Complementarios</CardTitle>
                      <Button size="sm" onClick={addComplementaria}><Plus className="h-3 w-3 mr-1" />Agregar</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Cursos, talleres, certificaciones</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {form.complementarios.length === 0 ? (
                      <p className="text-center py-4 text-muted-foreground text-sm">Sin estudios complementarios</p>
                    ) : form.complementarios.map((c, i) => (
                      <div key={i} className="grid grid-cols-4 gap-2 p-2 bg-muted/30 rounded">
                        <Input placeholder="Nombre del curso" value={c.curso} onChange={e => {const arr = [...form.complementarios]; arr[i].curso = e.target.value; setForm({...form, complementarios: arr})}} />
                        <Input placeholder="Institución" value={c.institucion} onChange={e => {const arr = [...form.complementarios]; arr[i].institucion = e.target.value; setForm({...form, complementarios: arr})}} />
                        <Input placeholder="Año" value={c.ano} onChange={e => {const arr = [...form.complementarios]; arr[i].ano = e.target.value; setForm({...form, complementarios: arr})}} />
                        <Button size="sm" variant="ghost" onClick={() => setForm({...form, complementarios: form.complementarios.filter((_, idx) => idx !== i)})}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB: HABILIDADES */}
            {activeTab === "habilidades" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CheckSquare className="h-4 w-4" />Programas Office</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: "excel", label: "Microsoft Excel" },
                        { key: "word", label: "Microsoft Word" },
                        { key: "powerPoint", label: "Power Point" },
                        { key: "access", label: "Microsoft Access" },
                      ].map(item => (
                        <label key={item.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${(form as any)[item.key] ? "bg-primary/10 border-primary" : "bg-muted/30 border-border hover:bg-muted/50"}`}>
                          <input type="checkbox" checked={(form as any)[item.key]} onChange={e => setForm({...form, [item.key]: e.target.checked})} className="h-4 w-4" />
                          <span className="text-sm font-medium">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Sistemas Operativos y Otros</CardTitle></CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: "windows", label: "Windows" },
                        { key: "msDos", label: "MS-DOS" },
                        { key: "centralTelefonica", label: "Central Telefónica" },
                        { key: "fax", label: "Fax" },
                      ].map(item => (
                        <label key={item.key} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${(form as any)[item.key] ? "bg-primary/10 border-primary" : "bg-muted/30 border-border hover:bg-muted/50"}`}>
                          <input type="checkbox" checked={(form as any)[item.key]} onChange={e => setForm({...form, [item.key]: e.target.checked})} className="h-4 w-4" />
                          <span className="text-sm font-medium">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Otros Conocimientos</CardTitle></CardHeader>
                  <CardContent>
                    <Input value={form.otrosConocimientos} onChange={e => setForm({...form, otrosConocimientos: e.target.value})} placeholder="Ej: Photoshop, contabilidad, inglés..." />
                  </CardContent>
                </Card>
              </div>
            )}


            {/* TAB: DATOS BANCARIOS */}
            {activeTab === "bancarios" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Landmark className="h-4 w-4" />
                    Datos bancarios
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Banco</Label>
                      <Select value={form.banco} onValueChange={v => setForm({ ...form, banco: v })}>
                        <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Banreservas">Banreservas</SelectItem>
                          <SelectItem value="Popular">Popular</SelectItem>
                          <SelectItem value="ACAP">ACAP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Número de cuenta</Label>
                      <Input
                        value={form.numeroCuenta}
                        onChange={e => setForm({ ...form, numeroCuenta: e.target.value })}
                        placeholder="Ej: 1234567890"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Tipo de cuenta</Label>
                      <Select value={form.tipoCuenta} onValueChange={v => setForm({ ...form, tipoCuenta: v })}>
                        <SelectTrigger><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Ahorro">Ahorro</SelectItem>
                          <SelectItem value="Corriente">Corriente</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* TAB: EXPERIENCIA */}
            {activeTab === "experiencia" && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4" />Experiencia Laboral</CardTitle>
                    <Button size="sm" onClick={addExperiencia}><Plus className="h-3 w-3 mr-1" />Agregar empleo</Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {form.experiencia.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Briefcase className="h-12 w-12 mx-auto mb-2 opacity-20" />
                      <p>Agrega tu experiencia laboral</p>
                    </div>
                  ) : form.experiencia.map((e, i) => (
                    <Card key={i} className="bg-muted/30">
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-bold text-primary">Empleo #{i + 1} {i === 0 && "(Más reciente)"}</span>
                          <Button size="sm" variant="ghost" onClick={() => setForm({...form, experiencia: form.experiencia.filter((_, idx) => idx !== i)})}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label className="text-xs">Desde</Label><Input type="date" value={e.desde} onChange={ev => {const arr = [...form.experiencia]; arr[i].desde = ev.target.value; setForm({...form, experiencia: arr})}} /></div>
                          <div><Label className="text-xs">Hasta</Label><Input type="date" value={e.hasta} onChange={ev => {const arr = [...form.experiencia]; arr[i].hasta = ev.target.value; setForm({...form, experiencia: arr})}} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label className="text-xs">Empresa</Label><Input value={e.empresa} onChange={ev => {const arr = [...form.experiencia]; arr[i].empresa = ev.target.value; setForm({...form, experiencia: arr})}} placeholder="Nombre de la empresa" /></div>
                          <div><Label className="text-xs">Teléfono</Label><Input value={e.telefono} onChange={ev => {const arr = [...form.experiencia]; arr[i].telefono = formatPhone(ev.target.value); setForm({...form, experiencia: arr})}} /></div>
                        </div>
                        <div><Label className="text-xs">Puesto</Label><Input value={e.puesto} onChange={ev => {const arr = [...form.experiencia]; arr[i].puesto = ev.target.value; setForm({...form, experiencia: arr})}} placeholder="Ej: Operadora de láser" /></div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><Label className="text-xs">Superior</Label><Input value={e.superior} onChange={ev => {const arr = [...form.experiencia]; arr[i].superior = ev.target.value; setForm({...form, experiencia: arr})}} /></div>
                          <div><Label className="text-xs">Jefe Inmediato</Label><Input value={e.inmediato} onChange={ev => {const arr = [...form.experiencia]; arr[i].inmediato = ev.target.value; setForm({...form, experiencia: arr})}} /></div>
                        </div>
                        <div><Label className="text-xs">Tareas del puesto</Label><Input value={e.tareas} onChange={ev => {const arr = [...form.experiencia]; arr[i].tareas = ev.target.value; setForm({...form, experiencia: arr})}} placeholder="Detalla algunas tareas que realizabas" /></div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* TAB: REFERENCIAS */}
            {activeTab === "referencias" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2"><Phone className="h-4 w-4" />Referencias Personales</CardTitle>
                      <Button size="sm" onClick={addReferencia} disabled={form.referencias.length >= 3}><Plus className="h-3 w-3 mr-1" />Agregar</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Indique 3 personas que lo conozcan (no familiares)</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {form.referencias.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <Phone className="h-12 w-12 mx-auto mb-2 opacity-20" />
                        <p>Agrega 3 referencias personales</p>
                      </div>
                    ) : form.referencias.map((r, i) => (
                      <Card key={i} className="bg-muted/30">
                        <CardContent className="pt-4 space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-primary">Referencia #{i + 1}</span>
                            <Button size="sm" variant="ghost" onClick={() => setForm({...form, referencias: form.referencias.filter((_, idx) => idx !== i)})}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                          </div>
                          <div><Label className="text-xs">Nombre Completo</Label><Input value={r.nombre} onChange={e => {const arr = [...form.referencias]; arr[i].nombre = e.target.value; setForm({...form, referencias: arr})}} /></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div><Label className="text-xs">Ocupación</Label><Input value={r.ocupacion} onChange={e => {const arr = [...form.referencias]; arr[i].ocupacion = e.target.value; setForm({...form, referencias: arr})}} /></div>
                            <div><Label className="text-xs">Teléfono</Label><Input value={r.telefono} onChange={e => {const arr = [...form.referencias]; arr[i].telefono = formatPhone(e.target.value); setForm({...form, referencias: arr})}} /></div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Disponibilidad</CardTitle></CardHeader>
                  <CardContent>
                    <div><Label className="text-xs">Fecha de disponibilidad para trabajar</Label><Input type="date" value={form.disponibilidad} onChange={e => setForm({...form, disponibilidad: e.target.value})} /></div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB: FIRMA */}
            {activeTab === "firma" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><FileSignature className="h-4 w-4" />Firma del Solicitante</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-4 bg-muted/30 rounded-lg text-xs">
                      <p className="text-muted-foreground italic">Certifico que la información anteriormente suministrada es correcta y autorizo a verificar la misma por todos los medios disponibles.</p>
                    </div>
                    {form.firma ? (
                      <div className="flex gap-3 items-center border rounded-lg p-4 bg-muted/10">
                        <img src={form.firma} alt="Firma" className="border max-h-32 bg-white" />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-green-600">✓ Firma registrada</p>
                          <Button size="sm" variant="outline" className="mt-2" onClick={() => setForm({...form, firma: ""})}>Borrar firma</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed border-muted rounded-lg p-8 text-center">
                        <FileSignature className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                        <p className="text-sm text-muted-foreground mb-3">Firma digital del solicitante</p>
                        <Button onClick={() => setShowFirma(true)}><PenTool className="h-4 w-4 mr-2" />Firmar ahora</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Observaciones Internas</CardTitle></CardHeader>
                  <CardContent>
                    <textarea value={form.observaciones} onChange={e => setForm({...form, observaciones: e.target.value})} rows={4} className="w-full px-3 py-2 border rounded-lg bg-background" placeholder="Notas adicionales sobre el candidato..." />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Navegación entre tabs */}
            <div className="flex justify-between mt-6 pt-4 border-t">
              <Button variant="outline" size="sm" onClick={() => {
                const idx = tabs.findIndex(t => t.id === activeTab)
                if (idx > 0) setActiveTab(tabs[idx - 1].id)
              }} disabled={tabs.findIndex(t => t.id === activeTab) === 0}>
                ← Anterior
              </Button>
              <span className="text-xs text-muted-foreground self-center">
                Paso {tabs.findIndex(t => t.id === activeTab) + 1} de {tabs.length}
              </span>
              <Button variant="outline" size="sm" onClick={() => {
                const idx = tabs.findIndex(t => t.id === activeTab)
                if (idx < tabs.length - 1) setActiveTab(tabs[idx + 1].id)
              }} disabled={tabs.findIndex(t => t.id === activeTab) === tabs.length - 1}>
                Siguiente →
              </Button>
            </div>
          </div>

          <DialogFooter className="p-4 border-t bg-muted/20">
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button variant="outline" onClick={() => exportPDF()}><Download className="h-4 w-4 mr-2" />Descargar PDF</Button>
            <Button onClick={handleSave}><Save className="h-4 w-4 mr-2" />Guardar Solicitud</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFirma} onOpenChange={setShowFirma}>
        <DialogContent>
          <DialogHeader><DialogTitle>Firma Digital</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">Firma con el mouse en el área:</p>
          <canvas ref={canvasRef} width={500} height={200} className="border-2 border-gray-300 bg-white cursor-crosshair rounded" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} />
          <DialogFooter>
            <Button variant="outline" onClick={clearFirma}>Limpiar</Button>
            <Button variant="outline" onClick={() => setShowFirma(false)}>Cancelar</Button>
            <Button onClick={saveFirma}>✓ Guardar firma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
