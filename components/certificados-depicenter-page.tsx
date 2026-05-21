"use client"

/**
 * Certificados Digitales DEPICENTER — módulo independiente.
 *
 * Funcional, separado de los certificados de Cibao Spa Laser:
 *   - Tabla propia (`csl_certificados_depicenter`)
 *   - PDF con plantilla Depicenter (texto fijo descrito por el cliente)
 *   - Si existe el archivo `public/certificados/depicenter-certificate.jpg`,
 *     se usa como FONDO del PDF. Si no, se renderiza con un marco rosa
 *     elegante y los datos limpios.
 *   - Operaciones: crear · editar · eliminar · imprimir · exportar PDF ·
 *     marcar como Usado / Cancelado · validar localmente.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Gift,
  Loader2,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import QRCode from "qrcode"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { depicenterValidationUrl } from "@/lib/certificado-depicenter"

type EstadoCert = "Activo" | "Usado" | "Vencido" | "Cancelado"

interface CertificadoDepicenter {
  codigo: string
  tipo: string
  fecha: string
  fechaVencimiento: string
  sucursal: string
  otorgadoA: string
  cortesiaDe: string
  validoPor: string
  monto: string
  servicio: string
  firma: string
  emitidoEn: string
  emitidoPor: string
  estado: EstadoCert
  usadoEn: string
  fechaUso: string
  canceladoEn: string
  notasEstado: string
  clienteNombre: string
  clienteTelefono: string
  clienteCorreo: string
  clienteDocumento: string
  observaciones: string
}

const SUCURSALES_DEPICENTER = ["La Vega", "Santiago", "Otro"]

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, days: number) {
  if (!iso) return ""
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ""
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(value?: string) {
  if (!value) return "-"
  const iso = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}

function fechaDesglose(value: string): { dia: string; mes: string; ano: string } {
  const iso = String(value || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!iso) return { dia: "____", mes: "__________", ano: "______" }
  const ano = iso[1]
  const mes = MESES_ES[Number(iso[2]) - 1] || "__________"
  const dia = String(Number(iso[3]))
  return { dia, mes, ano }
}

/**
 * Devuelve la fecha del día desglosada (día, mes, año) en zona horaria
 * LOCAL del navegador. Es la fecha que se imprime en el certificado:
 * siempre HOY, sin importar qué fecha tenga el `cert.fecha` guardado.
 *
 * Por qué local y no UTC: la frase "Dado a los X días, del mes de Y,
 * del año Z" tiene que reflejar lo que el operador ve en el reloj de
 * su pantalla. Si usáramos UTC, a las 8pm en RD (UTC-4) ya saldría el
 * día siguiente.
 */
