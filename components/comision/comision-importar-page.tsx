"use client"

/**
 * IMPORTADOR de Incentivos de Ventas — pantalla contenedora con dos importadores
 * claramente separados (Ventas y Reservas), cards de estado del período e
 * historial unificado de importaciones con anulación lógica.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Upload, ShoppingCart, CalendarCheck, History, RefreshCcw, Ban, Stethoscope } from "lucide-react"
import { ImportarVentasTab } from "./comision-importar-ventas"
import { ImportarReservasTab } from "./comision-importar-reservas"

const fmtRD = (n: number) => "RD$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface ImportRow {
  id: string; importType: string; filename: string; rowsCount: number; grossTotal: number
  status: string; importedBy: string | null; createdAt: string
  detectedPeriodStart: string | null; detectedPeriodEnd: string | null
  periodMonth: number; periodYear: number
  rawSummary: Record<string, unknown> | null
}

const STATUS_CLASS: Record<string, string> = {
  calculado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  importado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  borrador: "bg-amber-50 text-amber-700 border-amber-200",
  anulado: "bg-red-50 text-red-600 border-red-200",
}

type Tab = "ventas" | "reservas" | "historial"

export function ComisionImportarPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const canVoid = canPerm(user, "sales_commission.import")
  const [tab, setTab] = useState<Tab>("ventas")
  const [imports, setImports] = useState<ImportRow[]>([])
  const [filter, setFilter] = useState<"todos" | "SALES" | "RESERVATIONS">("todos")
  const [busy, setBusy] = useState(false)
  const [diag, setDiag] = useState<ImportRow | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getCommissionImports" })
      if (res?.ok) setImports((res.records as ImportRow[]) || [])
    } catch { /* la card mostrará vacío */ }
  }, [apiUrl])
  useEffect(() => { void load() }, [load])

  const lastActive = (type: string) => imports.find((i) => i.importType === type && i.status !== "anulado")
  const lastSales = useMemo(() => lastActive("SALES"), [imports])
  const lastResv = useMemo(() => lastActive("RESERVATIONS"), [imports])

  const doVoid = async (r: ImportRow) => {
    const reason = window.prompt(`¿Anular la importación "${r.filename}"? Es una anulación lógica (no se borra el historial).\nMotivo:`, "")
    if (reason === null) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "voidCommissionImport", id: r.id, reason })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo anular")
      invalidateReadCache("getCommissionImports")
      showToast("Importación anulada", "success")
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    } finally { setBusy(false) }
  }

  const filtered = imports.filter((i) => filter === "todos" || i.importType === filter)
  const periodLabel = (r: ImportRow) =>
    r.detectedPeriodStart ? `${r.detectedPeriodStart} → ${r.detectedPeriodEnd || "?"}` : `${String(r.periodMonth).padStart(2, "0")}/${r.periodYear}`

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Upload className="h-4 w-4 text-[color:var(--brand-primary)]" /> Importador de Incentivos de Ventas
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Carga los archivos de Ventas y Reservas del período. El sistema valida, detecta duplicados, vincula prestadores y calcula las bases necesarias para las comisiones e incentivos.
          </p>
        </CardContent>
      </Card>

      {/* Cards de estado */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600"><ShoppingCart className="h-3.5 w-3.5" /> Ventas</div>
          {lastSales ? (
            <div className="mt-1 space-y-0.5 text-xs">
              <div className="truncate font-medium">{lastSales.filename}</div>
              <div className="text-muted-foreground">{lastSales.rowsCount.toLocaleString("en-US")} filas · {fmtRD(lastSales.grossTotal)}</div>
              <div className="text-muted-foreground">Período: {periodLabel(lastSales)}</div>
              <Badge variant="outline" className={STATUS_CLASS[lastSales.status] || ""}>{lastSales.status}</Badge>
            </div>
          ) : <div className="mt-1 text-xs text-muted-foreground">Sin importaciones de ventas.</div>}
        </CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600"><CalendarCheck className="h-3.5 w-3.5" /> Reservas</div>
          {lastResv ? (
            <div className="mt-1 space-y-0.5 text-xs">
              <div className="truncate font-medium">{lastResv.filename}</div>
              <div className="text-muted-foreground">{lastResv.rowsCount.toLocaleString("en-US")} filas</div>
              <div className="text-muted-foreground">Período: {periodLabel(lastResv)}</div>
              <Badge variant="outline" className={STATUS_CLASS[lastResv.status] || ""}>{lastResv.status}</Badge>
            </div>
          ) : <div className="mt-1 text-xs text-muted-foreground">Sin importaciones de reservas.</div>}
        </CardContent></Card>
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Estado del período</div>
          <div className="mt-1 space-y-0.5 text-xs">
            <div>Ventas cargadas: <b className={lastSales ? "text-emerald-600" : "text-red-600"}>{lastSales ? "Sí" : "No"}</b></div>
            <div>Reservas cargadas: <b className={lastResv ? "text-emerald-600" : "text-red-600"}>{lastResv ? "Sí" : "No"}</b></div>
            <div>Cálculo listo: <b className={lastSales ? "text-emerald-600" : "text-slate-500"}>{lastSales ? "Sí" : "No"}</b></div>
            {!lastSales ? <div className="text-amber-600">Período incompleto: falta cargar archivo de Ventas.</div> : null}
            {!lastResv ? <div className="text-amber-600">Período incompleto: falta cargar archivo de Reservas.</div> : null}
          </div>
        </CardContent></Card>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-[color:var(--brand-border)] bg-white p-1">
        {([["ventas", "Ventas", ShoppingCart], ["reservas", "Reservas", CalendarCheck], ["historial", "Historial", History]] as [Tab, string, typeof ShoppingCart][]).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
              tab === id ? "bg-[color:var(--brand-primary)] text-white shadow-sm" : "text-slate-600 hover:bg-[color:var(--brand-bg-subtle)]",
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "ventas" ? <ImportarVentasTab onImported={load} /> : null}
      {tab === "reservas" ? <ImportarReservasTab onImported={load} /> : null}
      {tab === "historial" ? (
        <Card className="border-[color:var(--brand-border)]"><CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Historial de importaciones</span>
            <div className="ml-auto flex gap-1">
              {([["todos", "Todos"], ["SALES", "Ventas"], ["RESERVATIONS", "Reservas"]] as const).map(([id, label]) => (
                <button key={id} onClick={() => setFilter(id)} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", filter === id ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary-dark)]" : "border-slate-200 text-slate-500 hover:bg-slate-50")}>{label}</button>
              ))}
              <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={load}><RefreshCcw className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          {filtered.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Sin importaciones.</div> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Archivo</th><th className="px-2 py-2">Período detectado</th><th className="px-2 py-2 text-right">Filas</th><th className="px-2 py-2">Estado</th><th className="px-2 py-2">Por</th><th className="px-4 py-2 text-right">Acciones</th>
              </tr></thead>
              <tbody>{filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 text-xs">{String(r.createdAt || "").replace("T", " ").slice(0, 16)}</td>
                  <td className="px-2 py-2"><Badge variant="outline" className={r.importType === "SALES" ? "bg-cyan-50 text-cyan-800 border-cyan-200" : "bg-violet-50 text-violet-700 border-violet-200"}>{r.importType === "SALES" ? "Ventas" : "Reservas"}</Badge></td>
                  <td className="max-w-[220px] truncate px-2 py-2 text-xs" title={r.filename}>{r.filename}</td>
                  <td className="px-2 py-2 text-xs tabular-nums">{periodLabel(r)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.rowsCount.toLocaleString("en-US")}</td>
                  <td className="px-2 py-2"><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></td>
                  <td className="max-w-[140px] truncate px-2 py-2 text-xs" title={r.importedBy || ""}>{r.importedBy || "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => setDiag(r)}><Stethoscope className="mr-1 h-3.5 w-3.5" />Diagnóstico</Button>
                      {canVoid && r.status !== "anulado" ? (
                        <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700" disabled={busy} onClick={() => doVoid(r)}><Ban className="mr-1 h-3.5 w-3.5" />Anular</Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </CardContent></Card>
      ) : null}

      {/* Diagnóstico de una importación (períodos, filas, resumen crudo) */}
      <Dialog open={!!diag} onOpenChange={(o) => !o && setDiag(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Diagnóstico de importación</DialogTitle></DialogHeader>
          {diag ? (
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border p-3 text-xs">
                <div>Tipo: <b>{diag.importType === "SALES" ? "Ventas" : "Reservas"}</b></div>
                <div>Estado: <b>{diag.status}</b></div>
                <div className="col-span-2 break-all">Archivo: <b>{diag.filename}</b></div>
                <div>Filas: <b className="tabular-nums">{diag.rowsCount.toLocaleString("en-US")}</b></div>
                {diag.grossTotal ? <div>Bruto: <b className="tabular-nums">{fmtRD(diag.grossTotal)}</b></div> : <div />}
                <div className="col-span-2">Período detectado: <b>{periodLabel(diag)}</b></div>
                <div className="col-span-2">Importado por: <b>{diag.importedBy || "—"}</b> · {String(diag.createdAt || "").replace("T", " ").slice(0, 16)}</div>
              </div>
              {diag.rawSummary ? (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">Resumen del archivo</div>
                  <pre className="max-h-60 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] leading-relaxed">{JSON.stringify(diag.rawSummary, null, 2)}</pre>
                </div>
              ) : <p className="text-xs text-muted-foreground">Esta importación no guardó resumen del archivo.</p>}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
