"use client"

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, ChevronLeft, FileSpreadsheet, Loader2, Save, Upload, UploadCloud, CheckCircle2, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { fmtN } from "@/lib/fmt"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { loadXLSX } from "@/lib/load-xlsx"
import {
  markDuplicatesAgainstExisting,
  parseAgendaProWorkbook,
  type ParsedDisparoRow,
} from "@/lib/agendapro-parser"
import {
  parseEquiposDashboard,
  type ParsedEquipoDashboard,
  type EquiposDashboardResult,
} from "@/lib/equipos-dashboard-parser"
import {
  calculateLecturaInicial,
  type PulseReading,
  type LecturaInicialSource,
} from "@/lib/pulse-engine"
import { makeAgendaMatchKey, normalizeSucursal, normalizeOperadora } from "@/lib/normalize-pulse"
import { detectPulseFileType, extractAgendaProPeriod } from "@/lib/pulse-file-detector"
import { getOperationalWeek, type OperationalWeek } from "@/lib/operational-week"
import { signedColorClass } from "@/lib/pulse-colors"

// ─── Tipos locales ────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3

interface LecturasFile {
  filename: string
  result: EquiposDashboardResult
}

interface AgendaProFile {
  filename: string
  rows: ParsedDisparoRow[]
  period_start: string
  period_end: string
  period_label: string
}

interface ReviewRow extends ParsedEquipoDashboard {
  lectura_inicial: number
  lectura_inicial_source: LecturaInicialSource
  disp_laser: number
  // AgendaPro match
  disp_operador?: number
  diferencia?: number
  diferencia_pct?: number
  sin_match_agendapro?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return "-"
  try {
    const clean = d.split("T")[0]
    return new Date(clean + "T12:00:00").toLocaleDateString("es-DO", {
      day: "2-digit", month: "short", year: "numeric",
    })
  } catch { return d }
}

