"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react"
import { toSaleRecord, aggregateSales, type SaleRecord, type AggregateResult, type AggregateConfig } from "@/lib/commission/aggregate"
import { computeRowHash } from "@/lib/commission/hash"
import type { SaleCategory } from "@/lib/commission/classification"

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Columnas conocidas de la hoja "Produccion" del export de Cibao (1-indexed).
const COL = { fecha: 2, local: 3, cliente: 4, tipo: 9, nombre: 10, prestador: 11, cantidad: 13, precio: 16 }

const flat = (v: unknown): unknown => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    if (o instanceof Date) return (o as Date).toISOString()
    if (o.result !== undefined) return o.result
    if (o.text !== undefined) return o.text
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("")
  }
  return v
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

interface ParsedSale { rec: SaleRecord; rawProvider: string; rowHash: string }
interface Parsed {
  filename: string; fileHash: string; sales: ParsedSale[]; agg: AggregateResult
  periodMonth: number; periodYear: number
}

/** Config del motor derivada de las reglas vivas (con fallback a los valores por defecto). */
function configFromRules(rules: { ruleType: string; category: string | null; percentage: number | null; fixedAmount: number | null; minAmount: number | null; active: boolean }[]): AggregateConfig {
  const active = rules.filter((r) => r.active)
  const prod = active.find((r) => r.ruleType === "product_unit_incentive")
  const catPct: Partial<Record<SaleCategory, number>> = {}
  for (const r of active) if (r.ruleType === "category_commission" && r.category) catPct[r.category as SaleCategory] = r.percentage ?? 0
  const laser = active.filter((r) => r.ruleType === "laser_scale" && r.minAmount != null && r.percentage != null)
    .map((r) => ({ threshold: Number(r.minAmount), percentage: Number(r.percentage) })).sort((a, b) => a.threshold - b.threshold)
  return {
    productUnitAmount: prod?.fixedAmount ?? 100,
    categoryPct: Object.keys(catPct).length ? catPct : { FACIALES: 0.2, HOLLYWOOD_AQUA_PEEL: 0.1, TATUAJES: 0.1, HIFU: 0.1, MASAJES: 0.2 },
    laserScale: laser.length ? laser : [{ threshold: 260000, percentage: 0.02 }, { threshold: 600000, percentage: 0.03 }, { threshold: 800000, percentage: 0.04 }, { threshold: 2000000, percentage: 0.05 }],
  }
}

