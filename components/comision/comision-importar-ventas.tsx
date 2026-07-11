"use client"

/**
 * Tab VENTAS del Importador de Incentivos de Ventas.
 * Parsea la hoja "Produccion"/"Produccion v2", detecta TODOS los períodos del
 * archivo (puede cubrir varios meses), concilia contra la hoja "Resumen"
 * (total/servicios/productos/medios de pago) y confirma la importación con
 * cálculos por empleado POR MES.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react"
import { toSaleRecord, aggregateSales, type SaleRecord, type AggregateResult, type AggregateConfig } from "@/lib/commission/aggregate"
import { computeRowHash, fnvHex } from "@/lib/commission/hash"
import { parseDateISO } from "@/lib/commission/normalize"
import { extractResumenControls, type ResumenControls } from "@/lib/commission/ventas-resumen"
import { payBucketsFromV2, dominantPayment, addBuckets, type PayBuckets } from "@/lib/commission/ventas-pago"
import type { SaleCategory } from "@/lib/commission/classification"

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Columnas del export real (1-indexed): "Produccion" (header fila 1) y
// "Produccion v2" (header fila 2, con desglose de medios de pago por fila).
const COL = { id: 1, fecha: 2, local: 3, cliente: 4, tipo: 9, nombre: 10, prestador: 11, cantidad: 13, precio: 16 }
const COLV2 = { id: 1, fecha: 2, local: 3, cliente: 4, tipo: 8, nombre: 9, prestador: 10, cantidad: 13, precio: 16 }

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

// Medios de pago por recibo: lógica pura compartida en lib/commission/ventas-pago.

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

interface ParsedSale { rec: SaleRecord; rawProvider: string; rowHash: string; originalId: string; monthKey: string }
interface Parsed {
  filename: string; fileHash: string; sales: ParsedSale[]; agg: AggregateResult
  periods: string[]; minDate: string; maxDate: string
  resumen: ResumenControls | null
  paySums: Record<string, number>
}

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

/** Semáforo de conciliación: CUADRADO (≤ RD$1), ADVERTENCIA (≤1%), CRÍTICO. */
function semaforo(diff: number, base: number): "CUADRADO" | "ADVERTENCIA" | "CRÍTICO" {
  const d = Math.abs(diff)
  if (d <= 1) return "CUADRADO"
  if (base > 0 && d / base <= 0.01) return "ADVERTENCIA"
  return "CRÍTICO"
}
const SEM_CLASS: Record<string, string> = {
  CUADRADO: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ADVERTENCIA: "bg-amber-50 text-amber-700 border-amber-200",
  "CRÍTICO": "bg-red-50 text-red-600 border-red-200",
}

