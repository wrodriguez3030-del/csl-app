"use client"

/**
 * Tab GASTOS del Importador de Incentivos de Ventas.
 * Lee el libro `reportes de incentivo YYYY.xlsx` en el navegador: el libro de
 * gastos por sucursal de cada hoja mensual, la hoja «consolidado» (inversiones y
 * retiros de socios) y, opcionalmente, «Historico ventas» (2017 → antes de la
 * primera venta real). Concilia contra los totales del propio Excel y solo
 * escribe al confirmar.
 */
import { useCallback, useMemo, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FileSpreadsheet, Loader2, CheckCircle2, ShieldAlert } from "lucide-react"
import { sha256Hex, semaforo } from "./comision-importar-ventas"
import { parseGastosWorkbook, type GastosParseResult } from "@/lib/finanzas/gastos-parser"
import { parseConsolidado, type ConsolidadoResult } from "@/lib/finanzas/consolidado-parser"
import { parseHistorico, type HistoricoResult } from "@/lib/finanzas/historico-parser"
import type { ExpenseImportPayload } from "@/lib/finanzas/expense-import-schema"
import { ImportarGastosPreview, type CheckResult } from "./comision-importar-gastos-preview"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FIRST_REAL_SALE_YM = "2020-05"

interface Parsed { filename: string; fileHash: string; gastos: GastosParseResult; cons: ConsolidadoResult; hist: HistoricoResult }
interface Committed { expenses: { inserted: number; duplicated: number }; investments: { inserted: number; duplicated: number; differs: unknown[] }; withdrawals: { inserted: number; duplicated: number }; history: { upserted: number }; superseded: number }
interface DupExisting { filename: string; rowsCount: number; grossTotal: number }