export function ComisionImportarPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canImport = canPerm(user, "sales_commission.import")
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [cfg, setCfg] = useState<AggregateConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [dupExisting, setDupExisting] = useState<{ periodMonth: number; periodYear: number; filename: string; rowsCount: number; grossTotal: number } | null>(null)
  const [committed, setCommitted] = useState<{ salesInserted: number; salesDuplicated: number; employees: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionRules" })
        setCfg(configFromRules(res?.ok ? (res.records as never[]) : []))
      } catch { setCfg(configFromRules([])) }
    })()
  }, [apiUrl])

  const process = useCallback(async (file: File) => {
    setBusy(true); setParsed(null); setDupExisting(null); setCommitted(null)
    try {
      const buf = await file.arrayBuffer()
      const fileHash = await sha256Hex(buf)
      const isCsv = /\.csv$/i.test(file.name)
      if (isCsv) throw new Error("Por ahora usa el archivo .xlsx (CSV en próxima iteración).")
      const ExcelJS = (await import("exceljs")).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      const ws = wb.getWorksheet("Produccion") || wb.worksheets[0]
      if (!ws) throw new Error("El archivo no tiene datos.")
      const h1 = String(flat(ws.getRow(1).getCell(COL.nombre).value) ?? "")
      if (!/servicio|producto/i.test(h1)) throw new Error('No reconozco la estructura: se espera la hoja "Produccion" del reporte de ventas.')

      const sales: ParsedSale[] = []
      const monthCount: Record<string, number> = {}
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)
        const rawProvider = String(flat(row.getCell(COL.prestador).value) ?? "")
        const itemName = String(flat(row.getCell(COL.nombre).value) ?? "")
        const itemType = String(flat(row.getCell(COL.tipo).value) ?? "")
        if (!itemName && !itemType) continue
        const date = String(flat(row.getCell(COL.fecha).value) ?? "")
        const rec = toSaleRecord({
          date, branch: flat(row.getCell(COL.local).value), customer: flat(row.getCell(COL.cliente).value),
          provider: rawProvider, itemType, itemName,
          quantity: flat(row.getCell(COL.cantidad).value), amount: flat(row.getCell(COL.precio).value),
        })
        const rowHash = computeRowHash("", { date: rec.date, branch: rec.branch, provider: rec.provider, customer: rec.customer, itemName: rec.itemName, category: rec.category, quantity: rec.quantity, amount: rec.amount })
        sales.push({ rec, rawProvider, rowHash })
        // detectar período por la mayoría de fechas (DD/MM/YYYY o ISO)
        const mm = date.match(/(\d{4})-(\d{2})/) || date.match(/\d{1,2}\/(\d{2})\/(\d{4})/)
        if (mm) { const key = date.includes("-") ? `${mm[2]}-${mm[1]}` : `${mm[1]}-${mm[2]}`; monthCount[key] = (monthCount[key] || 0) + 1 }
      }
      if (!sales.length) throw new Error("No se encontraron ventas en el archivo.")

      const agg = aggregateSales(sales.map((s) => s.rec), cfg || configFromRules([]))
      // período dominante
      const dom = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0]?.[0]
      let pm = month, py = year
      if (dom) { const [mo, yr] = dom.split("-"); pm = Number(mo); py = Number(yr); setMonth(pm); setYear(py) }

      const p: Parsed = { filename: file.name, fileHash, sales, agg, periodMonth: pm, periodYear: py }
      setParsed(p)

      // dedup por archivo
      const chk = await apiJsonp(normalizeApiUrl(apiUrl), { action: "checkCommissionImport", fileHash })
      if (chk?.ok && chk.exists) setDupExisting(chk.existing as never)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo analizar el archivo", "error")
    } finally {
      setBusy(false)
    }
  }, [apiUrl, cfg, month, year, showToast])

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void process(f) }

  const confirmImport = async () => {
    if (!parsed || !canImport) return
    setBusy(true)
    try {
      const payload = {
        import: { periodMonth: month, periodYear: year, filename: parsed.filename, fileHash: parsed.fileHash, rowsCount: parsed.sales.length, grossTotal: parsed.agg.totalGross },
        sales: parsed.sales.map((s) => ({
          date: s.rec.date, branch: s.rec.branch, customer: s.rec.customer, provider: s.rec.provider,
          providerOriginal: s.rawProvider, itemType: s.rec.itemType, itemName: s.rec.itemName,
          category: s.rec.category, quantity: s.rec.quantity, amount: s.rec.amount, paymentMethod: s.rec.paymentMethod, rowHash: s.rowHash,
        })),
        calculations: parsed.agg.perEmployee.map((e) => ({ provider: e.provider, branch: e.branch, productUnits: e.productUnits, productIncentive: e.productIncentive, serviceCommissionTotal: e.serviceCommissionTotal, laserSales: e.laserSales, patients: e.patients })),
        ruleSnapshot: cfg,
      }
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "commitCommissionImport", importJson: JSON.stringify(payload) })
      if (res?.duplicate) { setDupExisting(res.existing as never); return }
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo importar")
      invalidateReadCache("getCommissionImports"); invalidateReadCache("getCommissionCalculations"); invalidateReadCache("getCommissionDashboard")
      setCommitted(res as never)
      showToast("Importación confirmada", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al importar", "error")
    } finally {
      setBusy(false)
    }
  }

  const agg = parsed?.agg
  const warns: string[] = []
  if (agg) {
    const noBranch = agg.branches[""]?.count || 0
    if (noBranch) warns.push(`${noBranch} ventas sin sucursal`)
    const otros = agg.byCategory.OTROS?.count || 0
    if (otros) warns.push(`${otros} ventas sin clasificar (OTROS)`)
    if (agg.unassigned.count) warns.push(`${agg.unassigned.count} ventas sin prestador comisionable (${fmtRD(agg.unassigned.gross)})`)
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Upload className="h-4 w-4 text-[color:var(--brand-primary)]" /> Importar ventas</div>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <div><Label className="text-xs">Mes</Label><Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Año</Label><Select value={String(year)} onValueChange={(v) => setYear(Number(v))}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{[year + 1, year, year - 1, year - 2].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {!canImport ? <div className="text-xs text-amber-600">No tienes permiso para importar (solo análisis).</div> : null}

          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-[color:var(--brand-primary)] bg-cyan-50/50" : "border-slate-300"}`}
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-[color:var(--brand-primary)]" /> : <FileSpreadsheet className="h-8 w-8 text-slate-400" />}
            <div className="text-sm font-medium">{busy ? "Analizando…" : "Arrastra el archivo .xlsx o haz clic para subir"}</div>
            <div className="text-[11px] text-muted-foreground">Reporte de ventas (hoja &quot;Produccion&quot;). No se importa hasta confirmar.</div>
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </div>
        </CardContent>
      </Card>

      {dupExisting ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-800">Este archivo ya fue importado anteriormente. No se duplicaron datos.</div>
              <div className="mt-1 text-amber-700">Período {String(dupExisting.periodMonth).padStart(2, "0")}/{dupExisting.periodYear} · {dupExisting.filename} · {dupExisting.rowsCount} filas · {fmtRD(dupExisting.grossTotal)}</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {committed ? (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold text-emerald-800">Importación confirmada</div>
              <div className="mt-1 text-emerald-700">{committed.salesInserted} ventas nuevas · {committed.salesDuplicated} duplicadas omitidas · {committed.employees} empleados calculados.</div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {agg && !committed ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Filas</div><div className="text-xl font-black tabular-nums">{agg.rows}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Bruto</div><div className="text-xl font-black tabular-nums">{fmtRD(agg.totalGross)}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Empleados</div><div className="text-xl font-black tabular-nums">{agg.perEmployee.length}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Fondo láser</div><div className="text-xl font-black tabular-nums">{fmtRD(agg.laser.fund)}</div><div className="text-[10px] text-muted-foreground">{(agg.laser.tramoPct * 100).toFixed(0)}% de {fmtRD(agg.laser.totalSales)}</div></CardContent></Card>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Por categoría</div>
              {Object.entries(agg.byCategory).sort((a, b) => b[1].sales - a[1].sales).map(([c, v]) => (
                <div key={c} className="flex justify-between border-b py-1 text-sm last:border-0"><span>{c}</span><span className="tabular-nums text-muted-foreground">{v.count} · {fmtRD(v.sales)}</span></div>
              ))}
            </CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Por sucursal</div>
              {Object.entries(agg.branches).sort((a, b) => b[1].gross - a[1].gross).map(([b, v]) => (
                <div key={b} className="flex justify-between border-b py-1 text-sm last:border-0"><span>{b || "(sin sucursal)"}</span><span className="tabular-nums text-muted-foreground">{v.count} · {fmtRD(v.gross)}</span></div>
              ))}
            </CardContent></Card>
          </div>

          {warns.length ? (
            <Card className="border-amber-200 bg-amber-50/40"><CardContent className="flex items-start gap-2 p-4 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><div className="font-semibold">Conciliación</div><ul className="mt-1 list-disc pl-4 text-amber-700">{warns.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
            </CardContent></Card>
          ) : null}

          <div className="flex items-center justify-between rounded-lg border border-[color:var(--brand-border)] bg-white p-3 text-sm">
            <div className="text-muted-foreground">Archivo: <b className="text-foreground">{parsed?.filename}</b> · hash <span className="font-mono text-xs">{parsed?.fileHash.slice(0, 12)}…</span> · período <b className="text-foreground">{String(month).padStart(2, "0")}/{year}</b></div>
            <Button disabled={!canImport || busy || !!dupExisting} onClick={confirmImport}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Confirmar importación</Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
