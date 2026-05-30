"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useAppStore, apiCall } from "@/lib/store"
import { supabaseBrowser } from "@/lib/supabase-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { KpiCard } from "@/components/kpi-card"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { parseMantenimientoDashboardExcel, type MantenimientoDashboardParseResult } from "@/lib/mantenimiento-dashboard-excel"
import type { Database } from "@/lib/types"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  Printer,
  Stethoscope,
  TrendingUp,
  Upload,
  Wrench,
  Zap,
} from "lucide-react"
import { fmtN } from "@/lib/fmt"

// ── Semáforo ─────────────────────────────────────────────────────────────────

type SemaforoLevel = "excelente" | "muy-bueno" | "vigilancia" | "critico"

interface SemaforoConfig {
  label: string
  colorClass: string
  badgeClass: string
  bgClass: string
}

const SEMAFORO: Record<SemaforoLevel, SemaforoConfig> = {
  excelente: {
    label: "Excelente",
    colorClass: "text-emerald-700",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bgClass: "bg-emerald-500",
  },
  "muy-bueno": {
    label: "Muy Bueno",
    colorClass: "text-cyan-700",
    badgeClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    bgClass: "bg-cyan-500",
  },
  vigilancia: {
    label: "Vigilancia",
    colorClass: "text-amber-700",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    bgClass: "bg-amber-500",
  },
  critico: {
    label: "Crítico",
    colorClass: "text-rose-700",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    bgClass: "bg-rose-500",
  },
}

function getSemaforo(pulsos: number): SemaforoLevel {
  if (pulsos < 1_000_000) return "excelente"
  if (pulsos < 3_000_000) return "muy-bueno"
  if (pulsos < 6_000_000) return "vigilancia"
  return "critico"
}

function fmtPulsos(n: number) {
  return fmtN(n)
}

function fmtFecha(value?: string) {
  if (!value) return "—"
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}

// ── Component ─────────────────────────────────────────────────────────────────

type ImportResult = {
  ok: boolean
  updated: number
  notFound: number
  snapshotsSaved: number
  fallasSaved: number
  warnings: string[]
  errors: string[]
  totalRows: number
}

