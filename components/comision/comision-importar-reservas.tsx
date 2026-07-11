"use client"

/**
 * Tab RESERVAS del Importador de Incentivos de Ventas.
 * Parsea la hoja "Reservas" (export real de 29 columnas), muestra preview con
 * resumen por estado/prestador/sucursal y confirma en LOTES (archivos de 20 mil+
 * filas) con progreso visible: start → append×N → finalize (alimenta Clientes
 * atendidos por atenciones ASISTE, métrica principal, + clientes únicos).
 */
import { useCallback, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CalendarCheck, Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react"
import { parseReservasWorkbook, aggregateAttendance, type ReservasParseResult } from "@/lib/commission/reservations-parser"
import { sha256Hex } from "./comision-importar-ventas"

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const CHUNK = 3000

const STATUS_LABEL: Record<string, string> = {
  ASISTE: "Asiste", NO_ASISTE: "No Asiste", CANCELADO: "Cancelado",
  CONFIRMADO: "Confirmado", RESERVADO: "Reservado", EN_ESPERA: "En Espera", OTRO: "Otro",
}
const STATUS_CLASS: Record<string, string> = {
  ASISTE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  NO_ASISTE: "bg-red-50 text-red-600 border-red-200",
  CANCELADO: "bg-slate-50 text-slate-600 border-slate-200",
  CONFIRMADO: "bg-sky-50 text-sky-700 border-sky-200",
  RESERVADO: "bg-violet-50 text-violet-700 border-violet-200",
  EN_ESPERA: "bg-amber-50 text-amber-700 border-amber-200",
  OTRO: "bg-slate-50 text-slate-500 border-slate-200",
}

export function ImportarReservasTab({ onImported }: { onImported?: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canImport = canPerm(user, "sales_commission.import") || canPerm(user, "sales_commission.import.reservations")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("")
  const [parsed, setParsed] = useState<(ReservasParseResult & { filename: string; fileHash: string }) | null>(null)
  const [dupExisting, setDupExisting] = useState<{ filename: string; rowsCount: number } | null>(null)
  const [committed, setCommitted] = useState<{ inserted: number; duplicated: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const process = useCallback(async (file: File) => {
    setBusy(true); setParsed(null); setDupExisting(null); setCommitted(null)
    try {
      setPhase("Analizando archivo…")
      const buf = await file.arrayBuffer()
      const fileHash = await sha256Hex(buf)
      const ExcelJS = (await import("exceljs")).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      setPhase("Validando columnas y normalizando…")
      const result = parseReservasWorkbook(wb)
      if (result.errors.length) throw new Error(result.errors.join(" "))
      if (!result.rows.length) throw new Error("No se encontraron reservas en el archivo.")
      setParsed({ ...result, filename: file.name, fileHash })
      const chk = await apiJsonp(normalizeApiUrl(apiUrl), { action: "checkCommissionImport", fileHash, importType: "RESERVATIONS" })
      if (chk?.ok && chk.exists) setDupExisting(chk.existing as never)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo analizar el archivo", "error")
    } finally {
      setBusy(false); setPhase("")
    }
  }, [apiUrl, showToast])

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void process(f) }

  const confirmImport = async () => {
    if (!parsed || !canImport) return
    setBusy(true)
    try {
      setPhase("Iniciando importación…")
      const lastPeriod = parsed.periods[parsed.periods.length - 1] || ""
      const [py, pm] = lastPeriod ? lastPeriod.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1]
      const start = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "startReservationsImport", fileHash: parsed.fileHash, filename: parsed.filename,
        rowsCount: parsed.totalRows, periodStart: parsed.minDate, periodEnd: parsed.maxDate,
        month: pm, year: py, summaryJson: JSON.stringify({ byStatus: parsed.byStatus, byBranch: parsed.byBranch }),
      })
      if (start?.duplicate) { setDupExisting(start.existing as never); return }
      if (!start?.ok) throw new Error((start as { error?: string })?.error || "No se pudo iniciar")
      const importId = String(start.importId)

      // Lotes con progreso (no una petición por fila).
      const chunks: typeof parsed.rows[] = []
      for (let i = 0; i < parsed.rows.length; i += CHUNK) chunks.push(parsed.rows.slice(i, i + CHUNK))
      let inserted = 0, duplicated = 0
      for (let i = 0; i < chunks.length; i++) {
        setPhase(`Guardando lote ${i + 1}/${chunks.length}…`)
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "appendReservationsRows", importId, rowsJson: JSON.stringify(chunks[i]) })
        if (!res?.ok) throw new Error((res as { error?: string })?.error || `Error en lote ${i + 1}`)
        inserted += Number(res.inserted) || 0
        duplicated += Number(res.duplicated) || 0
      }

      setPhase("Generando resumen de atenciones…")
      const counts = aggregateAttendance(parsed.rows)
      const fin = await apiJsonp(normalizeApiUrl(apiUrl), { action: "finalizeReservationsImport", importId, countsJson: JSON.stringify(counts), rowsInserted: inserted })
      if (!fin?.ok) throw new Error((fin as { error?: string })?.error || "No se pudo finalizar")

      invalidateReadCache("getCommissionImports"); invalidateReadCache("getCommissionPatients"); invalidateReadCache("getCommissionLaser"); invalidateReadCache("getCommissionDashboard")
      setCommitted({ inserted, duplicated })
      showToast("Importación de reservas confirmada", "success")
      onImported?.()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al importar reservas", "error")
    } finally {
      setBusy(false); setPhase("")
    }
  }

  const topProviders = parsed ? Object.entries(parsed.byProvider).sort((a, b) => b[1].attended - a[1].attended).slice(0, 12) : []

  return (
    <div className="space-y-4">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold">Reservas</div>
            <p className="text-xs text-muted-foreground">Importa reservas para calcular clientes atendidos, asistencia por prestador y participación en incentivos.</p>
          </div>
          {!canImport ? <div className="text-xs text-amber-600">No tienes permiso para importar reservas (solo análisis).</div> : null}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-[color:var(--brand-primary)] bg-cyan-50/50" : "border-slate-300"}`}
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-[color:var(--brand-primary)]" /> : <CalendarCheck className="h-8 w-8 text-slate-400" />}
            <div className="text-sm font-medium">{busy ? (phase || "Procesando…") : "Subir archivo de reservas"}</div>
            <div className="text-[11px] text-muted-foreground">Arrastra el .xlsx (hoja &quot;Reservas&quot;) o haz clic. No se importa hasta confirmar.</div>
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>
        </CardContent>
      </Card>

      {dupExisting ? (
        <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-3 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold text-amber-800">Este archivo ya fue importado anteriormente. No se duplicaron datos.</div>
            <div className="mt-1 text-amber-700">{dupExisting.filename} · {dupExisting.rowsCount} filas</div>
          </div>
        </CardContent></Card>
      ) : null}

      {committed ? (
        <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="flex items-start gap-3 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <div className="font-semibold text-emerald-800">Importación de reservas confirmada</div>
            <div className="mt-1 text-emerald-700">{committed.inserted} reservas nuevas · {committed.duplicated} duplicadas omitidas. Clientes atendidos actualizado.</div>
          </div>
        </CardContent></Card>
      ) : null}

      {parsed && !committed ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Filas</div><div className="text-xl font-black tabular-nums">{parsed.totalRows.toLocaleString("en-US")}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Atenciones (Asiste)</div><div className="text-xl font-black tabular-nums text-emerald-600">{(parsed.byStatus.ASISTE || 0).toLocaleString("en-US")}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rango (realización)</div><div className="text-sm font-bold tabular-nums">{parsed.minDate} → {parsed.maxDate}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Prestadores</div><div className="text-xl font-black tabular-nums">{Object.keys(parsed.byProvider).length}</div></CardContent></Card>
          </div>

          <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Resumen por estado</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(parsed.byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <Badge key={s} variant="outline" className={STATUS_CLASS[s] || ""}>{STATUS_LABEL[s] || s}: {n.toLocaleString("en-US")}</Badge>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Solo las filas <b>Asiste</b> cuentan como atención realizada (regla inicial, configurable). El período usa la <b>Fecha de realización</b>.</p>
          </CardContent></Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Atenciones por prestador (top)</div>
              {topProviders.map(([p, v]) => (
                <div key={p} className="flex justify-between border-b py-1 text-sm last:border-0"><span>{p}</span><span className="tabular-nums text-muted-foreground">{v.attended.toLocaleString("en-US")} / {v.total.toLocaleString("en-US")}</span></div>
              ))}
            </CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Por sucursal</div>
              {Object.entries(parsed.byBranch).sort((a, b) => b[1] - a[1]).map(([b, n]) => (
                <div key={b} className="flex justify-between border-b py-1 text-sm last:border-0"><span>{b}</span><span className="tabular-nums text-muted-foreground">{n.toLocaleString("en-US")}</span></div>
              ))}
              <div className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Períodos detectados</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {parsed.periods.map((p) => { const [y, m] = p.split("-").map(Number); return <Badge key={p} variant="outline" className="bg-cyan-50 text-cyan-800 border-cyan-200">{MONTHS[m]} {y}</Badge> })}
              </div>
            </CardContent></Card>
          </div>

          {parsed.missingProvider ? (
            <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><b>{parsed.missingProvider.toLocaleString("en-US")}</b> filas sin prestador confiable ("PROVEEDOR NO DISPONIBLE" o vacío) → quedan como <b>Pendientes de vinculación</b> (no se inventan empleados).</div>
            </CardContent></Card>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--brand-border)] bg-white p-3 text-sm">
            <div className="min-w-0 text-muted-foreground">Archivo: <b className="text-foreground">{parsed.filename}</b> · hash <span className="font-mono text-xs">{parsed.fileHash.slice(0, 12)}…</span></div>
            <Button disabled={!canImport || busy || !!dupExisting} onClick={confirmImport}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}{busy && phase ? phase : "Confirmar importación"}</Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
