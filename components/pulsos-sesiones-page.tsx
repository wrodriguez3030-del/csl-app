"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { loadXLSX } from "@/lib/load-xlsx"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, Save, Search, ChevronRight, X, Zap, Upload } from "lucide-react"
import type { ClienteCosmiatria, LecturaSemanal, SesionCliente } from "@/lib/types"
import {
  markDuplicatesAgainstExisting,
  parseAgendaProWorkbook,
  type ParsedDisparoRow,
  type ParseAgendaProResult,
} from "@/lib/agendapro-parser"

const today = new Date().toISOString().split("T")[0]

const empty: SesionCliente = {
  SesionID: "", Fecha: today, Sucursal: "", Cabina: "", OperadoraID: "",
  Cliente: "", AreaTrabajada: "", DisparosReportados: 0, Duracion: undefined,
  EquipoID: "", Observaciones: "",
}

const AREAS = [
  "Axilas","Bikini Completo","Bikini Brasileño","Piernas Completas",
  "Medias Piernas","Muslos","Pantorrillas","Brazos Completos","Antebrazo",
  "Espalda Completa","Media Espalda","Abdomen","Pecho","Rostro Completo",
  "Bozo","Patillas","Cuello","Manos / Dedos","Pies / Dedos","Línea Alba","Glúteos",
]

function fmtSemana(d: string) {
  try {
    const inicio = new Date(weekStartIso(d) + "T12:00:00")
    const fin = new Date(inicio)
    fin.setDate(inicio.getDate() + 6)
    const diaInicio = inicio.toLocaleDateString("es-DO", { day: "2-digit", month: "short" })
    const diaFin = fin.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })
    return `Del ${diaInicio} al ${diaFin}`
  } catch {
    return d
  }
}

function weekStartIso(d: string) {
  const fecha = new Date(String(d || "").slice(0, 10) + "T12:00:00")
  if (Number.isNaN(fecha.getTime())) return String(d || "")
  fecha.setDate(fecha.getDate() - fecha.getDay())
  return fecha.toISOString().slice(0, 10)
}

function normalizeText(value: string) {
  return String(value || "").toLowerCase().trim()
}

function normalizeCabina(value: string) {
  return normalizeText(value).replace(/\s+/g, " ").replace("cabina", "").trim()
}

function mapSucursal(s: string): string {
  if (s.includes("Plaza") || s.includes("Mediterr")) return "Rafael Vidal"
  if (s.includes("Jardines")) return "Los Jardines"
  if (s.includes("Villa Olga")) return "Villa Olga"
  return s.trim()
}

// Mapa completo: equipo por sucursal (cabina se asigna por operadora)
// Rafael Vidal: 4(Rosa/Cab5), 6(Madelin/Cab4), 7(Diana/Cab1), 8(Emely/Cab2)
// Los Jardines: 9(YAMILKA/Cab4), 10(Katherine/Cab1), 11(NAYELI/Cab3), 13(Lilian/Cab2)
// Villa Olga: 17(Yessica/Cab1), 19(Eidylee/Cab2)
const OPERADORA_EQUIPO: Record<string, { equipoId: string; cabina: string }> = {
  "Rosa":      { equipoId: "4",  cabina: "Cabina 5" },
  "Madelin":   { equipoId: "6",  cabina: "Cabina 4" },
  "Diana":     { equipoId: "7",  cabina: "Cabina 1" },
  "Emely":     { equipoId: "8",  cabina: "Cabina 2" },
  "YAMILKA":   { equipoId: "9",  cabina: "Cabina 4" },
  "Katherine": { equipoId: "10", cabina: "Cabina 1" },
  "NAYELI":    { equipoId: "11", cabina: "Cabina 3" },
  "Lilian":    { equipoId: "13", cabina: "Cabina 2" },
  "Yessica":   { equipoId: "17", cabina: "Cabina 1" },
  "Eidylee":   { equipoId: "19", cabina: "Cabina 2" },
}

function mapEquipo(suc: string): string {
  if (suc === "Rafael Vidal") return "133"
  if (suc === "Los Jardines") return "158"
  if (suc === "Villa Olga") return "VO-01"
  return ""
}

function getEquipoByOp(op: string): { equipoId: string; cabina: string } {
  return OPERADORA_EQUIPO[op] || { equipoId: mapEquipo(""), cabina: "" }
}

function findWeeklyAssignment(lecturas: LecturaSemanal[], fecha: string, sucursal: string, operadora: string) {
  const semana = weekStartIso(fecha)
  const lectura = lecturas.find(item =>
    String(item.FechaSemana || "").split("T")[0] === semana &&
    normalizeText(item.OperadoraID) === normalizeText(operadora) &&
    normalizeText(mapSucursal(item.Sucursal || "")) === normalizeText(mapSucursal(sucursal || ""))
  )
  if (!lectura) return undefined
  return { equipoId: lectura.EquipoID || "", cabina: lectura.Cabina || "" }
}

function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "")
}

function clienteNombre(cliente: ClienteCosmiatria) {
  return `${cliente.Nombre || ""} ${cliente.Apellido || ""}`.trim()
}

