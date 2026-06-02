"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Wallet, Plus, Trash2, Save, X, Loader2, Calculator, Settings, Printer, Check, AlertTriangle, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"

interface PayrollConfig { daily_base: number; afp_rate: number; sfs_rate: number; afp_cap: number; sfs_cap: number; verificado: boolean; bank_origin_account?: string; bank_origin_name?: string }
interface PayrollRun { id: string; period_start: string; period_end: string; tipo: string; sucursal: string | null; status: string; totals?: { bruto?: number; deducciones?: number; neto?: number; empleados?: number } }
interface PayrollItem {
  id: string; employee_id: string; employee_nombre: string | null
  sueldo_mensual: number; base_periodo: number; incentivos: number
  afp: number; sfs: number; isr: number; prestamos: number
  bruto: number; total_deducciones: number; neto: number
}

const STATUS_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  calculada: "bg-blue-100 text-blue-700 border-blue-200",
  revision: "bg-amber-100 text-amber-700 border-amber-200",
  aprobada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagada: "bg-purple-100 text-purple-700 border-purple-200",
}
const rd = (n: number | undefined) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function defaultFortnight(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const day = now.getDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  if (day <= 15) return { start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-15` }
  const last = new Date(y, m + 1, 0).getDate()
  return { start: `${y}-${pad(m + 1)}-16`, end: `${y}-${pad(m + 1)}-${pad(last)}` }
}

export function RrhhNominaPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [config, setConfig] = useState<PayrollConfig | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [cfgForm, setCfgForm] = useState<PayrollConfig | null>(null)
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState<{ period_start: string; period_end: string; tipo: string; sucursal: string } | null>(null)
  const [detail, setDetail] = useState<{ run: PayrollRun; items: PayrollItem[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [cfg, rs] = await Promise.all([
        call({ action: "getHrPayrollConfig" }) as Promise<{ ok?: boolean; config?: PayrollConfig; tableMissing?: boolean }>,
        call({ action: "getHrPayrollRuns" }) as Promise<{ ok?: boolean; records?: PayrollRun[] }>,
      ])
      setTableMissing(Boolean(cfg?.tableMissing))
      setConfig(cfg?.config ?? null)
      setRuns(rs?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar nómina: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const totalNeto = useMemo(() => runs.filter(r => r.status === "aprobada" || r.status === "pagada").reduce((s, r) => s + Number(r.totals?.neto || 0), 0), [runs])

  const saveConfig = async () => {
    if (!cfgForm) return
    setBusy(true)
    try {
      const res = await call({ action: "saveHrPayrollConfig", data: JSON.stringify(cfgForm) }) as { ok?: boolean; config?: PayrollConfig; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Configuración guardada", "success")
      setConfig(res.config ?? cfgForm)
      setShowConfig(false)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const createRun = async () => {
    if (!creating) return
    setBusy(true)
    try {
      const res = await call({ action: "createHrPayrollRun", data: JSON.stringify(creating) }) as { ok?: boolean; run_id?: string; empleados?: number; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tablas de nómina aún no existen", "info"); setCreating(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      showToast(`Corrida calculada: ${res.empleados ?? 0} empleados`, "success")
      setCreating(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const openDetail = async (run: PayrollRun) => {
    try {
      const res = await call({ action: "getHrPayrollRun", id: run.id }) as { ok?: boolean; run?: PayrollRun; items?: PayrollItem[] }
      setDetail({ run: res?.run ?? run, items: res?.items ?? [] })
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
  }

  const recalc = async (run: PayrollRun) => {
    setBusy(true)
    try {
      await call({ action: "createHrPayrollRun", data: JSON.stringify({ id: run.id, period_start: run.period_start, period_end: run.period_end, tipo: run.tipo, sucursal: run.sucursal || "" }) })
      showToast("Corrida recalculada", "success")
      await openDetail(run); reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const setStatus = async (run: PayrollRun, status: string) => {
    if (status === "aprobada" && !confirm("Aprobar la corrida marcará los incentivos incluidos como pagados y registrará las cuotas de préstamo. ¿Continuar?")) return
    setBusy(true)
    try {
      const res = await call({ action: "setHrPayrollStatus", id: run.id, status }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo actualizar"}`, "error"); return }
      showToast(`Estado: ${status}`, "success")
      setDetail(prev => prev ? { ...prev, run: { ...prev.run, status } } : prev)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const delRun = async (run: PayrollRun) => {
    if (!confirm("¿Eliminar esta corrida de nómina y sus renglones?")) return
    if (!confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusy(true)
    try {
      const res = await call({ action: "deleteHrPayrollRun", id: run.id }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo eliminar"}`, "error"); return }
      showToast("Corrida eliminada", "success")
      setDetail(null); reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const recibo = (run: PayrollRun, it: PayrollItem) => {
    const b = getBusinessBranding(business)
    const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : (typeof window !== "undefined" ? window.location.origin + b.logoUrl : b.logoUrl)
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Recibo - ${esc(it.employee_nombre)}</title>
<style>@page{size:letter;margin:16mm}body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px}
.h{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${b.primaryColor};padding-bottom:10px;margin-bottom:12px}
.h img{width:46px;height:46px;border-radius:50%;object-fit:cover}.bn{font-size:15px;font-weight:900;color:${b.primaryColor}}.st{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.1em}
h1{font-size:14px;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border:1px solid #e2e8f0;padding:5px 8px}.num{text-align:right;font-variant-numeric:tabular-nums}
.sec{background:#f1f5f9;font-weight:700}.tot{font-weight:800;background:#f8fafc}.foot{margin-top:14px;color:#64748b;font-size:9px;border-top:1px solid #e5e7eb;padding-top:8px}</style></head><body>
<div class="h"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
<h1>Recibo de pago · ${esc(run.tipo)} · ${esc(run.period_start)} → ${esc(run.period_end)}</h1>
<div>Empleado: <b>${esc(it.employee_nombre)}</b> (${esc(it.employee_id)})</div>
<table>
<tr class="sec"><td colspan="2">Ingresos</td></tr>
<tr><td>Sueldo del período</td><td class="num">${rd(it.base_periodo)}</td></tr>
<tr><td>Incentivos</td><td class="num">${rd(it.incentivos)}</td></tr>
<tr class="tot"><td>Total bruto</td><td class="num">${rd(it.bruto)}</td></tr>
<tr class="sec"><td colspan="2">Deducciones</td></tr>
<tr><td>AFP</td><td class="num">${rd(it.afp)}</td></tr>
<tr><td>SFS</td><td class="num">${rd(it.sfs)}</td></tr>
<tr><td>ISR</td><td class="num">${rd(it.isr)}</td></tr>
<tr><td>Préstamos</td><td class="num">${rd(it.prestamos)}</td></tr>
<tr class="tot"><td>Total deducciones</td><td class="num">${rd(it.total_deducciones)}</td></tr>
<tr class="tot"><td>NETO A PAGAR</td><td class="num">${rd(it.neto)}</td></tr>
</table>
<div class="foot">${esc(b.footerText)} · Sueldo mensual base ${rd(it.sueldo_mensual)} · Tasas TSS/ISR según configuración del sistema · Generado ${esc(new Date().toLocaleString("es-DO"))}</div>
<script>setTimeout(()=>window.print(),400)</script></body></html>`
    const w = window.open("", "_blank", "width=900,height=700"); if (!w) return
    w.document.write(html); w.document.close()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Wallet className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Nómina</h2>
            <p className="mt-1 text-sm text-muted-foreground">Corridas quincenales/mensuales con TSS/ISR configurables, incentivos y préstamos. Recibo PDF por empleado.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => { setCfgForm(config ?? { daily_base: 23.83, afp_rate: 0.0287, sfs_rate: 0.0304, afp_cap: 0, sfs_cap: 0, verificado: false }); setShowConfig(true) }}><Settings className="w-4 h-4 mr-1" />Configuración</Button>
          <Button onClick={() => { const f = defaultFortnight(); setCreating({ period_start: f.start, period_end: f.end, tipo: "quincenal", sucursal: "" }) }}><Plus className="w-4 h-4 mr-1" />Nueva corrida</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>Las tablas de nómina aún no existen. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020007_hr_payroll.sql</code>.</div>
        </div>
      )}

      {config && !config.verificado && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div><b>Tasas sin verificar.</b> Los valores TSS/ISR son los de RD por defecto. Contabilidad debe revisarlos en <b>Configuración</b> y marcar “verificado” antes de pagar.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{runs.length}</div><div className="text-xs text-muted-foreground uppercase mt-1">Corridas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{runs.filter(r => r.status === "revision").length}</div><div className="text-xs text-muted-foreground uppercase mt-1">En revisión</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{runs.filter(r => r.status === "aprobada").length}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(totalNeto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Neto aprobado</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin corridas. Crea la primera.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Período</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs text-center">Empl.</TableHead>
                <TableHead className="text-xs text-right">Neto</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-24">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => openDetail(r)}>
                    <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                    <TableCell className="text-xs">{r.tipo}</TableCell>
                    <TableCell className="text-xs text-center">{r.totals?.empleados ?? "—"}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.totals?.neto)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openDetail(r)}>Ver</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog config */}
      <Dialog open={showConfig} onOpenChange={open => !open && setShowConfig(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Configuración de nómina (TSS / ISR)</DialogTitle></DialogHeader>
          {cfgForm && (
            <div className="space-y-3 py-2">
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Valores RD por defecto. Verifícalos con contabilidad. Las tasas se ingresan como fracción (0.0287 = 2.87%).</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Base día (mensual ÷)</Label><Input type="number" step="0.01" value={cfgForm.daily_base} onChange={e => setCfgForm({ ...cfgForm, daily_base: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">AFP (frac.)</Label><Input type="number" step="0.0001" value={cfgForm.afp_rate} onChange={e => setCfgForm({ ...cfgForm, afp_rate: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">SFS (frac.)</Label><Input type="number" step="0.0001" value={cfgForm.sfs_rate} onChange={e => setCfgForm({ ...cfgForm, sfs_rate: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Tope AFP (0=sin)</Label><Input type="number" step="0.01" value={cfgForm.afp_cap} onChange={e => setCfgForm({ ...cfgForm, afp_cap: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Tope SFS (0=sin)</Label><Input type="number" step="0.01" value={cfgForm.sfs_cap} onChange={e => setCfgForm({ ...cfgForm, sfs_cap: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-3">
                <div className="space-y-1 col-span-2 text-xs font-semibold text-muted-foreground">Cuenta origen (para TXT bancario)</div>
                <div className="space-y-1"><Label className="text-xs">Cuenta origen</Label><Input value={cfgForm.bank_origin_account || ""} onChange={e => setCfgForm({ ...cfgForm, bank_origin_account: e.target.value })} placeholder="0000000000" /></div>
                <div className="space-y-1"><Label className="text-xs">Nombre origen</Label><Input value={cfgForm.bank_origin_name || ""} onChange={e => setCfgForm({ ...cfgForm, bank_origin_name: e.target.value })} placeholder="Empresa S.R.L." /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfgForm.verificado} onChange={e => setCfgForm({ ...cfgForm, verificado: e.target.checked })} />Tasas verificadas por contabilidad</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={saveConfig} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog nueva corrida */}
      <Dialog open={!!creating} onOpenChange={open => !open && setCreating(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva corrida de nómina</DialogTitle></DialogHeader>
          {creating && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={creating.period_start} onChange={e => setCreating({ ...creating, period_start: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={creating.period_end} onChange={e => setCreating({ ...creating, period_end: e.target.value })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={creating.tipo} onValueChange={v => setCreating({ ...creating, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="quincenal">Quincenal</SelectItem><SelectItem value="mensual">Mensual</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Sucursal (opcional)</Label><Input value={creating.sucursal} onChange={e => setCreating({ ...creating, sucursal: e.target.value })} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">Al calcular se incluyen todos los empleados con salario &gt; 0, sus incentivos aprobados (a nómina) y la cuota de sus préstamos activos.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(null)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={createRun} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}Calcular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog detalle corrida */}
      <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>Corrida {detail?.run.period_start} → {detail?.run.period_end} · {detail?.run.tipo}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_CLASS[detail.run.status] || ""}>{detail.run.status}</Badge>
                {(detail.run.status === "borrador" || detail.run.status === "calculada" || detail.run.status === "revision") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => recalc(detail.run)} disabled={busy}><Calculator className="w-3.5 h-3.5 mr-1" />Recalcular</Button>
                )}
                {detail.run.status === "calculada" && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(detail.run, "revision")} disabled={busy}>Enviar a revisión</Button>}
                {detail.run.status === "revision" && <Button size="sm" className="h-7 text-xs" onClick={() => setStatus(detail.run, "aprobada")} disabled={busy}><Check className="w-3.5 h-3.5 mr-1" />Aprobar</Button>}
                {detail.run.status === "aprobada" && <Button size="sm" className="h-7 text-xs" onClick={() => setStatus(detail.run, "pagada")} disabled={busy}>Marcar pagada</Button>}
                {detail.run.status !== "aprobada" && detail.run.status !== "pagada" && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => delRun(detail.run)} disabled={busy}><Trash2 className="w-3.5 h-3.5 mr-1" />Eliminar</Button>
                )}
              </div>
              <div className="max-h-[55vh] overflow-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="text-xs">Empleado</TableHead>
                    <TableHead className="text-xs text-right">Base</TableHead>
                    <TableHead className="text-xs text-right">Incent.</TableHead>
                    <TableHead className="text-xs text-right">AFP</TableHead>
                    <TableHead className="text-xs text-right">SFS</TableHead>
                    <TableHead className="text-xs text-right">ISR</TableHead>
                    <TableHead className="text-xs text-right">Prést.</TableHead>
                    <TableHead className="text-xs text-right">Neto</TableHead>
                    <TableHead className="text-xs text-center">Recibo</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {detail.items.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">Sin renglones. Usa “Recalcular”.</TableCell></TableRow>
                    ) : detail.items.map(it => (
                      <TableRow key={it.id}>
                        <TableCell className="text-xs font-medium">{it.employee_nombre}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{rd(it.base_periodo)}</TableCell>
                        <TableCell className="text-xs text-right font-mono">{rd(it.incentivos)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-red-600">{rd(it.afp)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-red-600">{rd(it.sfs)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-red-600">{rd(it.isr)}</TableCell>
                        <TableCell className="text-xs text-right font-mono text-red-600">{rd(it.prestamos)}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-bold">{rd(it.neto)}</TableCell>
                        <TableCell className="text-center"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => recibo(detail.run, it)} title="Recibo PDF"><Printer className="h-3.5 w-3.5" /></Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
