"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAppStore, apiCall, normalizeApiUrl } from "@/lib/store"
import { loadXLSX } from "@/lib/load-xlsx"
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
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, ChevronDown, ChevronRight, FileSpreadsheet, Loader2, Plus, RotateCcw, Trash2, Upload } from "lucide-react"
import { fmtN, parseN } from "@/lib/fmt"
import { buildOperadoraResolver } from "@/lib/operadora-oficial"
import {
  type PulseReading,
  calculateLecturaInicial,
  type LecturaInicialSource,
} from "@/lib/pulse-engine"
import {
  parseEquiposDashboard,
  type ParsedEquipoDashboard,
  type EquiposDashboardResult,
} from "@/lib/equipos-dashboard-parser"

// ─── Tipos locales ────────────────────────────────────────────────────────────

interface ImportPreviewRow extends ParsedEquipoDashboard {
  lectura_inicial: number
  lectura_inicial_source: LecturaInicialSource
}

interface ImportPreview {
  filename: string
  result: EquiposDashboardResult
  period_start: string
  period_end: string
  period_label: string
  rows: ImportPreviewRow[]
}

interface ManualForm {
  equipo_id: string
  sucursal: string
  cabina: string
  operadora: string
  period_start: string
  period_end: string
  lectura_final: string
  lectura_inicial: number
  lectura_inicial_source: LecturaInicialSource
  observaciones: string
  id?: string
}

const today = new Date().toISOString().slice(0, 10)

function emptyForm(): ManualForm {
  return {
    equipo_id: "",
    sucursal: "",
    cabina: "",
    operadora: "",
    period_start: today,
    period_end: today,
    lectura_final: "",
    lectura_inicial: 0,
    lectura_inicial_source: "primera_lectura",
    observaciones: "",
  }
}

function fmtDate(d: string) {
  if (!d) return "-"
  try {
    const clean = String(d).split("T")[0].trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return d
    return new Date(clean + "T12:00:00").toLocaleDateString("es-DO", {
      day: "2-digit", month: "short", year: "numeric",
    })
  } catch { return d }
}

function fmtPeriod(start: string, end: string): string {
  if (!start) return "-"
  const s = fmtDate(start)
  const e = end && end !== start ? ` — ${fmtDate(end)}` : ""
  return `${s}${e}`
}

