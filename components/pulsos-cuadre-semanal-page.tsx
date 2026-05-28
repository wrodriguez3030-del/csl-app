"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight,
  Download, FileSpreadsheet, Filter, Loader2, RotateCcw, Save, Upload, X,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { loadXLSX } from "@/lib/load-xlsx"
import {
  markDuplicatesAgainstExisting,
  parseAgendaProWorkbook,
  type ParsedDisparoRow,
  type ParseAgendaProResult,
} from "@/lib/agendapro-parser"
import {
  addDays, calcDesviacion, fmtFechaLocal, lunesDeSemana, type AlertaNivel,
} from "@/lib/pulse-audit"
import { printCuadre, type CuadreEquipoRow, type CuadreSnapshot } from "@/lib/pulse-cuadre-pdf"
import { exportCuadreXlsx } from "@/lib/pulse-cuadre-xlsx"
import {
  parseLecturasWorkbook,
  type ParsedLecturaRow,
  type ParseLecturasResult,
} from "@/lib/pulsos-lecturas-parser"
import type { SesionCliente, AuditoriaSemanal } from "@/lib/types"

// ─── Tipos locales del wizard ────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5

interface ExcelImportInfo {
  filename: string
  parsed: ParseAgendaProResult
  /** TODAS las filas del archivo (con status valid/duplicate/error) — usadas
   *  para mostrar contadores reales y rango de fechas detectado. */
  rowsAll: ParsedDisparoRow[]
  /** Subset filtrado por la semana seleccionada + sucursal. Cuando el
   *  usuario activa "procesar todo el Excel", apuntan al mismo rowsAll. */
  rows: ParsedDisparoRow[]
  /** Rango real del archivo. */
  fechaMinArchivo: string
  fechaMaxArchivo: string
  /** true = el usuario ignoró el filtro de semana para este archivo. */
  procesarTodo: boolean
  totalDisparos: number          // de rows (filtrado actual)
  imported: number               // se popula al confirmar
  duplicatesDb: number
}

/** Una fila del Excel de lecturas YA enriquecida con datos calculados. */
interface LecturaCuadreEntry extends ParsedLecturaRow {
  /** rowId estable para tracking del row en React lists. */
  rowId: string
  /** Lectura inicial buscada en lecturas semanales previas (puede ser null). */
  lecturaInicialAuto: number | null
  /** Override manual del usuario sobre cualquier campo. */
  override: Partial<{
    equipo: string
    sucursal: string
    cabina: string
    operador: string
    lecturaFinal: number
    lecturaInicial: number
    observaciones: string
  }>
}

/** Snapshot in-memory del Excel de lecturas cargado por el usuario. */
interface LecturasImportInfo {
  filename: string
  parsed: ParseLecturasResult
  rows: LecturaCuadreEntry[]
}

interface EquipoCuadre extends CuadreEquipoRow {
  // Sufijo único para tracking del row.
  rowId: string
  /** Bloqueo activo: razón por la cual la fila NO debe contar como crítica
   *  hasta que el usuario confirme manualmente. undefined = sin bloqueo. */
  bloqueo?: "sin_lectura_anterior" | "sin_agendapro" | "semana_no_coincide"
  /** Cuando el usuario hace clic en "Calcular sin lectura previa" o similar,
   *  marcamos true para permitir guardado. */
  bloqueoConfirmado?: boolean
}

// ─── Helpers locales ─────────────────────────────────────────────────────────

const ALERT_CLS: Record<AlertaNivel, string> = {
  OK: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Advertencia: "border-amber-200 bg-amber-50 text-amber-700",
  Critico: "border-rose-200 bg-rose-50 text-rose-700",
}

function newRowId() { return `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

/** Intenta detectar la semana cubierta por el header de la columna de
 *  lecturas (ej. "Pulsos 18–23 Mayo" → "2026-05-18"). Devuelve el lunes
 *  ISO si lo logra, "" si no. */
function detectarSemanaDeHeader(header: string, baseYear: number): string {
  if (!header) return ""
  const meses: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
  }
  const low = header.toLowerCase()
  // Match "18-23 Mayo" / "18 - 23 mayo" / "18–23 Mayo".
  const m = low.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([a-zñ]+)/i)
  if (!m) return ""
  const dia = parseInt(m[1], 10)
  const mes = meses[m[3]]
  if (!mes || !dia) return ""
  const iso = `${baseYear}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
  // Devolvemos el lunes de esa semana.
  return lunesDeSemana(iso)
}

// ─── Componente principal ───────────────────────────────────────────────────

export function PulsosCuadreSemanalPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const business = useCurrentBusiness()

  // ── Estado del wizard ─────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>(1)
  const today = new Date().toISOString().slice(0, 10)
  // weekStart arranca VACÍO — la semana se detecta automáticamente del Excel
  // AgendaPro en el Paso 2. El usuario nunca elige fechas manualmente.
  const [weekStart, setWeekStart] = useState<string>("")
  const [weekEnd, setWeekEnd] = useState<string>("")
  const [sucursalFiltro, setSucursalFiltro] = useState<string>("Todas")
  const [excelImports, setExcelImports] = useState<ExcelImportInfo[]>([])
  const [lecturasImport, setLecturasImport] = useState<LecturasImportInfo | null>(null)
  const [parsingExcel, setParsingExcel] = useState(false)
  const [parsingLecturas, setParsingLecturas] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [equiposEditados, setEquiposEditados] = useState<Record<string, Partial<EquipoCuadre>>>({})
  const [snapshotFinal, setSnapshotFinal] = useState<{ snapshot: CuadreSnapshot; sesiones: SesionCliente[] } | null>(null)

  const excelInputRef = useRef<HTMLInputElement>(null)
  const lecturasInputRef = useRef<HTMLInputElement>(null)

  // Sucursales disponibles (deriva del store + presets DR).
  const sucursalesOptions = useMemo(() => {
    const set = new Set<string>()
    db.equipos.forEach((e) => { if (e.Sucursal) set.add(e.Sucursal) })
    db.reportes.forEach((r) => { if (r.Sucursal) set.add(r.Sucursal) })
    dbPulsos.lecturasSemanales.forEach((l) => { if (l.Sucursal) set.add(l.Sucursal) })
    return ["Todas", ...Array.from(set).sort((a, b) => a.localeCompare(b, "es"))]
  }, [db.equipos, db.reportes, dbPulsos.lecturasSemanales])

  // Cuando cambia weekStart, el end se auto-ajusta a lunes+5 (sábado).
  useEffect(() => {
    if (weekStart) setWeekEnd(addDays(weekStart, 5))
  }, [weekStart])

  // Recalcular `rows` y `totalDisparos` de cada excelImport cuando cambia
  // la semana o sucursal — mantiene los excels ya cargados sincronizados.
  // Si `procesarTodo=true` para un import, ignora el filtro de semana.
  useEffect(() => {
    setExcelImports((current) => current.map((imp) => {
      const filtered = imp.procesarTodo
        ? imp.rowsAll
        : imp.rowsAll.filter((r) => {
          if (r.fecha < weekStart || r.fecha > weekEnd) return false
          if (sucursalFiltro !== "Todas" && r.sucursal !== sucursalFiltro) return false
          return true
        })
      return {
        ...imp,
        rows: filtered,
        totalDisparos: filtered.filter((r) => r.status === "valid").reduce((s, r) => s + r.disparos, 0),
      }
    }))
  }, [weekStart, weekEnd, sucursalFiltro])

  /** Cambia la semana del wizard al rango detectado en el archivo. */
  const useFileRange = (idx: number) => {
    const imp = excelImports[idx]
    if (!imp?.fechaMinArchivo) return
    setWeekStart(imp.fechaMinArchivo)
    setWeekEnd(imp.fechaMaxArchivo || addDays(imp.fechaMinArchivo, 5))
  }

  /** Toggle "procesar todo el Excel" — ignora el filtro de semana para
   *  este import específico. */
  const toggleProcesarTodo = (idx: number) => {
    setExcelImports((current) => current.map((imp, i) => {
      if (i !== idx) return imp
      const procesarTodo = !imp.procesarTodo
      const filtered = procesarTodo ? imp.rowsAll : imp.rowsAll.filter((r) => {
        if (r.fecha < weekStart || r.fecha > weekEnd) return false
        if (sucursalFiltro !== "Todas" && r.sucursal !== sucursalFiltro) return false
        return true
      })
      return {
        ...imp,
        procesarTodo,
        rows: filtered,
        totalDisparos: filtered.filter((r) => r.status === "valid").reduce((s, r) => s + r.disparos, 0),
      }
    }))
  }

  // ── PASO 2: parse Excel y agregar a la lista ─────────────────────────────
  const handleExcelFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    setParsingExcel(true)
    try {
      const XLSX = await loadXLSX() as { read: (data: ArrayBuffer | string, opts: { type: string }) => unknown; utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] } }
      const newImports: ExcelImportInfo[] = []
      for (const file of Array.from(files)) {
        try {
          const buf = await file.arrayBuffer()
          const wb = XLSX.read(buf, { type: "array" }) as { SheetNames: string[]; Sheets: Record<string, unknown> }
          const parsed = await parseAgendaProWorkbook(wb, XLSX)
          // Guardamos TODAS las filas del archivo + el subset filtrado por
          // semana/sucursal. Esto permite mostrar contadores reales y
          // ofrecer "Usar rango del archivo" / "Procesar todo el Excel"
          // cuando el filtro deja 0 filas.
          const rowsAll = markDuplicatesAgainstExisting(parsed.rows, dbPulsos.sesionesCliente)
          const fechas = parsed.rows.map((r) => r.fecha).filter(Boolean).sort()
          const fechaMinArchivo = fechas[0] || ""
          const fechaMaxArchivo = fechas[fechas.length - 1] || ""
          const enRango = rowsAll.filter((r) => {
            if (r.fecha < weekStart || r.fecha > weekEnd) return false
            if (sucursalFiltro !== "Todas" && r.sucursal !== sucursalFiltro) return false
            return true
          })
          newImports.push({
            filename: file.name,
            parsed,
            rowsAll,
            rows: enRango,
            fechaMinArchivo,
            fechaMaxArchivo,
            procesarTodo: false,
            totalDisparos: enRango.filter((r) => r.status === "valid").reduce((s, r) => s + r.disparos, 0),
            imported: 0,
            duplicatesDb: 0,
          })
        } catch (err) {
          showToast(`Error en ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error")
        }
      }
      setExcelImports((current) => [...current, ...newImports])
    } finally {
      setParsingExcel(false)
      if (excelInputRef.current) excelInputRef.current.value = ""
    }
  }

  const removeExcelImport = (idx: number) => setExcelImports((current) => current.filter((_, i) => i !== idx))

  /** Construye un payload SesionCliente desde una fila parseada. Helper
   *  compartido entre "Importar todo", "Importar solo esta semana" e
   *  "Importar todo el Excel". */
  const rowToSesion = (r: ParsedDisparoRow, filename: string, ts: number, i: number): SesionCliente => {
    const observaciones = r.disparosRaw !== String(r.disparos) ? `Disparos Excel: ${r.disparosRaw}` : ""
    return {
      SesionID: `ses_${ts}_${i}`,
      Fecha: r.fecha,
      EquipoID: "",
      Sucursal: r.sucursal,
      Cabina: "",
      OperadoraID: r.operadora,
      Cliente: r.cliente || "Sin cliente",
      AreaTrabajada: r.tratamiento.replace(/^depilaci[oó]n\s*-\s*/i, "").trim(),
      DisparosReportados: r.disparos,
      Duracion: undefined,
      Observaciones: observaciones,
      ContactoCliente: r.contacto || undefined,
      Tratamiento: r.tratamiento || undefined,
      Potencia: r.potencia || undefined,
      Spot: r.spot || undefined,
      ArchivoOrigen: filename,
      FilaOrigen: r.filaOrigen,
      ImportHash: r.hash || undefined,
    }
  }

  /** Persiste un array de filas válidas en DB. Devuelve contadores. */
  const persistRows = async (rows: ParsedDisparoRow[], filename: string): Promise<{ imported: number; duplicatesDb: number; insertedLocal: SesionCliente[] }> => {
    const ts = Date.now()
    let imported = 0
    let duplicatesDb = 0
    const insertedLocal: SesionCliente[] = []
    for (let i = 0; i < rows.length; i += 1) {
      const sesion = rowToSesion(rows[i], filename, ts, i)
      try {
        const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveSesion", data: JSON.stringify(sesion) }) as { ok?: boolean; duplicate?: boolean }
        if (result?.duplicate) duplicatesDb += 1
        else if (result?.ok) { imported += 1; insertedLocal.push(sesion) }
      } catch (err) {
        console.warn("saveSesion failed", err)
      }
    }
    return { imported, duplicatesDb, insertedLocal }
  }

  /** Importa SOLO las filas de una semana específica de un excelImport. */
  const importWeekFromExcel = async (idx: number, fechaLunes: string) => {
    const imp = excelImports[idx]
    if (!imp) return
    const weekEndIso = addDays(fechaLunes, 6)
    const targetRows = imp.rowsAll.filter((r) =>
      r.status === "valid" && r.fecha >= fechaLunes && r.fecha <= weekEndIso,
    )
    if (!targetRows.length) {
      showToast("No hay filas válidas para esa semana", "error")
      return
    }
    setImportingExcel(true)
    try {
      const { imported, duplicatesDb, insertedLocal } = await persistRows(targetRows, imp.filename)
      if (insertedLocal.length) {
        setDbPulsos({ ...dbPulsos, sesionesCliente: [...dbPulsos.sesionesCliente, ...insertedLocal] })
      }
      // Actualizar contadores acumulados del excelImport
      setExcelImports((current) => current.map((x, i) => i === idx
        ? { ...x, imported: x.imported + imported, duplicatesDb: x.duplicatesDb + duplicatesDb }
        : x))
      const total = insertedLocal.reduce((s, x) => s + x.DisparosReportados, 0)
      showToast(`${imported} sesiones de la semana ${fmtFechaLocal(fechaLunes)} importadas${duplicatesDb > 0 ? ` · ${duplicatesDb} dup DB` : ""}`, "success")
      if (total) {
        // sin más
      }
    } finally {
      setImportingExcel(false)
    }
  }

  /** Cambia la semana del wizard al lunes-sábado de la semana elegida. */
  const useWeekForCuadre = (fechaLunes: string) => {
    setWeekStart(fechaLunes)
    setWeekEnd(addDays(fechaLunes, 5))
    showToast(`Semana del cuadre: ${fmtFechaLocal(fechaLunes)} → ${fmtFechaLocal(addDays(fechaLunes, 5))}`, "success")
  }

  // Cuando cambia la semana, recalcular lecturaInicialAuto de las lecturas ya
  // cargadas (depende de weekStart: buscamos la última lectura final con
  // fecha_semana < weekStart para mismo equipo/sucursal/cabina).
  useEffect(() => {
    setLecturasImport((current) => {
      if (!current) return current
      return {
        ...current,
        rows: current.rows.map((r) => {
          const equipoEfectivo = r.override.equipo ?? r.equipo
          const sucursalEfectiva = r.override.sucursal ?? r.sucursal
          const cabinaEfectiva = r.override.cabina ?? r.cabina
          return {
            ...r,
            lecturaInicialAuto: lookupLecturaPrevia(equipoEfectivo, sucursalEfectiva, cabinaEfectiva, weekStart),
          }
        }),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  // Confirma la importación a DB de TODOS los Excel cargados — toca el
  // backend con saveSesion fila por fila (el UNIQUE parcial sobre
  // import_hash rechaza los duplicados que el dedupe in-memory dejó pasar).
  const importarExcels = async () => {
    if (!excelImports.length) return
    const ts = Date.now()
    setImportingExcel(true)
    try {
      const updates: ExcelImportInfo[] = []
      for (const imp of excelImports) {
        let imported = 0
        let duplicatesDb = 0
        const insertedLocal: SesionCliente[] = []
        const validRows = imp.rows.filter((r) => r.status === "valid")
        for (let i = 0; i < validRows.length; i += 1) {
          const r = validRows[i]
          const observaciones = r.disparosRaw !== String(r.disparos)
            ? `Disparos Excel: ${r.disparosRaw}`
            : ""
          const sesion: SesionCliente = {
            SesionID: `ses_${ts}_${imp.filename}_${i}`,
            Fecha: r.fecha,
            EquipoID: "",                // se asignará si hay lectura semanal previa
            Sucursal: r.sucursal,
            Cabina: "",
            OperadoraID: r.operadora,
            Cliente: r.cliente || "Sin cliente",
            AreaTrabajada: r.tratamiento.replace(/^depilaci[oó]n\s*-\s*/i, "").trim(),
            DisparosReportados: r.disparos,
            Duracion: undefined,
            Observaciones: observaciones,
            ContactoCliente: r.contacto || undefined,
            Tratamiento: r.tratamiento || undefined,
            Potencia: r.potencia || undefined,
            Spot: r.spot || undefined,
            ArchivoOrigen: imp.filename,
            FilaOrigen: r.filaOrigen,
            ImportHash: r.hash || undefined,
          }
          try {
            const result = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveSesion", data: JSON.stringify(sesion) }) as { ok?: boolean; duplicate?: boolean }
            if (result?.duplicate) {
              duplicatesDb += 1
            } else if (result?.ok) {
              imported += 1
              insertedLocal.push(sesion)
            }
          } catch (err) {
            console.warn("saveSesion failed", err)
          }
        }
        if (insertedLocal.length) {
          setDbPulsos({ ...dbPulsos, sesionesCliente: [...dbPulsos.sesionesCliente, ...insertedLocal] })
        }
        updates.push({ ...imp, imported, duplicatesDb })
      }
      setExcelImports(updates)
      const totalIns = updates.reduce((s, u) => s + u.imported, 0)
      const totalDup = updates.reduce((s, u) => s + u.duplicatesDb, 0)
      showToast(`${totalIns} sesiones importadas${totalDup > 0 ? ` · ${totalDup} omitidas por dedupe DB` : ""}`, "success")
    } finally {
      setImportingExcel(false)
    }
  }

  // ── PASO 3: Excel de lecturas/pulsos ─────────────────────────────────────
  const handleLecturasFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setParsingLecturas(true)
    try {
      const XLSX = await loadXLSX() as { read: (data: ArrayBuffer | string, opts: { type: string }) => unknown; utils: { sheet_to_json: (ws: unknown, opts: { header: 1; defval: string }) => unknown[][] } }
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" }) as { SheetNames: string[]; Sheets: Record<string, unknown> }
      const parsed = parseLecturasWorkbook(wb, XLSX)
      const rows: LecturaCuadreEntry[] = parsed.rows.map((r) => ({
        ...r,
        rowId: newRowId(),
        lecturaInicialAuto: lookupLecturaPrevia(r.equipo, r.sucursal, r.cabina, weekStart),
        override: {},
      }))
      setLecturasImport({ filename: file.name, parsed, rows })
      const validas = rows.filter((r) => r.status === "valid").length
      showToast(
        `Archivo de lecturas leído: ${validas} válidas de ${rows.length} filas`,
        validas === rows.length ? "success" : "info",
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error")
    } finally {
      setParsingLecturas(false)
      if (lecturasInputRef.current) lecturasInputRef.current.value = ""
    }
  }

  const clearLecturas = () => {
    setLecturasImport(null)
    if (lecturasInputRef.current) lecturasInputRef.current.value = ""
  }

  /** Override de un campo de una fila del Excel de lecturas. Usado para
   *  corregir manualmente (equipo, sucursal, lectura inicial, etc.). */
  const updateLecturaRow = (rowId: string, patch: LecturaCuadreEntry["override"]) => {
    setLecturasImport((current) => {
      if (!current) return current
      return {
        ...current,
        rows: current.rows.map((r) => {
          if (r.rowId !== rowId) return r
          const nextOverride = { ...r.override, ...patch }
          // Si cambió equipo/sucursal/cabina, recalculamos lectura inicial sugerida.
          const equipoEfectivo = nextOverride.equipo ?? r.equipo
          const sucursalEfectiva = nextOverride.sucursal ?? r.sucursal
          const cabinaEfectiva = nextOverride.cabina ?? r.cabina
          const lecturaInicialAuto = lookupLecturaPrevia(equipoEfectivo, sucursalEfectiva, cabinaEfectiva, weekStart)
          return { ...r, override: nextOverride, lecturaInicialAuto }
        }),
      }
    })
  }

  /**
   * Busca la lectura más reciente cuya fecha_semana es anterior al
   * `weekStart` actual, para mismo equipo+sucursal+cabina. Devuelve
   * la `LecturaFinal` de esa semana como punto de partida.
   */
  const lookupLecturaPrevia = (equipoId: string, sucursal: string, cabina: string, fromIso: string): number | null => {
    if (!equipoId || !fromIso) return null
    const candidates = dbPulsos.lecturasSemanales.filter((l) =>
      (l.EquipoID || "") === equipoId
      && (sucursal === "" || (l.Sucursal || "") === sucursal)
      && (cabina === "" || (l.Cabina || "") === cabina)
      && String(l.FechaSemana || "").slice(0, 10) < fromIso,
    )
    if (!candidates.length) return null
    candidates.sort((a, b) => String(b.FechaSemana || "").localeCompare(String(a.FechaSemana || "")))
    const lecturaPrevia = candidates[0]
    const final = Number(lecturaPrevia.LecturaFinal)
    return Number.isFinite(final) ? final : null
  }

  // ── PASO 4: cálculo del cuadre ────────────────────────────────────────────
  const equiposCuadre: EquipoCuadre[] = useMemo(() => {
    if (!lecturasImport) return []
    // Sesiones de la semana en el rango filtrado.
    const sesionesSemana = dbPulsos.sesionesCliente.filter((s) => {
      const f = String(s.Fecha || "").slice(0, 10)
      if (f < weekStart || f > weekEnd) return false
      if (sucursalFiltro !== "Todas" && s.Sucursal !== sucursalFiltro) return false
      return true
    })
    // Hay sesiones en absoluto de esta semana? Útil para distinguir
    // "no se importó AgendaPro" vs "no hay match para este equipo".
    const haySesionesEnSemana = sesionesSemana.length > 0
    // Agrupamos disparos operador por (sucursal|equipoId) — la cabina no
    // siempre cuadra entre Excel de lecturas (1,2,3...) y AgendaPro (vacía).
    // Si hay match exacto con cabina lo usamos primero; sino caemos a equipo+sucursal.
    const opCountsFull: Record<string, number> = {}
    const opCountsBySucEquipo: Record<string, number> = {}
    for (const s of sesionesSemana) {
      const keyFull = `${s.Sucursal || ""}|${s.Cabina || ""}|${s.EquipoID || ""}`
      opCountsFull[keyFull] = (opCountsFull[keyFull] || 0) + (Number(s.DisparosReportados) || 0)
      const keySE = `${s.Sucursal || ""}|${s.EquipoID || ""}`
      opCountsBySucEquipo[keySE] = (opCountsBySucEquipo[keySE] || 0) + (Number(s.DisparosReportados) || 0)
    }
    const rows: EquipoCuadre[] = []
    for (const lec of lecturasImport.rows) {
      if (lec.status === "error") continue
      const equipo = lec.override.equipo ?? lec.equipo
      const sucursal = lec.override.sucursal ?? lec.sucursal
      const cabina = lec.override.cabina ?? lec.cabina
      if (!equipo) continue
      if (sucursalFiltro !== "Todas" && sucursal !== sucursalFiltro) continue
      const lecturaFinalEf = lec.override.lecturaFinal ?? lec.lecturaFinal
      // Lectura inicial: prioridad override > auto-detectada > NINGUNO (no 0).
      const haLecturaInicialExplicita = lec.override.lecturaInicial !== undefined || lec.lecturaInicialAuto !== null
      const lecturaInicialEf = lec.override.lecturaInicial ?? lec.lecturaInicialAuto ?? 0
      const override = equiposEditados[lec.rowId] || {}
      // Búsqueda de disparos AgendaPro: full key primero, fallback a (sucursal|equipo).
      const keyFull = `${sucursal}|${cabina}|${equipo}`
      const keySE = `${sucursal}|${equipo}`
      const matchFull = opCountsFull[keyFull] > 0
      const matchSE = opCountsBySucEquipo[keySE] > 0
      const disparosOperadorRaw = matchFull
        ? opCountsFull[keyFull]
        : (matchSE ? opCountsBySucEquipo[keySE] : 0)
      const huboMatchAgendaPro = matchFull || matchSE
      // Determinamos bloqueo (problema de datos que requiere confirmación
      // antes de marcarse como crítico real).
      let bloqueo: EquipoCuadre["bloqueo"]
      const obsAuto: string[] = []
      if (lec.serial) obsAuto.push(`Serial ${lec.serial}`)
      if (lec.operador) obsAuto.push(`Op. ${lec.operador}`)
      if (!haLecturaInicialExplicita) {
        bloqueo = "sin_lectura_anterior"
        obsAuto.push("Sin lectura anterior registrada — confirmar para calcular desde 0")
      } else if (haySesionesEnSemana && !huboMatchAgendaPro) {
        bloqueo = "sin_agendapro"
        obsAuto.push(`Sin sesiones en AgendaPro para ${sucursal} · equipo ${equipo}`)
      } else if (!haySesionesEnSemana) {
        bloqueo = "sin_agendapro"
        obsAuto.push("AgendaPro no tiene datos en esta semana")
      }
      // Cálculo final.
      const disparosLaser = Math.max(0, lecturaFinalEf - lecturaInicialEf)
      const desv = calcDesviacion(disparosLaser, disparosOperadorRaw)
      // Si hay bloqueo y NO ha sido confirmado por el usuario, degradamos
      // el nivel de alerta a "Advertencia" para no asustar con "Critico"
      // falsos por datos faltantes.
      const bloqueoConfirmado = Boolean(override.bloqueoConfirmado)
      const alerta = bloqueo && !bloqueoConfirmado ? "Advertencia" as const : desv.alerta
      rows.push({
        rowId: lec.rowId,
        equipoId: equipo,
        sucursal,
        cabina,
        lecturaInicial: lecturaInicialEf,
        lecturaFinal: lecturaFinalEf,
        disparosLaser: desv.disparosLaser,
        disparosOperador: override.disparosOperador ?? desv.disparosOperador,
        diferencia: override.disparosOperador !== undefined
          ? (override.disparosOperador as number) - desv.disparosLaser
          : desv.diferencia,
        porcentaje: desv.porcentaje,
        alerta,
        observaciones: override.observaciones ?? (lec.override.observaciones ?? obsAuto.join(" · ")),
        bloqueo,
        bloqueoConfirmado,
      })
    }
    return rows
  }, [lecturasImport, dbPulsos.sesionesCliente, weekStart, weekEnd, sucursalFiltro, equiposEditados])

  /** Confirma o revierte el bloqueo de una fila (sin lectura anterior /
   *  sin AgendaPro). Al confirmar permitimos guardado y recalculamos
   *  alertas en su nivel real. */
  const toggleBloqueoConfirmado = (rowId: string, confirmar: boolean) => {
    setEquiposEditados((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), bloqueoConfirmado: confirmar },
    }))
  }

  // ── PASO 5: guardar ──────────────────────────────────────────────────────
  const guardarCuadre = async () => {
    if (!equiposCuadre.length) {
      showToast("Sin equipos con datos para guardar.", "error")
      return
    }
    setGuardando(true)
    try {
      const archivoExcel = excelImports.map((imp) => ({
        filename: imp.filename, rows: imp.parsed.rows.length, imported: imp.imported,
      }))
      if (lecturasImport) {
        archivoExcel.push({
          filename: `[Lecturas] ${lecturasImport.filename}`,
          rows: lecturasImport.parsed.rows.length,
          imported: lecturasImport.rows.filter((r) => r.status !== "error").length,
        })
      }
      // 1) Guardar lecturas semanales (una por fila del Excel de lecturas).
      if (lecturasImport) {
        for (const lec of lecturasImport.rows) {
          if (lec.status === "error") continue
          const equipo = lec.override.equipo ?? lec.equipo
          const sucursal = lec.override.sucursal ?? lec.sucursal
          const cabina = lec.override.cabina ?? lec.cabina
          const operador = lec.override.operador ?? lec.operador
          const lecturaFinal = lec.override.lecturaFinal ?? lec.lecturaFinal
          const lecturaInicial = lec.override.lecturaInicial ?? lec.lecturaInicialAuto ?? 0
          if (!equipo) continue
          const lecturaId = `lec_cuadre_${weekStart}_${sucursal}_${equipo}_${cabina || "_"}`.replace(/\s+/g, "_")
          const obs: string[] = []
          if (lec.serial) obs.push(`Serial ${lec.serial}`)
          if (operador) obs.push(`Op. ${operador}`)
          obs.push(`Origen: ${lecturasImport.filename}`)
          const lectura = {
            LecturaID: lecturaId,
            FechaSemana: weekStart,
            EquipoID: equipo,
            Sucursal: sucursal,
            Cabina: cabina,
            OperadoraID: operador,
            LecturaInicial: lecturaInicial,
            LecturaFinal: lecturaFinal,
            DiferenciaReal: Math.max(0, lecturaFinal - lecturaInicial),
            Observaciones: lec.override.observaciones ?? obs.join(" · "),
          }
          await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveLectura", data: JSON.stringify(lectura) })
        }
      }
      // 2) Guardar auditorías (una por equipo del cuadre).
      for (const eq of equiposCuadre) {
        const auditoriaId = `aud_${weekStart}_${eq.sucursal}_${eq.equipoId}_${eq.cabina || "_"}`.replace(/\s+/g, "_")
        const auditoria: Partial<AuditoriaSemanal> = {
          AuditoriaID: auditoriaId,
          FechaSemana: weekStart,
          EquipoID: eq.equipoId,
          Sucursal: eq.sucursal,
          PulsosReales: eq.disparosLaser,
          PulsosReportados: eq.disparosOperador,
          Diferencia: eq.diferencia,
          PorcentajeDesviacion: eq.porcentaje,
          Alerta: eq.alerta,
          Observaciones: eq.observaciones,
          Cabina: eq.cabina,
          SemanaFin: weekEnd,
          LecturaInicial: eq.lecturaInicial,
          LecturaFinal: eq.lecturaFinal,
          CreadoPor: user?.id || undefined,
          ArchivoExcel: archivoExcel,
          FotosCount: 0,
          Fuente: "wizard_cuadre_semanal_excel_lecturas",
        }
        await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveAuditoria", data: JSON.stringify(auditoria) })
      }
      // 3) Construir snapshot para el resumen / PDF / Excel.
      const sesionesSemana = dbPulsos.sesionesCliente.filter((s) => {
        const f = String(s.Fecha || "").slice(0, 10)
        if (f < weekStart || f > weekEnd) return false
        if (sucursalFiltro !== "Todas" && s.Sucursal !== sucursalFiltro) return false
        return true
      })
      const snapshot: CuadreSnapshot = {
        semanaInicio: weekStart,
        semanaFin: weekEnd,
        sucursalFiltro,
        generadoEn: new Date().toLocaleString("es-DO"),
        generadoPor: user?.nombre || user?.username || undefined,
        archivos: archivoExcel.map((a) => ({ filename: String(a.filename), rows: a.rows as number })),
        fotosCount: 0,
        equipos: equiposCuadre.map((r) => ({
          equipoId: r.equipoId, sucursal: r.sucursal, cabina: r.cabina,
          lecturaInicial: r.lecturaInicial, lecturaFinal: r.lecturaFinal,
          disparosLaser: r.disparosLaser, disparosOperador: r.disparosOperador,
          diferencia: r.diferencia, porcentaje: r.porcentaje, alerta: r.alerta,
          observaciones: r.observaciones,
        })),
      }
      setSnapshotFinal({ snapshot, sesiones: sesionesSemana })
      showToast(`Cuadre semanal guardado: ${equiposCuadre.length} equipos`, "success")
    } catch (err) {
      showToast(`Error guardando cuadre: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setGuardando(false)
    }
  }

  const resetWizard = () => {
    setStep(1)
    setExcelImports([])
    setLecturasImport(null)
    setEquiposEditados({})
    setSnapshotFinal(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (snapshotFinal) return <ResumenFinal {...snapshotFinal} onReset={resetWizard} business={business} />

  return (
    <div className="csl-page-shell">
      <div>
        <p className="csl-kicker">Cuadre semanal · {business.shortName}</p>
        <h2 className="mt-1 font-heading text-2xl font-black tracking-tight md:text-3xl">Asistente de cuadre semanal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube el Excel de AgendaPro y el Excel de lecturas por equipo, revisa diferencias y guarda el snapshot.
        </p>
      </div>

      <ProgressBar step={step} />

      {/* PASO 1 — Solo sucursal + intro (la semana se detecta en Paso 2) */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4" /> Paso 1 · Inicio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-sky-900">
              <p className="font-bold uppercase tracking-wide">¿Cómo funciona el cuadre?</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 leading-relaxed">
                <li>Sube el Excel de <b>AgendaPro</b>. El sistema detectará automáticamente las semanas disponibles dentro del archivo.</li>
                <li>Elige la semana del archivo que vas a cuadrar.</li>
                <li>Sube el Excel de <b>lecturas/pulsos</b> de esa semana — el sistema valida que corresponda a la misma semana de AgendaPro.</li>
                <li>Revisa diferencias por equipo y guarda el snapshot.</li>
              </ol>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sucursal</Label>
                <Select value={sucursalFiltro} onValueChange={setSucursalFiltro}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sucursalesOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-muted-foreground">Filtro opcional para limitar el cuadre a una sucursal.</p>
              </div>
            </div>
            <NavButtons onNext={() => setStep(2)} nextLabel="Continuar a AgendaPro" nextEnabled />
          </CardContent>
        </Card>
      ) : null}

      {/* PASO 2 — Excel */}
      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" /> Paso 2 · Sube los Excel de AgendaPro
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
              <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
              <p className="text-sm font-semibold">Arrastra los archivos aquí o selecciona</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Hoja &quot;Detalle Disparos tratamientos&quot;. Tras subir el archivo, el sistema detectará las semanas disponibles y tú eliges cuál cuadrar.
              </p>
              <input
                ref={excelInputRef} type="file" accept=".xlsx,.xls" multiple className="hidden"
                onChange={(e) => handleExcelFiles(e.target.files)}
              />
              <Button variant="outline" size="sm" className="mt-3 gap-2"
                onClick={() => excelInputRef.current?.click()} disabled={parsingExcel}>
                {parsingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Seleccionar Excel
              </Button>
            </div>

            {excelImports.length ? (
              <div className="space-y-3">
                {excelImports.map((imp, idx) => {
                  const totalArchivo = imp.rowsAll.length
                  const enRango = imp.rows.length
                  const validas = imp.rows.filter((r) => r.status === "valid").length
                  const dupArchivo = imp.rows.filter((r) => r.status === "duplicate_file").length
                  const yaImportadas = imp.rows.filter((r) => r.status === "already_imported").length
                  const errores = imp.rows.filter((r) => r.status === "error").length
                  // Si el archivo tiene datos pero ninguno cae dentro del
                  // rango de la semana actual (y NO está activo "procesar
                  // todo" y YA hay semana elegida), mostramos alerta.
                  const sinDatosEnRango = totalArchivo > 0 && enRango === 0 && !imp.procesarTodo && !!weekStart
                  // Cuando TODAS las filas válidas-en-rango son already_imported,
                  // mostramos banner específico distinto del "no hay datos".
                  const totalAccionables = validas + yaImportadas
                  const todoYaImportado = totalAccionables > 0 && validas === 0 && yaImportadas > 0
                  return (
                    <div key={idx} className="rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{imp.filename}</div>
                          <div className="mt-0.5 text-muted-foreground">
                            Hoja: {imp.parsed.sheet} · Header fila: {imp.parsed.headerRow}
                            {imp.fechaMinArchivo ? <> · Rango archivo: <b>{fmtFechaLocal(imp.fechaMinArchivo)} → {fmtFechaLocal(imp.fechaMaxArchivo)}</b></> : null}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeExcelImport(idx)} title="Quitar">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Mini label="Filas del archivo" value={totalArchivo} />
                        {weekStart || imp.procesarTodo ? (
                          <Mini label={imp.procesarTodo ? "Procesando todo" : "Dentro del rango"} value={enRango} tone={enRango > 0 ? "ok" : "warn"} />
                        ) : null}
                        {weekStart || imp.procesarTodo ? (
                          <Mini label="Válidas" value={validas} tone="ok" />
                        ) : null}
                        {yaImportadas > 0
                          ? <Mini label="Ya importadas" value={yaImportadas} tone="info" />
                          : null}
                        {dupArchivo > 0
                          ? <Mini label="Duplicadas en archivo" value={dupArchivo} tone="warn" />
                          : null}
                        {errores > 0
                          ? <Mini label="Errores" value={errores} tone="error" />
                          : null}
                        <Mini label="Disparos a importar" value={imp.totalDisparos} />
                        {imp.imported > 0
                          ? <Mini label="Importadas" value={imp.imported} tone="ok" />
                          : null}
                        {imp.duplicatesDb > 0
                          ? <Mini label="Dup DB" value={imp.duplicatesDb} tone="warn" />
                          : null}
                      </div>

                      {/* Banner cuando todo el rango de filas válidas resultó
                          en already_imported. NO es error — es info. */}
                      {todoYaImportado && !sinDatosEnRango ? (
                        <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-xs text-sky-900">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                            <div className="flex-1">
                              <p className="font-bold">Este archivo ya fue importado anteriormente.</p>
                              <p className="mt-1 text-sky-900/80">
                                Las <b>{yaImportadas.toLocaleString("es-DO")}</b> filas en el rango ya están en la base de datos.
                                No se importarán duplicados.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Alerta cuando el archivo trae datos pero el filtro
                          de semana los deja fuera. Ofrece 2 salidas. */}
                      {sinDatosEnRango ? (
                        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                            <div className="flex-1 space-y-1.5">
                              <p className="text-sm font-bold text-amber-900">
                                El archivo tiene datos, pero ninguno corresponde a la semana seleccionada.
                              </p>
                              <p className="text-xs text-amber-900/80">
                                Rango del archivo: <b>{fmtFechaLocal(imp.fechaMinArchivo)} → {fmtFechaLocal(imp.fechaMaxArchivo)}</b><br/>
                                Semana seleccionada: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b>
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button size="sm" variant="outline" onClick={() => useFileRange(idx)} className="h-8 gap-1 text-xs">
                                  Usar rango del archivo
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => toggleProcesarTodo(idx)} className="h-8 gap-1 text-xs">
                                  Procesar todo el Excel
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setStep(1)} className="h-8 gap-1 text-xs">
                                  Cambiar semana
                                </Button>
                              </div>
                              <p className="mt-1 text-[10px] text-amber-900/70">
                                Si procesas todo el Excel, las sesiones se registran para Disparos operadoras,
                                pero el cuadre semanal solo comparará la semana seleccionada.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {/* Si el usuario activó "Procesar todo", chip discreto
                          que se puede revertir. */}
                      {imp.procesarTodo ? (
                        <div className="mt-2 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-800">
                          <span>Procesando <b>todo el Excel</b> (filtro de semana desactivado).</span>
                          <button type="button" onClick={() => toggleProcesarTodo(idx)} className="font-bold underline">
                            Re-aplicar filtro
                          </button>
                        </div>
                      ) : null}

                      {/* Semanas detectadas en el archivo — agrupamos por
                          lunesDeSemana(fecha). Permite ver qué semanas tiene
                          el Excel y actuar sobre una semana específica:
                          usarla para el cuadre o importar solo esa semana. */}
                      {(() => {
                        const byWeek = new Map<string, ParsedDisparoRow[]>()
                        for (const row of imp.rowsAll) {
                          const wk = lunesDeSemana(row.fecha)
                          if (!wk) continue
                          if (!byWeek.has(wk)) byWeek.set(wk, [])
                          byWeek.get(wk)!.push(row)
                        }
                        const semanas = Array.from(byWeek.entries())
                          .sort((a, b) => b[0].localeCompare(a[0]))
                          .map(([fechaLunes, rows]) => {
                            const valid = rows.filter((r) => r.status === "valid")
                            const dupFile = rows.filter((r) => r.status === "duplicate_file")
                            const alreadyImp = rows.filter((r) => r.status === "already_imported")
                            const err = rows.filter((r) => r.status === "error")
                            return {
                              fechaLunes,
                              fechaFin: addDays(fechaLunes, 5),
                              rows,
                              valid: valid.length,
                              dupFile: dupFile.length,
                              alreadyImp: alreadyImp.length,
                              err: err.length,
                              disparos: valid.reduce((s, r) => s + r.disparos, 0),
                              operadoras: Array.from(new Set(rows.map((r) => r.operadora).filter(Boolean))),
                              sucursales: Array.from(new Set(rows.map((r) => r.sucursal).filter(Boolean))),
                            }
                          })
                        if (semanas.length === 0) return null
                        return (
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                                Semanas detectadas en el archivo ({semanas.length})
                              </h4>
                            </div>
                            <div className="space-y-2">
                              {semanas.map((sem) => {
                                const isActiveCuadre = sem.fechaLunes === weekStart
                                return (
                                  <div
                                    key={sem.fechaLunes}
                                    className={`rounded-lg border p-2.5 text-xs ${isActiveCuadre ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-white"}`}
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="font-bold">
                                          Semana del {fmtFechaLocal(sem.fechaLunes)} al {fmtFechaLocal(sem.fechaFin)}
                                          {isActiveCuadre ? (
                                            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                                              Activa para cuadre
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                                          <span><b>{sem.rows.length}</b> filas</span>
                                          <span>· <span className="text-emerald-700"><b>{sem.valid}</b> válidas</span></span>
                                          {sem.alreadyImp > 0 ? <span>· <span className="text-sky-700"><b>{sem.alreadyImp}</b> ya importadas</span></span> : null}
                                          {sem.dupFile > 0 ? <span>· <span className="text-amber-700"><b>{sem.dupFile}</b> dup archivo</span></span> : null}
                                          {sem.err > 0 ? <span>· <span className="text-rose-700"><b>{sem.err}</b> err</span></span> : null}
                                          <span>· <b>{sem.disparos.toLocaleString("es-DO")}</b> disparos</span>
                                          {sem.operadoras.length > 0 ? <span>· {sem.operadoras.length} {sem.operadoras.length === 1 ? "operadora" : "operadoras"}</span> : null}
                                          {sem.sucursales.length > 0 ? <span>· {sem.sucursales.join(", ")}</span> : null}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {!isActiveCuadre ? (
                                          <Button size="sm" variant="outline" onClick={() => useWeekForCuadre(sem.fechaLunes)} className="h-7 px-2 text-[11px]">
                                            Usar para cuadre
                                          </Button>
                                        ) : null}
                                        <Button
                                          size="sm" variant="outline"
                                          onClick={() => importWeekFromExcel(idx, sem.fechaLunes)}
                                          disabled={importingExcel || sem.valid === 0}
                                          className="h-7 gap-1 px-2 text-[11px]"
                                        >
                                          {importingExcel ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                          Importar {sem.valid > 0 ? `${sem.valid}` : ""}
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })}
                <Button onClick={importarExcels} disabled={importingExcel} className="w-full gap-2">
                  {importingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {importingExcel ? "Importando..." : `Importar sesiones a la base de datos`}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Las sesiones se persisten en <code>csl_sesiones_cliente</code> con dedupe por <code>import_hash</code>.
                </p>
              </div>
            ) : null}

            {excelImports.length > 0 && !weekStart ? (
              <Alert tone="warn">
                Aún no has elegido la semana del cuadre. En la lista <b>&quot;Semanas detectadas en el archivo&quot;</b> de arriba, presiona <b>&quot;Usar para cuadre&quot;</b> en la semana que vas a auditar.
              </Alert>
            ) : null}
            {weekStart ? (
              <Alert tone="info">
                Semana del cuadre seleccionada: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b>. Esta misma semana se usará al subir las lecturas y al guardar.
              </Alert>
            ) : null}
            <NavButtons
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              nextLabel={!weekStart ? "Elige una semana del archivo" : "Continuar a lecturas"}
              nextEnabled={excelImports.length > 0 && !!weekStart}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* PASO 3 — Excel de lecturas/pulsos */}
      {step === 3 ? (() => {
        const rows = lecturasImport?.rows || []
        const validas = rows.filter((r) => r.status === "valid").length
        const advertencias = rows.filter((r) => r.status === "warning").length
        const errores = rows.filter((r) => r.status === "error").length
        const equiposDetectados = new Set(rows.map((r) => r.override.equipo ?? r.equipo).filter(Boolean)).size
        const sucursalesDetectadas = Array.from(new Set(rows.map((r) => r.override.sucursal ?? r.sucursal).filter(Boolean)))
        const equiposCompletos = rows.filter((r) => r.status !== "error" && (r.override.equipo ?? r.equipo)).length
        const semanaHeader = lecturasImport
          ? detectarSemanaDeHeader(
              lecturasImport.parsed.lecturaColumnName,
              Number(weekStart.slice(0, 4)) || new Date().getFullYear(),
            )
          : ""
        const semanasCoinciden = !semanaHeader || semanaHeader === weekStart
        return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" /> Paso 3 · Sube el Excel de lecturas/pulsos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Banner: comparación semana AgendaPro vs semana lecturas */}
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-primary">Semana de AgendaPro</div>
                  <div className="mt-1 text-sm font-bold">
                    {weekStart ? `${fmtFechaLocal(weekStart)} → ${fmtFechaLocal(weekEnd)}` : "Sin semana seleccionada"}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Detectada en el Paso 2 a partir del archivo de AgendaPro.</p>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-primary">Semana de lecturas</div>
                  <div className={`mt-1 text-sm font-bold ${lecturasImport && !semanasCoinciden ? "text-rose-700" : ""}`}>
                    {lecturasImport
                      ? (semanaHeader
                          ? `${fmtFechaLocal(semanaHeader)} → ${fmtFechaLocal(addDays(semanaHeader, 5))}`
                          : "No detectada en el header")
                      : "—"}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lecturasImport
                      ? `Detectada desde "${lecturasImport.parsed.lecturaColumnName}"`
                      : "Sube el Excel de lecturas para detectar la semana."}
                  </p>
                </div>
              </div>
              {lecturasImport && semanaHeader && semanasCoinciden ? (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" /> Las semanas coinciden
                </div>
              ) : null}
            </div>

            {/* Dropzone — sin Excel cargado todavía */}
            {!lecturasImport ? (
              <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
                <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
                <p className="text-sm font-semibold">Sube el Excel de lecturas/pulsos por equipo</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Columnas esperadas: <b>Sucursal · Cabina · Operador · Equipo · Serial · Pulsos/Lectura final</b>.
                  El encabezado de la columna de lectura puede variar (ej. &quot;Pulsos 18–23 Mayo&quot;).
                </p>
                <input
                  ref={lecturasInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => handleLecturasFile(e.target.files)}
                />
                <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => lecturasInputRef.current?.click()} disabled={parsingLecturas}>
                  {parsingLecturas ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {parsingLecturas ? "Leyendo Excel..." : "Seleccionar Excel de lecturas"}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Resumen del archivo */}
                <div className="rounded-xl border p-3 text-xs">
                  {/* Validación: la semana detectada en el header debe coincidir
                      con la semana activa del cuadre. */}
                  {(() => {
                    const semanaHeader = detectarSemanaDeHeader(
                      lecturasImport.parsed.lecturaColumnName,
                      Number(weekStart.slice(0, 4)) || new Date().getFullYear(),
                    )
                    if (semanaHeader && semanaHeader !== weekStart) {
                      return (
                        <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-[11px] text-rose-900">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
                            <div className="flex-1">
                              <p className="font-bold">El archivo cargado no corresponde a la semana seleccionada.</p>
                              <p className="mt-1">
                                Semana del cuadre: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b><br />
                                Detectada en el archivo: <b>{fmtFechaLocal(semanaHeader)} → {fmtFechaLocal(addDays(semanaHeader, 5))}</b> (header: &quot;{lecturasImport.parsed.lecturaColumnName}&quot;)
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                <Button size="sm" variant="outline" onClick={() => setWeekStart(semanaHeader)} className="h-7 px-2 text-[11px]">
                                  Cambiar a la semana del archivo
                                </Button>
                                <Button size="sm" variant="ghost" onClick={clearLecturas} className="h-7 px-2 text-[11px]">
                                  Subir otro archivo
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    }
                    return null
                  })()}

                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{lecturasImport.filename}</div>
                      <div className="mt-0.5 text-muted-foreground">
                        Hoja: <b>{lecturasImport.parsed.sheet}</b> · Header fila: {lecturasImport.parsed.headerRow} · Columna lectura: <b>{lecturasImport.parsed.lecturaColumnName}</b>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => lecturasInputRef.current?.click()} disabled={parsingLecturas} className="h-7 gap-1 text-[11px]">
                      <Upload className="h-3 w-3" /> Cambiar archivo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearLecturas} className="h-7 gap-1 text-[11px]">
                      <X className="h-3 w-3" /> Limpiar
                    </Button>
                    <input
                      ref={lecturasInputRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={(e) => handleLecturasFile(e.target.files)}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Mini label="Filas leídas" value={rows.length} />
                    <Mini label="Válidas" value={validas} tone="ok" />
                    {advertencias > 0 ? <Mini label="Advertencias" value={advertencias} tone="warn" /> : null}
                    {errores > 0 ? <Mini label="Errores" value={errores} tone="error" /> : null}
                    <Mini label="Equipos" value={equiposDetectados} tone="info" />
                    <Mini label="Sucursales" value={sucursalesDetectadas.length} />
                  </div>
                  {sucursalesDetectadas.length > 0 ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Sucursales detectadas: <b>{sucursalesDetectadas.join(", ")}</b>
                    </div>
                  ) : null}
                  {errores > 0 ? (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800">
                      Hay <b>{errores}</b> {errores === 1 ? "fila con error" : "filas con errores"}. Corrige el archivo o completa manualmente antes de revisar.
                    </div>
                  ) : null}
                </div>

                {/* Tabla preview */}
                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Estado</TableHead>
                        <TableHead>Sucursal</TableHead>
                        <TableHead>Cabina</TableHead>
                        <TableHead>Operador</TableHead>
                        <TableHead>Equipo</TableHead>
                        <TableHead>Serial</TableHead>
                        <TableHead className="text-right">Lectura final</TableHead>
                        <TableHead>Observaciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => {
                        const sucursalEf = r.override.sucursal ?? r.sucursal
                        const cabinaEf = r.override.cabina ?? r.cabina
                        const operadorEf = r.override.operador ?? r.operador
                        const equipoEf = r.override.equipo ?? r.equipo
                        const lecturaEf = r.override.lecturaFinal ?? r.lecturaFinal
                        const stateBadge = r.status === "error"
                          ? <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700"><AlertTriangle className="h-2.5 w-2.5" />Error</span>
                          : r.status === "warning"
                            ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700"><AlertTriangle className="h-2.5 w-2.5" />Aviso</span>
                            : <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700"><CheckCircle2 className="h-2.5 w-2.5" />OK</span>
                        return (
                          <TableRow key={r.rowId}>
                            <TableCell className="text-[10px]">{stateBadge}</TableCell>
                            <TableCell className="text-xs">
                              <Input value={sucursalEf} onChange={(e) => updateLecturaRow(r.rowId, { sucursal: e.target.value })} className="h-7 w-32 text-xs" />
                            </TableCell>
                            <TableCell className="text-xs">
                              <Input value={cabinaEf} onChange={(e) => updateLecturaRow(r.rowId, { cabina: e.target.value })} className="h-7 w-16 text-xs" placeholder="—" />
                            </TableCell>
                            <TableCell className="text-xs">
                              <Input value={operadorEf} onChange={(e) => updateLecturaRow(r.rowId, { operador: e.target.value })} className="h-7 w-28 text-xs" placeholder="—" />
                            </TableCell>
                            <TableCell className="text-xs font-bold">
                              <Input value={equipoEf} onChange={(e) => updateLecturaRow(r.rowId, { equipo: e.target.value })} className="h-7 w-16 text-xs" />
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.serial || "—"}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number" min={0}
                                value={lecturaEf || ""}
                                onChange={(e) => updateLecturaRow(r.rowId, { lecturaFinal: Number(e.target.value) || 0 })}
                                className="h-7 w-32 text-right font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground">{r.message || "—"}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <NavButtons
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
              nextLabel={!semanasCoinciden ? "Las semanas no coinciden" : "Continuar a revisión"}
              nextEnabled={equiposCompletos > 0 && semanasCoinciden}
            />
          </CardContent>
        </Card>
        )
      })() : null}

      {/* PASO 4 — Revisión */}
      {step === 4 ? (() => {
        const bloqueosSinConfirmar = equiposCuadre.filter((r) => r.bloqueo && !r.bloqueoConfirmado)
        const sinLectAnterior = bloqueosSinConfirmar.filter((r) => r.bloqueo === "sin_lectura_anterior").length
        const sinAgendaPro = bloqueosSinConfirmar.filter((r) => r.bloqueo === "sin_agendapro").length
        return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" /> Paso 4 · Revisión del cuadre
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Banner de bloqueos pendientes */}
            {bloqueosSinConfirmar.length > 0 ? (
              <div className="border-b border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div className="flex-1">
                    <p className="font-bold">
                      {bloqueosSinConfirmar.length} {bloqueosSinConfirmar.length === 1 ? "equipo requiere confirmación" : "equipos requieren confirmación"}
                    </p>
                    <p className="mt-0.5">
                      {sinLectAnterior > 0 ? <><b>{sinLectAnterior}</b> sin lectura anterior · </> : null}
                      {sinAgendaPro > 0 ? <><b>{sinAgendaPro}</b> sin datos de AgendaPro · </> : null}
                      Confirma cada caso para poder guardar el cuadre.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Cabina</TableHead>
                  <TableHead className="text-right">Lect. inicial</TableHead>
                  <TableHead className="text-right">Lect. final</TableHead>
                  <TableHead className="text-right">Disp. láser</TableHead>
                  <TableHead className="text-right">Disp. operador</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equiposCuadre.length ? equiposCuadre.map((r) => (
                  <TableRow key={r.rowId} className={r.bloqueo && !r.bloqueoConfirmado ? "bg-amber-50/40" : ""}>
                    <TableCell className="font-bold">{r.equipoId}</TableCell>
                    <TableCell className="text-xs">{r.sucursal}</TableCell>
                    <TableCell className="text-xs">{r.cabina || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.bloqueo === "sin_lectura_anterior" ? (
                        <span className="text-amber-700">Sin previa</span>
                      ) : r.lecturaInicial.toLocaleString("es-DO")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.lecturaFinal.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{r.disparosLaser.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.bloqueo === "sin_agendapro" && !r.bloqueoConfirmado ? (
                        <span className="text-amber-700">Sin AgendaPro</span>
                      ) : (
                        <Input
                          type="number" min={0}
                          value={r.disparosOperador}
                          onChange={(e) => setEquiposEditados((prev) => ({
                            ...prev,
                            [r.rowId]: { ...(prev[r.rowId] || {}), disparosOperador: Math.max(0, Number(e.target.value) || 0) },
                          }))}
                          className="h-7 w-24 text-right text-xs"
                        />
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${r.diferencia > 0 ? "text-rose-600" : r.diferencia < 0 ? "text-sky-600" : ""}`}>
                      {r.diferencia > 0 ? "+" : ""}{r.diferencia.toLocaleString("es-DO")}
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.porcentaje.toFixed(1)}%</TableCell>
                    <TableCell>
                      {r.bloqueo && !r.bloqueoConfirmado ? (
                        <div className="flex flex-col gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {r.bloqueo === "sin_lectura_anterior" ? "Sin lectura anterior" : "Sin AgendaPro"}
                          </span>
                          <Button
                            size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                            onClick={() => toggleBloqueoConfirmado(r.rowId, true)}
                          >
                            Confirmar y continuar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ALERT_CLS[r.alerta]}`}>
                            {r.alerta === "OK"
                              ? <CheckCircle2 className="h-2.5 w-2.5" />
                              : <AlertTriangle className="h-2.5 w-2.5" />}
                            {r.alerta}
                          </span>
                          {r.bloqueo && r.bloqueoConfirmado ? (
                            <button type="button" className="text-[10px] text-muted-foreground underline" onClick={() => toggleBloqueoConfirmado(r.rowId, false)}>
                              deshacer confirmación
                            </button>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Sin equipos con datos completos. Volvé al Paso 3 y asigná equipo + lectura final.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="p-4">
              <NavButtons
                onBack={() => setStep(3)}
                onNext={() => setStep(5)}
                nextLabel={bloqueosSinConfirmar.length > 0 ? `Faltan ${bloqueosSinConfirmar.length} confirmaciones` : "Continuar a guardar"}
                nextEnabled={equiposCuadre.length > 0 && bloqueosSinConfirmar.length === 0}
              />
            </div>
          </CardContent>
        </Card>
        )
      })() : null}

      {/* PASO 5 — Guardar */}
      {step === 5 ? (() => {
        const bloqueosPend = equiposCuadre.filter((r) => r.bloqueo && !r.bloqueoConfirmado).length
        return (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Save className="h-4 w-4" /> Paso 5 · Guardar cuadre semanal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {bloqueosPend > 0 ? (
              <Alert tone="warn">
                <b>{bloqueosPend} equipos</b> tienen bloqueos sin confirmar (sin lectura anterior o sin AgendaPro). Vuelve al Paso 4 para confirmar cada caso antes de guardar.
              </Alert>
            ) : null}
            <Alert tone="info">
              Se guardarán <b>{equiposCuadre.length}</b> auditorías y <b>{lecturasImport ? lecturasImport.rows.filter((r) => r.status !== "error" && (r.override.equipo ?? r.equipo)).length : 0}</b> lecturas semanales en la base de datos.
              Si ya existe un cuadre para alguna combinación semana/equipo/cabina, el handler responde con error claro — desde el SQL editor se puede borrar el row previo para reemplazar.
            </Alert>
            <div className="rounded-xl border bg-slate-50/60 p-3 text-xs">
              <div className="font-bold uppercase tracking-wide text-muted-foreground">Resumen</div>
              <ul className="mt-2 space-y-1">
                <li>Semana: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b></li>
                <li>Sucursal: <b>{sucursalFiltro}</b></li>
                <li>Excel AgendaPro: <b>{excelImports.length}</b> ({excelImports.reduce((s, i) => s + i.imported, 0)} sesiones importadas)</li>
                <li>Excel lecturas: <b>{lecturasImport ? `${lecturasImport.filename}` : "—"}</b>{lecturasImport ? <> · {lecturasImport.rows.length} filas leídas</> : null}</li>
                <li>Equipos a auditar: <b>{equiposCuadre.length}</b></li>
                <li>Alertas: <b className="text-emerald-600">{equiposCuadre.filter((e) => e.alerta === "OK").length} OK</b> · <b className="text-amber-600">{equiposCuadre.filter((e) => e.alerta === "Advertencia").length} Advertencia</b> · <b className="text-rose-600">{equiposCuadre.filter((e) => e.alerta === "Critico").length} Crítico</b>{bloqueosPend > 0 ? <> · <b className="text-amber-700">{bloqueosPend} pendientes de confirmar</b></> : null}</li>
              </ul>
            </div>
            <NavButtons
              onBack={() => setStep(4)}
              onNext={guardarCuadre}
              nextLabel={guardando ? "Guardando..." : bloqueosPend > 0 ? `Resolver ${bloqueosPend} bloqueos antes` : "Guardar cuadre semanal"}
              nextEnabled={!guardando && equiposCuadre.length > 0 && bloqueosPend === 0}
            />
          </CardContent>
        </Card>
        )
      })() : null}
    </div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: WizardStep }) {
  const labels = ["Semana", "AgendaPro", "Lecturas", "Revisar", "Guardar"]
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="flex items-center justify-between">
        {labels.map((label, i) => {
          const n = (i + 1) as WizardStep
          const active = step === n
          const done = step > n
          return (
            <div key={label} className="flex flex-1 items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500 text-white" : active ? "bg-primary text-white ring-4 ring-primary/15" : "bg-slate-100 text-slate-400"}`}>
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
              </div>
              <div className={`text-xs font-bold uppercase tracking-wide ${active ? "text-foreground" : done ? "text-emerald-600" : "text-muted-foreground"}`}>{label}</div>
              {i < labels.length - 1 ? <div className={`h-0.5 flex-1 ${done ? "bg-emerald-300" : "bg-slate-100"}`} /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NavButtons({ onBack, onNext, nextLabel, nextEnabled = true }: { onBack?: () => void; onNext?: () => void; nextLabel: string; nextEnabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {onBack ? (
        <Button variant="outline" onClick={onBack} className="gap-1"><ChevronLeft className="h-4 w-4" />Atrás</Button>
      ) : <div />}
      {onNext ? (
        <Button onClick={onNext} disabled={!nextEnabled} className="gap-1">{nextLabel}<ChevronRight className="h-4 w-4" /></Button>
      ) : null}
    </div>
  )
}

function Alert({ tone, children }: { tone: "info" | "warn"; children: React.ReactNode }) {
  const cls = tone === "info" ? "border-cyan-200 bg-cyan-50 text-cyan-900" : "border-amber-200 bg-amber-50 text-amber-900"
  return <div className={`rounded-xl border p-3 text-xs ${cls}`}>{children}</div>
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "error" | "info" }) {
  const cls = tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700"
    : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "info" ? "border-sky-200 bg-sky-50 text-sky-700"
    : "border-slate-200 bg-white text-slate-700"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}: <span className="font-mono">{value.toLocaleString("es-DO")}</span>
    </span>
  )
}

function ResumenFinal({ snapshot, sesiones, onReset, business }: {
  snapshot: CuadreSnapshot
  sesiones: SesionCliente[]
  onReset: () => void
  business: { shortName: string }
}) {
  const totLaser = snapshot.equipos.reduce((s, r) => s + r.disparosLaser, 0)
  const totOperador = snapshot.equipos.reduce((s, r) => s + r.disparosOperador, 0)
  const totDif = totOperador - totLaser
  const okN = snapshot.equipos.filter((r) => r.alerta === "OK").length
  const warnN = snapshot.equipos.filter((r) => r.alerta === "Advertencia").length
  const critN = snapshot.equipos.filter((r) => r.alerta === "Critico").length
  const peor = [...snapshot.equipos].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))[0]

  return (
    <div className="csl-page-shell">
      <div className="rounded-3xl border bg-emerald-50/40 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
        <h2 className="font-heading text-2xl font-black">Cuadre semanal guardado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Semana <b>{fmtFechaLocal(snapshot.semanaInicio)} → {fmtFechaLocal(snapshot.semanaFin)}</b> · Sucursal: <b>{snapshot.sucursalFiltro}</b> · {business.shortName}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Equipos" value={snapshot.equipos.length} />
        <KpiTile label="Disp. láser" value={totLaser} />
        <KpiTile label="Disp. operador" value={totOperador} />
        <KpiTile label="Diferencia" value={totDif} tone={totDif === 0 ? "neutral" : totDif > 0 ? "warn" : "info"} />
        <KpiTile label="OK" value={okN} tone="ok" />
        <KpiTile label="Críticos" value={critN} tone={critN > 0 ? "error" : "ok"} />
      </div>

      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b bg-slate-50/70 py-4">
          <CardTitle className="text-base">Detalle por equipo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Cabina</TableHead>
                <TableHead className="text-right">Disp. láser</TableHead>
                <TableHead className="text-right">Disp. operador</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.equipos.map((r) => (
                <TableRow key={`${r.equipoId}|${r.sucursal}|${r.cabina}`}>
                  <TableCell className="font-bold">{r.equipoId}</TableCell>
                  <TableCell className="text-xs">{r.sucursal}</TableCell>
                  <TableCell className="text-xs">{r.cabina || "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs font-bold">{r.disparosLaser.toLocaleString("es-DO")}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{r.disparosOperador.toLocaleString("es-DO")}</TableCell>
                  <TableCell className={`text-right font-mono text-xs ${r.diferencia > 0 ? "text-rose-600" : r.diferencia < 0 ? "text-sky-600" : ""}`}>{r.diferencia > 0 ? "+" : ""}{r.diferencia.toLocaleString("es-DO")}</TableCell>
                  <TableCell className="text-right text-xs">{r.porcentaje.toFixed(1)}%</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ALERT_CLS[r.alerta]}`}>
                      {r.alerta}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {peor && peor.alerta !== "OK" ? (
        <Alert tone="warn">
          <b>Mayor desviación:</b> equipo <b>{peor.equipoId}</b> ({peor.sucursal}{peor.cabina ? ` · ${peor.cabina}` : ""}) — diferencia {peor.diferencia > 0 ? "+" : ""}{peor.diferencia.toLocaleString("es-DO")} ({peor.porcentaje.toFixed(1)}%).
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => printCuadre(snapshot)} variant="outline" className="gap-2">
          <Download className="h-4 w-4" /> Descargar PDF
        </Button>
        <Button onClick={() => exportCuadreXlsx({ snapshot, sesiones })} variant="outline" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" /> Exportar Excel
        </Button>
        <Button onClick={onReset} variant="ghost" className="ml-auto gap-2">
          <RotateCcw className="h-4 w-4" /> Nuevo cuadre
        </Button>
      </div>
    </div>
  )
}

function KpiTile({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "error" | "info" | "neutral" }) {
  const cls = tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700"
    : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "info" ? "border-sky-200 bg-sky-50 text-sky-700"
    : "border-slate-200 bg-white text-slate-700"
  return (
    <div className={`rounded-2xl border p-4 text-center ${cls}`}>
      <div className="font-heading text-2xl font-black tracking-tight">{value.toLocaleString("es-DO")}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.16em]">{label}</div>
    </div>
  )
}
