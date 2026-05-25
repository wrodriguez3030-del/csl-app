"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle, CalendarRange, Camera, CheckCircle2, ChevronLeft, ChevronRight,
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
import type { SesionCliente, AuditoriaSemanal } from "@/lib/types"

// ─── Tipos locales del wizard ────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5

interface ExcelImportInfo {
  filename: string
  parsed: ParseAgendaProResult
  rows: ParsedDisparoRow[]      // dedupeadas
  totalDisparos: number
  imported: number              // se popula al confirmar
  duplicatesDb: number
}

interface FotoEntry {
  id: string
  filename: string
  dataUrl: string               // base64 para preview (no se sube al server)
  equipoId: string
  sucursal: string
  cabina: string
  lecturaFinal: number | null
  lecturaInicialAuto: number | null   // se autocompleta desde lectura anterior
  observaciones: string
}

interface EquipoCuadre extends CuadreEquipoRow {
  // Sufijo único para tracking del row.
  rowId: string
}

// ─── Helpers locales ─────────────────────────────────────────────────────────

const ALERT_CLS: Record<AlertaNivel, string> = {
  OK: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Advertencia: "border-amber-200 bg-amber-50 text-amber-700",
  Critico: "border-rose-200 bg-rose-50 text-rose-700",
}

function newRowId() { return `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("No se pudo leer la foto"))
    reader.readAsDataURL(file)
  })
}

// ─── Componente principal ───────────────────────────────────────────────────

export function PulsosCuadreSemanalPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const business = useCurrentBusiness()

  // ── Estado del wizard ─────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>(1)
  const today = new Date().toISOString().slice(0, 10)
  const [weekStart, setWeekStart] = useState<string>(() => lunesDeSemana(today))
  const [weekEnd, setWeekEnd] = useState<string>(() => addDays(lunesDeSemana(today), 5))
  const [sucursalFiltro, setSucursalFiltro] = useState<string>("Todas")
  const [excelImports, setExcelImports] = useState<ExcelImportInfo[]>([])
  const [fotos, setFotos] = useState<FotoEntry[]>([])
  const [parsingExcel, setParsingExcel] = useState(false)
  const [importingExcel, setImportingExcel] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [equiposEditados, setEquiposEditados] = useState<Record<string, Partial<EquipoCuadre>>>({})
  const [snapshotFinal, setSnapshotFinal] = useState<{ snapshot: CuadreSnapshot; sesiones: SesionCliente[] } | null>(null)

  const excelInputRef = useRef<HTMLInputElement>(null)
  const fotosInputRef = useRef<HTMLInputElement>(null)

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
          // Solo filas dentro del rango de semana + sucursal filtrada
          const filtradas = parsed.rows.filter((r) => {
            if (r.fecha < weekStart || r.fecha > weekEnd) return false
            if (sucursalFiltro !== "Todas" && r.sucursal !== sucursalFiltro) return false
            return true
          })
          const withDedupe = markDuplicatesAgainstExisting(filtradas, dbPulsos.sesionesCliente)
          newImports.push({
            filename: file.name,
            parsed: { ...parsed, rows: filtradas },
            rows: withDedupe,
            totalDisparos: withDedupe.filter((r) => r.status === "valid").reduce((s, r) => s + r.disparos, 0),
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

  // ── PASO 3: fotos ─────────────────────────────────────────────────────────
  const handleFotosFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    const nuevas: FotoEntry[] = []
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await fileToDataUrl(file)
        nuevas.push({
          id: newRowId(),
          filename: file.name,
          dataUrl,
          equipoId: "",
          sucursal: sucursalFiltro !== "Todas" ? sucursalFiltro : "",
          cabina: "",
          lecturaFinal: null,
          lecturaInicialAuto: null,
          observaciones: "",
        })
      } catch (err) {
        showToast(`No se pudo cargar ${file.name}`, "error")
      }
    }
    setFotos((current) => [...current, ...nuevas])
    if (fotosInputRef.current) fotosInputRef.current.value = ""
  }

  const removeFoto = (id: string) => setFotos((current) => current.filter((f) => f.id !== id))

  const updateFoto = (id: string, patch: Partial<FotoEntry>) => {
    setFotos((current) => current.map((f) => {
      if (f.id !== id) return f
      const next = { ...f, ...patch }
      // Auto-calcula lectura inicial cuando cambia equipo+sucursal+cabina.
      if ("equipoId" in patch || "sucursal" in patch || "cabina" in patch) {
        next.lecturaInicialAuto = lookupLecturaPrevia(next.equipoId, next.sucursal, next.cabina, weekStart)
      }
      return next
    }))
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
    // Sesiones de la semana en el rango filtrado.
    const sesionesSemana = dbPulsos.sesionesCliente.filter((s) => {
      const f = String(s.Fecha || "").slice(0, 10)
      if (f < weekStart || f > weekEnd) return false
      if (sucursalFiltro !== "Todas" && s.Sucursal !== sucursalFiltro) return false
      return true
    })
    // Agrupar disparos operador por (sucursal|cabina|equipoId).
    const opCounts: Record<string, number> = {}
    for (const s of sesionesSemana) {
      const key = `${s.Sucursal || ""}|${s.Cabina || ""}|${s.EquipoID || ""}`
      opCounts[key] = (opCounts[key] || 0) + (Number(s.DisparosReportados) || 0)
    }
    // Por cada foto válida (con equipo asignado), generar una fila del cuadre.
    const rows: EquipoCuadre[] = []
    for (const foto of fotos) {
      if (!foto.equipoId || foto.lecturaFinal === null) continue
      const inicial = Number(foto.lecturaInicialAuto || 0)
      const final = Number(foto.lecturaFinal || 0)
      const disparosLaser = Math.max(0, final - inicial)
      const key = `${foto.sucursal}|${foto.cabina}|${foto.equipoId}`
      const disparosOperador = opCounts[key] || 0
      const desv = calcDesviacion(disparosLaser, disparosOperador)
      const override = equiposEditados[foto.id] || {}
      rows.push({
        rowId: foto.id,
        equipoId: foto.equipoId,
        sucursal: foto.sucursal,
        cabina: foto.cabina,
        lecturaInicial: inicial,
        lecturaFinal: final,
        disparosLaser: desv.disparosLaser,
        disparosOperador: override.disparosOperador ?? desv.disparosOperador,
        diferencia: override.disparosOperador !== undefined
          ? (override.disparosOperador as number) - desv.disparosLaser
          : desv.diferencia,
        porcentaje: desv.porcentaje,
        alerta: desv.alerta,
        observaciones: override.observaciones ?? foto.observaciones,
      })
    }
    return rows
  }, [fotos, dbPulsos.sesionesCliente, weekStart, weekEnd, sucursalFiltro, equiposEditados])

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
      // 1) Guardar lecturas semanales (una por foto válida).
      for (const foto of fotos) {
        if (!foto.equipoId || foto.lecturaFinal === null) continue
        const lecturaId = `lec_cuadre_${weekStart}_${foto.sucursal}_${foto.equipoId}_${foto.cabina || "_"}`.replace(/\s+/g, "_")
        const lectura = {
          LecturaID: lecturaId,
          FechaSemana: weekStart,
          EquipoID: foto.equipoId,
          Sucursal: foto.sucursal,
          Cabina: foto.cabina,
          OperadoraID: "",
          LecturaInicial: foto.lecturaInicialAuto || 0,
          LecturaFinal: foto.lecturaFinal,
          DiferenciaReal: Math.max(0, (foto.lecturaFinal || 0) - (foto.lecturaInicialAuto || 0)),
          Observaciones: foto.observaciones || `Cuadre semanal — foto ${foto.filename}`,
        }
        await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveLectura", data: JSON.stringify(lectura) })
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
          FotosCount: fotos.length,
          Fuente: "wizard_cuadre_semanal",
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
        fotosCount: fotos.length,
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
    setFotos([])
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
          Sube el Excel de AgendaPro, las fotos de las pantallas láser, revisa diferencias y guarda el snapshot.
        </p>
      </div>

      <ProgressBar step={step} />

      {/* PASO 1 — Semana + sucursal */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarRange className="h-4 w-4" /> Paso 1 · Selecciona la semana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Lunes</Label>
                <Input type="date" value={weekStart} onChange={(e) => setWeekStart(lunesDeSemana(e.target.value))} className="mt-1" />
                <p className="mt-1 text-[10px] text-muted-foreground">Se ajusta al lunes de la semana elegida.</p>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sábado</Label>
                <Input type="date" value={weekEnd} readOnly className="mt-1 bg-muted/40" />
                <p className="mt-1 text-[10px] text-muted-foreground">Auto: lunes + 5 días.</p>
              </div>
              <div>
                <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sucursal</Label>
                <Select value={sucursalFiltro} onValueChange={setSucursalFiltro}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sucursalesOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Alert tone="info">
              Semana evaluada: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b>{" "}
              · Sucursal: <b>{sucursalFiltro}</b>
            </Alert>
            <NavButtons onNext={() => setStep(2)} nextLabel="Continuar a Excel" nextEnabled={!!weekStart && !!weekEnd} />
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
                Hoja &quot;Detalle Disparos tratamientos&quot;. Solo filas dentro del rango {fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}{sucursalFiltro !== "Todas" ? ` y sucursal ${sucursalFiltro}` : ""} se procesan.
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
                  const validas = imp.rows.filter((r) => r.status === "valid").length
                  const duplicadas = imp.rows.filter((r) => r.status === "duplicate").length
                  const errores = imp.rows.filter((r) => r.status === "error").length
                  return (
                    <div key={idx} className="rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold">{imp.filename}</div>
                          <div className="mt-0.5 text-muted-foreground">
                            Hoja: {imp.parsed.sheet} · Header fila: {imp.parsed.headerRow}
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => removeExcelImport(idx)} title="Quitar">
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Mini label="Leídas" value={imp.rows.length} />
                        <Mini label="Válidas" value={validas} tone="ok" />
                        <Mini label="Duplicadas" value={duplicadas} tone="warn" />
                        <Mini label="Errores" value={errores} tone="error" />
                        <Mini label="Disparos" value={imp.totalDisparos} />
                        {imp.imported > 0
                          ? <Mini label="Importadas" value={imp.imported} tone="ok" />
                          : null}
                        {imp.duplicatesDb > 0
                          ? <Mini label="Dup DB" value={imp.duplicatesDb} tone="warn" />
                          : null}
                      </div>
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

            <NavButtons
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              nextLabel="Continuar a fotos"
              nextEnabled={excelImports.length > 0}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* PASO 3 — Fotos */}
      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Paso 3 · Sube las fotos de pantalla
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
              <Camera className="mx-auto mb-2 h-8 w-8 text-primary" />
              <p className="text-sm font-semibold">Arrastra las fotos o selecciona</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Una foto por equipo (pantalla del GentleYAG). El número de pulsos se ingresa manualmente por ahora — OCR/IA queda preparado en próxima iteración.
              </p>
              <input
                ref={fotosInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => handleFotosFiles(e.target.files)}
              />
              <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => fotosInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> Seleccionar fotos
              </Button>
            </div>

            {fotos.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {fotos.map((foto) => (
                  <FotoCard
                    key={foto.id}
                    foto={foto}
                    equipos={db.equipos.filter((e) => e.Estado !== "Inactivo")}
                    sucursales={sucursalesOptions.filter((s) => s !== "Todas")}
                    onUpdate={(patch) => updateFoto(foto.id, patch)}
                    onRemove={() => removeFoto(foto.id)}
                  />
                ))}
              </div>
            ) : null}

            <NavButtons
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
              nextLabel="Continuar a revisión"
              nextEnabled={fotos.some((f) => f.equipoId && f.lecturaFinal !== null)}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* PASO 4 — Revisión */}
      {step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" /> Paso 4 · Revisión del cuadre
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
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
                  <TableRow key={r.rowId}>
                    <TableCell className="font-bold">{r.equipoId}</TableCell>
                    <TableCell className="text-xs">{r.sucursal}</TableCell>
                    <TableCell className="text-xs">{r.cabina || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.lecturaInicial.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.lecturaFinal.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-bold">{r.disparosLaser.toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      <Input
                        type="number" min={0}
                        value={r.disparosOperador}
                        onChange={(e) => setEquiposEditados((prev) => ({
                          ...prev,
                          [r.rowId]: { ...(prev[r.rowId] || {}), disparosOperador: Math.max(0, Number(e.target.value) || 0) },
                        }))}
                        className="h-7 w-24 text-right text-xs"
                      />
                    </TableCell>
                    <TableCell className={`text-right font-mono text-xs ${r.diferencia > 0 ? "text-rose-600" : r.diferencia < 0 ? "text-sky-600" : ""}`}>
                      {r.diferencia > 0 ? "+" : ""}{r.diferencia.toLocaleString("es-DO")}
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.porcentaje.toFixed(1)}%</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${ALERT_CLS[r.alerta]}`}>
                        {r.alerta === "OK"
                          ? <CheckCircle2 className="h-2.5 w-2.5" />
                          : <AlertTriangle className="h-2.5 w-2.5" />}
                        {r.alerta}
                      </span>
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
              <NavButtons onBack={() => setStep(3)} onNext={() => setStep(5)} nextLabel="Continuar a guardar" nextEnabled={equiposCuadre.length > 0} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* PASO 5 — Guardar */}
      {step === 5 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Save className="h-4 w-4" /> Paso 5 · Guardar cuadre semanal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="info">
              Se guardarán <b>{equiposCuadre.length}</b> auditorías y <b>{fotos.filter((f) => f.equipoId && f.lecturaFinal !== null).length}</b> lecturas semanales en la base de datos.
              Si ya existe un cuadre para alguna combinación semana/equipo/cabina, el handler responde con error claro — desde el SQL editor se puede borrar el row previo para reemplazar.
            </Alert>
            <div className="rounded-xl border bg-slate-50/60 p-3 text-xs">
              <div className="font-bold uppercase tracking-wide text-muted-foreground">Resumen</div>
              <ul className="mt-2 space-y-1">
                <li>Semana: <b>{fmtFechaLocal(weekStart)} → {fmtFechaLocal(weekEnd)}</b></li>
                <li>Sucursal: <b>{sucursalFiltro}</b></li>
                <li>Excel cargados: <b>{excelImports.length}</b> ({excelImports.reduce((s, i) => s + i.imported, 0)} sesiones importadas)</li>
                <li>Fotos: <b>{fotos.length}</b></li>
                <li>Equipos a auditar: <b>{equiposCuadre.length}</b></li>
                <li>Alertas: <b className="text-emerald-600">{equiposCuadre.filter((e) => e.alerta === "OK").length} OK</b> · <b className="text-amber-600">{equiposCuadre.filter((e) => e.alerta === "Advertencia").length} Advertencia</b> · <b className="text-rose-600">{equiposCuadre.filter((e) => e.alerta === "Critico").length} Crítico</b></li>
              </ul>
            </div>
            <NavButtons
              onBack={() => setStep(4)}
              onNext={guardarCuadre}
              nextLabel={guardando ? "Guardando..." : "Guardar cuadre semanal"}
              nextEnabled={!guardando && equiposCuadre.length > 0}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: WizardStep }) {
  const labels = ["Semana", "Excel", "Fotos", "Revisar", "Guardar"]
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

function Mini({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "error" }) {
  const cls = tone === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-700"
    : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700"
    : "border-slate-200 bg-white text-slate-700"
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}: <span className="font-mono">{value.toLocaleString("es-DO")}</span>
    </span>
  )
}