function SourceBadge({ source }: { source: LecturaInicialSource }) {
  if (source === "historico") {
    return <Badge className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">Histórico</Badge>
  }
  return <Badge className="text-xs bg-slate-100 text-slate-600 border border-slate-200">Primera lectura</Badge>
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PulsosLecturasPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()

  // UI state
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [form, setForm] = useState<ManualForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [recalcRunning, setRecalcRunning] = useState(false)
  const [recalcOpRunning, setRecalcOpRunning] = useState(false)
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set())

  // Inline editing: click on lectura_final cell
  const [editingFinalId, setEditingFinalId] = useState<string | null>(null)
  const [editingFinalValue, setEditingFinalValue] = useState("")
  const [savingInline, setSavingInline] = useState(false)
  const editingInputRef = useRef<HTMLInputElement>(null)

  const pulseReadings = useMemo(() => dbPulsos.pulseReadings ?? [], [dbPulsos.pulseReadings])
  // Operadora oficial por cabina/equipo desde el catálogo de equipos.
  const operadoraResolver = useMemo(() => buildOperadoraResolver(db.equipos), [db.equipos])

  // Detectar problemas de continuidad: cur.lectura_inicial ≠ prev.lectura_final
  const continuityIssues = useMemo(() => {
    const byEquipo = new Map<string, PulseReading[]>()
    for (const r of pulseReadings) {
      if (!byEquipo.has(r.equipo_id)) byEquipo.set(r.equipo_id, [])
      byEquipo.get(r.equipo_id)!.push(r)
    }
    let count = 0
    for (const [, readings] of byEquipo) {
      const sorted = [...readings].sort((a, b) => a.period_start.localeCompare(b.period_start))
      for (let i = 1; i < sorted.length; i++) {
        const prevFin = Number(sorted[i - 1].lectura_final)
        const curIni = Number(sorted[i].lectura_inicial)
        if (prevFin > 0 && curIni !== prevFin) count++
      }
    }
    return count
  }, [pulseReadings])

  // Lecturas agrupadas por período (period_start + period_end)
  const groupedByPeriod = useMemo(() => {
    const map = new Map<string, PulseReading[]>()
    for (const r of pulseReadings) {
      const key = `${r.period_start}||${r.period_end}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, readings]) => ({
        key,
        period_start: readings[0].period_start,
        period_end: readings[0].period_end,
        period_label: readings[0].period_label || "",
        readings: readings.sort((a, b) => String(a.equipo_id).localeCompare(String(b.equipo_id))),
        totalDispLaser: readings.reduce((s, r) => s + (Number(r.disp_laser) || 0), 0),
      }))
  }, [pulseReadings])

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  // Recargar pulse readings desde la API
  const reloadReadings = async () => {
    const res = await apiCallLocal({ action: "getPulseReadings" })
    if (res.records) {
      setDbPulsos({ ...dbPulsos, pulseReadings: res.records as PulseReading[] })
    }
  }

  // Auto-focus cuando se activa inline edit
  useEffect(() => {
    if (editingFinalId && editingInputRef.current) {
      editingInputRef.current.focus()
      editingInputRef.current.select()
    }
  }, [editingFinalId])

  // ── Importar Excel ──────────────────────────────────────────────────────────

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setImporting(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX = await loadXLSX() as any
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const result = parseEquiposDashboard(XLSX, wb, file.name)

      if (!result.rows.length) {
        showToast("No se encontraron filas de equipos en el archivo", "error")
        return
      }

      const previewRows: ImportPreviewRow[] = result.rows.map(row => {
        const { value, source } = calculateLecturaInicial(
          pulseReadings,
          row.equipo_id,
          result.period_start || today,
        )
        return { ...row, lectura_inicial: value, lectura_inicial_source: source }
      })

      setImportPreview({
        filename: file.name,
        result,
        period_start: result.period_start,
        period_end: result.period_end,
        period_label: result.period_label,
        rows: previewRows,
      })

      if (result.warnings.length) result.warnings.forEach(w => showToast(w, "info"))
    } catch (err) {
      showToast(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setImporting(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!importPreview) return
    setSaving(true)
    try {
      const saved: PulseReading[] = []
      for (const row of importPreview.rows) {
        const payload = {
          equipo_id: row.equipo_id,
          serial: row.serial || "",
          sucursal: row.sucursal,
          cabina: row.cabina || "",
          operadora: row.operadora || "",
          period_start: importPreview.period_start,
          period_end: importPreview.period_end,
          period_label: importPreview.period_label,
          lectura_inicial: row.lectura_inicial,
          lectura_final: row.pulsos,
          estado_cuadre: "lectura_guardada",
          estado_mantenimiento: row.estado || "",
          fallas: row.fallas || "",
          source_file: importPreview.filename,
          source_type: "excel_equipos",
          observaciones: "",
        }
        const res = await apiCallLocal({ action: "savePulseReading", data: JSON.stringify(payload) })
        if (res.record) saved.push(res.record as PulseReading)
      }

      const existingIds = new Set(saved.map(r => r.id))
      const updated = [...pulseReadings.filter(r => !existingIds.has(r.id)), ...saved]
      setDbPulsos({ ...dbPulsos, pulseReadings: updated })
      showToast(`${saved.length} lecturas guardadas`, "success")
      setImportPreview(null)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  // ── Inline edit lectura_final ───────────────────────────────────────────────

  const startEditFinal = (r: PulseReading) => {
    setEditingFinalId(r.id)
    setEditingFinalValue(String(r.lectura_final))
  }

  const cancelEditFinal = () => setEditingFinalId(null)

  const handleInlineSaveFinal = async (reading: PulseReading) => {
    const newFinal = parseN(editingFinalValue)
    setEditingFinalId(null)
    if (!newFinal || newFinal === Number(reading.lectura_final)) return
    setSavingInline(true)
    try {
      const payload = {
        id: reading.id,
        equipo_id: reading.equipo_id,
        serial: reading.serial || "",
        sucursal: reading.sucursal,
        cabina: reading.cabina || "",
        operadora: reading.operadora || "",
        period_start: reading.period_start,
        period_end: reading.period_end,
        period_label: reading.period_label || "",
        lectura_inicial: Number(reading.lectura_inicial),
        lectura_final: newFinal,
        disp_operador: reading.disp_operador != null ? Number(reading.disp_operador) : undefined,
        diferencia_pct: reading.diferencia_pct != null ? Number(reading.diferencia_pct) : undefined,
        estado_cuadre: reading.estado_cuadre || "lectura_guardada",
        estado_mantenimiento: reading.estado_mantenimiento || "",
        fallas: reading.fallas || "",
        source_type: reading.source_type || "manual",
        observaciones: reading.observaciones || "",
      }
      const res = await apiCallLocal({ action: "savePulseReading", data: JSON.stringify(payload) })
      const saved = res.record as PulseReading

      // Actualizar el registro en el store
      let updated = pulseReadings.map(r => r.id === reading.id ? saved : r)
      setDbPulsos({ ...dbPulsos, pulseReadings: updated })

      // Recalcular continuidad de semanas posteriores para este equipo
      const recalcRes = await apiCallLocal({ action: "recalculatePulseContinuity" })
      const fixed = Number(recalcRes.fixed) || 0
      if (fixed > 0) await reloadReadings()

      showToast(
        `Fin actualizado a ${fmtN(newFinal)}${fixed > 0 ? ` · ${fixed} continuidad(es) corregida(s)` : ""}`,
        "success"
      )
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSavingInline(false)
    }
  }

  // ── Formulario manual ───────────────────────────────────────────────────────

  const handleEquipoChange = (equipoId: string) => {
    const eq = db.equipos.find(e => e.EquipoID === equipoId)
    const { value, source } = calculateLecturaInicial(pulseReadings, equipoId, form.period_start || today)
    setForm(prev => ({
      ...prev,
      equipo_id: equipoId,
      sucursal: eq?.Sucursal || prev.sucursal,
      cabina: eq?.Cabina || prev.cabina,
      operadora: eq?.Operadora || prev.operadora,
      lectura_inicial: value,
      lectura_inicial_source: source,
    }))
  }

  const handlePeriodStartChange = (date: string) => {
    if (!date) return
    const { value, source } = calculateLecturaInicial(pulseReadings, form.equipo_id, date)
    setForm(prev => ({
      ...prev,
      period_start: date,
      period_end: prev.period_end < date ? date : prev.period_end,
      lectura_inicial: value,
      lectura_inicial_source: source,
    }))
  }

  const handleSaveManual = async () => {
    if (!form.equipo_id) { showToast("Selecciona un equipo", "error"); return }
    if (!form.period_start || !form.period_end) { showToast("Indica el período", "error"); return }
    const lecturaFinal = parseN(form.lectura_final)
    if (lecturaFinal <= 0) { showToast("La lectura final debe ser mayor que 0", "error"); return }

    setSaving(true)
    try {
      const payload: Record<string, string | number> = {
        equipo_id: form.equipo_id,
        sucursal: form.sucursal,
        cabina: form.cabina,
        operadora: form.operadora,
        period_start: form.period_start,
        period_end: form.period_end,
        period_label: fmtPeriod(form.period_start, form.period_end),
        lectura_inicial: form.lectura_inicial,
        lectura_final: lecturaFinal,
        estado_cuadre: "lectura_guardada",
        source_type: "manual",
        observaciones: form.observaciones,
      }
      if (form.id) payload.id = form.id

      const res = await apiCallLocal({ action: "savePulseReading", data: JSON.stringify(payload) })
      const saved = res.record as PulseReading

      const updated = form.id
        ? pulseReadings.map(r => r.id === form.id ? saved : r)
        : [...pulseReadings, saved]
      setDbPulsos({ ...dbPulsos, pulseReadings: updated })

      // Recalcular continuidad después de guardar manual
      const recalcRes = await apiCallLocal({ action: "recalculatePulseContinuity" })
      const fixed = Number(recalcRes.fixed) || 0
      if (fixed > 0) await reloadReadings()

      showToast(
        `Lectura ${form.id ? "actualizada" : "guardada"}${fixed > 0 ? ` · ${fixed} continuidad(es) corregida(s)` : ""}`,
        "success"
      )
      setManualOpen(false)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (reading: PulseReading) => {
    if (!confirm(`¿Eliminar lectura de equipo ${reading.equipo_id} (${fmtDate(reading.period_start)})?`)) return
    try {
      await apiCallLocal({ action: "deletePulseReading", id: reading.id })
      const updated = pulseReadings.filter(r => r.id !== reading.id)
      setDbPulsos({ ...dbPulsos, pulseReadings: updated })
      showToast("Lectura eliminada", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
  }

  const handleEdit = (reading: PulseReading) => {
    setForm({
      id: reading.id,
      equipo_id: reading.equipo_id,
      sucursal: reading.sucursal,
      cabina: reading.cabina || "",
      operadora: reading.operadora || "",
      period_start: reading.period_start,
      period_end: reading.period_end,
      lectura_final: String(reading.lectura_final),
      lectura_inicial: Number(reading.lectura_inicial),
      lectura_inicial_source: "historico",
      observaciones: reading.observaciones || "",
    })
    setManualOpen(true)
  }

  // ── Recalcular continuidad ──────────────────────────────────────────────────

  const handleRecalculate = async () => {
    if (!confirm("¿Recalcular continuidad? El Inicio de cada semana se corregirá al Final de la semana anterior para cada equipo.")) return
    setRecalcRunning(true)
    try {
      const res = await apiCallLocal({ action: "recalculatePulseContinuity" })
      const fixed = Number(res.fixed) || 0
      // Siempre recargar del servidor para reflejar el estado real
      await reloadReadings()
      showToast(
        fixed > 0 ? `✓ ${fixed} lectura(s) corregida(s)` : "Todo ya estaba correcto — nada que cambiar.",
        fixed > 0 ? "success" : "info"
      )
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setRecalcRunning(false)
    }
  }

  const handleRecalculateDispOperador = async () => {
    if (!confirm(
      "¿Recalcular DISP OPERADOR?\n\n" +
      "Se reescribirá disp_operador en cada lectura sumando los disparos AgendaPro " +
      "del mismo business_id + semana + sucursal + operadora (normalizadas).\n\n" +
      "Es seguro: solo actualiza valores que difieren. No borra datos."
    )) return
    setRecalcOpRunning(true)
    try {
      const res = await apiCallLocal({ action: "recalculateDispOperador" })
      const updated = Number(res.updated) || 0
      const unchanged = Number(res.unchanged) || 0
      const skipped = Number(res.skipped) || 0
      const total = Number(res.total) || 0
      await reloadReadings()
      if (updated > 0) {
        showToast(
          `✓ ${updated} de ${total} lecturas actualizadas` +
            (unchanged > 0 ? ` · ${unchanged} sin cambios` : "") +
            (skipped > 0 ? ` · ${skipped} sin sucursal/operadora válida` : ""),
          "success",
        )
      } else {
        showToast(
          `Ningún disp_operador cambió (revisadas ${total})` +
            (skipped > 0 ? ` · ${skipped} sin sucursal/operadora válida` : ""),
          "info",
        )
      }
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setRecalcOpRunning(false)
    }
  }

  const togglePeriod = (key: string) => {
    setCollapsedPeriods(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Label
          htmlFor="import-excel-input"
          className="cursor-pointer inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md text-sm font-medium"
        >
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          Importar Dashboard Excel
        </Label>
        <input
          id="import-excel-input"
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleImportExcel}
          disabled={importing}
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => { setForm(emptyForm()); setManualOpen(true) }}
        >
          <Plus className="w-4 h-4 mr-1" />
          Nueva lectura manual
        </Button>

        <Button
          variant={continuityIssues > 0 ? "default" : "ghost"}
          size="sm"
          onClick={handleRecalculate}
          disabled={recalcRunning}
          className={continuityIssues > 0 ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
        >
          {recalcRunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
          {continuityIssues > 0 ? `Corregir continuidad (${continuityIssues})` : "Recalcular continuidad"}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleRecalculateDispOperador}
          disabled={recalcOpRunning}
          title="Reescribe DISP Operador en cada lectura sumando AgendaPro por semana + sucursal + operadora"
        >
          {recalcOpRunning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RotateCcw className="w-4 h-4 mr-1" />}
          Recalcular DISP Operador
        </Button>

        <span className="ml-auto text-sm text-muted-foreground">
          {pulseReadings.length} lectura{pulseReadings.length !== 1 ? "s" : ""} · {groupedByPeriod.length} período{groupedByPeriod.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Banner de continuidad */}
      {continuityIssues > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>{continuityIssues} lectura{continuityIssues !== 1 ? "s" : ""}</strong> {continuityIssues !== 1 ? "tienen" : "tiene"} continuidad incorrecta
            (Inicio ≠ Final de la semana anterior).
            Pulsa <strong>Corregir continuidad</strong> para corregirlas automáticamente.
          </span>
        </div>
      )}

      {/* Import Preview */}
      {importPreview && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Vista previa: {importPreview.filename}
            </CardTitle>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-1">
              <span>
                Período:{" "}
                {importPreview.result.period_detected_from === "filename" ? (
                  <strong>{fmtPeriod(importPreview.period_start, importPreview.period_end)}</strong>
                ) : (
                  <span className="text-amber-600">No detectado automáticamente</span>
                )}
              </span>
              {importPreview.result.period_detected_from === "manual" && (
                <div className="flex gap-2 items-center">
                  <Input
                    type="date"
                    className="h-7 w-36 text-xs"
                    value={importPreview.period_start}
                    onChange={e => setImportPreview(prev => prev ? { ...prev, period_start: e.target.value } : null)}
                  />
                  <span className="text-muted-foreground">al</span>
                  <Input
                    type="date"
                    className="h-7 w-36 text-xs"
                    value={importPreview.period_end}
                    onChange={e => setImportPreview(prev => prev ? { ...prev, period_end: e.target.value } : null)}
                  />
                </div>
              )}
              <span>{importPreview.rows.length} equipos</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Equipo</TableHead>
                    <TableHead className="text-xs">Sucursal</TableHead>
                    <TableHead className="text-xs">Cabina</TableHead>
                    <TableHead className="text-xs">Operadora</TableHead>
                    <TableHead className="text-xs text-right">Inicio (fuente)</TableHead>
                    <TableHead className="text-xs text-right">Fin</TableHead>
                    <TableHead className="text-xs text-right">DISP Láser</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs">Fallas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importPreview.rows.map(row => (
                    <TableRow key={row.equipo_id}>
                      <TableCell className="text-xs font-mono">{row.equipo_id}</TableCell>
                      <TableCell className="text-xs">{row.sucursal || "-"}</TableCell>
                      <TableCell className="text-xs">{row.cabina || "-"}</TableCell>
                      <TableCell className="text-xs">{row.operadora || "-"}</TableCell>
                      <TableCell className="text-xs text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span>{fmtN(row.lectura_inicial)}</span>
                          <SourceBadge source={row.lectura_inicial_source} />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmtN(row.pulsos)}</TableCell>
                      <TableCell className="text-xs text-right font-mono text-primary font-semibold">
                        {fmtN(row.pulsos - row.lectura_inicial)}
                      </TableCell>
                      <TableCell className="text-xs">{row.estado || "-"}</TableCell>
                      <TableCell className="text-xs">{row.fallas || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => setImportPreview(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmImport}
                disabled={saving || !importPreview.period_start || !importPreview.period_end}
              >
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                Confirmar e importar {importPreview.rows.length} lecturas
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lecturas agrupadas por período */}
      {groupedByPeriod.length === 0 && !importPreview && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No hay lecturas registradas.</p>
            <p className="text-sm mt-1">Importa un Excel o crea una lectura manual.</p>
          </CardContent>
        </Card>
      )}

      {groupedByPeriod.map(group => {
        const collapsed = collapsedPeriods.has(group.key)
        return (
          <Card key={group.key}>
            <CardHeader
              className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => togglePeriod(group.key)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <CardTitle className="text-sm font-semibold">
                    {group.period_label || fmtPeriod(group.period_start, group.period_end)}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{group.readings.length} equipo{group.readings.length !== 1 ? "s" : ""}</span>
                  <span className="font-semibold text-primary">
                    Total DISP Láser: +{fmtN(group.totalDispLaser)}
                  </span>
                </div>
              </div>
            </CardHeader>

            {!collapsed && (
              <CardContent className="pt-0">
                <div className="overflow-x-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Equipo</TableHead>
                        <TableHead className="text-xs">Sucursal / Cabina</TableHead>
                        <TableHead className="text-xs">Operadora</TableHead>
                        <TableHead className="text-xs text-right">Inicio</TableHead>
                        {/* Fin es editable inline — haz clic para editar */}
                        <TableHead className="text-xs text-right">Fin <span className="opacity-50">(clic para editar)</span></TableHead>
                        <TableHead className="text-xs text-right">DISP Láser</TableHead>
                        <TableHead className="text-xs">Estado</TableHead>
                        <TableHead className="text-xs w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.readings.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs font-mono">{r.equipo_id}</TableCell>
                          <TableCell className="text-xs">
                            <div>{r.sucursal}</div>
                            {r.cabina && <div className="text-muted-foreground">{r.cabina}</div>}
                          </TableCell>
                          <TableCell className="text-xs">
                            {(() => {
                              const res = operadoraResolver.resolve({ sucursal: r.sucursal, cabina: r.cabina, equipo: r.equipo_id, operadoraExcel: r.operadora })
                              return (
                                <span className="inline-flex items-center gap-1">
                                  {res.operadora || "-"}
                                  {res.mismatch && <span title={res.observacion} className="text-[10px] text-amber-500 cursor-help">⚠ Excel: {res.excel}</span>}
                                  {res.source === "excel" && <span title={res.observacion} className="text-[10px] text-muted-foreground cursor-help">(archivo)</span>}
                                </span>
                              )
                            })()}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">{fmtN(r.lectura_inicial)}</TableCell>

                          {/* Fin — inline editable */}
                          <TableCell
                            className="text-xs text-right font-mono cursor-pointer hover:bg-primary/5 group select-none"
                            onClick={() => !savingInline && startEditFinal(r)}
                          >
                            {editingFinalId === r.id ? (
                              <input
                                ref={editingInputRef}
                                className="w-28 text-right text-xs font-mono bg-background border-b-2 border-primary outline-none px-1"
                                value={editingFinalValue}
                                onChange={e => setEditingFinalValue(e.target.value)}
                                onBlur={() => handleInlineSaveFinal(r)}
                                onKeyDown={e => {
                                  if (e.key === "Enter") { e.preventDefault(); handleInlineSaveFinal(r) }
                                  if (e.key === "Escape") cancelEditFinal()
                                }}
                              />
                            ) : (
                              <span className="flex items-center justify-end gap-1">
                                {fmtN(r.lectura_final)}
                                <span className="opacity-0 group-hover:opacity-40 text-[10px]">✏</span>
                              </span>
                            )}
                          </TableCell>

                          <TableCell className="text-xs text-right font-mono text-primary font-semibold">
                            +{fmtN(r.disp_laser)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {r.estado_cuadre === "lectura_guardada" ? (
                              <Badge variant="outline" className="text-xs">Guardada</Badge>
                            ) : r.estado_cuadre === "cuadre_completo" ? (
                              <Badge className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">Cuadre</Badge>
                            ) : (
                              <span className="text-muted-foreground">{r.estado_cuadre || "-"}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => handleEdit(r)}
                                title="Editar todos los campos"
                              >
                                ✏️
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() => handleDelete(r)}
                                title="Eliminar"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      {/* Dialog: Nueva / Editar lectura manual */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar lectura" : "Nueva lectura manual"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-equipo">Equipo</Label>
              <Select value={form.equipo_id} onValueChange={handleEquipoChange}>
                <SelectTrigger id="manual-equipo">
                  <SelectValue placeholder="Selecciona un equipo..." />
                </SelectTrigger>
                <SelectContent>
                  {db.equipos
                    .filter(e => e.Estado === "Activo")
                    .map(e => (
                      <SelectItem key={e.EquipoID} value={e.EquipoID}>
                        {e.EquipoID} — {e.Sucursal}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="period-start">Período inicio</Label>
                <Input
                  id="period-start"
                  type="date"
                  value={form.period_start}
                  onChange={e => handlePeriodStartChange(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="period-end">Período fin</Label>
                <Input
                  id="period-end"
                  type="date"
                  value={form.period_end}
                  min={form.period_start}
                  onChange={e => setForm(prev => ({ ...prev, period_end: e.target.value }))}
                />
              </div>
            </div>

            {/* Inicio — editable (auto-calculado pero sobreridable) */}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="manual-inicial">Lectura inicial</Label>
                <SourceBadge source={form.lectura_inicial_source} />
              </div>
              <Input
                id="manual-inicial"
                placeholder="Auto-calculado del historial"
                value={form.lectura_inicial > 0 ? fmtN(form.lectura_inicial) : ""}
                onChange={e => setForm(prev => ({ ...prev, lectura_inicial: parseN(e.target.value) || 0 }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Se calcula automáticamente del Final de la semana anterior. Modifica solo si necesitas corregir.
              </p>
            </div>

            {/* Fin */}
            <div className="grid gap-1.5">
              <Label htmlFor="manual-final">Lectura final</Label>
              <Input
                id="manual-final"
                placeholder="Ej: 3,686,650"
                value={form.lectura_final}
                onChange={e => setForm(prev => ({ ...prev, lectura_final: e.target.value }))}
                className="font-mono"
              />
            </div>

            {/* Preview DISP */}
            {form.lectura_final && parseN(form.lectura_final) > 0 && (
              <div className="rounded-md bg-primary/5 px-3 py-2 text-sm font-mono text-center">
                DISP Láser: <strong className="text-primary">+{fmtN(parseN(form.lectura_final) - form.lectura_inicial)}</strong>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="manual-obs">Observaciones</Label>
              <Input
                id="manual-obs"
                placeholder="Opcional"
                value={form.observaciones}
                onChange={e => setForm(prev => ({ ...prev, observaciones: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveManual} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
