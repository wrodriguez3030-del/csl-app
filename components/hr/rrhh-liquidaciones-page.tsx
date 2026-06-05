"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Scale, Plus, Pencil, Trash2, Save, X, Loader2, Calculator, Printer, AlertTriangle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"

interface Severance {
  id: string; employee_id: string; employee_nombre: string | null; motivo: string
  fecha_ingreso: string | null; fecha_salida: string | null; anios_servicio: number
  sueldo_mensual: number; salario_diario: number
  preaviso_dias: number; preaviso_monto: number; cesantia_dias: number; cesantia_monto: number
  vacaciones_monto: number; navidad_monto: number; salario_pendiente: number
  otros_ingresos: number; descuentos: number; total: number; status: string; observations: string | null
}

const MOTIVOS: Record<string, string> = {
  desahucio: "Desahucio", renuncia: "Renuncia", despido_justificado: "Despido justificado",
  despido_injustificado: "Despido injustificado", mutuo_acuerdo: "Mutuo acuerdo",
  fin_contrato: "Fin de contrato", abandono: "Abandono", fallecimiento: "Fallecimiento",
}
const ESTADOS = ["borrador", "calculado", "revisado", "aprobado", "pagado", "archivado", "anulado"]
const STATUS_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  calculado: "bg-blue-100 text-blue-700 border-blue-200",
  revisado: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-purple-100 text-purple-700 border-purple-200",
  archivado: "bg-gray-100 text-gray-500 border-gray-200",
  anulado: "bg-gray-100 text-gray-400 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function emptyForm(): Partial<Severance> {
  return { motivo: "desahucio", fecha_salida: new Date().toISOString().slice(0, 10), status: "borrador",
    preaviso_dias: 0, preaviso_monto: 0, cesantia_dias: 0, cesantia_monto: 0, vacaciones_monto: 0, navidad_monto: 0, salario_pendiente: 0, otros_ingresos: 0, descuentos: 0 }
}