function SourceBadge({ source }: { source: LecturaInicialSource }) {
  if (source === "historico") return <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">Hist.</Badge>
  return <Badge className="text-[10px] bg-slate-100 text-slate-600 border-slate-200">1ª lectura</Badge>
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PulsosCuadreSemanalPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()

  const [step, setStep] = useState<WizardStep>(1)

  // Step 1 state
  const [lecturasFile, setLecturasFile] = useState<LecturasFile | null>(null)
  const [agendaFile, setAgendaFile] = useState<AgendaProFile | null>(null)
  const [parsingLecturas, setParsingLecturas] = useState(false)
  const [parsingAgenda, setParsingAgenda] = useState(false)
  const [manualPeriodStart, setManualPeriodStart] = useState("")
  const [manualPeriodEnd, setManualPeriodEnd] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // Step 2 state
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])
  const [saving, setSaving] = useState(false)
  const [progressMsg, setProgressMsg] = useState("")
  const [savedCount, setSavedCount] = useState(0)
  const [savedSesionesCount, setSavedSesionesCount] = useState(0)
  const [weekPage, setWeekPage] = useState(0)
  const [deletingShotsFor, setDeletingShotsFor] = useState<string | null>(null)
  const WEEKS_PER_PAGE = 5

  const lecturasInputRef = useRef<HTMLInputElement>(null)
  const agendaInputRef = useRef<HTMLInputElement>(null)
  const dropInputRef = useRef<HTMLInputElement>(null)

  const pulseReadings = useMemo(() => dbPulsos.pulseReadings ?? [], [dbPulsos.pulseReadings])

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  // Período efectivo: del archivo si fue detectado, si no del input manual.
  // Prioridad: Lecturas > AgendaPro > manual.
  const effectivePeriod = useMemo(() => {
    const lf = lecturasFile
    if (lf?.result.period_start && lf?.result.period_end) {
      return { start: lf.result.period_start, end: lf.result.period_end, label: lf.result.period_label }
    }
    if (agendaFile?.period_start && agendaFile?.period_end) {
      return { start: agendaFile.period_start, end: agendaFile.period_end, label: agendaFile.period_label }
    }
    return { start: manualPeriodStart, end: manualPeriodEnd, label: "" }
  }, [lecturasFile, agendaFile, manualPeriodStart, manualPeriodEnd])

  // Bucket AgendaPro por semana operativa (lunes–sábado). Cada bucket lleva
  // la suma por sucursal+operadora canónicos. Esto reemplaza la suma global
  // de todo el archivo cuando el AgendaPro abarca varias semanas.
  type WeekBucketRow = {
    sucursal: string; sucursalNorm: string
    operadora: string; operadoraNorm: string
    sesiones: number; disparos: number
  }
  type WeekBucket = {
    week: OperationalWeek
    rowsByKey: Map<string, WeekBucketRow>
    totalSesiones: number
    totalDisparos: number
  }
  const weekBuckets = useMemo<WeekBucket[]>(() => {
    if (!agendaFile) return []
    const buckets = new Map<string, WeekBucket>()
    for (const r of agendaFile.rows) {
      // El resumen semanal de disparos (DISP OPERADOR) debe sumar TODAS las filas
      // reales del archivo de la semana, NO solo las nuevas. El dedup
      // (already_imported / duplicate_file) aplica al import de SESIONES, no al
      // total de disparos del operador. Solo excluimos filas con error real.
      if (r.status === "error") continue
      const week = getOperationalWeek(r.fecha)
      if (!week) continue
      const sucursalNorm = normalizeSucursal(r.sucursal)
      const operadoraNorm = normalizeOperadora(r.operadora)
      if (!sucursalNorm || !operadoraNorm) continue // descarta cabecera/basura
      let bucket = buckets.get(week.period_start)
      if (!bucket) {
        bucket = { week, rowsByKey: new Map(), totalSesiones: 0, totalDisparos: 0 }
        buckets.set(week.period_start, bucket)
      }
      const key = `${sucursalNorm}|${operadoraNorm}`
      const existing = bucket.rowsByKey.get(key)
      if (existing) {
        existing.sesiones += 1
        existing.disparos += r.disparos
      } else {
        bucket.rowsByKey.set(key, {
          sucursal: r.sucursal, sucursalNorm,
          operadora: r.operadora, operadoraNorm,
          sesiones: 1, disparos: r.disparos,
        })
      }
      bucket.totalSesiones += 1
      bucket.totalDisparos += r.disparos
    }
    return Array.from(buckets.values()).sort(
      (a, b) => a.week.period_start.localeCompare(b.week.period_start),
    )
  }, [agendaFile])

  // Lecturas existentes en csl_pulse_readings que cubren EXACTAMENTE el mismo
  // período (start + end). pulseReadings ya viene filtrado por business_id desde
  // el backend, así que esta comparación es segura por tenant.
  const existingForPeriod = useMemo(() => {
    if (!effectivePeriod.start || !effectivePeriod.end) return []
    return pulseReadings.filter(
      r =>
        String(r.period_start || "").slice(0, 10) === effectivePeriod.start &&
        String(r.period_end || "").slice(0, 10) === effectivePeriod.end,
    )
  }, [pulseReadings, effectivePeriod.start, effectivePeriod.end])

  // ── Paso 1: Cargar archivos ─────────────────────────────────────────────────

  /**
   * Procesa un archivo según el tipo detectado automáticamente.
   * Retorna el tipo detectado para que el caller pueda informar al usuario.
   */
  const processFile = async (file: File): Promise<"agendapro" | "equipos" | "unknown"> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const XLSX = await loadXLSX() as any
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: "array" })
    const type = detectPulseFileType(wb)
    if (type === "equipos") {
      const result = parseEquiposDashboard(XLSX, wb, file.name)
      if (!result.rows.length) {
        showToast(`${file.name}: no se encontraron filas de equipos`, "error")
        return "equipos"
      }
      setLecturasFile({ filename: file.name, result })
      const periodTxt = result.period_start
        ? ` · ${fmtDate(result.period_start)} — ${fmtDate(result.period_end)}`
        : ""
      showToast(`Lecturas: ${result.rows.length} equipos de ${file.name}${periodTxt}`, "success")
      return "equipos"
    }
    if (type === "agendapro") {
      const parsed = await parseAgendaProWorkbook(wb, XLSX)
      const marked = markDuplicatesAgainstExisting(parsed.rows, dbPulsos.sesionesCliente)
      // Período: 1° desde row 1 del archivo, 2° desde fechas de las filas, 3° del nombre
      let period = extractAgendaProPeriod(wb, XLSX, file.name)
      if (!period) {
        const fechas = marked.map(r => r.fecha).filter(Boolean).sort()
        if (fechas[0] && fechas[fechas.length - 1]) {
          period = {
            start: fechas[0],
            end: fechas[fechas.length - 1],
            label: `${fmtDate(fechas[0])} — ${fmtDate(fechas[fechas.length - 1])}`,
          }
        }
      }
      setAgendaFile({
        filename: file.name,
        rows: marked,
        period_start: period?.start || "",
        period_end: period?.end || "",
        period_label: period?.label || "",
      })
      const periodTxt = period ? ` · ${fmtDate(period.start)} — ${fmtDate(period.end)}` : ""
      showToast(`AgendaPro: ${marked.length} filas de ${file.name}${periodTxt}`, "success")
      return "agendapro"
    }
    showToast(
      `${file.name}: formato no reconocido. Esperaba Excel de AgendaPro (hoja "Detalle Disparos tratamientos") o de equipos (hoja "Equipos").`,
      "error",
    )
    return "unknown"
  }

  /**
   * Procesa una lista de archivos arrastrados o seleccionados. Acepta múltiples
   * archivos a la vez (típicamente: AgendaPro + Equipos en una misma carga).
   */
  const processFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name))
    if (!list.length) {
      showToast("Arrastra archivos .xlsx, .xls o .csv", "error")
      return
    }
    setBulkProcessing(true)
    try {
      for (const file of list) {
        try {
          await processFile(file)
        } catch (err) {
          showToast(
            `Error en ${file.name}: ${err instanceof Error ? err.message : String(err)}`,
            "error",
          )
        }
      }
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleLecturasUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setParsingLecturas(true)
    try {
      await processFile(file)
    } catch (err) {
      showToast(`Error al leer ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setParsingLecturas(false)
    }
  }

  const handleAgendaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setParsingAgenda(true)
    try {
      await processFile(file)
    } catch (err) {
      showToast(`Error al leer ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setParsingAgenda(false)
    }
  }

  const handleDropZoneSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || !files.length) return
    e.target.value = ""
    await processFiles(files)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files || !files.length) return
    await processFiles(files)
  }

  const buildReviewRows = (): ReviewRow[] => {
    const { start: periodStart, end: periodEnd } = effectivePeriod
    const rows: ReviewRow[] = (lecturasFile?.result.rows ?? []).map(row => {
      const { value: lectura_inicial, source: lectura_inicial_source } = calculateLecturaInicial(
        pulseReadings, row.equipo_id, periodStart || new Date().toISOString().slice(0, 10),
      )
      const disp_laser = row.pulsos - lectura_inicial
      return { ...row, lectura_inicial, lectura_inicial_source, disp_laser }
    })

    // Si hay AgendaPro, calcular disparos operador usando clave canónica.
    // CRÍTICO: solo sumar filas dentro del rango de la semana activa. Si el
    // archivo AgendaPro trae datos de más de una semana, sin este filtro
    // disp_operador acumula disparos de semanas anteriores.
    if (agendaFile) {
      const dispByKey = new Map<string, number>()
      for (const r of agendaFile.rows.filter(r => r.status === "valid")) {
        const fecha = String(r.fecha || "").slice(0, 10)
        // Si tenemos rango definido, descartar filas fuera de la semana.
        if (periodStart && periodEnd && (fecha < periodStart || fecha > periodEnd)) continue
        const key = makeAgendaMatchKey(r.sucursal, r.operadora)
        if (!key) continue // descarta cabecera/basura (SUCURSAL/OPERADORA, etc.)
        dispByKey.set(key, (dispByKey.get(key) || 0) + r.disparos)
      }

      return rows.map(row => {
        const key = makeAgendaMatchKey(row.sucursal, row.operadora)
        const dispOp = key ? dispByKey.get(key) : undefined
        const matched = dispOp !== undefined && dispOp > 0
        const disp_operador = matched ? dispOp : undefined
        const diferencia = matched ? dispOp - row.disp_laser : undefined
        const diferencia_pct = matched && row.disp_laser > 0
          ? Math.round(((dispOp! - row.disp_laser) / row.disp_laser) * 10000) / 100
          : undefined
        return {
          ...row,
          disp_operador,
          diferencia,
          diferencia_pct,
          sin_match_agendapro: !matched,
        }
      })
    }

    return rows
  }

  /** Elimina TODOS los operator_shots guardados para una semana específica del
   *  tenant activo. Útil cuando se subió un AgendaPro equivocado y se quiere
   *  empezar de cero esa semana. */
  const handleDeleteShotsForWeek = async (periodStart: string, periodEnd: string, label: string) => {
    if (!confirm(
      `¿Eliminar TODOS los resúmenes guardados de la semana ${label}?\n\n` +
      `Esto borra las filas de csl_operator_shots para esta semana (este tenant). ` +
      `Las lecturas láser (csl_pulse_readings) NO se tocan.`
    )) return
    setDeletingShotsFor(periodStart)
    try {
      const res = await apiCallLocal({
        action: "deleteOperatorShotsByPeriod",
        periodStart,
        periodEnd,
      }) as { ok?: boolean; deleted?: number; tableMissing?: boolean }
      const n = Number(res?.deleted) || 0
      if (res?.tableMissing) {
        showToast("La tabla csl_operator_shots aún no existe.", "info")
      } else {
        // Actualizar store: quitar shots de esa semana en este tenant
        setDbPulsos({
          ...dbPulsos,
          operatorShots: (dbPulsos.operatorShots ?? []).filter(
            s => !(String(s.period_start).slice(0, 10) === periodStart && String(s.period_end).slice(0, 10) === periodEnd),
          ),
        })
        showToast(`${n} resumen(es) eliminado(s)`, "success")
      }
    } catch (err) {
      showToast(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setDeletingShotsFor(null)
    }
  }

  const handleContinuar = () => {
    // Aceptar cualquiera de los dos archivos como entrada válida.
    if (!lecturasFile && !agendaFile) return
    if (!effectivePeriod.start || !effectivePeriod.end) {
      showToast("Indica el período de la semana", "error")
      return
    }
    setReviewRows(buildReviewRows())
    setStep(2)
  }

  // ── Paso 2: Revisar y guardar ───────────────────────────────────────────────

  const handleGuardar = async () => {
    // Aceptar guardar con cualquiera de las dos fuentes (o ambas).
    if (!reviewRows.length && !agendaFile) return
    setSaving(true)
    setProgressMsg("Preparando datos…")
    try {
      // ── 1) Persistir lecturas semanales (csl_pulse_readings) ────────────
      // Si no hay archivo de lecturas, este loop simplemente se salta.
      const saved: PulseReading[] = []
      for (const row of reviewRows) {
        const payload: Record<string, string | number> = {
          equipo_id: row.equipo_id,
          serial: row.serial || "",
          sucursal: row.sucursal,
          cabina: row.cabina || "",
          operadora: row.operadora || "",
          period_start: effectivePeriod.start,
          period_end: effectivePeriod.end,
          period_label: effectivePeriod.label || `${effectivePeriod.start} al ${effectivePeriod.end}`,
          lectura_inicial: row.lectura_inicial,
          lectura_final: row.pulsos,
          estado_cuadre: agendaFile ? "cuadre_completo" : "lectura_guardada",
          estado_mantenimiento: row.estado || "",
          fallas: row.fallas || "",
          source_file: lecturasFile?.filename || "",
          source_type: "excel_equipos",
          observaciones: "",
        }
        if (row.disp_operador !== undefined) payload.disp_operador = row.disp_operador
        if (row.diferencia_pct !== undefined) payload.diferencia_pct = row.diferencia_pct

        const res = await apiCallLocal({ action: "savePulseReading", data: JSON.stringify(payload) })
        if (res.record) saved.push(res.record as PulseReading)
      }

      // ── 2a) Persistir resumen semanal (csl_operator_shots) ──────────────
      // Una fila por (tenant, semana operativa, sucursal_norm, operadora_norm).
      // Bucketea internamente por getOperationalWeek(fecha) — ignora el rango
      // global del archivo. Si la tabla aún no existe, el handler lo reporta
      // y seguimos sin error (gradual rollout).
      let shotsUpserted = 0
      let shotsTableMissing = false
      let crossTenantOmitidas = 0
      if (agendaFile && weekBuckets.length > 0) {
        const shotsPayload: Record<string, unknown>[] = []
        for (const bucket of weekBuckets) {
          for (const row of bucket.rowsByKey.values()) {
            shotsPayload.push({
              period_start: bucket.week.period_start,
              period_end: bucket.week.period_end,
              period_label: bucket.week.period_label,
              sucursal_original: row.sucursal,
              sucursal_normalizada: row.sucursalNorm,
              operadora_original: row.operadora,
              operadora_normalizada: row.operadoraNorm,
              sesiones: row.sesiones,
              disparos: row.disparos,
              source_file: agendaFile.filename,
              source_type: "agendapro",
            })
          }
        }
        if (shotsPayload.length) {
          setProgressMsg("Guardando resumen semanal…")
          const res = await apiCallLocal({
            action: "saveOperatorShots",
            data: JSON.stringify({ rows: shotsPayload }),
          }) as { ok?: boolean; upserted?: number; tableMissing?: boolean; skipped?: number }
          shotsUpserted = Number(res?.upserted) || 0
          shotsTableMissing = Boolean(res?.tableMissing)
          crossTenantOmitidas += Number(res?.skipped) || 0
        }
      }

      // ── 2b) Persistir sesiones AgendaPro individuales (csl_sesiones_cliente)
      // Idempotente por ImportHash (UNIQUE parcial en DB). Solo persiste filas
      // que caen en TODAS las semanas operativas detectadas — actúa como
      // respaldo cuando aún no existe csl_operator_shots.
      let sesionesInsertadas = 0
      let sesionesDuplicadas = 0
      const sesionesLocal: Record<string, unknown>[] = []
      if (agendaFile) {
        // Persistir TODAS las filas válidas del AgendaPro (cada una con su
        // fecha real). El bucketing por semana se hace en operator_shots
        // arriba. Aquí actuamos como respaldo cuando operator_shots no exista.
        const validRows = agendaFile.rows.filter(r => {
          if (r.status !== "valid") return false
          if (!getOperationalWeek(r.fecha)) return false
          if (!makeAgendaMatchKey(r.sucursal, r.operadora)) return false
          return true
        })
        // Mapa para resolver equipo_id desde sucursal+operadora canónicos
        const equipoByKey = new Map<string, { equipoId: string; cabina: string }>()
        for (const row of reviewRows) {
          const key = makeAgendaMatchKey(row.sucursal, row.operadora)
          if (key && !key.startsWith("|") && !equipoByKey.has(key)) {
            equipoByKey.set(key, { equipoId: row.equipo_id, cabina: row.cabina || "" })
          }
        }
        const ts = Date.now()
        const sesionesPayload: Record<string, unknown>[] = validRows.map((r, idx) => {
          const assignment = equipoByKey.get(makeAgendaMatchKey(r.sucursal, r.operadora))
          return {
            SesionID: `ses_${ts}_${idx}`,
            Fecha: r.fecha,
            EquipoID: assignment?.equipoId || "",
            Sucursal: r.sucursal,
            Cabina: assignment?.cabina || "",
            OperadoraID: r.operadora,
            Cliente: r.cliente || "Sin cliente",
            AreaTrabajada: r.tratamiento.replace(/^depilaci[oó]n\s*-\s*/i, "").trim(),
            DisparosReportados: r.disparos,
            ContactoCliente: r.contacto || undefined,
            Tratamiento: r.tratamiento || undefined,
            Potencia: r.potencia || undefined,
            Spot: r.spot || undefined,
            ArchivoOrigen: agendaFile.filename,
            FilaOrigen: r.filaOrigen,
            ImportHash: r.hash || undefined,
            Observaciones: r.disparosRaw && r.disparosRaw !== String(r.disparos)
              ? `Disparos Excel: ${r.disparosRaw}` : "",
          }
        })
        // Guardado MASIVO en UNA sola llamada (el backend inserta por chunks y
        // dedup por import_hash) — en vez de 1 request por sesión.
        if (sesionesPayload.length) {
          setProgressMsg(`Guardando ${sesionesPayload.length} sesiones…`)
          try {
            const res = await apiCallLocal({ action: "saveSesionesBatch", data: JSON.stringify({ sesiones: sesionesPayload }) }) as
              { ok?: boolean; inserted?: number; duplicates?: number; errors?: number; skipped?: number }
            sesionesInsertadas = Number(res?.inserted) || 0
            sesionesDuplicadas = Number(res?.duplicates) || 0
            crossTenantOmitidas += Number(res?.skipped) || 0
            if (sesionesInsertadas > 0) sesionesLocal.push(...sesionesPayload)
          } catch (err) {
            console.warn("saveSesionesBatch error:", err)
            showToast("No se pudieron guardar las sesiones (ver consola)", "error")
          }
        }
      }

      // ── 3) Actualizar store local con todo lo nuevo ─────────────────────
      const existingIds = new Set(saved.map(r => r.id))
      const updatedReadings = [
        ...pulseReadings.filter(r => !existingIds.has(r.id)),
        ...saved,
      ]
      const sesionesIds = new Set(sesionesLocal.map(s => String(s.SesionID)))
      const updatedSesiones = sesionesLocal.length
        ? [
            ...dbPulsos.sesionesCliente.filter(s => !sesionesIds.has(String(s.SesionID))),
            ...(sesionesLocal as unknown as typeof dbPulsos.sesionesCliente),
          ]
        : dbPulsos.sesionesCliente
      setDbPulsos({ ...dbPulsos, pulseReadings: updatedReadings, sesionesCliente: updatedSesiones })
      setSavedCount(saved.length)
      setSavedSesionesCount(sesionesInsertadas)
      if (shotsUpserted > 0) {
        showToast(
          `${shotsUpserted} resumen(es) semanal(es) guardado(s) en ${weekBuckets.length} semana(s)`,
          "success",
        )
      } else if (shotsTableMissing) {
        showToast(
          "Resumen semanal pendiente: corre la migración 202605310001_csl_operator_shots.sql en Supabase",
          "info",
        )
      }
      if (sesionesInsertadas > 0) {
        showToast(
          `${sesionesInsertadas} sesión(es) AgendaPro guardada(s)` +
            (sesionesDuplicadas > 0 ? ` · ${sesionesDuplicadas} duplicada(s) omitida(s)` : ""),
          "success",
        )
      }
      if (crossTenantOmitidas > 0) {
        showToast(
          `${crossTenantOmitidas} fila(s) de sucursales de otro negocio omitida(s) (no tienes acceso a ese tenant)`,
          "info",
        )
      }
      setStep(3)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
      setProgressMsg("")
    }
  }

  const resetWizard = () => {
    setStep(1)
    setLecturasFile(null)
    setAgendaFile(null)
    setReviewRows([])
    setSavedCount(0)
    setSavedSesionesCount(0)
    setWeekPage(0)
    setManualPeriodStart("")
    setManualPeriodEnd("")
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Cuadre semanal · {business.shortName}
        </p>
        <h2 className="mt-1 text-xl font-black tracking-tight">Asistente de cuadre semanal</h2>
      </div>

      {/* ── PASO 1: Subir archivos ─────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Paso 1 · Subir archivos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Dropzone: arrastrar y soltar con detección automática */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`relative rounded-xl border-2 border-dashed transition-colors px-4 py-6 text-center cursor-pointer ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"
              }`}
              onClick={() => dropInputRef.current?.click()}
            >
              <input
                ref={dropInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={handleDropZoneSelect}
              />
              <div className="flex flex-col items-center gap-2">
                {bulkProcessing ? (
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                ) : (
                  <UploadCloud className={`w-8 h-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
                )}
                <div className="text-sm font-semibold">
                  {bulkProcessing
                    ? "Procesando archivos..."
                    : dragOver
                      ? "Suelta los archivos aquí"
                      : "Arrastra archivos aquí o haz clic para seleccionar"}
                </div>
                <div className="text-xs text-muted-foreground">
                  AgendaPro y/o Lecturas (.xlsx, .xls, .csv) — el tipo y la semana se detectan automáticamente
                </div>
                <div className="flex gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px]">AgendaPro: hoja "Detalle Disparos tratamientos"</Badge>
                  <Badge variant="outline" className="text-[10px]">Lecturas: hoja "Equipos"</Badge>
                </div>
              </div>
            </div>

            {/* Aviso: el período detectado ya tiene lecturas en este tenant */}
            {existingForPeriod.length > 0 && effectivePeriod.start && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    Esta semana ya tiene {existingForPeriod.length} lectura{existingForPeriod.length !== 1 ? "s" : ""} guardada{existingForPeriod.length !== 1 ? "s" : ""}
                  </div>
                  <div className="text-amber-800">
                    Período {fmtDate(effectivePeriod.start)} — {fmtDate(effectivePeriod.end)}. Si continúas, las lecturas existentes se sobrescribirán equipo por equipo.
                  </div>
                </div>
              </div>
            )}

            {/* Estado de archivos detectados (resumen rápido si hay alguno) */}
            {(lecturasFile || agendaFile) && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className={`rounded-lg border px-3 py-2 text-xs ${
                  lecturasFile ? "border-emerald-200 bg-emerald-50" : "border-muted bg-muted/20"
                }`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {lecturasFile
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      : <Upload className="w-3.5 h-3.5 text-muted-foreground" />}
                    Lecturas (Equipos)
                  </div>
                  {lecturasFile && (
                    <div className="mt-0.5 text-[11px] text-emerald-800/80 truncate">
                      {lecturasFile.filename} · {lecturasFile.result.rows.length} equipos
                    </div>
                  )}
                </div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${
                  agendaFile ? "border-emerald-200 bg-emerald-50" : "border-muted bg-muted/20"
                }`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {agendaFile
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      : <Upload className="w-3.5 h-3.5 text-muted-foreground" />}
                    AgendaPro (opcional)
                  </div>
                  {agendaFile && (
                    <div className="mt-0.5 text-[11px] text-emerald-800/80 truncate">
                      {agendaFile.filename} · {agendaFile.rows.length} filas
                      {agendaFile.period_start ? ` · ${fmtDate(agendaFile.period_start)} — ${fmtDate(agendaFile.period_end)}` : ""}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Lecturas (obligatorio) */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Excel de lecturas (Equipos Dashboard) <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Archivo con hoja "Equipos". Nombre esperado: <code className="text-[11px]">DD_DD_Mes_YYYY.xlsx</code> para detectar el período automáticamente.
              </p>
              {lecturasFile ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{lecturasFile.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {lecturasFile.result.rows.length} equipos
                      {lecturasFile.result.period_start
                        ? ` · Período: ${fmtDate(lecturasFile.result.period_start)} — ${fmtDate(lecturasFile.result.period_end)}`
                        : " · Período no detectado"}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setLecturasFile(null)}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div>
                  <input
                    ref={lecturasInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleLecturasUpload}
                  />
                  <Button
                    variant="outline"
                    onClick={() => lecturasInputRef.current?.click()}
                    disabled={parsingLecturas}
                  >
                    {parsingLecturas ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Seleccionar archivo de lecturas
                  </Button>
                </div>
              )}
            </div>

            {/* Período manual si no se detectó */}
            {lecturasFile && !lecturasFile.result.period_start && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <AlertTriangle className="w-4 h-4" />
                  Período no detectado automáticamente
                </div>
                <p className="text-xs text-amber-700">
                  El nombre del archivo no sigue el formato <code>DD_DD_Mes_YYYY</code>. Indica el período manualmente:
                </p>
                <div className="flex gap-3 items-center">
                  <Input
                    type="date"
                    className="w-36 h-8 text-sm"
                    value={manualPeriodStart}
                    onChange={e => setManualPeriodStart(e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground">al</span>
                  <Input
                    type="date"
                    className="w-36 h-8 text-sm"
                    value={manualPeriodEnd}
                    min={manualPeriodStart}
                    onChange={e => setManualPeriodEnd(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* AgendaPro (opcional) */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">
                Importar AgendaPro <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Si lo subis, el cuadre incluirá columnas de DISP Operador y Diferencia.
              </p>
              {agendaFile ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{agendaFile.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {agendaFile.rows.length} filas · {fmtDate(agendaFile.period_start)} — {fmtDate(agendaFile.period_end)}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setAgendaFile(null)}>
                    Quitar
                  </Button>
                </div>
              ) : (
                <div>
                  <input
                    ref={agendaInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleAgendaUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => agendaInputRef.current?.click()}
                    disabled={parsingAgenda}
                  >
                    {parsingAgenda ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Seleccionar AgendaPro
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleContinuar}
                disabled={!lecturasFile && !agendaFile}
              >
                Continuar →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PASO 2: Revisar y guardar ──────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Paso 2 · Revisar{agendaFile ? " y cuadrar" : ""}
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                Período: <strong>{fmtDate(effectivePeriod.start)} — {fmtDate(effectivePeriod.end)}</strong>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Aviso de semana ya existente con conteo de overlaps por equipo */}
            {existingForPeriod.length > 0 && (() => {
              const existingIds = new Set(existingForPeriod.map(r => r.equipo_id))
              const overlap = reviewRows.filter(r => existingIds.has(r.equipo_id)).length
              const newly = reviewRows.length - overlap
              return (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div className="space-y-0.5">
                    <div className="font-semibold">
                      Esta semana ya tiene lecturas guardadas
                    </div>
                    <div className="text-amber-800">
                      Al guardar: <strong>{overlap}</strong> equipo{overlap !== 1 ? "s" : ""} se sobrescribirá{overlap !== 1 ? "n" : ""}
                      {newly > 0 ? <> · <strong>{newly}</strong> equipo{newly !== 1 ? "s" : ""} nuevo{newly !== 1 ? "s" : ""}</> : null}
                      {" "}({fmtDate(effectivePeriod.start)} — {fmtDate(effectivePeriod.end)})
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Advertencias no bloqueantes */}
            {agendaFile && reviewRows.some(r => r.sin_match_agendapro) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {reviewRows.filter(r => r.sin_match_agendapro).length} equipo(s) sin match en AgendaPro
                  — se guardarán solo con lectura láser.
                </span>
              </div>
            )}

            {/* Vista AgendaPro-only: una tarjeta por semana operativa (lunes-sábado)
                 Orden: semana más reciente primero. Paginación de 5 semanas por página. */}
            {!reviewRows.length && agendaFile && weekBuckets.length > 0 && (() => {
              const totalSesiones = weekBuckets.reduce((s, b) => s + b.totalSesiones, 0)
              const totalDisparos = weekBuckets.reduce((s, b) => s + b.totalDisparos, 0)
              const weeksDesc = [...weekBuckets].sort(
                (a, b) => b.week.period_start.localeCompare(a.week.period_start),
              )
              const totalPages = Math.max(1, Math.ceil(weeksDesc.length / WEEKS_PER_PAGE))
              const page = Math.min(weekPage, totalPages - 1)
              const startIdx = page * WEEKS_PER_PAGE
              const pageWeeks = weeksDesc.slice(startIdx, startIdx + WEEKS_PER_PAGE)
              return (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                    <div>
                      <div className="font-semibold">
                        Archivo dividido en {weekBuckets.length} semana{weekBuckets.length !== 1 ? "s" : ""} operativa{weekBuckets.length !== 1 ? "s" : ""} (lunes–sábado) · más reciente primero
                      </div>
                      <div className="text-blue-800">
                        Total: {totalSesiones} sesiones · {fmtN(totalDisparos)} disparos. Al guardar, cada semana se almacena por separado.
                      </div>
                    </div>
                  </div>

                  {/* Paginación: solo mostrar controles si hay más de WEEKS_PER_PAGE semanas */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-muted bg-muted/20 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        Mostrando {startIdx + 1}–{Math.min(startIdx + WEEKS_PER_PAGE, weeksDesc.length)} de {weeksDesc.length} semanas
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          disabled={page === 0}
                          onClick={() => setWeekPage(p => Math.max(0, p - 1))}
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          Anterior
                        </Button>
                        <span className="px-2 font-medium">{page + 1} / {totalPages}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          disabled={page >= totalPages - 1}
                          onClick={() => setWeekPage(p => Math.min(totalPages - 1, p + 1))}
                        >
                          Siguiente
                          <ChevronLeft className="w-3.5 h-3.5 rotate-180" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {pageWeeks.map((bucket) => {
                    const rows = Array.from(bucket.rowsByKey.values()).sort((a, b) => {
                      if (a.sucursalNorm !== b.sucursalNorm) return a.sucursalNorm.localeCompare(b.sucursalNorm)
                      return a.operadoraNorm.localeCompare(b.operadoraNorm)
                    })
                    const sucursales = Array.from(new Set(rows.map(r => r.sucursalNorm)))
                    // ¿Esta semana ya tiene shots guardados en el tenant?
                    const savedShots = (dbPulsos.operatorShots ?? []).filter(
                      s => String(s.period_start).slice(0, 10) === bucket.week.period_start &&
                           String(s.period_end).slice(0, 10) === bucket.week.period_end,
                    )
                    const hasSavedShots = savedShots.length > 0
                    return (
                      <Card key={bucket.week.period_start} className="overflow-hidden">
                        <CardHeader className="py-2 px-3 bg-muted/30 border-b">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                              <div className="text-sm font-semibold">Semana {bucket.week.period_label}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {bucket.totalSesiones} sesiones · {fmtN(bucket.totalDisparos)} disparos · {sucursales.length} sucursal(es) · {rows.length} operadora(s)
                                {hasSavedShots && (
                                  <span className="ml-2 text-amber-700">· {savedShots.length} ya guardados</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline" className="text-[10px]">
                                {bucket.week.period_start} → {bucket.week.period_end}
                              </Badge>
                              {hasSavedShots && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteShotsForWeek(
                                    bucket.week.period_start,
                                    bucket.week.period_end,
                                    bucket.week.period_label,
                                  )}
                                  disabled={deletingShotsFor === bucket.week.period_start}
                                  title="Eliminar shots guardados de esta semana"
                                >
                                  {deletingShotsFor === bucket.week.period_start
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <Trash2 className="h-3.5 w-3.5" />}
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="p-0 overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Sucursal</TableHead>
                                <TableHead className="text-xs">Operadora</TableHead>
                                <TableHead className="text-xs text-right">Sesiones</TableHead>
                                <TableHead className="text-xs text-right">Disparos</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((r, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-xs">{r.sucursalNorm}</TableCell>
                                  <TableCell className="text-xs">{r.operadoraNorm}</TableCell>
                                  <TableCell className="text-xs text-right font-mono">{r.sesiones}</TableCell>
                                  <TableCell className="text-xs text-right font-mono text-primary font-semibold">{fmtN(r.disparos)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )
            })()}

            {reviewRows.length > 0 && <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Equipo</TableHead>
                    <TableHead className="text-xs">Sucursal</TableHead>
                    <TableHead className="text-xs">Cabina</TableHead>
                    <TableHead className="text-xs">Operadora</TableHead>
                    <TableHead className="text-xs text-right">Inicio</TableHead>
                    <TableHead className="text-xs text-right">Fin</TableHead>
                    <TableHead className="text-xs text-right">DISP Láser</TableHead>
                    {agendaFile && <TableHead className="text-xs text-right">DISP Op.</TableHead>}
                    {agendaFile && <TableHead className="text-xs text-right">Diferencia</TableHead>}
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs">Fallas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewRows.map(row => (
                    <TableRow key={row.equipo_id}>
                      <TableCell className="text-xs font-mono">{row.equipo_id}</TableCell>
                      <TableCell className="text-xs">{row.sucursal || "-"}</TableCell>
                      <TableCell className="text-xs">{row.cabina || "-"}</TableCell>
                      <TableCell className="text-xs">{row.operadora || "-"}</TableCell>
                      <TableCell className="text-xs text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="font-mono">{fmtN(row.lectura_inicial)}</span>
                          <SourceBadge source={row.lectura_inicial_source} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtN(row.pulsos)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-primary font-semibold">
                        +{fmtN(row.disp_laser)}
                      </TableCell>
                      {agendaFile && (
                        <TableCell className="text-xs text-right font-mono">
                          {row.sin_match_agendapro
                            ? <Badge variant="outline" className="text-[10px] text-muted-foreground">Sin match</Badge>
                            : fmtN(row.disp_operador ?? 0)
                          }
                        </TableCell>
                      )}
                      {agendaFile && (
                        <TableCell className="text-xs text-right font-mono">
                          {row.diferencia !== undefined ? (
                            <span className={signedColorClass(row.diferencia)}>
                              {row.diferencia > 0 ? "+" : ""}{fmtN(row.diferencia)}
                              {row.diferencia_pct !== undefined && (
                                <span className="text-[10px] text-muted-foreground ml-1">({row.diferencia_pct}%)</span>
                              )}
                            </span>
                          ) : "-"}
                        </TableCell>
                      )}
                      <TableCell className="text-xs">{row.estado || "-"}</TableCell>
                      <TableCell className="text-xs">{row.fallas || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>}

            <div className="flex items-center justify-between gap-3">
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Volver
              </Button>
              {saving && progressMsg && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />{progressMsg}</span>
              )}
              <Button onClick={handleGuardar} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {reviewRows.length > 0 && agendaFile
                  ? "Guardar cuadre"
                  : reviewRows.length > 0
                    ? `Guardar ${reviewRows.length} lecturas`
                    : agendaFile
                      ? `Guardar AgendaPro (${agendaFile.rows.filter(r => r.status === "valid").length} filas)`
                      : "Guardar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── PASO 3: Resumen de éxito ───────────────────────────────────────── */}
      {step === 3 && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <div className="text-4xl">✓</div>
            <h3 className="text-xl font-bold">
              {savedCount > 0 ? (
                <>{savedCount} lectura{savedCount !== 1 ? "s" : ""} guardada{savedCount !== 1 ? "s" : ""}</>
              ) : (
                <>{savedSesionesCount} sesión{savedSesionesCount !== 1 ? "es" : ""} AgendaPro guardada{savedSesionesCount !== 1 ? "s" : ""}</>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              Período: {fmtDate(effectivePeriod.start)} — {fmtDate(effectivePeriod.end)}
              {savedCount > 0 && savedSesionesCount > 0
                ? ` · ${savedSesionesCount} sesión(es) AgendaPro + cuadre completo.`
                : savedCount > 0 && agendaFile
                  ? " · Cuadre con AgendaPro completado."
                  : savedCount === 0 && savedSesionesCount > 0
                    ? " · Solo AgendaPro guardado. Sube las lecturas para completar el cuadre."
                    : ""}
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={resetWizard} variant="outline">
                Nuevo cuadre
              </Button>
              <Button
                onClick={() => {
                  const { setActiveTab } = useAppStore.getState()
                  setActiveTab("pulsos-lecturas")
                }}
              >
                Ir a lecturas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
