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
import { CalendarDays, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, Calculator, Printer, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"

const DAILY_BASE = 23.83

interface DiaLaborado {
  id: string
  employee_id: string
  employee_nombre: string | null
  period_start: string
  period_end: string
  sucursal: string | null
  sueldo_mensual: number
  sueldo_diario: number
  dias_laborados: number
  dias_origen: string
  edit_reason: string | null
  ingresos: number
  ingresos_detalle: string | null
  descuentos: number
  descuentos_detalle: string | null
  pago_dias: number
  total: number
  estado: string
  observations: string | null
}

const ESTADOS = ["borrador", "calculado", "en_revision", "aprobado", "anulado"]
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador", calculado: "Calculado", en_revision: "En revisión", aprobado: "Aprobado", anulado: "Anulado",
}
const ESTADO_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  calculado: "bg-blue-100 text-blue-700 border-blue-200",
  en_revision: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function emptyForm(): Partial<DiaLaborado> {
  const today = new Date().toISOString().slice(0, 10)
  const first = today.slice(0, 8) + "01"
  return { employee_id: "", period_start: first, period_end: today, sueldo_mensual: 0, dias_laborados: 0, dias_origen: "manual", ingresos: 0, descuentos: 0, estado: "borrador" }
}

export function RrhhDiasLaboradosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<DiaLaborado[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<DiaLaborado> | null>(null)
  const [saving, setSaving] = useState(false)
  const [calcing, setCalcing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("all")

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrDiasLaborados" }) as { ok?: boolean; records?: DiaLaborado[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRecords(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar días laborados: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => filterStatus === "all" ? records : records.filter(r => r.estado === filterStatus), [records, filterStatus])
  const counts = useMemo(() => ({
    total: records.length,
    revision: records.filter(r => r.estado === "en_revision").length,
    aprobado: records.filter(r => r.estado === "aprobado").length,
    monto: records.filter(r => r.estado === "aprobado").reduce((s, r) => s + Number(r.total || 0), 0),
  }), [records])

  // Desglose en vivo (el servidor recalcula de forma autoritativa al guardar).
  const sueldoDiario = editing ? round2(Number(editing.sueldo_mensual || 0) / DAILY_BASE) : 0
  const pagoDias = editing ? round2(sueldoDiario * Number(editing.dias_laborados || 0)) : 0
  const totalCalc = editing ? round2(pagoDias + Number(editing.ingresos || 0) - Number(editing.descuentos || 0)) : 0

  const calcularDesdeAsistencia = async () => {
    if (!editing?.employee_id?.trim()) { showToast("Ingresa el ID del empleado primero", "error"); return }
    setCalcing(true)
    try {
      const res = await call({ action: "getHrDiasSugeridos", employee_id: editing.employee_id.trim(), period_start: editing.period_start || "", period_end: editing.period_end || "" }) as
        { ok?: boolean; employee_nombre?: string; sueldo_mensual?: number; dias_sugeridos?: number; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      setEditing(prev => prev ? {
        ...prev,
        employee_nombre: res.employee_nombre ?? prev.employee_nombre,
        sueldo_mensual: res.sueldo_mensual ?? prev.sueldo_mensual,
        dias_laborados: res.dias_sugeridos ?? 0,
        dias_origen: "asistencia",
        edit_reason: "",
      } : prev)
      showToast(`Días desde asistencia: ${res.dias_sugeridos ?? 0} · Sueldo vigente ${rd(res.sueldo_mensual ?? 0)}`, "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setCalcing(false) }
  }

  const buildPayload = (r: Partial<DiaLaborado>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "",
      employee_nombre: r.employee_nombre || "",
      period_start: r.period_start || "",
      period_end: r.period_end || "",
      sueldo_mensual: Number(r.sueldo_mensual || 0),
      dias_laborados: Number(r.dias_laborados || 0),
      dias_origen: r.dias_origen || "manual",
      ingresos: Number(r.ingresos || 0),
      descuentos: Number(r.descuentos || 0),
      estado: r.estado || "borrador",
    }
    if (r.id) p.id = r.id
    if (r.edit_reason) p.edit_reason = r.edit_reason
    if (r.sucursal) p.sucursal = r.sucursal
    if (r.ingresos_detalle) p.ingresos_detalle = r.ingresos_detalle
    if (r.descuentos_detalle) p.descuentos_detalle = r.descuentos_detalle
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!editing.period_start || !editing.period_end) { showToast("Período obligatorio", "error"); return }
    if (editing.dias_origen === "manual" && !editing.edit_reason?.trim()) {
      showToast("La edición manual de días requiere un motivo", "error"); return
    }
    setSaving(true)
    try {
      const res = await call({ action: "saveHrDiaLaborado", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; record?: DiaLaborado; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_dias_laborados aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Cálculo guardado", "success")
      setEditing(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const setEstado = async (r: DiaLaborado, estado: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrDiaLaborado", data: JSON.stringify({ ...buildPayload(r), estado }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo actualizar"}`, "error"); return }
      showToast(`Estado: ${ESTADO_LABEL[estado] || estado}`, "success")
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const del = async (id: string) => {
    if (!confirm("¿Eliminar este cálculo de días laborados? Esta acción no se puede deshacer.")) return
    if (!confirm("Confirma de nuevo: se eliminará permanentemente el registro.")) return
    setBusyId(id)
    try {
      await call({ action: "deleteHrDiaLaborado", id })
      setRecords(prev => prev.filter(r => r.id !== id))
      showToast("Registro eliminado", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const imprimir = (r: DiaLaborado) => {
    const b = getBusinessBranding(business)
    const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : (typeof window !== "undefined" ? window.location.origin + b.logoUrl : b.logoUrl)
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Días laborados - ${esc(r.employee_nombre || r.employee_id)}</title>
<style>@page{size:letter;margin:16mm}body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px}
.h{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${b.primaryColor};padding-bottom:10px;margin-bottom:14px}
.h img{width:48px;height:48px;border-radius:50%;object-fit:cover}.bn{font-size:16px;font-weight:900;color:${b.primaryColor}}.st{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.1em}
h1{font-size:15px;margin:6px 0 2px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #e2e8f0;padding:6px 8px;text-align:left}th{background:#f1f5f9}
.num{text-align:right;font-variant-numeric:tabular-nums}.tot{font-weight:800;background:#f8fafc}.foot{margin-top:16px;color:#64748b;font-size:9px;border-top:1px solid #e5e7eb;padding-top:8px}</style></head><body>
<div class="h"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
<h1>Cálculo de Días Laborados</h1>
<div>Empleado: <b>${esc(r.employee_nombre || r.employee_id)}</b> (${esc(r.employee_id)}) · Período: <b>${esc(r.period_start)} → ${esc(r.period_end)}</b> · Estado: <b>${esc(ESTADO_LABEL[r.estado] || r.estado)}</b></div>
<table>
<tr><th>Concepto</th><th class="num">Valor</th></tr>
<tr><td>Sueldo mensual</td><td class="num">${rd(r.sueldo_mensual)}</td></tr>
<tr><td>Sueldo diario (mensual ÷ ${DAILY_BASE})</td><td class="num">${rd(r.sueldo_diario)}</td></tr>
<tr><td>Días laborados (${esc(r.dias_origen)})</td><td class="num">${r.dias_laborados}</td></tr>
<tr><td>Pago por días (diario × días)</td><td class="num">${rd(r.pago_dias)}</td></tr>
<tr><td>Ingresos adicionales${r.ingresos_detalle ? ` — ${esc(r.ingresos_detalle)}` : ""}</td><td class="num">${rd(r.ingresos)}</td></tr>
<tr><td>Descuentos${r.descuentos_detalle ? ` — ${esc(r.descuentos_detalle)}` : ""}</td><td class="num">− ${rd(r.descuentos)}</td></tr>
<tr class="tot"><td>TOTAL A PAGAR</td><td class="num">${rd(r.total)}</td></tr>
</table>
${r.edit_reason ? `<p style="margin-top:8px;font-size:10px">Motivo de ajuste manual de días: ${esc(r.edit_reason)}</p>` : ""}
<div class="foot">${esc(b.footerText)} · Documento de cálculo (no es comprobante de pago) · Generado ${esc(new Date().toLocaleString("es-DO"))}</div>
<script>setTimeout(()=>window.print(),400)</script></body></html>`
    const w = window.open("", "_blank", "width=900,height=700")
    if (!w) return
    w.document.write(html); w.document.close()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><CalendarDays className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Días laborados</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pago proporcional = sueldo diario (mensual ÷ {DAILY_BASE}) × días laborados. Sin TSS/ISR (eso va en Nómina).</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo cálculo</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_dias_laborados</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020004_hr_dias_laborados.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Cálculos</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.revision}</div><div className="text-xs text-muted-foreground uppercase mt-1">En revisión</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto aprobado</div></CardContent></Card>
      </div>

      <div className="max-w-[180px]">
        <Label className="text-xs">Estado</Label>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {ESTADOS.map(s => <SelectItem key={s} value={s}>{ESTADO_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{records.length === 0 ? "Sin cálculos. Crea el primero." : "Sin cálculos con ese filtro."}</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Período</TableHead>
                <TableHead className="text-xs text-right">Diario</TableHead>
                <TableHead className="text-xs text-right">Días</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-40">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
                    <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{rd(r.sueldo_diario)}</TableCell>
                    <TableCell className="text-xs text-right">{r.dias_laborados}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.total)}</TableCell>
                    <TableCell><Badge variant="outline" className={ESTADO_CLASS[r.estado] || ""}>{ESTADO_LABEL[r.estado] || r.estado}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {(r.estado === "calculado" || r.estado === "borrador") && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:bg-amber-50" onClick={() => setEstado(r, "en_revision")} disabled={busyId === r.id} title="Enviar a revisión">↗</Button>
                        )}
                        {r.estado === "en_revision" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setEstado(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">
                            {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        {r.estado !== "anulado" && r.estado !== "aprobado" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:bg-gray-100" onClick={() => setEstado(r, "anulado")} disabled={busyId === r.id} title="Anular"><Ban className="h-3.5 w-3.5" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => imprimir(r)} title="Imprimir / PDF"><Printer className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar" disabled={r.estado === "aprobado"}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => del(r.id)} disabled={busyId === r.id} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog cálculo */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar cálculo" : "Nuevo cálculo de días laborados"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>
                <div className="space-y-1"><Label className="text-xs">Desde *</Label><Input type="date" value={editing.period_start || ""} onChange={e => setEditing({ ...editing, period_start: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Hasta *</Label><Input type="date" value={editing.period_end || ""} onChange={e => setEditing({ ...editing, period_end: e.target.value })} /></div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={calcularDesdeAsistencia} disabled={calcing}>
                {calcing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}Calcular desde asistencia
              </Button>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Sueldo mensual (RD$)</Label><Input type="number" step="0.01" value={editing.sueldo_mensual ?? 0} onChange={e => setEditing({ ...editing, sueldo_mensual: Number(e.target.value) })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Días laborados</Label>
                  <Input type="number" step="0.5" value={editing.dias_laborados ?? 0}
                    onChange={e => setEditing({ ...editing, dias_laborados: Number(e.target.value), dias_origen: "manual" })} />
                </div>
              </div>
              {editing.dias_origen === "manual" && (
                <div className="space-y-1"><Label className="text-xs">Motivo del ajuste manual de días *</Label><Input value={editing.edit_reason || ""} onChange={e => setEditing({ ...editing, edit_reason: e.target.value })} placeholder="Ej: ausencia justificada no reflejada en ponche" /></div>
              )}

              {/* Desglose */}
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Sueldo diario (mensual ÷ {DAILY_BASE})</span><span className="font-mono">{rd(sueldoDiario)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Pago por días (diario × {editing.dias_laborados || 0})</span><span className="font-mono">{rd(pagoDias)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">+ Ingresos</span><span className="font-mono">{rd(Number(editing.ingresos || 0))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">− Descuentos</span><span className="font-mono">{rd(Number(editing.descuentos || 0))}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>Total</span><span className="font-mono">{rd(totalCalc)}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Ingresos adicionales (RD$)</Label><Input type="number" step="0.01" value={editing.ingresos ?? 0} onChange={e => setEditing({ ...editing, ingresos: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Detalle ingresos</Label><Input value={editing.ingresos_detalle || ""} onChange={e => setEditing({ ...editing, ingresos_detalle: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Descuentos (RD$)</Label><Input type="number" step="0.01" value={editing.descuentos ?? 0} onChange={e => setEditing({ ...editing, descuentos: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Detalle descuentos</Label><Input value={editing.descuentos_detalle || ""} onChange={e => setEditing({ ...editing, descuentos_detalle: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  <Select value={editing.estado || "borrador"} onValueChange={v => setEditing({ ...editing, estado: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ESTADOS.filter(s => s !== "aprobado").map(s => <SelectItem key={s} value={s}>{ESTADO_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={editing.sucursal || ""} onChange={e => setEditing({ ...editing, sucursal: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              <p className="text-[11px] text-muted-foreground">La aprobación se hace desde la tabla (estado “En revisión” → Aprobar). No se marca como pagado automáticamente.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