function buildPayload(p: Parsed, includeHistory: boolean): ExpenseImportPayload {
  const g = p.gastos
  const grossTotal = Math.round(g.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100
  return {
    import: {
      filename: p.filename, fileHash: p.fileHash, year: g.year || new Date().getFullYear(), rowsCount: g.rows.length, grossTotal,
      detectedPeriodStart: g.minDate, detectedPeriodEnd: g.maxDate, periods: g.periods, includeHistory: includeHistory && p.hist.rows.length > 0,
    },
    expenses: g.rows.map((r) => ({
      date: r.date, branch: r.branch, concept: r.concept, amount: r.amount, account: r.account, category: r.category,
      notes: `Importado de ${p.filename} · hoja ${r.sheet} · fila ${r.excelRow}`, rowHash: r.rowHash,
    })),
    investments: p.cons.investments.map((i) => ({ year: i.year, month: i.month, branch: i.branch, amount: i.amount, nombre: i.nombre, fechaInicio: i.fechaInicio, rowHash: i.rowHash })),
    withdrawals: p.cons.withdrawals.map((w) => ({ year: w.year, month: w.month, kind: w.kind, amount: w.amount, date: w.date, rowHash: w.rowHash })),
    history: includeHistory ? p.hist.rows : [],
    rawSummary: {
      controls: g.sheets.flatMap((s) => s.controls), blocks: g.sheets.flatMap((s) => s.blocks.filter((b) => !b.branch && b.rows > 0)),
      consolidado: p.cons.months, warnings: [...g.warnings, ...p.cons.warnings, ...p.hist.warnings],
    },
  }
}

export function ImportarGastosTab({ onImported }: { onImported?: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canImport = canPerm(user, "sales_commission.import") || canPerm(user, "sales_commission.import.expenses")
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("")
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [force, setForce] = useState(false)
  const [dupExisting, setDupExisting] = useState<DupExisting | null>(null)
  const [committed, setCommitted] = useState<Committed | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const process = useCallback(async (file: File) => {
    setBusy(true); setParsed(null); setCheck(null); setDupExisting(null); setCommitted(null); setForce(false)
    try {
      setPhase("Analizando archivo…")
      const buf = await file.arrayBuffer()
      const fileHash = await sha256Hex(buf)
      if (!/\.xlsx$/i.test(file.name)) throw new Error("Usa el libro .xlsx de reportes de incentivo.")
      const ExcelJS = (await import("exceljs")).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      setPhase("Leyendo hojas mensuales, consolidado e histórico…")
      const gastos = parseGastosWorkbook(wb, file.name)
      const cons = gastos.year ? parseConsolidado(wb, gastos.year) : { found: false, months: [], investments: [], withdrawals: [], warnings: [] }
      const hist = parseHistorico(wb, FIRST_REAL_SALE_YM)
      setIncludeHistory(hist.found && hist.rows.length > 0)
      setParsed({ filename: file.name, fileHash, gastos, cons, hist })
      setPhase("Comprobando duplicados y totales ya cargados…")
      const chk = await apiJsonp(normalizeApiUrl(apiUrl), { action: "checkExpenseImport", fileHash, periods: gastos.periods.join(",") })
      if (chk?.ok) {
        setCheck(chk as unknown as CheckResult)
        if (chk.exists) setDupExisting(chk.existing as DupExisting)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo analizar el archivo", "error")
    } finally { setBusy(false); setPhase("") }
  }, [apiUrl, showToast])

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void process(f) }

  const hasCritical = useMemo(() => Boolean(parsed?.gastos.sheets.some((s) => s.controls.some((c) => c.control != null && semaforo(c.numericTotal - c.control, c.control) === "CRÍTICO"))), [parsed])
  const hasErrors = Boolean(parsed?.gastos.errors.length)
  const canConfirm = Boolean(parsed) && canImport && !busy && !dupExisting && !hasErrors && (!hasCritical || force) && (parsed?.gastos.rows.length || 0) > 0

  const confirmImport = async () => {
    if (!parsed || !canConfirm) return
    setBusy(true); setPhase("Guardando…")
    try {
      const payload = buildPayload(parsed, includeHistory)
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "commitExpenseImport", importJson: JSON.stringify(payload) })
      if (res?.duplicate) { setDupExisting(res.existing as DupExisting); return }
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo importar")
      for (const k of ["getExpenseImports", "getBiFinanceData", "getExpenses", "getCommissionImports"]) invalidateReadCache(k)
      setCommitted(res as unknown as Committed)
      showToast("Importación de gastos confirmada", "success")
      onImported?.()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al importar", "error")
    } finally { setBusy(false); setPhase("") }
  }

  return (
    <div className="space-y-4">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold">Gastos</div>
            <p className="text-xs text-muted-foreground">Importa el libro <b>reportes de incentivo AAAA.xlsx</b>: gastos por sucursal de cada mes, inversiones y retiros de socios (hoja consolidado) y el histórico de ventas anterior a mayo 2020.</p>
          </div>
          {!canImport ? <div className="text-xs text-amber-600">No tienes permiso para importar gastos (solo análisis).</div> : null}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-[color:var(--brand-primary)] bg-cyan-50/50" : "border-slate-300"}`}
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-[color:var(--brand-primary)]" /> : <FileSpreadsheet className="h-8 w-8 text-slate-400" />}
            <div className="text-sm font-medium">{busy ? (phase || "Procesando…") : "Subir libro de gastos"}</div>
            <div className="text-[11px] text-muted-foreground">Arrastra el .xlsx o haz clic. Se analiza y concilia primero; no se importa hasta confirmar.</div>
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>
        </CardContent>
      </Card>

      {dupExisting ? (
        <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-3 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold text-amber-800">Este archivo ya fue importado anteriormente. No se duplicaron datos.</div>
            <div className="mt-1 text-amber-700">{dupExisting.filename} · {dupExisting.rowsCount} filas · {fmtRD(dupExisting.grossTotal)}</div>
          </div>
        </CardContent></Card>
      ) : null}

      {committed ? (
        <Card className="border-emerald-200 bg-emerald-50/40"><CardContent className="flex items-start gap-3 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <div className="font-semibold text-emerald-800">Importación de gastos confirmada</div>
            <div className="mt-1 text-emerald-700">
              {committed.expenses.inserted} gastos nuevos · {committed.expenses.duplicated} ya existentes omitidos · {committed.investments.inserted} inversiones nuevas ({committed.investments.duplicated} ya cargadas) · {committed.withdrawals.inserted} retiros · {committed.history.upserted} meses de histórico · {committed.superseded} totales mensuales reemplazados por el detalle.
            </div>
          </div>
        </CardContent></Card>
      ) : null}

      {parsed && !committed ? (
        <>
          <ImportarGastosPreview parsed={parsed.gastos} cons={parsed.cons} hist={parsed.hist} check={check} includeHistory={includeHistory} onToggleHistory={setIncludeHistory} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--brand-border)] bg-white p-3 text-sm">
            <div className="min-w-0 text-muted-foreground">Archivo: <b className="text-foreground">{parsed.filename}</b> · hash <span className="font-mono text-xs">{parsed.fileHash.slice(0, 12)}…</span></div>
            <div className="flex flex-wrap items-center gap-3">
              {hasErrors ? <span className="text-xs font-semibold text-red-600">Hay errores que impiden importar</span> : null}
              {hasCritical && !hasErrors ? (
                <label className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                  <Checkbox checked={force} onCheckedChange={(v) => setForce(Boolean(v))} /> Hay diferencias CRÍTICAS — importar de todos modos
                </label>
              ) : null}
              <Button disabled={!canConfirm} onClick={confirmImport}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Confirmar importación</Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