export function ImportarVentasTab({ onImported }: { onImported?: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canImport = canPerm(user, "sales_commission.import") || canPerm(user, "sales_commission.import.sales")
  const [cfg, setCfg] = useState<AggregateConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState("")
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
      setPhase("Analizando archivo…")
      const buf = await file.arrayBuffer()
      const fileHash = await sha256Hex(buf)
      if (/\.csv$/i.test(file.name)) throw new Error("Usa el archivo .xlsx del reporte de ventas.")
      const ExcelJS = (await import("exceljs")).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf)
      setPhase("Validando columnas…")
      const wsV2 = wb.getWorksheet("Produccion v2")
      const ws = wsV2 || wb.getWorksheet("Produccion") || wb.worksheets[0]
      if (!ws) throw new Error("El archivo no tiene datos.")
      const isV2 = Boolean(wsV2) && ws === wsV2
      const C = isV2 ? COLV2 : COL
      const headerRow = isV2 ? 2 : 1
      const hName = String(flat(ws.getRow(headerRow).getCell(C.nombre).value) ?? "")
      if (!/servicio|producto/i.test(hName)) throw new Error('Formato no reconocido: se espera la hoja "Produccion" del reporte de ventas.')

      setPhase("Normalizando y detectando duplicados…")
      // El desglose de pago viene POR RECIBO (una sola línea lo lleva en
      // recibos multi-línea) → pre-pasada acumulando por Identificador para
      // asignar a cada línea el medio dominante de SU recibo.
      const receiptPay = new Map<string, PayBuckets>()
      if (isV2) {
        for (let r = headerRow + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r)
          const rid = String(flat(row.getCell(C.id).value) ?? "").trim()
          if (!rid) continue
          receiptPay.set(rid, addBuckets(receiptPay.get(rid) || { tarjeta: 0, efectivo: 0, transf: 0, otros: 0 }, payBucketsFromV2(row)))
        }
      }
      const sales: ParsedSale[] = []
      const hashSeen = new Map<string, number>()
      const monthSet = new Set<string>()
      const paySums: Record<string, number> = {}
      let minDate = "", maxDate = ""
      for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = ws.getRow(r)
        const rawProvider = String(flat(row.getCell(C.prestador).value) ?? "")
        const itemName = String(flat(row.getCell(C.nombre).value) ?? "")
        const itemType = String(flat(row.getCell(C.tipo).value) ?? "")
        if (!itemName && !itemType) continue
        const date = String(flat(row.getCell(C.fecha).value) ?? "")
        const originalId = String(flat(row.getCell(C.id).value) ?? "").trim()
        const receipt = originalId ? receiptPay.get(originalId) : undefined
        const rec = toSaleRecord({
          date, branch: flat(row.getCell(C.local).value), customer: flat(row.getCell(C.cliente).value),
          provider: rawProvider, itemType, itemName,
          quantity: flat(row.getCell(C.cantidad).value), amount: flat(row.getCell(C.precio).value),
          paymentMethod: isV2 ? dominantPayment(receipt || payBucketsFromV2(row)) : undefined,
        })
        const baseHash = computeRowHash("", { date: rec.date, branch: rec.branch, provider: rec.provider, customer: rec.customer, itemName: rec.itemName, category: rec.category, quantity: rec.quantity, amount: rec.amount, originalId })
        const occurrence = (hashSeen.get(baseHash) || 0) + 1
        hashSeen.set(baseHash, occurrence)
        const rowHash = occurrence === 1 ? baseHash : fnvHex(`${baseHash}#${occurrence}`)
        const iso = parseDateISO(rec.date)
        const monthKey = iso ? iso.slice(0, 7) : ""
        if (monthKey) monthSet.add(monthKey)
        if (iso) { if (!minDate || iso < minDate) minDate = iso; if (!maxDate || iso > maxDate) maxDate = iso }
        paySums[rec.paymentMethod] = Math.round(((paySums[rec.paymentMethod] || 0) + rec.amount) * 100) / 100
        sales.push({ rec, rawProvider, rowHash, originalId, monthKey })
      }
      if (!sales.length) throw new Error("No se encontraron ventas en el archivo.")

      setPhase("Calculando y conciliando…")
      const agg = aggregateSales(sales.map((s) => s.rec), cfg || configFromRules([]))
      const resumen = extractResumenControls(wb)
      setParsed({ filename: file.name, fileHash, sales, agg, periods: [...monthSet].sort(), minDate, maxDate, resumen, paySums })

      const chk = await apiJsonp(normalizeApiUrl(apiUrl), { action: "checkCommissionImport", fileHash, importType: "SALES" })
      if (chk?.ok && chk.exists) setDupExisting(chk.existing as never)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo analizar el archivo", "error")
    } finally {
      setBusy(false); setPhase("")
    }
  }, [apiUrl, cfg, showToast])

  const onFiles = (files: FileList | null) => { const f = files?.[0]; if (f) void process(f) }

  const confirmImport = async () => {
    if (!parsed || !canImport) return
    setBusy(true); setPhase("Guardando…")
    try {
      const last = parsed.periods[parsed.periods.length - 1] || ""
      const [py, pm] = last ? last.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1]
      // Cálculos POR MES: agrupar filas por mes y agregar cada grupo.
      const calcs: Record<string, unknown>[] = []
      for (const period of parsed.periods) {
        const [y, m] = period.split("-").map(Number)
        const monthRecs = parsed.sales.filter((s) => s.monthKey === period).map((s) => s.rec)
        const magg = aggregateSales(monthRecs, cfg || configFromRules([]))
        for (const e of magg.perEmployee) {
          calcs.push({ periodMonth: m, periodYear: y, provider: e.provider, branch: e.branch, productUnits: e.productUnits, productIncentive: e.productIncentive, serviceCommissionTotal: e.serviceCommissionTotal, laserSales: e.laserSales, patients: e.patients })
        }
      }
      const payload = {
        import: {
          periodMonth: pm, periodYear: py, filename: parsed.filename, fileHash: parsed.fileHash,
          rowsCount: parsed.sales.length, grossTotal: parsed.agg.totalGross,
          detectedPeriodStart: parsed.minDate, detectedPeriodEnd: parsed.maxDate,
        },
        sales: parsed.sales.map((s) => ({
          date: s.rec.date, branch: s.rec.branch, customer: s.rec.customer, provider: s.rec.provider,
          providerOriginal: s.rawProvider, itemType: s.rec.itemType, itemName: s.rec.itemName,
          category: s.rec.category, quantity: s.rec.quantity, amount: s.rec.amount, paymentMethod: s.rec.paymentMethod,
          rowHash: s.rowHash, originalId: s.originalId,
        })),
        calculations: calcs,
        ruleSnapshot: cfg,
        rawSummary: parsed.resumen,
      }
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "commitCommissionImport", importJson: JSON.stringify(payload) })
      if (res?.duplicate) { setDupExisting(res.existing as never); return }
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo importar")
      invalidateReadCache("getCommissionImports"); invalidateReadCache("getCommissionCalculations"); invalidateReadCache("getCommissionDashboard"); invalidateReadCache("getCommissionByBranch")
      setCommitted(res as never)
      showToast("Importación de ventas confirmada", "success")
      onImported?.()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al importar", "error")
    } finally {
      setBusy(false); setPhase("")
    }
  }

  const agg = parsed?.agg
  const warns: string[] = []
  if (agg) {
    const noBranch = agg.branches[""]?.count || 0
    if (noBranch) warns.push(`${noBranch} ventas sin sucursal`)
    const otros = agg.byCategory.OTROS?.count || 0
    if (otros) warns.push(`${otros} ventas sin clasificar (OTROS)`)
    if (agg.unassigned.count) warns.push(`${agg.unassigned.count} ventas sin prestador comisionable (${fmtRD(agg.unassigned.gross)}) → Pendientes de vinculación`)
  }

  // Conciliación contra la hoja Resumen (§6-7).
  const recon: { label: string; archivo: number; importado: number }[] = []
  if (parsed?.resumen && agg) {
    const r = parsed.resumen
    const productos = agg.byCategory.PRODUCTO?.sales || 0
    recon.push({ label: "Total del período", archivo: r.total, importado: agg.totalGross })
    recon.push({ label: "Servicios", archivo: r.servicios, importado: Math.round((agg.totalGross - productos) * 100) / 100 })
    recon.push({ label: "Productos", archivo: r.productos, importado: productos })
    if (parsed.paySums.EFECTIVO || r.efectivo) recon.push({ label: "Efectivo", archivo: r.efectivo, importado: parsed.paySums.EFECTIVO || 0 })
    if (parsed.paySums.TARJETA || r.tarjeta) recon.push({ label: "Tarjeta", archivo: r.tarjeta, importado: parsed.paySums.TARJETA || 0 })
    if (parsed.paySums.TRANSFERENCIA || r.transferencia) recon.push({ label: "Transferencia", archivo: r.transferencia, importado: parsed.paySums.TRANSFERENCIA || 0 })
  }
  const hasCritical = recon.some((r) => semaforo(r.importado - r.archivo, r.archivo) === "CRÍTICO")

  return (
    <div className="space-y-4">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold">Ventas</div>
            <p className="text-xs text-muted-foreground">Importa ventas, productos, servicios, formas de pago y ventas por sucursal.</p>
          </div>
          {!canImport ? <div className="text-xs text-amber-600">No tienes permiso para importar ventas (solo análisis).</div> : null}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files) }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-[color:var(--brand-primary)] bg-cyan-50/50" : "border-slate-300"}`}
          >
            {busy ? <Loader2 className="h-8 w-8 animate-spin text-[color:var(--brand-primary)]" /> : <FileSpreadsheet className="h-8 w-8 text-slate-400" />}
            <div className="text-sm font-medium">{busy ? (phase || "Procesando…") : "Subir archivo de ventas"}</div>
            <div className="text-[11px] text-muted-foreground">Arrastra el .xlsx o haz clic. Se analiza primero; no se importa hasta confirmar.</div>
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
            <div className="font-semibold text-emerald-800">Importación de ventas confirmada</div>
            <div className="mt-1 text-emerald-700">{committed.salesInserted} ventas nuevas · {committed.salesDuplicated} duplicadas omitidas · {committed.employees} cálculos por empleado/mes.</div>
          </div>
        </CardContent></Card>
      ) : null}

      {agg && !committed ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Filas</div><div className="text-xl font-black tabular-nums">{agg.rows}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Bruto</div><div className="text-xl font-black tabular-nums">{fmtRD(agg.totalGross)}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Rango</div><div className="text-sm font-bold tabular-nums">{parsed?.minDate} → {parsed?.maxDate}</div></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><div className="text-xs text-muted-foreground">Empleados</div><div className="text-xl font-black tabular-nums">{agg.perEmployee.length}</div></CardContent></Card>
          </div>

          <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Períodos detectados ({parsed?.periods.length})</div>
            <div className="flex flex-wrap gap-1.5">
              {parsed?.periods.map((p) => {
                const [y, m] = p.split("-").map(Number)
                return <Badge key={p} variant="outline" className="bg-cyan-50 text-cyan-800 border-cyan-200">{MONTHS[m]} {y}</Badge>
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Cada venta se asigna a su mes REAL por fecha de transacción; los cálculos se generan por mes.</p>
          </CardContent></Card>

          {recon.length ? (
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">Conciliación contra hoja Resumen</div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="py-1 pr-2">Control</th><th className="py-1 pr-2 text-right">Archivo (Resumen)</th><th className="py-1 pr-2 text-right">Importado</th><th className="py-1 pr-2 text-right">Diferencia</th><th className="py-1">Estado</th></tr></thead>
                <tbody>{recon.map((r) => {
                  const diff = Math.round((r.importado - r.archivo) * 100) / 100
                  const sem = semaforo(diff, r.archivo)
                  return (
                    <tr key={r.label} className="border-b last:border-0">
                      <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtRD(r.archivo)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtRD(r.importado)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{fmtRD(diff)}</td>
                      <td className="py-1.5"><Badge variant="outline" className={SEM_CLASS[sem]}>{sem}</Badge></td>
                    </tr>
                  )
                })}</tbody>
              </table></div>
            </CardContent></Card>
          ) : null}

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
              <div><div className="font-semibold">Diagnóstico</div><ul className="mt-1 list-disc pl-4 text-amber-700">{warns.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
            </CardContent></Card>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--brand-border)] bg-white p-3 text-sm">
            <div className="min-w-0 text-muted-foreground">Archivo: <b className="text-foreground">{parsed?.filename}</b> · hash <span className="font-mono text-xs">{parsed?.fileHash.slice(0, 12)}…</span></div>
            <div className="flex items-center gap-2">
              {hasCritical ? <span className="text-xs font-semibold text-red-600">Hay diferencias CRÍTICAS de conciliación</span> : null}
              <Button disabled={!canImport || busy || !!dupExisting} onClick={confirmImport}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Confirmar importación</Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