function FotoCard({ foto, equipos, sucursales, onUpdate, onRemove }: {
  foto: FotoEntry
  equipos: Array<{ EquipoID: string; Sucursal: string; Modelo: string }>
  sucursales: string[]
  onUpdate: (patch: Partial<FotoEntry>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={foto.dataUrl} alt={foto.filename} className="h-24 w-24 shrink-0 rounded-lg border object-cover" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-bold">{foto.filename}</div>
              <div className="text-[10px] text-muted-foreground">{foto.lecturaInicialAuto !== null ? `Lect. inicial auto: ${foto.lecturaInicialAuto.toLocaleString("es-DO")}` : "Sin lectura previa para autocompletar"}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={foto.equipoId} onValueChange={(value) => onUpdate({ equipoId: value })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Equipo" /></SelectTrigger>
              <SelectContent>
                {equipos.map((e) => <SelectItem key={e.EquipoID} value={e.EquipoID}>{e.EquipoID} · {e.Modelo}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={foto.sucursal} onValueChange={(value) => onUpdate({ sucursal: value })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sucursal" /></SelectTrigger>
              <SelectContent>
                {sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              type="text" placeholder="Cabina (opcional)" value={foto.cabina}
              onChange={(e) => onUpdate({ cabina: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              type="number" min={0} placeholder="Lectura final *"
              value={foto.lecturaFinal ?? ""}
              onChange={(e) => onUpdate({ lecturaFinal: e.target.value === "" ? null : Number(e.target.value) })}
              className="h-8 text-xs"
            />
          </div>
          <Input
            type="text" placeholder="Observaciones"
            value={foto.observaciones}
            onChange={(e) => onUpdate({ observaciones: e.target.value })}
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
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