export function PulsosMantenimientoPage() {
  const { db, dbPulsos, apiUrl, setDb } = useAppStore()
  const [showAllAlertas, setShowAllAlertas] = useState(false)
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  // ── Import state ──────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false)
  const [importStep, setImportStep] = useState<"file" | "preview" | "result">("file")
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importParsed, setImportParsed] = useState<MantenimientoDashboardParseResult | null>(null)
  const [importPeriodoInicio, setImportPeriodoInicio] = useState("")
  const [importPeriodoFin, setImportPeriodoFin] = useState("")
  const [importEtiqueta, setImportEtiqueta] = useState("")
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetImport() {
    setImportStep("file")
    setImportFile(null)
    setImportParsed(null)
    setImportPeriodoInicio("")
    setImportPeriodoFin("")
    setImportEtiqueta("")
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleImportFile = useCallback(async (file: File) => {
    setImportLoading(true)
    try {
      const result = await parseMantenimientoDashboardExcel(file)
      setImportFile(file)
      setImportParsed(result)
      if (result.periodoDetectado) {
        setImportPeriodoInicio(result.periodoDetectado.inicio)
        setImportPeriodoFin(result.periodoDetectado.fin)
        setImportEtiqueta(result.periodoDetectado.etiqueta)
      }
      setImportStep("preview")
    } catch (err) {
      alert(`Error al leer el archivo: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setImportLoading(false)
    }
  }, [])

  const handleImportSubmit = useCallback(async () => {
    if (!importParsed) return
    setImportLoading(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      const res = await fetch("/api/integrations/mantenimiento/import-lecturas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          rows: importParsed.rows,
          periodoInicio: importPeriodoInicio || undefined,
          periodoFin: importPeriodoFin || undefined,
          etiquetaPeriodo: importEtiqueta || undefined,
          archivoNombre: importFile?.name,
        }),
      })
      const data = (await res.json()) as ImportResult
      setImportResult(data)
      setImportStep("result")

      // Recargar equipos para que el dashboard refleje los nuevos P_Cabeza
      if (data.updated > 0) {
        try {
          const refreshed = await apiCall(apiUrl, { action: "getAllData" })
          if (refreshed.ok && refreshed.data) setDb(refreshed.data as Database)
        } catch { /* silencioso — el usuario puede recargar manualmente */ }
      }
    } catch (err) {
      setImportResult({ ok: false, updated: 0, notFound: 0, snapshotsSaved: 0, fallasSaved: 0, warnings: [], errors: [String(err)], totalRows: 0 })
      setImportStep("result")
    } finally {
      setImportLoading(false)
    }
  }, [importParsed, importPeriodoInicio, importPeriodoFin, importEtiqueta, importFile, apiUrl, setDb])

  // ── Data ──────────────────────────────────────────────────────────────────

  const equipoRows = useMemo(() => {
    const rows = db.equipos
      .filter((e) => e.Estado === "Activo")
      .map((e) => {
        const pulsos = Number(e.P_Cabeza || 0)
        return { ...e, pulsos, semaforo: getSemaforo(pulsos) }
      })
    return rows.sort((a, b) =>
      sortDir === "desc" ? b.pulsos - a.pulsos : a.pulsos - b.pulsos,
    )
  }, [db.equipos, sortDir])

  const stats = useMemo(() => {
    const total = equipoRows.length
    const conLecturas = equipoRows.filter((e) => e.pulsos > 0)
    const evaluados = conLecturas.length
    const criticos = equipoRows.filter((e) => e.semaforo === "critico").length
    const vigilancia = equipoRows.filter((e) => e.semaforo === "vigilancia").length
    const promedio = evaluados > 0 ? Math.round(conLecturas.reduce((s, e) => s + e.pulsos, 0) / evaluados) : 0
    return { total, evaluados, criticos, vigilancia, promedio }
  }, [equipoRows])

  const porSucursal = useMemo(() => {
    const map = new Map<string, { total: number; criticos: number; vigilancia: number }>()
    for (const e of equipoRows) {
      const s = e.Sucursal || "Sin sucursal"
      const cur = map.get(s) ?? { total: 0, criticos: 0, vigilancia: 0 }
      cur.total++
      if (e.semaforo === "critico") cur.criticos++
      if (e.semaforo === "vigilancia") cur.vigilancia++
      map.set(s, cur)
    }
    return Array.from(map.entries())
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.criticos - a.criticos || b.vigilancia - a.vigilancia)
  }, [equipoRows])

  const alertas = useMemo(
    () =>
      dbPulsos.auditoriasSemanales
        .filter((a) => a.Alerta === "Critico" || a.Alerta === "Advertencia")
        .sort((a, b) => String(b.FechaSemana).localeCompare(String(a.FechaSemana))),
    [dbPulsos.auditoriasSemanales],
  )

  const alertasVisible = showAllAlertas ? alertas : alertas.slice(0, 6)

  const planAccion = useMemo(() => {
    return equipoRows
      .filter((e) => e.semaforo === "critico" || e.semaforo === "vigilancia")
      .map((e) => ({
        equipo: e.EquipoID,
        sucursal: e.Sucursal,
        nivel: e.semaforo as "critico" | "vigilancia",
        accion:
          e.semaforo === "critico"
            ? `Revisión inmediata de cabezal y componentes de alta exposición. ${fmtPulsos(e.pulsos)} pulsos acumulados superan el umbral crítico (6M).`
            : `Programar mantenimiento preventivo en las próximas 2 semanas. ${fmtPulsos(e.pulsos)} pulsos en zona de vigilancia (3M–6M).`,
      }))
  }, [equipoRows])

  // Frecuencia de fallas desde FallasRecientes de cada equipo activo
  const fallasFrecuencia = useMemo(() => {
    const counter = new Map<string, { count: number; equipos: string[] }>()
    for (const e of equipoRows) {
      if (!e.FallasRecientes) continue
      for (const c of e.FallasRecientes.split(",").map(s => s.trim()).filter(Boolean)) {
        const cur = counter.get(c) ?? { count: 0, equipos: [] }
        cur.count++
        cur.equipos.push(e.EquipoID)
        counter.set(c, cur)
      }
    }
    return Array.from(counter.entries())
      .map(([codigo, data]) => ({ codigo, ...data }))
      .sort((a, b) => b.count - a.count)
  }, [equipoRows])

  const handlePrint = useCallback(() => { window.print() }, [])

  if (equipoRows.length === 0) {
    return (
      <div className="csl-page-shell">
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Wrench className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>Sin datos de equipos. Conecta y recarga para ver el dashboard.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="csl-page-shell print:p-0">

      {/* ── Import Dialog ────────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) resetImport(); setImportOpen(open) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              {importStep === "file" && "Importar lecturas desde Excel"}
              {importStep === "preview" && "Revisar antes de importar"}
              {importStep === "result" && "Resultado de importación"}
            </DialogTitle>
          </DialogHeader>

          {/* Estado 1: Selección de archivo */}
          {importStep === "file" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sube el Excel <strong>Dashboard Mantenimiento</strong> (hoja <code className="rounded bg-slate-100 px-1 text-xs">Equipos</code>).
                Columnas: Equipo, Serial, Sucursal, Cabina, Operadora, Pulsos, Estado, Fallas.
              </p>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-10 transition-colors hover:border-primary hover:bg-primary/5 ${importLoading ? "pointer-events-none opacity-60" : ""}`}
              >
                {importLoading ? (
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                ) : (
                  <Upload className="h-8 w-8 text-slate-400" />
                )}
                <div className="text-center">
                  <p className="font-bold text-slate-700">{importLoading ? "Leyendo archivo…" : "Arrastra el Excel aquí"}</p>
                  {!importLoading && <p className="text-sm text-slate-500">o haz click para seleccionar</p>}
                  <p className="mt-1 text-xs text-slate-400">Acepta .xlsx y .xls</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept=".xlsx,.xls"
                  disabled={importLoading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f) }}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Nombre de archivo recomendado: <code className="rounded bg-slate-100 px-1">Equipos_Cibao_Dashboard_Premium_25_30_Mayo_2026.xlsx</code> — el período se detecta automáticamente.
              </p>
            </div>
          )}

          {/* Estado 2: Preview */}
          {importStep === "preview" && importParsed && (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              {/* Info de parse */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-2xl font-black text-primary">{importParsed.rows.length}</p>
                  <p className="text-xs text-muted-foreground">equipos detectados</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-2xl font-black text-slate-700">{importParsed.skipped}</p>
                  <p className="text-xs text-muted-foreground">filas saltadas</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3">
                  <p className="text-xs font-mono font-bold text-slate-600 truncate">{importParsed.sheetUsed}</p>
                  <p className="text-xs text-muted-foreground">hoja usada</p>
                </div>
              </div>

              {/* Período */}
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <p className="mb-2 text-xs font-bold text-slate-600 uppercase tracking-wide">Período</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Inicio</label>
                    <input
                      type="date"
                      value={importPeriodoInicio}
                      onChange={e => setImportPeriodoInicio(e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Fin</label>
                    <input
                      type="date"
                      value={importPeriodoFin}
                      onChange={e => setImportPeriodoFin(e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="text-xs text-slate-500">Etiqueta (opcional)</label>
                  <input
                    type="text"
                    value={importEtiqueta}
                    onChange={e => setImportEtiqueta(e.target.value)}
                    placeholder="Ej: 25-30 Mayo 2026"
                    className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                {!importPeriodoInicio && !importPeriodoFin && (
                  <p className="mt-1.5 text-xs text-amber-600">
                    ⚠ Período no detectado del nombre del archivo. Puedes dejarlo vacío o ingresarlo manualmente.
                  </p>
                )}
              </div>

              {/* Advertencias */}
              {importParsed.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                  {importParsed.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
                  ))}
                </div>
              )}

              {/* Tabla preview */}
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipo</TableHead>
                      <TableHead>Sucursal</TableHead>
                      <TableHead>Cabina</TableHead>
                      <TableHead>Operadora</TableHead>
                      <TableHead className="text-right">Pulsos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fallas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importParsed.rows.slice(0, 8).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-black">{row.equipoId}</TableCell>
                        <TableCell className="text-sm">{row.sucursal || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.cabina || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.operadora || "—"}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-bold">
                          {row.pulsos > 0 ? fmtPulsos(row.pulsos) : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{row.estadoExcel || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{row.fallasRaw || "—"}</TableCell>
                      </TableRow>
                    ))}
                    {importParsed.rows.length > 8 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-2">
                          … y {importParsed.rows.length - 8} equipo{importParsed.rows.length - 8 !== 1 ? "s" : ""} más
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Estado 3: Resultado */}
          {importStep === "result" && importResult && (
            <div className="space-y-4">
              <div className={`rounded-xl border p-4 ${importResult.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`font-black text-lg ${importResult.ok ? "text-emerald-700" : "text-amber-700"}`}>
                  {importResult.ok ? "✅ Importación completada" : "⚠ Completado con advertencias"}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {importResult.totalRows} fila{importResult.totalRows !== 1 ? "s" : ""} procesada{importResult.totalRows !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-2xl font-black text-emerald-600">{importResult.updated}</p>
                  <p className="text-xs text-muted-foreground">equipos actualizados</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-2xl font-black text-slate-500">{importResult.notFound}</p>
                  <p className="text-xs text-muted-foreground">no encontrados</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-2xl font-black text-primary">{importResult.snapshotsSaved}</p>
                  <p className="text-xs text-muted-foreground">snapshots guardados</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-2xl font-black text-amber-600">{importResult.fallasSaved}</p>
                  <p className="text-xs text-muted-foreground">fallas registradas</p>
                </div>
              </div>
              {importResult.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1 max-h-32 overflow-y-auto">
                  {importResult.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">⚠ {w}</p>)}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-1 max-h-32 overflow-y-auto">
                  {importResult.errors.map((e, i) => <p key={i} className="text-xs text-rose-700">✗ {e}</p>)}
                </div>
              )}
              {importResult.updated > 0 && (
                <p className="text-xs text-emerald-700">El dashboard se actualizó automáticamente con los nuevos pulsos.</p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {importStep === "file" && (
              <Button variant="outline" onClick={() => { resetImport(); setImportOpen(false) }}>Cancelar</Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("file")} disabled={importLoading}>
                  ← Volver
                </Button>
                <Button onClick={handleImportSubmit} disabled={importLoading || (importParsed?.rows.length ?? 0) === 0}>
                  {importLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importando…</> : <><Upload className="mr-2 h-4 w-4" />Importar lecturas</>}
                </Button>
              </>
            )}
            {importStep === "result" && (
              <Button onClick={() => { resetImport(); setImportOpen(false) }}>Cerrar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_rgba(15,45,68,.09)] print:hidden">
        <div className="absolute right-8 top-8 hidden h-24 w-24 rounded-full border border-cyan-300/20 bg-cyan-300/10 blur-sm md:block" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <span className="csl-kicker">Módulo mantenimiento</span>
            <h2 className="mt-2 font-heading text-3xl font-black tracking-tight md:text-5xl">Dashboard Mantenimiento</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Semáforo de equipos por pulsos acumulados, ranking de uso, alertas de auditoría y plan de acción automático para los equipos GentleYAG.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" className="gap-2" onClick={() => { resetImport(); setImportOpen(true) }}>
              <FileSpreadsheet className="h-4 w-4" />
              <span className="hidden sm:inline">Importar Excel</span>
            </Button>
            <Button variant="outline" className="gap-2" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar PDF</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Cabecera de impresión */}
      <div className="hidden print:block mb-6">
        <div className="flex items-center gap-3 border-b pb-4">
          <Stethoscope className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-black">Dashboard Mantenimiento — GentleYAG</h1>
            <p className="text-xs text-slate-500">
              Generado el {new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Equipos activos" value={stats.total} icon={Wrench} variant="primary" description={`${stats.evaluados} con lecturas registradas`} />
        <KpiCard title="Promedio pulsos" value={fmtPulsos(stats.promedio)} icon={Zap} variant="success" description="Promedio acumulado por equipo" />
        <KpiCard title="En vigilancia" value={stats.vigilancia} icon={Activity} variant="warning" description="3M – 6M pulsos acumulados" />
        <KpiCard title="Críticos" value={stats.criticos} icon={AlertTriangle} variant="destructive" description="> 6M pulsos acumulados" />
      </div>

      {/* Distribución + resumen por sucursal */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendingUp className="h-5 w-5 text-primary" />
              Distribución por estado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {(["excelente", "muy-bueno", "vigilancia", "critico"] as SemaforoLevel[]).map((level) => {
              const count = equipoRows.filter((e) => e.semaforo === level).length
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              const cfg = SEMAFORO[level]
              return (
                <div key={level} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className={`font-bold ${cfg.colorClass}`}>{cfg.label}</span>
                    <span className="text-muted-foreground">{count} equipo{count !== 1 ? "s" : ""} · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all ${cfg.bgClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Resumen por sucursal
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">Vigilancia</TableHead>
                  <TableHead className="text-center">Críticos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porSucursal.map((s) => (
                  <TableRow key={s.nombre}>
                    <TableCell className="font-bold">{s.nombre}</TableCell>
                    <TableCell className="text-center">{s.total}</TableCell>
                    <TableCell className="text-center">
                      {s.vigilancia > 0 ? <Badge className={SEMAFORO.vigilancia.badgeClass}>{s.vigilancia}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.criticos > 0 ? <Badge className={SEMAFORO.critico.badgeClass}>{s.criticos}</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Ranking de equipos */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Stethoscope className="h-5 w-5 text-primary" />
              Ranking — pulsos acumulados
            </CardTitle>
            <Button
              variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground print:hidden"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              {sortDir === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              {sortDir === "desc" ? "Mayor → Menor" : "Menor → Mayor"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Cabina</TableHead>
                <TableHead>Operadora</TableHead>
                <TableHead className="text-right">Pulsos acum.</TableHead>
                <TableHead className="text-center">Semáforo</TableHead>
                <TableHead>Fallas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipoRows.map((e, i) => {
                const cfg = SEMAFORO[e.semaforo]
                return (
                  <TableRow key={e.EquipoID}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-black">{e.EquipoID}</TableCell>
                    <TableCell>{e.Sucursal}</TableCell>
                    <TableCell className="text-muted-foreground">{e.Cabina || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.Operadora || "—"}</TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {e.pulsos > 0 ? fmtPulsos(e.pulsos) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cfg.badgeClass}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {e.FallasRecientes || "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Frecuencia de fallas (solo si hay datos de importación) */}
      {fallasFrecuencia.length > 0 && (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              Frecuencia de fallas
              <Badge className="ml-2 border-rose-200 bg-rose-50 text-rose-700">{fallasFrecuencia.length} códigos</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Código falla</TableHead>
                  <TableHead className="text-center">Equipos afectados</TableHead>
                  <TableHead>Equipos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fallasFrecuencia.map((f, i) => (
                  <TableRow key={f.codigo}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-mono font-black">{f.codigo}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={f.count >= 3 ? SEMAFORO.critico.badgeClass : f.count >= 2 ? SEMAFORO.vigilancia.badgeClass : SEMAFORO["muy-bueno"].badgeClass}>
                        {f.count}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">{f.equipos.join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Alertas de auditoría */}
      {alertas.length > 0 && (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Alertas de auditoría
              <Badge className="ml-2 border-amber-200 bg-amber-50 text-amber-700">{alertas.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Semana</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Pulsos láser</TableHead>
                  <TableHead className="text-right">Pulsos operador</TableHead>
                  <TableHead className="text-right">Desv. %</TableHead>
                  <TableHead className="text-center">Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertasVisible.map((a, i) => (
                  <TableRow key={a.AuditoriaID}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell>{fmtFecha(a.FechaSemana)}</TableCell>
                    <TableCell className="font-black">{a.EquipoID}</TableCell>
                    <TableCell>{a.Sucursal}</TableCell>
                    <TableCell className="text-right font-mono">{fmtN(a.PulsosReales)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtN(a.PulsosReportados)}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={a.PorcentajeDesviacion > 20 ? "font-bold text-rose-600" : "text-amber-600"}>
                        {a.PorcentajeDesviacion.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={a.Alerta === "Critico" ? SEMAFORO.critico.badgeClass : SEMAFORO.vigilancia.badgeClass}>
                        {a.Alerta}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {alertas.length > 6 && (
              <div className="p-3 text-center print:hidden">
                <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setShowAllAlertas((v) => !v)}>
                  {showAllAlertas ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {showAllAlertas ? "Ver menos" : `Ver ${alertas.length - 6} más`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan de acción automático */}
      {planAccion.length > 0 && (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Wrench className="h-5 w-5 text-primary" />
              Plan de acción automático
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {planAccion.map((p, i) => (
              <div
                key={i}
                className={`flex gap-3 rounded-xl border p-4 ${p.nivel === "critico" ? "border-rose-200 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"}`}
              >
                <Badge className={`${SEMAFORO[p.nivel].badgeClass} mt-0.5 shrink-0 self-start`}>
                  {p.nivel === "critico" ? "URGENTE" : "PREVENTIVO"}
                </Badge>
                <div>
                  <p className="text-sm font-black">{p.equipo} · {p.sucursal}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.accion}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
