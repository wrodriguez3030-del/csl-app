"use client"

import { useMemo, useRef, useState } from "react"
import { AlertTriangle, ChevronLeft, FileSpreadsheet, Loader2, Save, Upload } from "lucide-react"
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
import { makeAgendaMatchKey } from "@/lib/normalize-pulse"

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

  // Step 2 state
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([])
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)

  const lecturasInputRef = useRef<HTMLInputElement>(null)
  const agendaInputRef = useRef<HTMLInputElement>(null)

  const pulseReadings = useMemo(() => dbPulsos.pulseReadings ?? [], [dbPulsos.pulseReadings])

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  // Período efectivo: del archivo si fue detectado, si no del input manual
  const effectivePeriod = useMemo(() => {
    const lf = lecturasFile
    if (lf?.result.period_start && lf?.result.period_end) {
      return { start: lf.result.period_start, end: lf.result.period_end, label: lf.result.period_label }
    }
    return { start: manualPeriodStart, end: manualPeriodEnd, label: "" }
  }, [lecturasFile, manualPeriodStart, manualPeriodEnd])

  // ── Paso 1: Cargar archivos ─────────────────────────────────────────────────

  const handleLecturasUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setParsingLecturas(true)
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
      setLecturasFile({ filename: file.name, result })
      if (result.warnings.length) result.warnings.forEach(w => showToast(w, "info"))
      else showToast(`${result.rows.length} equipos leídos de ${file.name}`, "success")
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX = await loadXLSX() as any
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const parsed = await parseAgendaProWorkbook(wb, XLSX)
      const marked = markDuplicatesAgainstExisting(parsed.rows, dbPulsos.sesionesCliente)
      const fechas = marked.map(r => r.fecha).filter(Boolean).sort()
      setAgendaFile({
        filename: file.name,
        rows: marked,
        period_start: fechas[0] || "",
        period_end: fechas[fechas.length - 1] || "",
      })
      showToast(`AgendaPro: ${marked.length} filas leídas de ${file.name}`, "success")
    } catch (err) {
      showToast(`Error al leer ${file.name}: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setParsingAgenda(false)
    }
  }

  const buildReviewRows = (): ReviewRow[] => {
    const { start: periodStart } = effectivePeriod
    const rows: ReviewRow[] = (lecturasFile?.result.rows ?? []).map(row => {
      const { value: lectura_inicial, source: lectura_inicial_source } = calculateLecturaInicial(
        pulseReadings, row.equipo_id, periodStart || new Date().toISOString().slice(0, 10),
      )
      const disp_laser = row.pulsos - lectura_inicial
      return { ...row, lectura_inicial, lectura_inicial_source, disp_laser }
    })

    // Si hay AgendaPro, calcular disparos operador usando clave canónica
    if (agendaFile) {
      // Acumular disparos por clave normalizada (SUCURSAL|OPERADORA en mayúsculas + aliases)
      const dispByKey = new Map<string, number>()
      for (const r of agendaFile.rows.filter(r => r.status === "valid")) {
        const key = makeAgendaMatchKey(r.sucursal, r.operadora)
        if (key && !key.startsWith("|")) {
          dispByKey.set(key, (dispByKey.get(key) || 0) + r.disparos)
        }
      }

      return rows.map(row => {
        const key = makeAgendaMatchKey(row.sucursal, row.operadora)
        const dispOp = dispByKey.get(key)
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

  const handleContinuar = () => {
    if (!lecturasFile) return
    if (!effectivePeriod.start || !effectivePeriod.end) {
      showToast("Indica el período de la semana", "error")
      return
    }
    setReviewRows(buildReviewRows())
    setStep(2)
  }

  // ── Paso 2: Revisar y guardar ───────────────────────────────────────────────

  const handleGuardar = async () => {
    if (!reviewRows.length) return
    setSaving(true)
    try {
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

      // Actualizar store
      const existingIds = new Set(saved.map(r => r.id))
      const updatedReadings = [
        ...pulseReadings.filter(r => !existingIds.has(r.id)),
        ...saved,
      ]
      setDbPulsos({ ...dbPulsos, pulseReadings: updatedReadings })
      setSavedCount(saved.length)
      setStep(3)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const resetWizard = () => {
    setStep(1)
    setLecturasFile(null)
    setAgendaFile(null)
    setReviewRows([])
    setSavedCount(0)
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
                disabled={!lecturasFile}
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

            <div className="overflow-x-auto rounded border">
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
                            <span className={row.diferencia < 0 ? "text-rose-600" : row.diferencia > 0 ? "text-amber-600" : "text-emerald-600"}>
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
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Volver
              </Button>
              <Button onClick={handleGuardar} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                {agendaFile ? "Guardar cuadre" : `Guardar ${reviewRows.length} lecturas`}
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
              {savedCount} lectura{savedCount !== 1 ? "s" : ""} guardada{savedCount !== 1 ? "s" : ""}
            </h3>
            <p className="text-sm text-muted-foreground">
              Período: {fmtDate(effectivePeriod.start)} — {fmtDate(effectivePeriod.end)}
              {agendaFile ? " · Cuadre con AgendaPro completado." : ""}
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