export function RrhhLiquidacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Severance[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Severance> | null>(null)
  const [calcing, setCalcing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrSeverance" }) as { ok?: boolean; records?: Severance[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setRecords(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const counts = useMemo(() => ({
    total: records.length,
    proceso: records.filter(r => ["borrador", "calculado", "revisado"].includes(r.status)).length,
    aprobado: records.filter(r => r.status === "aprobado" || r.status === "pagado").length,
    monto: records.filter(r => r.status === "aprobado" || r.status === "pagado").reduce((s, r) => s + Number(r.total || 0), 0),
  }), [records])

  const totalCalc = editing ? round2(Number(editing.preaviso_monto || 0) + Number(editing.cesantia_monto || 0) + Number(editing.vacaciones_monto || 0) + Number(editing.navidad_monto || 0) + Number(editing.salario_pendiente || 0) + Number(editing.otros_ingresos || 0) - Number(editing.descuentos || 0)) : 0

  const calcular = async () => {
    if (!editing?.employee_id?.trim()) { showToast("Ingresa el ID del empleado", "error"); return }
    setCalcing(true)
    try {
      const res = await call({ action: "getHrSeveranceSuggestion", employee_id: editing.employee_id.trim(), motivo: editing.motivo || "desahucio", fecha_ingreso: editing.fecha_ingreso || "", fecha_salida: editing.fecha_salida || "" }) as
        { ok?: boolean; employee_nombre?: string; sueldo_mensual?: number; anios_servicio?: number; salario_diario?: number; preaviso_dias?: number; preaviso_monto?: number; cesantia_dias?: number; cesantia_monto?: number; vacaciones_monto?: number; navidad_monto?: number; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      setEditing(prev => prev ? {
        ...prev,
        employee_nombre: res.employee_nombre ?? prev.employee_nombre,
        sueldo_mensual: res.sueldo_mensual, anios_servicio: res.anios_servicio, salario_diario: res.salario_diario,
        preaviso_dias: res.preaviso_dias, preaviso_monto: res.preaviso_monto,
        cesantia_dias: res.cesantia_dias, cesantia_monto: res.cesantia_monto,
        vacaciones_monto: res.vacaciones_monto, navidad_monto: res.navidad_monto,
      } : prev)
      showToast("Cálculo referencial aplicado. Revisa y ajusta los montos.", "success")
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setCalcing(false) }
  }

  const buildPayload = (r: Partial<Severance>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "", motivo: r.motivo || "desahucio", status: r.status || "borrador",
      anios_servicio: Number(r.anios_servicio || 0), sueldo_mensual: Number(r.sueldo_mensual || 0), salario_diario: Number(r.salario_diario || 0),
      preaviso_dias: Number(r.preaviso_dias || 0), preaviso_monto: Number(r.preaviso_monto || 0),
      cesantia_dias: Number(r.cesantia_dias || 0), cesantia_monto: Number(r.cesantia_monto || 0),
      vacaciones_monto: Number(r.vacaciones_monto || 0), navidad_monto: Number(r.navidad_monto || 0),
      salario_pendiente: Number(r.salario_pendiente || 0), otros_ingresos: Number(r.otros_ingresos || 0), descuentos: Number(r.descuentos || 0),
    }
    if (r.id) p.id = r.id
    if (r.employee_nombre) p.employee_nombre = r.employee_nombre
    if (r.fecha_ingreso) p.fecha_ingreso = r.fecha_ingreso
    if (r.fecha_salida) p.fecha_salida = r.fecha_salida
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    setBusy(true)
    try {
      const res = await call({ action: "saveHrSeverance", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_severance aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Liquidación guardada", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }
  const setStatus = async (r: Severance, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrSeverance", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error}`, "error"); return }
      showToast(`Estado: ${status}`, "success"); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta liquidación?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: "deleteHrSeverance", id }); setRecords(prev => prev.filter(r => r.id !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  const imprimir = (r: Severance) => {
    const b = getBusinessBranding(business)
    const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : (typeof window !== "undefined" ? window.location.origin + b.logoUrl : b.logoUrl)
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const fila = (c: string, v: number) => `<tr><td>${esc(c)}</td><td class="num">${rd(v)}</td></tr>`
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Liquidación - ${esc(r.employee_nombre)}</title>
<style>@page{size:letter;margin:16mm}body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px}
.h{display:flex;align-items:center;gap:12px;border-bottom:3px solid ${b.primaryColor};padding-bottom:10px;margin-bottom:12px}
.h img{width:46px;height:46px;border-radius:50%;object-fit:cover}.bn{font-size:15px;font-weight:900;color:${b.primaryColor}}.st{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.1em}
h1{font-size:14px;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{border:1px solid #e2e8f0;padding:5px 8px}.num{text-align:right;font-variant-numeric:tabular-nums}.tot{font-weight:800;background:#f8fafc}
.legal{margin-top:12px;font-size:9px;color:#7c2d12;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px}.foot{margin-top:12px;color:#64748b;font-size:9px;border-top:1px solid #e5e7eb;padding-top:8px}
.sign{display:flex;justify-content:space-between;margin-top:34px;gap:20px}.sign div{flex:1;border-top:1px solid #475569;text-align:center;font-size:10px;padding-top:4px}</style></head><body>
<div class="h"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
<h1>Cálculo de Prestaciones Laborales</h1>
<div>Empleado: <b>${esc(r.employee_nombre)}</b> (${esc(r.employee_id)}) · Motivo: <b>${esc(MOTIVOS[r.motivo] || r.motivo)}</b></div>
<div>Ingreso: ${esc(r.fecha_ingreso || "—")} · Salida: ${esc(r.fecha_salida || "—")} · Tiempo: <b>${r.anios_servicio} año(s)</b> · Sueldo: ${rd(r.sueldo_mensual)} · Diario: ${rd(r.salario_diario)}</div>
<table>
<tr><th>Concepto</th><th class="num">Monto</th></tr>
${fila(`Preaviso (${r.preaviso_dias} días)`, r.preaviso_monto)}
${fila(`Cesantía (${r.cesantia_dias} días)`, r.cesantia_monto)}
${fila("Vacaciones pendientes", r.vacaciones_monto)}
${fila("Salario de Navidad proporcional", r.navidad_monto)}
${fila("Salario pendiente", r.salario_pendiente)}
${fila("Otros ingresos", r.otros_ingresos)}
<tr><td>Descuentos</td><td class="num">− ${rd(r.descuentos)}</td></tr>
<tr class="tot"><td>TOTAL LIQUIDACIÓN</td><td class="num">${rd(r.total)}</td></tr>
</table>
<div class="legal"><b>Nota legal:</b> Este documento es un cálculo REFERENCIAL según la interpretación estándar del Código de Trabajo de la República Dominicana. NO constituye asesoría legal ni un comprobante de pago. Debe ser validado por Recursos Humanos, contabilidad y/o un asesor legal antes de cualquier pago.</div>
<div class="sign"><div>RR.HH.</div><div>Representante empresa</div><div>Empleado</div></div>
<div class="foot">${esc(b.footerText)} · Generado ${esc(new Date().toLocaleString("es-DO"))}</div>
<script>setTimeout(()=>window.print(),400)</script></body></html>`
    const w = window.open("", "_blank", "width=900,height=800"); if (!w) return
    w.document.write(html); w.document.close()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Scale className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Prestaciones · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Liquidaciones y prestaciones RD</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cálculo referencial de prestaciones laborales (desahucio, cesantía, preaviso, vacaciones, Navidad).</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nueva liquidación</Button>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div><b>Cálculo referencial.</b> Los montos se estiman según la interpretación estándar del Código de Trabajo RD y son <b>editables</b>. <b>Deben validarse con RR.HH., contabilidad y/o asesor legal</b> antes de pagar. No es asesoría legal ni comprobante de pago.</div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_severance</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020010_hr_severance.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.proceso}</div><div className="text-xs text-muted-foreground uppercase mt-1">En proceso</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto aprobado</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin liquidaciones registradas.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Motivo</TableHead>
                <TableHead className="text-xs text-right">Años</TableHead><TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Estado</TableHead><TableHead className="text-xs text-center w-40">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
                    <TableCell className="text-xs">{MOTIVOS[r.motivo] || r.motivo}</TableCell>
                    <TableCell className="text-xs text-right">{r.anios_servicio}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.total)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {(r.status === "calculado" || r.status === "borrador") && <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:bg-amber-50" onClick={() => setStatus(r, "revisado")} disabled={busyId === r.id} title="Marcar revisado">↗</Button>}
                        {r.status === "revisado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✓"}</Button>}
                        {r.status === "aprobado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-purple-600 hover:bg-purple-50" onClick={() => setStatus(r, "pagado")} disabled={busyId === r.id} title="Marcar pagada">$</Button>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => imprimir(r)} title="PDF"><Printer className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar" disabled={r.status === "pagado" || r.status === "archivado"}><Pencil className="h-3.5 w-3.5" /></Button>
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

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar liquidación" : "Nueva liquidación"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "", sueldo_mensual: emp?.sueldo || editing.sueldo_mensual || 0 })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Motivo</Label>
                  <Select value={editing.motivo || "desahucio"} onValueChange={v => setEditing({ ...editing, motivo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(MOTIVOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Fecha ingreso</Label><Input type="date" value={editing.fecha_ingreso || ""} onChange={e => setEditing({ ...editing, fecha_ingreso: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Fecha salida</Label><Input type="date" value={editing.fecha_salida || ""} onChange={e => setEditing({ ...editing, fecha_salida: e.target.value })} /></div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={calcular} disabled={calcing}>
                {calcing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}Calcular referencial
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Preaviso días</Label><Input type="number" step="0.5" value={editing.preaviso_dias ?? 0} onChange={e => setEditing({ ...editing, preaviso_dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Preaviso monto</Label><Input type="number" step="0.01" value={editing.preaviso_monto ?? 0} onChange={e => setEditing({ ...editing, preaviso_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cesantía días</Label><Input type="number" step="0.5" value={editing.cesantia_dias ?? 0} onChange={e => setEditing({ ...editing, cesantia_dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cesantía monto</Label><Input type="number" step="0.01" value={editing.cesantia_monto ?? 0} onChange={e => setEditing({ ...editing, cesantia_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Vacaciones</Label><Input type="number" step="0.01" value={editing.vacaciones_monto ?? 0} onChange={e => setEditing({ ...editing, vacaciones_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Navidad</Label><Input type="number" step="0.01" value={editing.navidad_monto ?? 0} onChange={e => setEditing({ ...editing, navidad_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Salario pendiente</Label><Input type="number" step="0.01" value={editing.salario_pendiente ?? 0} onChange={e => setEditing({ ...editing, salario_pendiente: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Otros ingresos</Label><Input type="number" step="0.01" value={editing.otros_ingresos ?? 0} onChange={e => setEditing({ ...editing, otros_ingresos: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Descuentos</Label><Input type="number" step="0.01" value={editing.descuentos ?? 0} onChange={e => setEditing({ ...editing, descuentos: Number(e.target.value) })} /></div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2 text-sm flex justify-between"><span className="text-muted-foreground">Total liquidación</span><span className="font-mono font-bold">{rd(totalCalc)}</span></div>
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              <p className="text-[11px] text-amber-700">Referencial — validar con asesoría legal/contable antes de aprobar.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSave} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