function fechaHoyDesglose(): { dia: string; mes: string; ano: string; iso: string } {
  const d = new Date()
  const ano = String(d.getFullYear())
  const mes = MESES_ES[d.getMonth()] || "__________"
  const dia = String(d.getDate())
  const iso = `${ano}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { dia, mes, ano, iso }
}

/**
 * Construye el nombre del PDF descargable. Usa el nombre del destinatario
 * (Otorgado a) y le agrega el código al final por si dos certificados
 * comparten el mismo nombre. Cae al código solo si no hay otorgadoA.
 *
 *   "Carmen Lopez" + "DEPI-GC-...-354GC"
 *     → "Certificado-Depicenter-Carmen-Lopez-354GC.pdf"
 */
function buildPdfFilename(cert: CertificadoDepicenter): string {
  // Sanitizar: quitar acentos, dejar sólo letras/números/espacios, colapsar espacios.
  const sanitize = (raw: string) =>
    raw
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")  // combining diacriticals (tildes, acentos)
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
  const nombre = sanitize(cert.otorgadoA || "")
  // Sufijo corto del código (últimos 6 chars) para desambiguar si hay homónimos
  const suffix = (cert.codigo || "").split("-").pop()?.toUpperCase() || ""
  if (nombre) {
    return suffix
      ? `Certificado-Depicenter-${nombre}-${suffix}.pdf`
      : `Certificado-Depicenter-${nombre}.pdf`
  }
  return `Certificado-Depicenter-${cert.codigo || "sin-codigo"}.pdf`
}

function createCode() {
  const date = new Date()
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("")
  const random = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `DEPI-GC-${stamp}-${random}`
}

function emptyCert(sucursal = ""): CertificadoDepicenter {
  const fecha = todayIso()
  return {
    codigo: createCode(),
    tipo: "Digital",
    fecha,
    fechaVencimiento: addDays(fecha, 30),
    sucursal,
    otorgadoA: "",
    cortesiaDe: "",
    validoPor: "",
    monto: "",
    servicio: "",
    firma: "",
    emitidoEn: new Date().toISOString(),
    emitidoPor: "",
    estado: "Activo",
    usadoEn: "",
    fechaUso: "",
    canceladoEn: "",
    notasEstado: "",
    clienteNombre: "",
    clienteTelefono: "",
    clienteCorreo: "",
    clienteDocumento: "",
    observaciones: "",
  }
}

function normalize(input: Partial<CertificadoDepicenter>): CertificadoDepicenter {
  const base = emptyCert()
  return {
    ...base,
    ...input,
    codigo: String(input.codigo || base.codigo),
    estado: ((input.estado as EstadoCert) || "Activo"),
    monto: input.monto != null ? String(input.monto) : "",
  }
}

const ESTADO_BADGE: Record<EstadoCert, string> = {
  Activo: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Usado: "bg-slate-100 text-slate-600 border-slate-300",
  Vencido: "bg-amber-50 text-amber-700 border-amber-200",
  Cancelado: "bg-rose-50 text-rose-700 border-rose-200",
}

const DEPICENTER_TEMPLATE_IMAGE = "/certificados/depicenter-certificate.png"

/**
 * Construye la URL de validación pública de un certificado Depicenter.
 * Si estamos en SSR (no window) usamos un placeholder — el QR sólo se
 * genera en cliente.
 *
 * IMPORTANTE: la `fecha` que firma el QR es HOY (no `cert.fecha`), para
 * que coincida exactamente con la fecha impresa en el certificado. Si
 * un certificado se reimprime en otro día, su QR se firma con el día
 * de la reimpresión — la página de validación recalcula la firma con
 * los mismos datos del QR, así que sigue siendo válido. El estado del
 * certificado (Activo / Usado / Cancelado) se consulta aparte contra
 * el backend, no depende de la firma.
 */
function certValidationUrl(cert: CertificadoDepicenter): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://csl-app-eta.vercel.app"
  const { iso: fechaHoy } = fechaHoyDesglose()
  return depicenterValidationUrl(origin, {
    codigo: cert.codigo,
    otorgadoA: cert.otorgadoA,
    cortesiaDe: cert.cortesiaDe,
    validoPor: cert.validoPor,
    fecha: fechaHoy,
  })
}

/**
 * Genera el QR del certificado como dataURL PNG.
 *
 *  - Fondo transparente (`light: "#00000000"`) → integración visual
 *    limpia sobre la plantilla, sin caja blanca pegada.
 *  - errorCorrectionLevel "H" (30% de corrección) → permite escanear
 *    incluso si el patrón decorativo de la plantilla se transparenta
 *    entre los módulos del QR.
 *  - 480 px → resolución alta para mantener nitidez incluso impreso a
 *    tamaño grande.
 *  - margin 1 → quiet-zone mínima (la transparencia hace que la del
 *    propio QR sea opcional).
 */
async function generateQrDataUrl(cert: CertificadoDepicenter): Promise<string> {
  const url = certValidationUrl(cert)
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 480,
    color: { dark: "#0a5e5c", light: "#00000000" },
  })
}

type SortKey = "fecha" | "codigo" | "otorgadoA" | "estado" | "sucursal"

/**
 * Convierte cualquier error del backend en un mensaje amigable para el
 * usuario final. Mantiene el mensaje original sólo si claramente no es
 * técnico; de lo contrario muestra una versión "humana".
 */
function friendlyError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw || "")
  // Tabla faltante en Supabase (PGRST205) o cache de schema viejo
  if (/PGRST205|schema cache|Could not find the table|csl_certificados_depicenter/i.test(msg)) {
    return "La base de certificados Depicenter aún no está habilitada. Pide al administrador ejecutar el SQL `csl_certificados_depicenter.sql` en Supabase."
  }
  // Permisos / RLS
  if (/permission denied|row-level security|policy/i.test(msg)) {
    return "No tienes permiso para esta acción. Verifica tus permisos o contacta al administrador."
  }
  // Timeout / red
  if (/timeout|network|fetch failed|ECONNREFUSED/i.test(msg)) {
    return "No se pudo conectar con el servidor. Verifica tu conexión e intenta nuevamente."
  }
  // Auth
  if (/401|unauthorized|jwt|token/i.test(msg)) {
    return "Tu sesión expiró. Inicia sesión nuevamente."
  }
  // Cualquier otro mensaje claro y corto lo devolvemos tal cual; si trae
  // ruido técnico (códigos, stack), lo simplificamos.
  if (msg && msg.length < 160 && !/at\s+\w+|\bnode_modules\b|'\bstack'/i.test(msg)) {
    return msg
  }
  return "No se pudo completar la operación. Intenta nuevamente."
}

export function CertificadosDepicenterPage() {
  const { apiUrl, showToast, incrementFormOpen, decrementFormOpen } = useAppStore()
  const [items, setItems] = useState<CertificadoDepicenter[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editingCode, setEditingCode] = useState("")
  const [form, setForm] = useState<CertificadoDepicenter>(() => emptyCert())
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [deletingCode, setDeletingCode] = useState("")
  const [viewing, setViewing] = useState<CertificadoDepicenter | null>(null)
  // Banner amigable visible cuando la tabla aún no fue creada en Supabase
  const [tableMissing, setTableMissing] = useState(false)

  // Filtros y búsqueda
  const [query, setQuery] = useState("")
  const [filterEstado, setFilterEstado] = useState<"todos" | EstadoCert>("todos")
  const [filterSucursal, setFilterSucursal] = useState("todas")
  const [filterDesde, setFilterDesde] = useState("")
  const [filterHasta, setFilterHasta] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("fecha")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Validador en línea
  const [validateCode, setValidateCode] = useState("")
  const validateResult = useMemo(() => {
    const code = validateCode.trim().toUpperCase()
    if (!code) return null
    return items.find((c) => c.codigo.toUpperCase() === code) || null
  }, [validateCode, items])

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCertificadosDepicenter" })
      if (!(result as { ok?: boolean }).ok && (result as { error?: string }).error) {
        // El backend devolvió ok:false con un error explícito
        const msg = String((result as { error?: string }).error || "")
        if (/PGRST205|schema cache|Could not find the table|csl_certificados_depicenter/i.test(msg)) {
          setTableMissing(true)
          setItems([])
          return
        }
        throw new Error(msg)
      }
      setTableMissing(false)
      const records = Array.isArray((result as { records?: unknown[] }).records)
        ? ((result as { records?: Partial<CertificadoDepicenter>[] }).records || [])
        : []
      setItems(records.map(normalize))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error || "")
      if (/PGRST205|schema cache|Could not find the table|csl_certificados_depicenter/i.test(msg)) {
        setTableMissing(true)
        setItems([])
        return  // No toasteamos — el banner amigable ya informa al usuario
      }
      // Modo silencioso (auto-refresh): no molestamos con toast — la próxima
      // ronda volverá a intentar.
      if (!options.silent) showToast(friendlyError(error), "error")
    } finally {
      if (!options.silent) setLoading(false)
    }
  }, [apiUrl, showToast])

  useEffect(() => {
    void load()
  }, [load])

  useAutoRefresh(() => load({ silent: true }), {
    intervalMs: 60_000,
    skipWhen: () => open || !!viewing,
  })

  useEffect(() => {
    if (open) {
      incrementFormOpen()
      return () => decrementFormOpen()
    }
  }, [open, incrementFormOpen, decrementFormOpen])

  const sucursales = useMemo(
    () => Array.from(new Set([...SUCURSALES_DEPICENTER, ...items.map((c) => c.sucursal)].filter(Boolean))),
    [items],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = items.filter((c) => {
      if (filterEstado !== "todos" && c.estado !== filterEstado) return false
      if (filterSucursal !== "todas" && c.sucursal !== filterSucursal) return false
      if (filterDesde && c.fecha && c.fecha < filterDesde) return false
      if (filterHasta && c.fecha && c.fecha > filterHasta) return false
      if (needle) {
        const haystack = [c.codigo, c.otorgadoA, c.cortesiaDe, c.validoPor, c.clienteNombre, c.clienteTelefono, c.clienteCorreo, c.clienteDocumento]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
    list.sort((a, b) => {
      const va = String(a[sortKey] || "").toLowerCase()
      const vb = String(b[sortKey] || "").toLowerCase()
      if (va === vb) return 0
      const cmp = va < vb ? -1 : 1
      return sortDir === "asc" ? cmp : -cmp
    })
    return list
  }, [items, query, filterEstado, filterSucursal, filterDesde, filterHasta, sortKey, sortDir])

  const totals = useMemo(
    () => ({
      total: items.length,
      activos: items.filter((c) => c.estado === "Activo").length,
      usados: items.filter((c) => c.estado === "Usado").length,
      cancelados: items.filter((c) => c.estado === "Cancelado").length,
    }),
    [items],
  )

  // ---- Form helpers ----
  const update = (patch: Partial<CertificadoDepicenter>) => {
    setForm((current) => {
      const next = { ...current, ...patch }
      // Si cambia la fecha, recalcula vencimiento a +30 días por defecto.
      if (patch.fecha && !patch.fechaVencimiento) {
        next.fechaVencimiento = addDays(patch.fecha, 30)
      }
      return next
    })
  }

  /**
   * Reset completo del formulario y todo su estado satélite. Lo llamamos
   * tanto al cerrar el modal como después de un guardado exitoso.
   * Cubre TODOS los campos listados en la agenda: código, otorgado a,
   * cortesía de, válido por, monto, servicio, sucursal, estado, fechas,
   * cliente, observaciones, modo edición.
   */
  const resetForm = useCallback(() => {
    setForm(emptyCert())       // genera un nuevo `codigo`, fecha=hoy, estado=Activo, etc.
    setEditingCode("")
    setIsSaving(false)
    setSaveError("")
  }, [])

  const startCreate = () => {
    resetForm()
    setOpen(true)
  }

  const startEdit = (cert: CertificadoDepicenter) => {
    setSaveError("")
    setEditingCode(cert.codigo)
    setForm(normalize(cert))
    setOpen(true)
  }

  const handleSave = async () => {
    if (isSaving) return
    setSaveError("")
    // Validaciones de campos obligatorios
    const nombre = (form.otorgadoA || "").trim()
    if (!nombre) {
      setSaveError("Falta el nombre del beneficiario (Otorgado a).")
      return
    }
    if (!form.cortesiaDe.trim()) {
      setSaveError("Falta indicar 'Cortesía de'.")
      return
    }
    if (!form.validoPor.trim()) {
      setSaveError("Falta indicar 'Válido por' (servicio o descripción).")
      return
    }

    setIsSaving(true)
    try {
      // Si la fecha existe pero no la de vencimiento, derivamos +30 días
      const payload: CertificadoDepicenter = {
        ...form,
        codigo: form.codigo || createCode(),
        fecha: form.fecha || todayIso(),
        fechaVencimiento: form.fechaVencimiento || addDays(form.fecha || todayIso(), 30),
      }

      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveCertificadoDepicenter",
        data: JSON.stringify(payload),
      })

      if (!(result as { ok?: boolean }).ok) {
        const rawErr = String((result as { error?: string })?.error || "No se pudo guardar")
        // Tabla faltante: levantamos el banner y conservamos los datos
        if (/PGRST205|schema cache|Could not find the table|csl_certificados_depicenter/i.test(rawErr)) {
          setTableMissing(true)
        }
        throw new Error(rawErr)
      }

      const saved = normalize((result as { record?: Partial<CertificadoDepicenter> }).record || payload)
      // Reemplazamos en items (o agregamos si es nuevo), arriba del listado
      setItems((current) => {
        const without = current.filter((c) => c.codigo !== saved.codigo)
        return [saved, ...without]
      })
      setTableMissing(false)
      const wasEditing = Boolean(editingCode)

      // ÉXITO → limpieza completa del formulario, cierre del modal,
      // mensaje claro. La próxima vez que se abra "Nuevo certificado" el
      // form parte en blanco con un código fresco.
      setOpen(false)
      resetForm()
      showToast(wasEditing ? "Certificado actualizado" : "Certificado emitido", "success")
    } catch (error) {
      // ERROR → mostramos banner DENTRO del modal y conservamos los
      // datos escritos por el usuario para que no pierda información.
      const friendly = friendlyError(error)
      setSaveError(friendly)
      showToast(friendly, "error")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (cert: CertificadoDepicenter) => {
    if (deletingCode) return
    if (!window.confirm(`¿Eliminar el certificado ${cert.codigo}?`)) return
    setDeletingCode(cert.codigo)
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteCertificadoDepicenter", codigo: cert.codigo })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string })?.error || "No se pudo eliminar"))
      }
      setItems((current) => current.filter((c) => c.codigo !== cert.codigo))
      if (viewing?.codigo === cert.codigo) setViewing(null)
      // Si el formulario abierto correspondía al borrado, lo limpiamos
      if (editingCode === cert.codigo) {
        setOpen(false)
        resetForm()
      }
      showToast("Certificado eliminado", "success")
    } catch (error) {
      showToast(friendlyError(error), "error")
    } finally {
      setDeletingCode("")
    }
  }

  const changeEstado = async (cert: CertificadoDepicenter, estado: EstadoCert, extra: Partial<CertificadoDepicenter> = {}) => {
    const updated: CertificadoDepicenter = { ...cert, estado, ...extra }
    if (estado === "Usado" && !updated.fechaUso) updated.fechaUso = new Date().toISOString()
    if (estado === "Cancelado" && !updated.canceladoEn) updated.canceladoEn = new Date().toISOString()
    try {
      const result = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveCertificadoDepicenter",
        data: JSON.stringify(updated),
      })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string })?.error || "No se pudo actualizar"))
      }
      setItems((current) => current.map((c) => (c.codigo === cert.codigo ? updated : c)))
      if (viewing?.codigo === cert.codigo) setViewing(updated)
      showToast(`Marcado como ${estado}`, "success")
    } catch (error) {
      showToast(friendlyError(error), "error")
    }
  }

  // ---- PDF (plantilla oficial Depicenter) ----
  //
  // Hoja vertical 4:5 (600 x 750 pt) que respeta la proporción de la
  // plantilla oficial Depicenter (Instagram portrait).
  //
  // Si existe `public/certificados/depicenter-certificate.jpg` la usamos
  // como FONDO y SOLO escribimos los valores sobre las líneas existentes
  // (sin redibujar etiquetas).  Si no existe, dibujamos un fallback
  // programático con el mismo layout y los rótulos para que se vea bien.
  // Página A5 vertical en alta resolución (ratio 4:5 = 1080 x 1350 pt) para
  // que el JPG de la plantilla mantenga calidad de impresión y no se
  // deforme. pdf-lib usa origen abajo-izquierda.
  const PAGE_W = 1080
  const PAGE_H = 1350
  // Coordenadas detectadas por análisis de píxeles de la plantilla oficial
  // (depicenter-certificate.png 2400×3000 → escala a 1080×1350 = ×0.45).
  // La línea (underscore) está en pdf_y_bottom; el baseline del texto se
  // sitúa ~10 pt por encima para que el texto descanse sobre la raya.
  //   Línea "Otorgado a:"  pdf_y=589  →  baseline=599
  //   Línea "Cortesía de:" pdf_y=486  →  baseline=496
  //   Línea "Válido por:"  pdf_y=381  →  baseline=391
  //   Línea fecha 1 (DD/MES)  pdf_y=237 → baseline=247
  //   Línea fecha 2 (YYYY)    pdf_y=193 → baseline=203
  const POS = {
    otorgadoY: 599,
    cortesiaY: 496,
    validoY:   391,
    valido30Y: 360,            // (sólo fallback — en la plantilla ya está impreso)
    fechaY:    247,            // "Dado a los DD días, del mes de MES,"
    fechaY2:   203,            // "del año YYYY ."
    addressY:  Math.round(PAGE_H * 0.07),  // 95 (fallback)
    phoneY:    Math.round(PAGE_H * 0.045), // 61 (fallback)
    codeY:     20,             // esquina inferior derecha
    valueX:    425,            // las líneas empiezan en x_pt=410 — dejamos 15 pt de margen
  }

  const buildPdf = async (cert: CertificadoDepicenter): Promise<Uint8Array> => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([PAGE_W, PAGE_H])
    const { width, height } = page.getSize()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique)

    // Paleta Depicenter (turquesa).
    const teal = rgb(0.05, 0.49, 0.48)
    const tealSoft = rgb(0.86, 0.93, 0.93)
    const ink = rgb(0.10, 0.20, 0.22)
    const muted = rgb(0.36, 0.46, 0.48)

    // Intentar cargar imagen de fondo si está disponible.
    // Importante: NO deformar la imagen — la plantilla es 4:5 igual que la
    // página, así que cubre exactamente la hoja completa. Si por alguna
    // razón la proporción no coincide, dibujamos centrada manteniendo el
    // aspect ratio (object-contain) para no estirarla.
    let backgroundEmbedded = false
    try {
      if (typeof window !== "undefined") {
        const response = await fetch(DEPICENTER_TEMPLATE_IMAGE)
        if (response.ok) {
          const buffer = await response.arrayBuffer()
          const bytes = new Uint8Array(buffer)
          const image = DEPICENTER_TEMPLATE_IMAGE.toLowerCase().endsWith(".png")
            ? await doc.embedPng(bytes)
            : await doc.embedJpg(bytes)
          // Calcular escala "contain" para nunca deformar la imagen
          const scale = Math.min(width / image.width, height / image.height)
          const drawW = image.width * scale
          const drawH = image.height * scale
          const offX = (width - drawW) / 2
          const offY = (height - drawH) / 2
          page.drawImage(image, { x: offX, y: offY, width: drawW, height: drawH })
          backgroundEmbedded = true
        }
      }
    } catch {
      // Imagen no disponible — caemos a render programático.
    }

    const drawCentered = (text: string, y: number, size: number, fnt: PDFFont, color = ink) => {
      const w = fnt.widthOfTextAtSize(text, size)
      page.drawText(text, { x: (width - w) / 2, y, size, font: fnt, color })
    }

    if (!backgroundEmbedded) {
      // ---- Fallback programático cuando no hay imagen ----
      // (escalas pensadas para 1080×1350)
      // Banda superior turquesa + zona blanca grande
      page.drawRectangle({ x: 0, y: height - 380, width, height: 380, color: teal })
      page.drawRectangle({ x: 0, y: 0, width, height: height - 380, color: rgb(0.97, 0.97, 0.97) })
      // Disco blanco que simula el cuerpo del certificado
      page.drawCircle({ x: width / 2, y: height - 340, size: 360, color: rgb(1, 1, 1) })

      drawCentered("DEPICENTER", height - 420, 38, bold, teal)
      drawCentered("Skin Laser", height - 460, 18, italic, muted)
      drawCentered("Certificado", height - 550, 62, bold, teal)
      drawCentered("de regalo", height - 615, 38, italic, teal)

      // Etiquetas y líneas (sólo cuando NO hay imagen)
      const drawField = (label: string, y: number) => {
        page.drawText(label, { x: 130, y, size: 22, font: bold, color: teal })
        page.drawLine({
          start: { x: POS.valueX, y: y - 6 },
          end: { x: width - 110, y: y - 6 },
          thickness: 1.2,
          color: teal,
        })
      }
      drawField("Otorgado a:", POS.otorgadoY)
      drawField("Cortesía de:", POS.cortesiaY)
      drawField("Válido por:", POS.validoY)
      page.drawText("Válido por 30 días", { x: width - 320, y: POS.valido30Y, size: 16, font: italic, color: muted })

      // Plantilla de fecha
      page.drawText("Dado a los", { x: 130, y: POS.fechaY, size: 22, font, color: ink })
      page.drawText("días, del mes de", { x: 360, y: POS.fechaY, size: 22, font, color: ink })
      page.drawText(",", { x: 745, y: POS.fechaY, size: 22, font, color: ink })
      page.drawText("del año", { x: 400, y: POS.fechaY2, size: 22, font, color: ink })
      page.drawText(".", { x: 630, y: POS.fechaY2, size: 22, font, color: ink })
    }

    // ---- Valores (siempre, sobre fondo o fallback) ----
    const writeOnLine = (value: string, y: number) => {
      const text = value || ""
      page.drawText(text, { x: POS.valueX, y, size: 26, font: italic, color: ink })
    }
    writeOnLine(cert.otorgadoA, POS.otorgadoY)
    writeOnLine(cert.cortesiaDe, POS.cortesiaY)
    writeOnLine(cert.validoPor, POS.validoY)

    // FECHA DEL CERTIFICADO: siempre HOY al momento de generar/imprimir.
    // No usamos `cert.fecha` (la fecha guardada) para que un certificado
    // reimpreso al día siguiente refleje la fecha actual del día — tal
    // como pidió el cliente.
    const { dia, mes, ano } = fechaHoyDesglose()
    // Posiciones X detectadas (en pt sobre página 1080):
    //   DD blank:   x=[333, 411]  → centro ~370
    //   MES blank:  x=[722, 936]  → centro ~830
    //   YYYY blank: x=[529, 662]  → centro ~595
    // Centramos cada valor en el hueco midiendo el ancho del texto.
    const centerOn = (text: string, cx: number, y: number, size: number, fnt: PDFFont) => {
      const w = fnt.widthOfTextAtSize(text, size)
      page.drawText(text, { x: cx - w / 2, y, size, font: fnt, color: ink })
    }
    centerOn(dia, 370, POS.fechaY,  22, bold)
    centerOn(mes, 830, POS.fechaY,  22, bold)
    centerOn(ano, 595, POS.fechaY2, 22, bold)

    // Pie con dirección y teléfono — sólo dibujamos si NO hay imagen
    // (la plantilla oficial ya los trae impresos).
    if (!backgroundEmbedded) {
      drawCentered("FG Corner Plaza Mod, Av. García Godoy 101, La Vega", POS.addressY, 18, bold, teal)
      drawCentered("Teléfono:  809 737 2676", POS.phoneY, 18, font, ink)
    }

    // ---- QR de validación ----
    // Esquina inferior DERECHA, integrado al diseño SIN caja blanca.
    //
    // Geometría del hueco disponible (medido sobre la plantilla):
    //   - footer impreso (dirección + tel) ocupa y=67–117
    //   - línea de fecha "del mes de MES," llega hasta x≈946 con
    //     coma en y≈237–250 (un único punto)
    //   - "Válido por 30 días" subtítulo termina en x≈803 a y≈349
    //
    // El QR se ancla al borde derecho (20 pt de margen) y sube
    // verticalmente hasta tocar la zona del subtítulo "Válido por 30
    // días". El cuadrado de ~170×170 pt sólo solapa con el patrón
    // decorativo de cajitas (no con texto), y el fondo transparente
    // + corrección H aseguran que se vea limpio y siga escaneable.
    try {
      const qrDataUrl = await generateQrDataUrl(cert)
      const qrBytes = await fetch(qrDataUrl).then((r) => r.arrayBuffer())
      const qrImage = await doc.embedPng(new Uint8Array(qrBytes))
      const QR_SIZE = 170
      const QR_X = width - QR_SIZE - 20    // 890 (1080 – 170 – 20)
      const QR_Y = 125                      // 8 pt sobre el footer impreso
      // SIN caja, SIN borde, SIN etiqueta — el QR habla por sí mismo
      // y queda integrado al diseño.
      page.drawImage(qrImage, { x: QR_X, y: QR_Y, width: QR_SIZE, height: QR_SIZE })
    } catch {
      // Si la generación del QR falla por cualquier razón (CSP, red,
      // navegador antiguo) no rompemos el PDF — sólo lo emitimos sin QR.
    }

    // Código discreto en esquina inferior IZQUIERDA — identifica el
    // certificado siempre (también cuando hay imagen de fondo). Lo
    // movemos al lado opuesto del QR para balance visual.
    page.drawText(cert.codigo, { x: 60, y: POS.codeY, size: 11, font, color: muted })
    // Decoración mínima
    void tealSoft

    return doc.save()
  }

  const handleDownloadPdf = async (cert: CertificadoDepicenter) => {
    try {
      const bytes = await buildPdf(cert)
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = buildPdfFilename(cert)
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al generar PDF", "error")
    }
  }

  const handlePrint = async (cert: CertificadoDepicenter) => {
    try {
      const bytes = await buildPdf(cert)
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const popup = window.open(url, "_blank")
      if (!popup) showToast("El navegador bloqueó la ventana de impresión", "error")
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error al imprimir", "error")
    }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  return (
    <div className="space-y-6">
      <Card className="csl-section-card">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="csl-kpi-icon">
                  <Gift className="h-5 w-5" />
                </span>
                <span className="csl-pill">Depicenter</span>
              </div>
              <h2 className="font-heading text-2xl font-black tracking-tight text-[color:var(--brand-primary-dark)] sm:text-3xl">
                Certificado Digital Depicenter
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Emisión, validación y PDF con plantilla Depicenter. Independiente de los certificados de Cibao Spa Laser.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void load()} className="rounded-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Actualizar
              </Button>
              <Button onClick={startCreate} className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Nuevo certificado
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {tableMissing ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm"
        >
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <div className="font-semibold">La base de certificados Depicenter aún no está habilitada.</div>
            <div className="mt-1 text-amber-800">
              Pide al administrador ejecutar el script SQL{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs">
                supabase/csl_certificados_depicenter.sql
              </code>{" "}
              en el SQL Editor de Supabase. Mientras tanto la UI funciona pero no podrás
              guardar ni listar certificados.
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label="Emitidos" value={totals.total} />
        <Kpi label="Activos" value={totals.activos} tone="emerald" />
        <Kpi label="Usados" value={totals.usados} />
        <Kpi label="Cancelados" value={totals.cancelados} tone="rose" />
      </div>

      {/* Validador rápido */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-[color:var(--brand-primary)]" />
            Validar certificado por código
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <Label className="text-xs">Código del certificado</Label>
              <Input
                value={validateCode}
                onChange={(e) => setValidateCode(e.target.value)}
                placeholder="Ej: DEPI-GC-20260509-AB12X"
                className="mt-1 font-mono"
              />
            </div>
            <div className="flex-1">
              {validateCode.trim() ? (
                validateResult ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" /> Certificado encontrado
                    </div>
                    <div className="mt-1 text-xs text-emerald-700">
                      {validateResult.otorgadoA || "Beneficiario sin nombre"} · {validateResult.estado} ·
                      {" "}emitido {formatDate(validateResult.fecha)}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
                    <div className="flex items-center gap-2 font-semibold text-rose-800">
                      <XCircle className="h-4 w-4" /> No encontrado
                    </div>
                    <div className="mt-1 text-xs text-rose-700">
                      Ese código no corresponde a un certificado Depicenter activo.
                    </div>
                  </div>
                )
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,1fr)_auto]">
          <div>
            <Label className="text-xs">Búsqueda</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Código, beneficiario, cortesía, cliente…" className="pl-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={filterEstado} onValueChange={(v) => setFilterEstado(v as "todos" | EstadoCert)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Activo">Activo</SelectItem>
                <SelectItem value="Usado">Usado</SelectItem>
                <SelectItem value="Vencido">Vencido</SelectItem>
                <SelectItem value="Cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sucursal</Label>
            <Select value={filterSucursal} onValueChange={setFilterSucursal}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Fecha desde</Label>
            <Input type="date" className="mt-1" value={filterDesde} onChange={(e) => setFilterDesde(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fecha hasta</Label>
            <Input type="date" className="mt-1" value={filterHasta} onChange={(e) => setFilterHasta(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="ghost" onClick={() => { setQuery(""); setFilterEstado("todos"); setFilterSucursal("todas"); setFilterDesde(""); setFilterHasta("") }} className="gap-1 text-xs">
              <X className="h-3.5 w-3.5" /> Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Certificados Depicenter
            <Badge variant="outline">{filtered.length}</Badge>
            {filtered.length !== items.length ? <span className="text-xs font-normal text-muted-foreground">de {items.length}</span> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("fecha")}>
                    Fecha <ArrowUpDown className="ml-1 inline h-3 w-3" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("codigo")}>
                    Código <ArrowUpDown className="ml-1 inline h-3 w-3" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("otorgadoA")}>
                    Otorgado a <ArrowUpDown className="ml-1 inline h-3 w-3" />
                  </TableHead>
                  <TableHead>Cortesía de</TableHead>
                  <TableHead>Válido por</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort("sucursal")}>Sucursal</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[color:var(--brand-primary)]" />
                      Cargando certificados…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                      No hay certificados que coincidan con los filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((cert, i) => (
                    <TableRow key={cert.codigo}>
                      <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                      <TableCell className="font-semibold whitespace-nowrap">{formatDate(cert.fecha)}</TableCell>
                      <TableCell className="font-mono text-xs">{cert.codigo}</TableCell>
                      <TableCell className="font-bold">{cert.otorgadoA || "—"}</TableCell>
                      <TableCell>{cert.cortesiaDe || "—"}</TableCell>
                      <TableCell>{cert.validoPor || "—"}</TableCell>
                      <TableCell>{cert.sucursal || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ESTADO_BADGE[cert.estado] || ""}>
                          {cert.estado}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Ver / vista previa" onClick={() => setViewing(cert)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Imprimir" onClick={() => void handlePrint(cert)}>
                            <Printer className="h-4 w-4 text-[color:var(--brand-primary)]" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Descargar PDF" onClick={() => void handleDownloadPdf(cert)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Editar" onClick={() => startEdit(cert)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Eliminar" disabled={deletingCode === cert.codigo} onClick={() => void handleDelete(cert)}>
                            {deletingCode === cert.codigo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-rose-600" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Formulario */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[1000px]">
          <DialogHeader>
            <DialogTitle>{editingCode ? "Editar certificado Depicenter" : "Nuevo certificado Depicenter"}</DialogTitle>
            <DialogDescription>
              Plantilla oficial Depicenter · FG Corner Plaza, Av. García Godoy 101, La Vega · Tel. 809 737 2676
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input value={form.codigo} readOnly className="mt-1 font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Fecha emisión</Label>
                  <Input type="date" className="mt-1" value={form.fecha} onChange={(e) => update({ fecha: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Fecha vencimiento</Label>
                  <Input type="date" className="mt-1" value={form.fechaVencimiento} onChange={(e) => update({ fechaVencimiento: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Estado</Label>
                  <Select value={form.estado} onValueChange={(v) => update({ estado: v as EstadoCert })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Activo">Activo</SelectItem>
                      <SelectItem value="Usado">Usado</SelectItem>
                      <SelectItem value="Vencido">Vencido</SelectItem>
                      <SelectItem value="Cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sucursal</Label>
                  <Select value={form.sucursal} onValueChange={(v) => update({ sucursal: v })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                    <SelectContent>
                      {SUCURSALES_DEPICENTER.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3">
                  <Label className="text-xs">Emitido por (especialista / recepción)</Label>
                  <Input className="mt-1" value={form.emitidoPor} onChange={(e) => update({ emitidoPor: e.target.value })} placeholder="Nombre del emisor" />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border p-4">
              <h3 className="mb-4 font-heading text-lg font-black">Contenido del certificado</h3>
              <div className="grid gap-3">
                <div>
                  <Label>Otorgado a *</Label>
                  <Input className="mt-1" value={form.otorgadoA} onChange={(e) => update({ otorgadoA: e.target.value })} placeholder="Nombre completo del beneficiario" />
                </div>
                <div>
                  <Label>Cortesía de *</Label>
                  <Input className="mt-1" value={form.cortesiaDe} onChange={(e) => update({ cortesiaDe: e.target.value })} placeholder="Nombre de quien regala" />
                </div>
                <div>
                  <Label>Válido por *</Label>
                  <Input className="mt-1" value={form.validoPor} onChange={(e) => update({ validoPor: e.target.value })} placeholder="Servicio, monto o descripción del certificado" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Monto (opcional)</Label>
                    <Input className="mt-1" value={form.monto} onChange={(e) => update({ monto: e.target.value })} placeholder="Ej: 3500.00" />
                  </div>
                  <div>
                    <Label>Servicio (opcional)</Label>
                    <Input className="mt-1" value={form.servicio} onChange={(e) => update({ servicio: e.target.value })} placeholder="Ej: Depilación piernas completas" />
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border p-4">
              <h3 className="mb-4 font-heading text-lg font-black">Datos del cliente</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Nombre del cliente</Label>
                  <Input className="mt-1" value={form.clienteNombre} onChange={(e) => update({ clienteNombre: e.target.value })} placeholder="Si es distinto del beneficiario" />
                </div>
                <div>
                  <Label>Documento</Label>
                  <Input className="mt-1" value={form.clienteDocumento} onChange={(e) => update({ clienteDocumento: e.target.value })} />
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <Input className="mt-1" value={form.clienteTelefono} onChange={(e) => update({ clienteTelefono: e.target.value })} />
                </div>
                <div>
                  <Label>Correo</Label>
                  <Input type="email" className="mt-1" value={form.clienteCorreo} onChange={(e) => update({ clienteCorreo: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Observaciones</Label>
                  <Textarea className="mt-1" value={form.observaciones} onChange={(e) => update({ observaciones: e.target.value })} placeholder="Notas internas, restricciones, fecha de uso prevista…" />
                </div>
              </div>
            </section>

            {/* Vista previa */}
            <CertificadoPreview cert={form} />
          </div>

          {saveError ? (
            <div
              role="alert"
              className="sticky bottom-[68px] z-20 -mx-6 border-y border-red-200 bg-red-50 px-6 py-2 text-sm font-medium text-red-700"
            >
              {saveError}
            </div>
          ) : null}

          <DialogFooter className="sticky bottom-0 z-20 -mx-6 -mb-6 border-t border-[color:var(--brand-border)] bg-white/95 px-6 py-3 backdrop-blur">
            <Button variant="outline" onClick={() => void handlePrint(form)} disabled={isSaving} className="gap-2">
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
            <Button variant="outline" onClick={() => void handleDownloadPdf(form)} disabled={isSaving} className="gap-2">
              <Download className="h-4 w-4" /> Descargar PDF
            </Button>
            <Button onClick={() => void handleSave()} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? "Guardando…" : (editingCode ? "Actualizar" : "Guardar certificado")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vista de detalle / preview */}
      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>{viewing?.otorgadoA || "Certificado Depicenter"}</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-[10px] text-muted-foreground/70">{viewing?.codigo}</span>
              {viewing ? ` · ${formatDate(viewing.fecha)} · ${viewing.sucursal || ""}` : null}
            </DialogDescription>
          </DialogHeader>
          {viewing ? <CertificadoPreview cert={viewing} /> : null}
          <DialogFooter className="flex-wrap gap-2">
            {viewing && viewing.estado === "Activo" ? (
              <>
                <Button variant="outline" onClick={() => viewing && changeEstado(viewing, "Usado")} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Marcar como usado
                </Button>
                <Button variant="outline" onClick={() => viewing && changeEstado(viewing, "Cancelado")} className="gap-2">
                  <XCircle className="h-4 w-4" /> Cancelar
                </Button>
              </>
            ) : null}
            <Button variant="outline" onClick={() => viewing && handlePrint(viewing)} className="gap-2">
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
            <Button onClick={() => viewing && handleDownloadPdf(viewing)} className="gap-2">
              <Download className="h-4 w-4" /> Descargar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "emerald" | "rose" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-[color:var(--brand-primary-dark)]"
  return (
    <Card className="csl-section-card">
      <CardContent className="p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={`mt-2 font-heading text-3xl font-black ${cls}`}>{value.toLocaleString("es-DO")}</div>
      </CardContent>
    </Card>
  )
}

/**
 * Vista previa HTML del certificado Depicenter.
 * Muestra el mismo layout y texto que el PDF, para que el operador vea
 * el resultado antes de imprimir o guardar.
 */
function CertificadoPreview({ cert }: { cert: CertificadoDepicenter }) {
  // La preview muestra SIEMPRE la fecha del día (igual que el PDF),
  // sin importar el `cert.fecha` guardado. Mismo criterio que en buildPdf.
  const { dia, mes, ano } = fechaHoyDesglose()
  const [bgError, setBgError] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>("")

  // Color Depicenter (turquesa oficial)
  const TEAL = "#0D7C7A"
  const TEAL_DARK = "#0a5e5c"

  // Generar QR cada vez que cambian los datos relevantes del certificado.
  // Lo hacemos en cliente con useEffect — si falla, no rompe la preview.
  useEffect(() => {
    let cancelled = false
    if (!cert.codigo) {
      setQrDataUrl("")
      return
    }
    void generateQrDataUrl(cert)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("")
      })
    return () => {
      cancelled = true
    }
  }, [cert.codigo, cert.otorgadoA, cert.cortesiaDe, cert.validoPor, cert.fecha])

  return (
    <section className="rounded-2xl border bg-white p-4">
      <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-muted-foreground">Vista previa</h3>
      <div className="relative mx-auto aspect-[4/5] w-full max-w-[440px] overflow-hidden rounded-xl border bg-white shadow-md">
        {/* Imagen de fondo de la plantilla oficial Depicenter */}
        {!bgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={DEPICENTER_TEMPLATE_IMAGE}
            alt="Plantilla Depicenter"
            onError={() => setBgError(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // Fallback programático con la misma estética turquesa
          <div className="absolute inset-0 bg-white">
            <div
              className="absolute inset-x-0 top-0 h-[28%]"
              style={{ background: TEAL }}
            />
            <div
              className="absolute left-1/2 top-[8%] h-[120px] w-[120px] -translate-x-1/2 rounded-full bg-white"
              style={{ boxShadow: "0 4px 18px rgba(0,0,0,0.08)" }}
            />
            <div className="absolute inset-x-0 top-[18%] text-center text-[10px] font-bold tracking-widest" style={{ color: TEAL }}>
              D · DEPICENTER
            </div>
            <div className="absolute inset-x-0 top-[22%] text-center text-[9px] italic" style={{ color: TEAL }}>
              Skin Laser
            </div>
            <div className="absolute inset-x-0 top-[32%] text-center text-[42px] font-bold leading-none" style={{ color: TEAL, fontFamily: "serif" }}>
              Certificado
            </div>
            <div className="absolute inset-x-0 top-[42%] text-center text-[22px] italic" style={{ color: TEAL, fontFamily: "serif" }}>
              de regalo
            </div>
          </div>
        )}

        {/* Overlay de DATOS — siempre encima del fondo (imagen o fallback).
            Posiciones calibradas por análisis de píxeles de la plantilla
            (depicenter-certificate.png 2400×3000). Las líneas detectadas:
              Otorgado a:  56.4% desde arriba
              Cortesía de: 64.0%
              Válido por:  71.8%
              Fecha L1:    82.4%  (DD ∙ MES)
              Fecha L2:    85.7%  (YYYY)
            El texto se posiciona ~3 pp por encima para descansar sobre la raya. */}
        <div className="absolute inset-0">
          {/* Otorgado a */}
          <div
            className="absolute right-[10%] truncate text-[13px] italic"
            style={{ top: "53.5%", left: "38%", color: TEAL_DARK }}
          >
            {bgError ? (
              <span className="not-italic font-semibold" style={{ color: TEAL, marginLeft: "-22%" }}>
                Otorgado a:&nbsp;
              </span>
            ) : null}
            {cert.otorgadoA || ""}
            {bgError ? <div className="mt-0.5 h-px" style={{ background: TEAL }} /> : null}
          </div>
          {/* Cortesía de */}
          <div
            className="absolute right-[10%] truncate text-[13px] italic"
            style={{ top: "61.2%", left: "38%", color: TEAL_DARK }}
          >
            {bgError ? (
              <span className="not-italic font-semibold" style={{ color: TEAL, marginLeft: "-24%" }}>
                Cortesía de:&nbsp;
              </span>
            ) : null}
            {cert.cortesiaDe || ""}
            {bgError ? <div className="mt-0.5 h-px" style={{ background: TEAL }} /> : null}
          </div>
          {/* Válido por */}
          <div
            className="absolute right-[10%] truncate text-[13px] italic"
            style={{ top: "68.9%", left: "35%", color: TEAL_DARK }}
          >
            {bgError ? (
              <span className="not-italic font-semibold" style={{ color: TEAL, marginLeft: "-22%" }}>
                Válido por:&nbsp;
              </span>
            ) : null}
            {cert.validoPor || ""}
            {bgError ? <div className="mt-0.5 h-px" style={{ background: TEAL }} /> : null}
          </div>

          {bgError ? (
            <div className="absolute right-[10%] text-[9px] italic" style={{ top: "73%", color: TEAL_DARK }}>
              Válido por 30 días
            </div>
          ) : null}

          {/* Fecha — sobre la plantilla oficial, sólo escribimos los valores
              (día, mes, año) sobre las rayitas correspondientes. */}
          {bgError ? (
            <>
              <div
                className="absolute left-[12%] right-[10%] text-[11px]"
                style={{ top: "79.5%", color: TEAL_DARK }}
              >
                Dado a los <span className="font-bold">{dia}</span> días, del mes de <span className="font-bold">{mes}</span>,
              </div>
              <div
                className="absolute left-[12%] right-[10%] text-[11px]"
                style={{ top: "82.8%", color: TEAL_DARK }}
              >
                del año <span className="font-bold">{ano}</span>.
              </div>
            </>
          ) : (
            <>
              {/* DD centrada en x=34.4% (centro de la rayita) */}
              <div
                className="absolute -translate-x-1/2 text-[12px] font-bold"
                style={{ top: "79.8%", left: "34.4%", color: TEAL_DARK }}
              >
                {dia}
              </div>
              {/* MES centrada en x=76.8% (centro de la rayita) */}
              <div
                className="absolute -translate-x-1/2 text-[12px] font-bold"
                style={{ top: "79.8%", left: "76.8%", color: TEAL_DARK }}
              >
                {mes}
              </div>
              {/* YYYY centrada en x=55.1% (centro de la rayita) */}
              <div
                className="absolute -translate-x-1/2 text-[12px] font-bold"
                style={{ top: "83.1%", left: "55.1%", color: TEAL_DARK }}
              >
                {ano}
              </div>
            </>
          )}

          {/* Pie con dirección — sólo en modo fallback (la plantilla oficial ya la trae) */}
          {bgError ? (
            <div
              className="absolute inset-x-0 text-center text-[8px] font-semibold"
              style={{ top: "93%", color: TEAL }}
            >
              FG Corner Plaza Mod, Av. García Godoy 101, La Vega
              <br />Teléfono:  809 737 2676
            </div>
          ) : null}

          {/* QR de validación — esquina inferior DERECHA, sin caja, sin
              borde, sin etiqueta. Los módulos transparentes se funden
              con el patrón crema del fondo de la plantilla. Posición y
              tamaño mapean 1:1 al PDF (170×170 pt en página 1080×1350
              ≈ 15.7% del ancho y 7%×12.6% del alto). */}
          {qrDataUrl ? (
            <div
              className="absolute"
              style={{
                right: "1.85%",        // 20pt / 1080
                bottom: "9.25%",       // 125pt / 1350
                width: "15.7%",        // 170pt / 1080
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="QR de validación"
                className="block h-auto w-full"
              />
            </div>
          ) : null}

          {/* Código discreto en esquina inferior IZQUIERDA (balance con el QR derecha) */}
          <div className="absolute bottom-1 left-2 font-mono text-[7px] tracking-wide text-slate-500/70">
            {cert.codigo}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {bgError
          ? <>Sube la plantilla a <code className="rounded bg-slate-100 px-1 font-mono">{DEPICENTER_TEMPLATE_IMAGE}</code> y se usará como fondo automáticamente.</>
          : "Vista previa con plantilla oficial Depicenter."}
      </p>
    </section>
  )
}