function clienteSearchText(cliente: ClienteCosmiatria) {
  return [
    clienteNombre(cliente),
    cliente.Telefono,
    cliente.Telefono2,
    cliente.DocumentoIdentidad,
    cliente.Email,
    cliente.Sucursal,
  ].join(" ").toLowerCase()
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

export function PulsosSesionesPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SesionCliente>(empty)
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])
  const [clientSearch, setClientSearch] = useState("")
  // Estado explícito del dropdown del selector de cliente: antes el render
  // se derivaba solo de `clientSearch.trim()` y como tras seleccionar el
  // texto se reescribía con el nombre del cliente, el dropdown se quedaba
  // abierto (el cliente seguía matcheando consigo mismo).
  const [clienteDropdownOpen, setClienteDropdownOpen] = useState(false)
  const clientePickerRef = useRef<HTMLDivElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [filterDesde, setFilterDesde] = useState("")
  const [filterHasta, setFilterHasta] = useState("")
  const [filterSemana, setFilterSemana] = useState("todas")
  const [filterOp, setFilterOp] = useState("todas")
  const [filterSuc, setFilterSuc] = useState("todas")
  // Búsqueda libre: matchea cliente / contacto / tratamiento / archivo origen.
  // Vivimos un solo input para no saturar el toolbar — los selectors de
  // operadora/sucursal/semana ya cubren los filtros estructurados.
  const [filterText, setFilterText] = useState("")
  const [showImport, setShowImport] = useState(false)
  // Detalle de grupo del resumen: al hacer clic en una fila se abre un modal
  // con las sesiones individuales que componen ese grupo (con campos ricos).
  const [detailGroup, setDetailGroup] = useState<null | {
    semana: string
    sucursal: string
    cabina: string
    equipoId: string
    operadoraId: string
  }>(null)
  const [sortCol, setSortCol] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }
  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 ml-1">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }


  const syncApi = async (params: Record<string, string>) => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    try { await apiJsonp(normalized, params) } catch(e) { console.warn(e) }
  }

  const loadClientes = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    try {
      const result = await apiJsonp(normalized, { action: "getClientesCosmiatria" })
      if (!result?.ok) throw new Error(String((result as { error?: string })?.error || "No se pudieron cargar los clientes"))
      setClientes((((result as { records?: Record<string, unknown>[] }).records || [])).map(normalizeCliente))
    } catch (error) {
      console.warn(error)
    }
  }

  // El store NO persiste `sesionesCliente` (por tamaño): tras un refresh queda
  // vacío. Hacer auto-fetch evita que el usuario vea la pantalla en blanco
  // hasta presionar "Actualizar".
  const loadSesionesIfEmpty = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    try {
      const result = await apiJsonp(normalized, { action: "getAllPulsosData" }) as {
        ok?: boolean
        operadoras?: typeof dbPulsos.operadoras
        lecturasSemanales?: typeof dbPulsos.lecturasSemanales
        sesionesCliente?: typeof dbPulsos.sesionesCliente
        auditoriasSemanales?: typeof dbPulsos.auditoriasSemanales
      }
      if (!result?.ok) return
      setDbPulsos({
        operadoras: result.operadoras ?? dbPulsos.operadoras,
        lecturasSemanales: result.lecturasSemanales ?? dbPulsos.lecturasSemanales,
        sesionesCliente: result.sesionesCliente ?? [],
        auditoriasSemanales: result.auditoriasSemanales ?? dbPulsos.auditoriasSemanales,
        pulseReadings: dbPulsos.pulseReadings,
        operatorShots: dbPulsos.operatorShots,
      })
    } catch (error) {
      console.warn(error)
    }
  }

  useEffect(() => {
    void loadClientes()
    if (dbPulsos.sesionesCliente.length === 0) {
      void loadSesionesIfEmpty()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  const matchedClientes = useMemo(() => {
    const query = clientSearch.trim().toLowerCase()
    if (!query) return []
    return clientes
      .filter((cliente) => cliente.Estado !== "Inactivo")
      .filter((cliente) => clienteSearchText(cliente).includes(query) || onlyDigits(clienteSearchText(cliente)).includes(onlyDigits(query)))
      .slice(0, 8)
  }, [clientes, clientSearch])

  const selectCliente = (cliente: ClienteCosmiatria) => {
    const nombre = clienteNombre(cliente)
    setForm({
      ...form,
      Cliente: nombre,
      Sucursal: cliente.Sucursal || form.Sucursal,
    })
    // Limpiar la búsqueda + cerrar el dropdown explícitamente. El nombre
    // queda visible en el campo "Cliente *" de abajo, que es la fuente de
    // verdad para guardar.
    setClientSearch("")
    setClienteDropdownOpen(false)
  }

  // Cerrar dropdown del selector al hacer click fuera.
  useEffect(() => {
    if (!clienteDropdownOpen) return
    const onDocPointerDown = (event: PointerEvent) => {
      if (!clientePickerRef.current) return
      if (!clientePickerRef.current.contains(event.target as Node)) {
        setClienteDropdownOpen(false)
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown)
    return () => document.removeEventListener("pointerdown", onDocPointerDown)
  }, [clienteDropdownOpen])

  const openNew = () => { setForm({ ...empty }); setClientSearch(""); setIsEditing(false); setOpen(true) }
  const openEdit = (s: SesionCliente) => { setForm({ ...s }); setClientSearch(s.Cliente || ""); setIsEditing(true); setOpen(true) }

  const getSesionUiKey = (s: SesionCliente, index: number) => {
    const id = String(s.SesionID ?? "").trim()
    const fecha = String(s.Fecha ?? "").trim()
    const cliente = String(s.Cliente ?? "").trim()
    return [id || "sinid", fecha || "sinfecha", cliente || "sincliente", index].join("-")
  }

  const handleSave = async () => {
    if (!form.Cliente.trim() || !form.EquipoID) { showToast("Cliente y equipo son obligatorios", "error"); return }
    const record: SesionCliente = { ...form, SesionID: String(form.SesionID || "").trim() || ("ses_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)) }
    if (isEditing) {
      setDbPulsos({ ...dbPulsos, sesionesCliente: dbPulsos.sesionesCliente.map(s => s.SesionID === record.SesionID ? record : s) })
    } else {
      setDbPulsos({ ...dbPulsos, sesionesCliente: [...dbPulsos.sesionesCliente, record] })
    }
    showToast(isEditing ? "Sesión actualizada" : "Sesión registrada", "success")
    setOpen(false)
    await syncApi({ action: isEditing ? "updateSesion" : "addSesion", data: JSON.stringify(record) })
  }

  const handleDelete = async (s: SesionCliente) => {
    if (!confirm("Eliminar sesión de " + s.Cliente + "?")) return
    setDbPulsos({ ...dbPulsos, sesionesCliente: dbPulsos.sesionesCliente.filter(x => x.SesionID !== s.SesionID) })
    showToast("Sesión eliminada", "success")
    await syncApi({ action: "deleteSesion", id: s.SesionID })
  }

  // Estado del wizard de importación: parsea → vista previa → confirma.
  // Mantenemos la lógica fuera del onChange para poder reusar el preview
  // dialog y dejar al usuario revisar antes de tocar la DB.
  const [importPreview, setImportPreview] = useState<null | {
    fileName: string
    parsed: ParseAgendaProResult
    rows: ParsedDisparoRow[]   // ya con dedupe marcada
  }>(null)
  const [importing, setImporting] = useState(false)

  // ─── Estado del modal de Vista previa: tabs, filtros, paginación ────────
  const [previewTab, setPreviewTab] = useState<"resumen" | "valid" | "duplicate" | "error" | "totales">("resumen")
  const [previewSearch, setPreviewSearch] = useState("")
  const [previewOpFilter, setPreviewOpFilter] = useState("todas")
  const [previewSucFilter, setPreviewSucFilter] = useState("todas")
  const [previewPageSize, setPreviewPageSize] = useState(50)
  const [previewPage, setPreviewPage] = useState(1)
  const [confirmStep, setConfirmStep] = useState(false)
  const [importResult, setImportResult] = useState<null | { inserted: number; dupOnDb: number; totalDisparos: number }>(null)

  // Reset al abrir un nuevo preview.
  useEffect(() => {
    if (importPreview) {
      setPreviewTab("resumen")
      setPreviewSearch("")
      setPreviewOpFilter("todas")
      setPreviewSucFilter("todas")
      setPreviewPage(1)
      setConfirmStep(false)
      setImportResult(null)
    }
  }, [importPreview])

  // Reset paginación cuando cambia el tab / filtros.
  useEffect(() => { setPreviewPage(1) }, [previewTab, previewSearch, previewOpFilter, previewSucFilter, previewPageSize])

  // ─── Stats agregados del preview ──────────────────────────────────────────
  const previewStats = useMemo(() => {
    if (!importPreview) return null
    const rows = importPreview.rows
    const valid = rows.filter((r) => r.status === "valid")
    const dupFile = rows.filter((r) => r.status === "duplicate_file")
    const alreadyImp = rows.filter((r) => r.status === "already_imported")
    // El tab "duplicate" muestra ambas categorías combinadas — el badge en
    // el filtrado distingue cuál es cuál.
    const duplicate = [...dupFile, ...alreadyImp]
    const error = rows.filter((r) => r.status === "error")
    const fechas = rows.map((r) => r.fecha).filter(Boolean).sort()
    const fechaMin = fechas[0] || ""
    const fechaMax = fechas[fechas.length - 1] || ""
    const totalDisparosValidos = valid.reduce((s, r) => s + r.disparos, 0)
    const operadoras = Array.from(new Set(rows.map((r) => r.operadora).filter(Boolean))).sort()
    const sucursales = Array.from(new Set(rows.map((r) => r.sucursal).filter(Boolean))).sort()
    const tratamientos = Array.from(new Set(rows.map((r) => r.tratamiento).filter(Boolean))).sort()
    return { rows, valid, duplicate, dupFile, alreadyImp, error, fechaMin, fechaMax, totalDisparosValidos, operadoras, sucursales, tratamientos }
  }, [importPreview])

  // Totales por dimensión (solo cuenta filas válidas — son las que se importan).
  const previewTotales = useMemo(() => {
    if (!previewStats) return null
    const agg = (key: (r: ParsedDisparoRow) => string) => {
      const m = new Map<string, { sesiones: number; disparos: number }>()
      for (const r of previewStats.valid) {
        const k = key(r) || "—"
        const cur = m.get(k) || { sesiones: 0, disparos: 0 }
        cur.sesiones += 1
        cur.disparos += r.disparos
        m.set(k, cur)
      }
      return Array.from(m.entries())
        .map(([nombre, v]) => ({ nombre, ...v }))
        .sort((a, b) => b.disparos - a.disparos)
    }
    return {
      porOperadora: agg((r) => r.operadora),
      porSucursal: agg((r) => r.sucursal),
      porTratamiento: agg((r) => r.tratamiento),
      porFecha: agg((r) => r.fecha),
    }
  }, [previewStats])

  // Filas filtradas según tab + filtros + búsqueda.
  const previewFilteredRows = useMemo(() => {
    if (!previewStats) return [] as ParsedDisparoRow[]
    const base = previewTab === "valid"
      ? previewStats.valid
      : previewTab === "duplicate"
        ? previewStats.duplicate
        : previewTab === "error"
          ? previewStats.error
          : previewStats.rows
    const needle = previewSearch.trim().toLowerCase()
    return base.filter((r) => {
      if (previewOpFilter !== "todas" && r.operadora !== previewOpFilter) return false
      if (previewSucFilter !== "todas" && r.sucursal !== previewSucFilter) return false
      if (needle) {
        const text = [r.cliente, r.contacto, r.tratamiento, r.operadora, r.sucursal].join(" ").toLowerCase()
        if (!text.includes(needle)) return false
      }
      return true
    })
  }, [previewStats, previewTab, previewSearch, previewOpFilter, previewSucFilter])

  const previewPageCount = Math.max(1, Math.ceil(previewFilteredRows.length / previewPageSize))
  const previewPageRows = useMemo(
    () => previewFilteredRows.slice((previewPage - 1) * previewPageSize, previewPage * previewPageSize),
    [previewFilteredRows, previewPage, previewPageSize],
  )

  // Descarga de errores como CSV.
  const downloadErrorsCsv = () => {
    if (!previewStats) return
    const headers = ["Fila", "Fecha", "Cliente", "Contacto", "Operadora", "Sucursal", "Tratamiento", "Disparos originales", "Error"]
    const rows = previewStats.error.map((r) => [
      r.filaOrigen, r.fecha, r.cliente, r.contacto, r.operadora, r.sucursal, r.tratamiento, r.disparosRaw, r.message || "",
    ])
    const escape = (v: unknown) => {
      const s = String(v ?? "")
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers.map(escape).join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const safe = (importPreview?.fileName || "import").replace(/\.[^/.]+$/, "")
    a.download = `errores-${safe}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    let XLSX: { read: (data: ArrayBuffer | string, opts: { type: string }) => unknown; utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] } }
    try {
      XLSX = await loadXLSX() as typeof XLSX
    } catch {
      showToast("No se pudo cargar la librería XLSX. Revisa tu conexión.", "error")
      e.target.value = ""
      return
    }

    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: "binary" }) as { SheetNames: string[]; Sheets: Record<string, unknown> }
        const parsed = await parseAgendaProWorkbook(wb, XLSX)
        if (!parsed.rows.length) {
          showToast(parsed.warnings[0] || "El archivo no contiene filas.", "error")
          return
        }
        // Marcamos duplicadas contra las sesiones ya cargadas en el store
        // (vienen de getAllPulsosData → ya filtradas por tenant). Hasta que
        // se apruebe el SQL de `import_hash`, este es el filtro principal.
        const withDedupe = markDuplicatesAgainstExisting(parsed.rows, dbPulsos.sesionesCliente)
        setImportPreview({ fileName: file.name, parsed, rows: withDedupe })
      } catch (err) {
        showToast("Error al leer el Excel: " + String(err instanceof Error ? err.message : err), "error")
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ""
  }

  const confirmImport = async () => {
    if (!importPreview) return
    const validRows = importPreview.rows.filter((r) => r.status === "valid")
    if (!validRows.length) {
      showToast("No hay filas válidas para importar.", "error")
      return
    }
    setImporting(true)
    try {
      const ts = Date.now()
      const nuevas: SesionCliente[] = validRows.map((r, idx) => {
        // Asignación equipo/cabina: si hay lectura semanal previa para
        // (semana, sucursal, operadora), usamos esa. Sino, el mapa hardcoded
        // OPERADORA_EQUIPO. Sino, el fallback genérico por sucursal.
        const assignment = findWeeklyAssignment(dbPulsos.lecturasSemanales, r.fecha, r.sucursal, r.operadora)
        const opInfo = OPERADORA_EQUIPO[r.operadora]
        const equipoId = assignment?.equipoId || opInfo?.equipoId || mapEquipo(r.sucursal)
        const cabina = assignment?.cabina || opInfo?.cabina || ""
        // Si la celda I traía coma (ej. "120,150"), guardamos el original en
        // Observaciones para auditoría humana. Sino, Observaciones queda
        // vacío — los campos ricos van en sus columnas dedicadas.
        const observaciones = r.disparosRaw && r.disparosRaw !== String(r.disparos)
          ? `Disparos Excel: ${r.disparosRaw}`
          : ""
        return {
          SesionID: "ses_" + ts + "_" + idx,
          Fecha: r.fecha,
          EquipoID: equipoId,
          Sucursal: r.sucursal,
          Cabina: cabina,
          OperadoraID: r.operadora,
          Cliente: r.cliente || "Sin cliente",
          AreaTrabajada: r.tratamiento.replace(/^depilaci[oó]n\s*-\s*/i, "").trim(),
          DisparosReportados: r.disparos,
          Duracion: undefined,
          Observaciones: observaciones,
          // Columnas agregadas por 009_pulse_import_richer.sql. El backend
          // las persiste en su columna real y usa ImportHash en el UNIQUE
          // parcial para rechazar duplicados.
          ContactoCliente: r.contacto || undefined,
          Tratamiento: r.tratamiento || undefined,
          Potencia: r.potencia || undefined,
          Spot: r.spot || undefined,
          ArchivoOrigen: importPreview.fileName,
          FilaOrigen: r.filaOrigen,
          ImportHash: r.hash || undefined,
        }
      })
      // Persistimos en serie para contar duplicados detectados por el DB
      // UNIQUE parcial (segunda línea de defensa, después del dedupe
      // in-memory). El handler devuelve `{ok:true, duplicate:true}` cuando
      // el hash ya existía — esa fila no se agrega al store local.
      let inserted = 0
      let dupOnDb = 0
      const insertedLocal: SesionCliente[] = []
      for (const sesion of nuevas) {
        const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveSesion", data: JSON.stringify(sesion) }) as { ok?: boolean; duplicate?: boolean }
        if (result?.duplicate) {
          dupOnDb += 1
        } else if (result?.ok) {
          inserted += 1
          insertedLocal.push(sesion)
        }
      }
      if (insertedLocal.length) {
        setDbPulsos({ ...dbPulsos, sesionesCliente: [...dbPulsos.sesionesCliente, ...insertedLocal] })
      }
      const totalDisparos = insertedLocal.reduce((s, x) => s + x.DisparosReportados, 0)
      const msg = dupOnDb > 0
        ? `${inserted} sesiones importadas (${totalDisparos.toLocaleString("es-DO")} disparos) · ${dupOnDb} omitidas por dedupe DB`
        : `${inserted} sesiones importadas (${totalDisparos.toLocaleString("es-DO")} disparos)`
      showToast(msg, "success")
      // Pasamos a la pantalla "Importación completada" dentro del mismo modal
      // en vez de cerrarlo. El usuario puede revisar el resultado, ver disparos
      // importados, o cerrar.
      setImportResult({ inserted, dupOnDb, totalDisparos })
      setConfirmStep(false)
      setShowImport(false)
    } catch (err) {
      showToast("Error guardando sesiones: " + String(err instanceof Error ? err.message : err), "error")
    } finally {
      setImporting(false)
    }
  }

  const filtered = useMemo(() => {
    const needle = filterText.trim().toLowerCase()
    return dbPulsos.sesionesCliente.filter(s => {
      if (filterDesde && s.Fecha < filterDesde) return false
      if (filterHasta && s.Fecha > filterHasta) return false
      if (filterSemana !== "todas" && weekStartIso(s.Fecha) !== filterSemana) return false
      if (filterOp !== "todas" && s.OperadoraID !== filterOp) return false
      if (filterSuc !== "todas" && s.Sucursal !== filterSuc) return false
      if (needle) {
        const haystack = [
          s.Cliente, s.ContactoCliente, s.Tratamiento, s.AreaTrabajada,
          s.ArchivoOrigen, s.OperadoraID, s.Sucursal,
        ].filter(Boolean).join(" ").toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [dbPulsos.sesionesCliente, filterDesde, filterHasta, filterSemana, filterOp, filterSuc, filterText])

  const resumenSemanal = useMemo(() => {
    const map = new Map<string, { Semana: string; Sucursal: string; Cabina: string; EquipoID: string; OperadoraID: string; DisparosReportados: number; Sesiones: number; Importadas: number; Manuales: number }>()
    filtered.forEach(s => {
      const semana = weekStartIso(s.Fecha)
      const operadora = s.OperadoraID || "Sin asignar"
      const key = `${semana}|${s.Sucursal || ""}|${normalizeCabina(s.Cabina)}|${s.EquipoID || ""}|${operadora}`
      const current = map.get(key) || {
        Semana: semana,
        Sucursal: s.Sucursal || "",
        Cabina: s.Cabina || "",
        EquipoID: s.EquipoID || "",
        OperadoraID: operadora,
        DisparosReportados: 0,
        Sesiones: 0,
        Importadas: 0,
        Manuales: 0,
      }
      current.DisparosReportados += Number(s.DisparosReportados) || 0
      current.Sesiones += 1
      // Sesión "Importada" si trae ArchivoOrigen o ImportHash; "Manual" sino.
      if (s.ArchivoOrigen || s.ImportHash) current.Importadas += 1
      else current.Manuales += 1
      map.set(key, current)
    })

    return Array.from(map.values()).sort((a, b) => {
      if (!sortCol) return b.Semana.localeCompare(a.Semana) || a.OperadoraID.localeCompare(b.OperadoraID)
      let va: string | number = ""
      let vb: string | number = ""
      switch(sortCol) {
        case "Fecha": va = a.Semana; vb = b.Semana; break
        case "Sucursal": va = a.Sucursal; vb = b.Sucursal; break
        case "Cabina": va = a.Cabina; vb = b.Cabina; break
        case "EquipoID": va = a.EquipoID; vb = b.EquipoID; break
        case "OperadoraID": va = a.OperadoraID; vb = b.OperadoraID; break
        case "DisparosReportados": va = a.DisparosReportados; vb = b.DisparosReportados; break
        case "Sesiones": va = a.Sesiones; vb = b.Sesiones; break
        default: return b.Semana.localeCompare(a.Semana) || a.OperadoraID.localeCompare(b.OperadoraID)
      }
      if (typeof va === "string") { va = va.toLowerCase(); vb = String(vb).toLowerCase() }
      if (va < vb) return sortDir === "asc" ? -1 : 1
      if (va > vb) return sortDir === "asc" ? 1 : -1
      return 0
    })
  }, [filtered, sortCol, sortDir])

  const totalDisparos = filtered.reduce((sum, s) => sum + (Number(s.DisparosReportados) || 0), 0)

  const resumenOp = useMemo(() => {
    const map: Record<string, number> = {}
    filtered.forEach(s => {
      const key = s.OperadoraID || "Sin asignar"
      map[key] = (map[key] || 0) + (Number(s.DisparosReportados) || 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [filtered])

  const sucursales = Array.from(new Set(dbPulsos.sesionesCliente.map(s => s.Sucursal)))
  const semanasDisponibles = Array.from(new Set(dbPulsos.sesionesCliente.map(s => weekStartIso(s.Fecha)).filter(Boolean))).sort((a, b) => b.localeCompare(a))
  const equiposDisponibles = Array.from(new Set([
    ...db.equipos.filter(e => e.Estado !== "Inactivo").map(e => e.EquipoID),
    ...dbPulsos.lecturasSemanales.map(l => l.EquipoID),
    "133",
    "158",
    "VO-01",
  ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))

  const resolveAssignment = (fecha: string, sucursal: string, operadora: string) => (
    findWeeklyAssignment(dbPulsos.lecturasSemanales, fecha, sucursal, operadora) || getEquipoByOp(operadora)
  )

  // Sesiones individuales del grupo activo en el modal de detalle. Filtran
  // por la misma llave que arma `resumenSemanal` (semana+sucursal+cabina+
  // equipo+operadora). Mantengo el filtro de texto activo para que el
  // modal respete la búsqueda del toolbar.
  const detailSesiones = useMemo(() => {
    if (!detailGroup) return []
    const targetCabina = normalizeCabina(detailGroup.cabina)
    return filtered
      .filter(s => weekStartIso(s.Fecha) === detailGroup.semana
        && (s.Sucursal || "") === detailGroup.sucursal
        && normalizeCabina(s.Cabina) === targetCabina
        && (s.EquipoID || "") === detailGroup.equipoId
        && (s.OperadoraID || "Sin asignar") === detailGroup.operadoraId)
      .sort((a, b) => String(a.Fecha).localeCompare(String(b.Fecha)))
  }, [filtered, detailGroup])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Disparos operadoras</h2>
          <p className="text-sm text-muted-foreground">Disparos registrados por operadora en cada atención</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4 mr-2" />Importar Excel
          </Button>
          <Button onClick={openNew} size="sm">
            <Plus className="h-4 w-4 mr-2" />Nueva Sesión
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Desde:</Label>
          <div className="relative">
            <input
              type="date"
              value={filterDesde}
              onChange={e => setFilterDesde(e.target.value)}
              className="w-44 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm cursor-pointer appearance-none"
              style={{ colorScheme: "dark" }}
            />
            {filterDesde && (
              <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                {new Date(filterDesde + "T12:00:00").toLocaleDateString("es-DO", { day:"2-digit", month:"short" })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Hasta:</Label>
          <div className="relative">
            <input
              type="date"
              value={filterHasta}
              onChange={e => setFilterHasta(e.target.value)}
              className="w-44 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm cursor-pointer appearance-none"
              style={{ colorScheme: "dark" }}
            />
            {filterHasta && (
              <span className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                {new Date(filterHasta + "T12:00:00").toLocaleDateString("es-DO", { day:"2-digit", month:"short" })}
              </span>
            )}
          </div>
        </div>
        {/* Accesos rápidos de semana */}
        <div className="flex gap-1">
          {[
            { label: "Esta semana", days: 6 },
            { label: "Últimos 7d", days: 7 },
            { label: "Últimos 14d", days: 14 },
            { label: "Este mes", days: 30 },
          ].map(({ label, days }) => (
            <button
              key={label}
              onClick={() => {
                const hoy = new Date()
                const desde = new Date(hoy)
                desde.setDate(hoy.getDate() - days)
                setFilterDesde(desde.toISOString().split("T")[0])
                setFilterHasta(hoy.toISOString().split("T")[0])
              }}
              className="text-xs px-2 py-1 rounded-md border border-border hover:border-primary hover:text-primary transition-colors text-muted-foreground"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Semana:</Label>
          <Select value={filterSemana} onValueChange={setFilterSemana}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las semanas</SelectItem>
              {semanasDisponibles.map(s => <SelectItem key={s} value={s}>{fmtSemana(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Operadora:</Label>
          <Select value={filterOp} onValueChange={setFilterOp}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {dbPulsos.operadoras.map(o => <SelectItem key={o.OperadoraID} value={o.OperadoraID}>{o.Nombre}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sucursal:</Label>
          <Select value={filterSuc} onValueChange={setFilterSuc}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Buscar:</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Cliente, contacto, tratamiento, archivo..."
              className="h-9 w-64 pl-8 text-sm"
            />
          </div>
        </div>
        {(filterDesde || filterHasta || filterSemana !== "todas" || filterOp !== "todas" || filterSuc !== "todas" || filterText) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterDesde(""); setFilterHasta(""); setFilterSemana("todas"); setFilterOp("todas"); setFilterSuc("todas"); setFilterText("") }}>
            Limpiar
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">
          {resumenSemanal.length} resumenes - {filtered.length} sesiones - <span className="font-bold text-foreground">{totalDisparos.toLocaleString()} disparos</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Tabla principal */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Fecha")}>Semana{sortIcon("Fecha")}</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Sucursal")}>Sucursal{sortIcon("Sucursal")}</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Cabina")}>Cabina{sortIcon("Cabina")}</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("EquipoID")}>Equipo{sortIcon("EquipoID")}</TableHead>
                    <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("OperadoraID")}>Operadora{sortIcon("OperadoraID")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Sesiones")}>Sesiones{sortIcon("Sesiones")}</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("DisparosReportados")}>Cantidad de disparos{sortIcon("DisparosReportados")}</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumenSemanal.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-12">
                        Sin sesiones. Importa el Excel de AgendaPro o registra manualmente.
                      </TableCell>
                    </TableRow>
                  ) : resumenSemanal.map((row, i) => (
                    <TableRow key={`${row.Semana}-${row.Sucursal}-${row.Cabina}-${row.EquipoID}-${row.OperadoraID}`}>
                      <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                      <TableCell className="font-medium text-sm">{fmtSemana(row.Semana)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.Sucursal || "-"}</TableCell>
                      <TableCell className="text-sm">{row.Cabina || "-"}</TableCell>
                      <TableCell className="font-mono text-sm">{row.EquipoID || "-"}</TableCell>
                      <TableCell className="text-sm font-semibold">{row.OperadoraID}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{row.Sesiones.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{row.DisparosReportados.toLocaleString()}</TableCell>
                      <TableCell>
                        {/* Mezcla en el grupo: mostramos ambos badges con
                            sus conteos. Si solo hay uno, sale uno solo. */}
                        <div className="flex flex-wrap gap-1">
                          {row.Importadas > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700">
                              <Upload className="h-2.5 w-2.5" />
                              Importado {row.Manuales > 0 ? `· ${row.Importadas}` : ""}
                            </span>
                          ) : null}
                          {row.Manuales > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                              Manual {row.Importadas > 0 ? `· ${row.Manuales}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => setDetailGroup({
                            semana: row.Semana,
                            sucursal: row.Sucursal,
                            cabina: row.Cabina,
                            equipoId: row.EquipoID,
                            operadoraId: row.OperadoraID,
                          })}
                        >
                          Ver detalle <ChevronRight className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Resumen por operadora */}
        <div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Disparos por operadora</CardTitle></CardHeader>
            <CardContent className="p-0">
              {resumenOp.length === 0 ? (
                <p className="text-center text-muted-foreground py-6 text-sm">Sin datos</p>
              ) : (
                <div className="divide-y divide-border">
                  {resumenOp.map(([id, total]) => {
                    const pct = totalDisparos > 0 ? Math.round((total / totalDisparos) * 100) : 0
                    return (
                      <div key={id} className="px-4 py-2.5">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium">{id}</span>
                          <span className="font-mono text-sm font-bold">{total.toLocaleString()}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: pct + "%" }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{pct}% del total</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Form Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isEditing ? "Editar Sesión" : "Nueva Sesión / Atención"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Fecha *</Label>
              <Input type="date" value={form.Fecha} onChange={e => {
                const fecha = e.target.value
                const assignment = resolveAssignment(fecha, form.Sucursal, form.OperadoraID)
                setForm({ ...form, Fecha: fecha, EquipoID: assignment.equipoId || form.EquipoID, Cabina: assignment.cabina || form.Cabina })
              }} />
            </div>
            <div className="space-y-1.5">
              <Label>Equipo *</Label>
              <Select value={form.EquipoID} onValueChange={v => setForm({ ...form, EquipoID: v })}>
                <SelectTrigger><SelectValue placeholder="Equipo" /></SelectTrigger>
                <SelectContent>
                  {equiposDisponibles.map(equipo => (
                    <SelectItem key={equipo} value={equipo}>{equipo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal</Label>
              <Select value={form.Sucursal} onValueChange={v => {
                const assignment = resolveAssignment(form.Fecha, v, form.OperadoraID)
                setForm({ ...form, Sucursal: v, EquipoID: assignment.equipoId || form.EquipoID, Cabina: assignment.cabina || form.Cabina })
              }}>
                <SelectTrigger><SelectValue placeholder="Sucursal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                  <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                  <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                  <SelectItem value="La Vega">La Vega</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Operadora</Label>
              <Select value={form.OperadoraID} onValueChange={v => {
                const assignment = resolveAssignment(form.Fecha, form.Sucursal, v)
                setForm({ ...form, OperadoraID: v, EquipoID: assignment.equipoId || form.EquipoID, Cabina: assignment.cabina || form.Cabina })
              }}>
                <SelectTrigger><SelectValue placeholder="Operadora" /></SelectTrigger>
                <SelectContent>
                  {dbPulsos.operadoras.filter(o => o.Estado === "Activa").map(o => (
                    <SelectItem key={o.OperadoraID} value={o.OperadoraID}>{o.Nombre}</SelectItem>
                  ))}
                  {dbPulsos.operadoras.length === 0 && (
                    <>
                      <SelectItem value="Diana">Diana</SelectItem>
                      <SelectItem value="Eidylee">Eidylee</SelectItem>
                      <SelectItem value="Emely">Emely</SelectItem>
                      <SelectItem value="Katherine">Katherine</SelectItem>
                      <SelectItem value="Lilian">Lilian</SelectItem>
                      <SelectItem value="Madelin">Madelin</SelectItem>
                      <SelectItem value="NAYELI">NAYELI</SelectItem>
                      <SelectItem value="Rosa">Rosa</SelectItem>
                      <SelectItem value="YAMILKA">YAMILKA</SelectItem>
                      <SelectItem value="Yessica">Yessica</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Buscar cliente registrado</Label>
              <div className="relative" ref={clientePickerRef}>
                <Input
                  value={clientSearch}
                  onChange={e => {
                    setClientSearch(e.target.value)
                    setClienteDropdownOpen(true)
                  }}
                  onFocus={() => setClienteDropdownOpen(true)}
                  placeholder="Buscar por nombre, teléfono o documento..."
                />
                {clienteDropdownOpen && clientSearch.trim() ? (
                  <div className="absolute left-0 right-0 top-10 z-30 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                    {matchedClientes.length ? matchedClientes.map((cliente) => (
                      <button
                        key={cliente.ClienteID}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectCliente(cliente)}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none"
                      >
                        <span className="font-semibold">{clienteNombre(cliente)}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{cliente.Telefono || "Sin teléfono"}</span>
                        <span className="block text-xs text-muted-foreground">{cliente.Sucursal || "Sin sucursal"} · {cliente.DocumentoIdentidad || cliente.Email || "Sin documento"}</span>
                      </button>
                    )) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No se encontró en Clientes</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Cliente *</Label>
              <Input value={form.Cliente} onChange={e => setForm({ ...form, Cliente: e.target.value })} placeholder="Nombre completo" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Área trabajada</Label>
              <Select value={form.AreaTrabajada} onValueChange={v => setForm({ ...form, AreaTrabajada: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar área" /></SelectTrigger>
                <SelectContent>
                  {AREAS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Disparos reportados *</Label>
              <Input type="number" value={form.DisparosReportados}
                onChange={e => setForm({ ...form, DisparosReportados: Number(e.target.value) })} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label>Cabina</Label>
              <Input value={form.Cabina} onChange={e => setForm({ ...form, Cabina: e.target.value })} placeholder="Ej: Cabina 1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button onClick={handleSave}><Save className="h-4 w-4 mr-2" />Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Importar Excel de AgendaPro</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-sm font-semibold mb-1">Selecciona el Excel de AgendaPro</p>
              <p className="text-xs text-muted-foreground mb-4">Formato: Detalle Disparos tratamientos (.xlsx)</p>
              <label className="cursor-pointer">
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
                <span className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:bg-primary/90 transition-colors cursor-pointer">
                  <Upload className="h-4 w-4" /> Subir archivo Excel
                </span>
              </label>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Mapeo automático de sucursales:</p>
              <p>• Plaza Mediterránea → Rafael Vidal / Equipo 133</p>
              <p>• Los Jardines → Los Jardines / Equipo 158</p>
              <p>• Villa Olga → Villa Olga / Equipo VO-01</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImport(false)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle del grupo del resumen — sesiones individuales con todos
          los campos ricos importados del Excel AgendaPro. */}
      <Dialog open={!!detailGroup} onOpenChange={(open) => { if (!open) setDetailGroup(null) }}>
        <DialogContent className="w-[94vw] max-w-[1100px] max-h-[88vh] overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Detalle de sesiones
            </DialogTitle>
          </DialogHeader>
          {detailGroup ? (
            <div className="space-y-3 py-2">
              <div className="rounded-xl border bg-slate-50/60 p-3 text-xs text-slate-700">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 md:grid-cols-3">
                  <span><b>Semana:</b> {fmtSemana(detailGroup.semana)}</span>
                  <span><b>Sucursal:</b> {detailGroup.sucursal || "—"}</span>
                  <span><b>Cabina:</b> {detailGroup.cabina || "—"}</span>
                  <span><b>Equipo:</b> {detailGroup.equipoId || "—"}</span>
                  <span><b>Operadora:</b> {detailGroup.operadoraId}</span>
                  <span><b>Sesiones:</b> {detailSesiones.length} ({detailSesiones.reduce((s, x) => s + (Number(x.DisparosReportados) || 0), 0).toLocaleString("es-DO")} disparos)</span>
                </div>
              </div>
              <div className="rounded-xl border overflow-hidden">
                <div className="max-h-[55vh] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Origen</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Contacto</TableHead>
                        <TableHead>Tratamiento</TableHead>
                        <TableHead className="text-right">Potencia</TableHead>
                        <TableHead className="text-right">Spot</TableHead>
                        <TableHead className="text-right">Disparos</TableHead>
                        <TableHead>Archivo · fila</TableHead>
                        <TableHead className="text-right">ID import</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailSesiones.map((s) => {
                        const importado = Boolean(s.ArchivoOrigen || s.ImportHash)
                        return (
                          <TableRow key={s.SesionID}>
                            <TableCell>
                              {importado ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700">
                                  <Upload className="h-2.5 w-2.5" /> Importado
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
                                  Manual
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{s.Fecha || "—"}</TableCell>
                            <TableCell className="text-xs font-semibold">{s.Cliente || "—"}</TableCell>
                            <TableCell className="text-xs">{s.ContactoCliente || "—"}</TableCell>
                            <TableCell className="text-xs">{s.Tratamiento || s.AreaTrabajada || "—"}</TableCell>
                            <TableCell className="text-right text-xs">{s.Potencia || "—"}</TableCell>
                            <TableCell className="text-right text-xs">{s.Spot || "—"}</TableCell>
                            <TableCell className="text-right font-mono text-xs font-bold">{(Number(s.DisparosReportados) || 0).toLocaleString("es-DO")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {s.ArchivoOrigen
                                ? <span title={s.ArchivoOrigen}>{s.ArchivoOrigen.length > 22 ? `…${s.ArchivoOrigen.slice(-22)}` : s.ArchivoOrigen}{s.FilaOrigen ? ` · ${s.FilaOrigen}` : ""}</span>
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-[10px] text-muted-foreground" title={s.ImportHash || ""}>
                              {s.ImportHash ? s.ImportHash.slice(0, 10) : "—"}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                      {detailSesiones.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                            Sin sesiones individuales para este grupo (puede deberse a un filtro activo).
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailGroup(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vista previa del import — modal ampliado con tabs, filtros,
          paginación y totales. El flujo es:
            (1) Parseo del Excel → setImportPreview()
            (2) Usuario revisa por tabs (Resumen / Válidas / Duplicadas /
                Errores / Totales) y filtra
            (3) Click "Importar válidas" → confirmStep=true → confirma
            (4) confirmImport() persiste sesiones, setea importResult
            (5) Pantalla final "Importación completada" con botones cerrar
                o ver disparos. */}
      <Dialog open={!!importPreview} onOpenChange={(open) => { if (!open) setImportPreview(null) }}>
        <DialogContent className="w-[94vw] max-w-[1200px] max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              {importResult ? "Importación completada" : "Vista previa de importación AgendaPro"}
            </DialogTitle>
          </DialogHeader>

          {/* PANTALLA FINAL — post-import */}
          {importResult && importPreview && previewStats ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-6 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
                <p className="text-sm text-emerald-900">Las sesiones se importaron correctamente.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <PreviewStat label="Leídas" value={importPreview.rows.length} />
                <PreviewStat label="Importadas" value={importResult.inserted} tone="ok" />
                <PreviewStat label="Duplicadas omitidas" value={previewStats.duplicate.length + importResult.dupOnDb} tone="warn" />
                <PreviewStat label="Con error" value={previewStats.error.length} tone="error" />
                <PreviewStat label="Disparos importados" value={importResult.totalDisparos} tone="ok" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setImportPreview(null)}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : null}

          {/* PASO DE CONFIRMACIÓN */}
          {!importResult && confirmStep && previewStats ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5">
                <h3 className="text-base font-bold text-amber-900">Confirmar importación</h3>
                <p className="mt-2 text-sm text-amber-900/80">
                  Se importarán <b>{previewStats.valid.length.toLocaleString("es-DO")}</b> filas válidas
                  ({previewStats.totalDisparosValidos.toLocaleString("es-DO")} disparos).
                  {previewStats.duplicate.length > 0 ? <> Se omitirán <b>{previewStats.duplicate.length.toLocaleString("es-DO")}</b> duplicadas.</> : null}
                  {previewStats.error.length > 0 ? <> Se omitirán <b>{previewStats.error.length.toLocaleString("es-DO")}</b> con error.</> : null}
                </p>
                <p className="mt-2 text-xs text-amber-900/70">¿Deseas continuar?</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmStep(false)} disabled={importing}>Volver</Button>
                <Button onClick={confirmImport} disabled={importing} className="gap-2">
                  {importing ? <Save className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {importing ? "Guardando..." : `Sí, importar ${previewStats.valid.length.toLocaleString("es-DO")} filas`}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {/* PREVIEW NORMAL */}
          {!importResult && !confirmStep && importPreview && previewStats && previewTotales ? (
            <div className="space-y-4 py-2">
              <p className="text-xs text-muted-foreground">Revisa los datos antes de confirmar la importación.</p>

              {/* Información del archivo */}
              <div className="rounded-xl border bg-slate-50/60 p-3 text-xs text-slate-700">
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 md:grid-cols-4">
                  <span><b>Archivo:</b> {importPreview.fileName}</span>
                  <span><b>Hoja:</b> {importPreview.parsed.sheet}</span>
                  <span><b>Header fila:</b> {importPreview.parsed.headerRow}</span>
                  {importPreview.parsed.fileDateRange ? <span><b>Reporte:</b> {importPreview.parsed.fileDateRange}</span> : null}
                </div>
              </div>

              {/* KPIs principales — 6 cards + rango fechas */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <PreviewStat label="Leídas" value={previewStats.rows.length} />
                <PreviewStat label="Válidas" value={previewStats.valid.length} tone="ok" />
                <PreviewStat label="Ya importadas" value={previewStats.alreadyImp.length} tone="info" />
                <PreviewStat label="Dup. archivo" value={previewStats.dupFile.length} tone="warn" />
                <PreviewStat label="Con error" value={previewStats.error.length} tone="error" />
                <PreviewStat label="Total disparos" value={previewStats.totalDisparosValidos} tone="ok" />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-700">Rango fechas</div>
                <div className="mt-1 font-mono text-xs font-bold tracking-tight">
                  {previewStats.fechaMin || "—"}{previewStats.fechaMin && previewStats.fechaMax ? "  →  " : ""}{previewStats.fechaMax || "—"}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
                {[
                  { id: "resumen", label: "Resumen" },
                  { id: "valid", label: `Válidas (${previewStats.valid.length})` },
                  { id: "duplicate", label: `Duplicadas (${previewStats.duplicate.length}${previewStats.alreadyImp.length > 0 || previewStats.dupFile.length > 0 ? ` · ${previewStats.alreadyImp.length} ya · ${previewStats.dupFile.length} arch.` : ""})` },
                  { id: "error", label: `Errores (${previewStats.error.length})` },
                  { id: "totales", label: "Totales" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPreviewTab(t.id as typeof previewTab)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      previewTab === t.id
                        ? "bg-white text-foreground shadow-sm ring-1 ring-slate-200"
                        : "text-slate-500 hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* TAB RESUMEN */}
              {previewTab === "resumen" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <DetectionList title="Operadoras detectadas" items={previewStats.operadoras} />
                  <DetectionList title="Sucursales detectadas" items={previewStats.sucursales} />
                  <DetectionList title="Tratamientos detectados" items={previewStats.tratamientos} className="md:col-span-2" />
                </div>
              ) : null}

              {/* TABS VALID / DUPLICATE / ERROR — tabla filtrable */}
              {previewTab !== "resumen" && previewTab !== "totales" ? (
                <>
                  {/* Filtros */}
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                    <Input
                      placeholder="Buscar cliente / contacto / tratamiento..."
                      value={previewSearch}
                      onChange={(e) => setPreviewSearch(e.target.value)}
                      className="h-9 text-xs"
                    />
                    <Select value={previewOpFilter} onValueChange={setPreviewOpFilter}>
                      <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="Operadora" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas operadoras</SelectItem>
                        {previewStats.operadoras.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={previewSucFilter} onValueChange={setPreviewSucFilter}>
                      <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todas">Todas sucursales</SelectItem>
                        {previewStats.sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(previewPageSize)} onValueChange={(v) => setPreviewPageSize(Number(v))}>
                      <SelectTrigger className="h-9 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="50">50 / pág</SelectItem>
                        <SelectItem value="100">100 / pág</SelectItem>
                        <SelectItem value="250">250 / pág</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Botón descargar errores */}
                  {previewTab === "error" && previewStats.error.length > 0 ? (
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={downloadErrorsCsv} className="gap-1">
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Descargar errores CSV
                      </Button>
                    </div>
                  ) : null}

                  {/* Tabla */}
                  <div className="rounded-xl border overflow-hidden">
                    <div className="max-h-[44vh] overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {previewTab === "error" ? (
                              <>
                                <TableHead>Fila</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Operadora</TableHead>
                                <TableHead>Sucursal</TableHead>
                                <TableHead>Tratamiento</TableHead>
                                <TableHead className="text-right">Disp. orig.</TableHead>
                                <TableHead>Error</TableHead>
                              </>
                            ) : previewTab === "duplicate" ? (
                              <>
                                <TableHead>Fila</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Operadora</TableHead>
                                <TableHead>Sucursal</TableHead>
                                <TableHead>Tratamiento</TableHead>
                                <TableHead className="text-right">Disparos</TableHead>
                                <TableHead>Motivo</TableHead>
                              </>
                            ) : (
                              <>
                                <TableHead>Fila</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Contacto</TableHead>
                                <TableHead>Operadora</TableHead>
                                <TableHead>Sucursal</TableHead>
                                <TableHead>Tratamiento</TableHead>
                                <TableHead className="text-right">Pot.</TableHead>
                                <TableHead className="text-right">Spot</TableHead>
                                <TableHead className="text-right">Disp. orig.</TableHead>
                                <TableHead className="text-right">Disp. calc.</TableHead>
                              </>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewPageRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={previewTab === "valid" ? 11 : 8} className="py-10 text-center text-xs text-muted-foreground">
                                Sin filas en esta categoría con los filtros actuales.
                              </TableCell>
                            </TableRow>
                          ) : previewPageRows.map((r) => (
                            <TableRow key={`${r.filaOrigen}-${previewTab}`}>
                              {previewTab === "valid" ? (
                                <>
                                  <TableCell className="text-[10px] text-muted-foreground">{r.filaOrigen}</TableCell>
                                  <TableCell className="text-xs">{r.fecha || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.cliente || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.contacto || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.operadora || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.sucursal || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.tratamiento || "—"}</TableCell>
                                  <TableCell className="text-right text-xs">{r.potencia || "—"}</TableCell>
                                  <TableCell className="text-right text-xs">{r.spot || "—"}</TableCell>
                                  <TableCell className="text-right text-xs font-mono">{r.disparosRaw}</TableCell>
                                  <TableCell className="text-right text-xs font-bold">{r.disparos.toLocaleString("es-DO")}</TableCell>
                                </>
                              ) : previewTab === "duplicate" ? (
                                <>
                                  <TableCell className="text-[10px] text-muted-foreground">{r.filaOrigen}</TableCell>
                                  <TableCell className="text-xs">{r.fecha || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.cliente || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.operadora || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.sucursal || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.tratamiento || "—"}</TableCell>
                                  <TableCell className="text-right text-xs font-mono">{r.disparos.toLocaleString("es-DO")}</TableCell>
                                  <TableCell className="text-xs text-amber-800">{r.message || "Duplicada"}</TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell className="text-[10px] text-muted-foreground">{r.filaOrigen}</TableCell>
                                  <TableCell className="text-xs">{r.fecha || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.cliente || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.operadora || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.sucursal || "—"}</TableCell>
                                  <TableCell className="text-xs">{r.tratamiento || "—"}</TableCell>
                                  <TableCell className="text-right text-xs font-mono">{r.disparosRaw || "—"}</TableCell>
                                  <TableCell className="text-xs text-rose-700">{r.message || "Error"}</TableCell>
                                </>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {/* Footer tabla — paginación */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50/60 px-3 py-2 text-xs text-muted-foreground">
                      <span>
                        Mostrando <b>{previewPageRows.length}</b> de <b>{previewFilteredRows.length}</b> filas
                        {previewFilteredRows.length !== previewStats.rows.length ? ` (filtradas de ${previewStats.rows.length})` : ""}
                      </span>
                      {previewPageCount > 1 ? (
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" disabled={previewPage <= 1} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))} className="h-7 px-2 text-xs">‹ Atrás</Button>
                          <span className="px-2 font-bold">{previewPage} / {previewPageCount}</span>
                          <Button variant="outline" size="sm" disabled={previewPage >= previewPageCount} onClick={() => setPreviewPage((p) => Math.min(previewPageCount, p + 1))} className="h-7 px-2 text-xs">Siguiente ›</Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {/* TAB TOTALES */}
              {previewTab === "totales" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <TotalesTable title="Total por operadora" rows={previewTotales.porOperadora} />
                  <TotalesTable title="Total por sucursal" rows={previewTotales.porSucursal} />
                  <TotalesTable title="Total por tratamiento (top 15)" rows={previewTotales.porTratamiento.slice(0, 15)} />
                  <TotalesTable title="Total por fecha" rows={previewTotales.porFecha} />
                </div>
              ) : null}

              {/* Warnings del parser */}
              {importPreview.parsed.warnings.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {importPreview.parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={() => setImportPreview(null)} disabled={importing}>Cancelar</Button>
                {previewStats.error.length > 0 ? (
                  <Button variant="outline" onClick={downloadErrorsCsv} className="gap-1">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Descargar errores
                  </Button>
                ) : null}
                <Button
                  onClick={() => {
                    // Pasamos a confirmación si hay duplicadas/errores significativos,
                    // o directo a confirmImport si todo limpio.
                    if (previewStats.duplicate.length > 0 || previewStats.error.length > 0) {
                      setConfirmStep(true)
                    } else {
                      confirmImport()
                    }
                  }}
                  disabled={importing || previewStats.valid.length === 0}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {previewStats.valid.length === 0
                    ? "No hay filas válidas para importar"
                    : `Importar ${previewStats.valid.length.toLocaleString("es-DO")} filas válidas`}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DetectionList({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${className || ""}`}>
      <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : items.map((item) => (
          <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function TotalesTable({ title, rows }: { title: string; rows: Array<{ nombre: string; sesiones: number; disparos: number }> }) {
  const totalDisparos = rows.reduce((s, r) => s + r.disparos, 0)
  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="border-b bg-slate-50/60 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="max-h-[44vh] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Sesiones</TableHead>
              <TableHead className="text-right">Disparos</TableHead>
              <TableHead className="text-right">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">Sin datos</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.nombre}>
                <TableCell className="text-xs font-semibold">{r.nombre}</TableCell>
                <TableCell className="text-right text-xs font-mono">{r.sesiones.toLocaleString("es-DO")}</TableCell>
                <TableCell className="text-right text-xs font-mono font-bold">{r.disparos.toLocaleString("es-DO")}</TableCell>
                <TableCell className="text-right text-[10px] text-muted-foreground">{totalDisparos > 0 ? ((r.disparos / totalDisparos) * 100).toFixed(1) : "—"}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function PreviewStat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "error" | "info" }) {
  const cls = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : tone === "info"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-slate-200 bg-white text-slate-800"
  return (
    <div className={`rounded-xl border p-3 text-center ${cls}`}>
      <div className="font-heading text-xl font-black tracking-tight">{value.toLocaleString("es-DO")}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em]">{label}</div>
    </div>
  )
}
