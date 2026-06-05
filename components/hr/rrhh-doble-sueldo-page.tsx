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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Gift, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle, AlertTriangle, FileSpreadsheet } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { exportHrReportExcel } from "@/lib/hr-report-excel"

interface Bonus {
  id: string; employee_id: string; employee_nombre: string | null; anio: number
  sueldo_mensual: number; proporcional: boolean; meses: number; monto: number; status: string; observations: string | null
  fecha_ingreso?: string; antiguedad_anios?: number; cedula?: string; puesto?: string; sucursal?: string
}
interface Emp { id: string; nombre: string; cedula: string; puesto: string; sucursal: string; sueldo: number; fecha_ingreso: string }

const STATUS_CLASS: Record<string, string> = {
  calculado: "bg-blue-100 text-blue-700 border-blue-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-purple-100 text-purple-700 border-purple-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const pick = (...vals: unknown[]) => { for (const v of vals) { const s = v == null ? "" : String(v).trim(); if (s) return s } return "" }
const fmtAntig = (a: number) => `${(Number(a) || 0).toFixed(1)} años`
function toEmp(r: Record<string, unknown>): Emp {
  return {
    id: pick(r.SolicitudID, r.empleado_id, r.EmpleadoID, r.id),
    nombre: `${pick(r.Nombre, r.nombre)} ${pick(r.Apellido, r.apellido)}`.replace(/\s+/g, " ").trim() || pick(r.SolicitudID, r.empleado_id),
    cedula: pick(r.Cedula, r.cedula),
    puesto: pick(r.PuestoSolicitado, r.puesto_solicitado, r.Puesto, r.puesto),
    sucursal: pick(r.Sucursal, r.sucursal),
    fecha_ingreso: pick(r.fechaIngresoLaboral, r.FechaIngresoLaboral, r.fecha_ingreso, r.start_date, r.fechaIngreso, r.FechaSolicitud, r.fecha_solicitud),
    sueldo: Number(r.Salario ?? r.salario ?? 0) || 0,
  }
}

export function RrhhDobleSueldoPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Bonus[]>([])
  const [empMap, setEmpMap] = useState<Record<string, Emp>>({})
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Bonus> | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [calcing, setCalcing] = useState(false)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [bon, emp] = await Promise.all([
        call({ action: "getHrChristmasBonus" }) as Promise<{ ok?: boolean; records?: Bonus[]; tableMissing?: boolean }>,
        call({ action: "getEmpleados" }) as Promise<{ ok?: boolean; records?: Record<string, unknown>[] }>,
      ])
      setTableMissing(Boolean(bon?.tableMissing)); setRecords(bon?.records ?? [])
      const map: Record<string, Emp> = {}
      for (const r of (emp?.records ?? [])) { const e = toEmp(r); if (e.id) map[e.id] = e }
      setEmpMap(map)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = useMemo(() => records.map(r => {
    const e = empMap[r.employee_id]
    return {
      ...r,
      _nombre: r.employee_nombre || e?.nombre || r.employee_id,
      _cedula: pick(r.cedula, e?.cedula), _puesto: pick(r.puesto, e?.puesto), _sucursal: pick(r.sucursal, e?.sucursal),
      _fecha_ingreso: pick(r.fecha_ingreso, e?.fecha_ingreso),
    }
  }), [records, empMap])

  const counts = useMemo(() => ({
    total: records.length,
    calculado: records.filter(r => r.status === "calculado").length,
    aprobado: records.filter(r => r.status === "aprobado").length,
    monto: records.filter(r => r.status === "aprobado" || r.status === "pagado").reduce((s, r) => s + Number(r.monto || 0), 0),
  }), [records])

  // Monto en vivo del modal.
  const montoCalc = editing
    ? round2(editing.proporcional ? Number(editing.sueldo_mensual || 0) * Number(editing.meses || 0) / 12 : Number(editing.sueldo_mensual || 0))
    : 0

  // Carga sueldo + fecha ingreso + meses trabajados (según fecha ingreso y año).
  const calcularDoble = async (employeeId: string, anio: number) => {
    setCalcing(true)
    try {
      const res = await call({ action: "getHrDobleSugerido", employee_id: employeeId, anio }) as
        { ok?: boolean; employee_nombre?: string; cedula?: string; puesto?: string; sucursal?: string; fecha_ingreso?: string; sueldo_mensual?: number; antiguedad_anios?: number; meses_trabajados?: number; completo?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      const meses = res.meses_trabajados ?? 12
      setEditing(prev => prev ? {
        ...prev,
        employee_id: employeeId, employee_nombre: res.employee_nombre ?? prev.employee_nombre,
        cedula: res.cedula, puesto: res.puesto, sucursal: res.sucursal, fecha_ingreso: res.fecha_ingreso,
        sueldo_mensual: res.sueldo_mensual ?? prev.sueldo_mensual, antiguedad_anios: res.antiguedad_anios,
        meses, proporcional: meses < 12,
      } : prev)
      if (!res.fecha_ingreso) showToast("Este empleado no tiene fecha de ingreso laboral registrada.", "error")
      else showToast(`Ingreso ${res.fecha_ingreso} · ${meses} mes(es) en ${anio}`, "success")
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setCalcing(false) }
  }

  const buildPayload = (r: Partial<Bonus>): Record<string, string | number | boolean> => {
    const p: Record<string, string | number | boolean> = {
      employee_id: r.employee_id || "", employee_nombre: r.employee_nombre || "", anio: Number(r.anio || new Date().getFullYear()),
      proporcional: Boolean(r.proporcional), meses: Number(r.meses || 12), status: r.status || "calculado",
      sueldo_mensual: Number(r.sueldo_mensual || 0),
    }
    if (r.id) p.id = r.id
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio (selecciónalo de la lista)", "error"); return }
    setBusy(true)
    try {
      const res = await call({ action: "saveHrChristmasBonus", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_christmas_bonus aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Doble sueldo guardado", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }
  const setStatus = async (r: Bonus, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrChristmasBonus", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`${res?.error}`, "error"); return }
      showToast(`Estado: ${status}`, "success"); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm("¿Eliminar este doble sueldo?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: "deleteHrChristmasBonus", id }); setRecords(prev => prev.filter(r => r.id !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  const exportExcel = () => {
    const headers = ["No.", "Empleado", "Cédula", "Puesto", "Sucursal", "Fecha ingreso", "Año", "Sueldo mensual", "Meses", "Tipo", "Monto", "Estado", "Observaciones"]
    const rows = enriched.map((r, i) => [
      i + 1, r._nombre, r._cedula, r._puesto, r._sucursal, r._fecha_ingreso, r.anio,
      rd(r.sueldo_mensual), r.proporcional ? r.meses : 12, r.proporcional ? "Proporcional" : "Completo",
      rd(r.monto), r.status, r.observations || "",
    ])
    const totalMonto = enriched.reduce((s, r) => s + (Number(r.monto) || 0), 0)
    exportHrReportExcel(business, {
      title: "Reporte de Doble Sueldo (Salario de Navidad)", headers, rows,
      footer: ["", "Empleados: " + enriched.length, "", "", "", "", "", "", "", "TOTAL", rd(totalMonto), "", ""],
      filename: `DobleSueldo_${new Date().toISOString().slice(0, 10)}.xls`,
    })
    showToast(`Excel generado (${rows.length} fila(s))`, "success")
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Gift className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Doble sueldo (Salario de Navidad)</h2>
            <p className="mt-1 text-sm text-muted-foreground">Año completo = 1 sueldo; proporcional = sueldo × meses ÷ 12 (meses según fecha de ingreso laboral). Bloqueo de doble pago por año.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-1" />Exportar Excel</Button>
          <Button onClick={() => setEditing({ anio: new Date().getFullYear(), proporcional: false, meses: 12, status: "calculado", sueldo_mensual: 0 })}><Plus className="w-4 h-4 mr-1" />Nuevo cálculo</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_christmas_bonus</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020009_hr_vacations_christmas.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-blue-600">{counts.calculado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Calculados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : enriched.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin cálculos de doble sueldo.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Ingreso</TableHead><TableHead className="text-xs text-center">Año</TableHead>
                <TableHead className="text-xs">Tipo</TableHead><TableHead className="text-xs text-right">Monto</TableHead>
                <TableHead className="text-xs">Estado</TableHead><TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {enriched.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r._nombre}<div className="text-[11px] text-muted-foreground">{r._cedula || "—"}{r._sucursal ? ` · ${r._sucursal}` : ""}</div></TableCell>
                    <TableCell className="text-xs">{r._fecha_ingreso || "—"}</TableCell>
                    <TableCell className="text-xs text-center">{r.anio}</TableCell>
                    <TableCell className="text-xs">{r.proporcional ? `Proporcional (${r.meses} m)` : "Completo"}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.monto)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {r.status === "calculado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>}
                        {r.status === "aprobado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-purple-600 hover:bg-purple-50" onClick={() => setStatus(r, "pagado")} disabled={busyId === r.id} title="Marcar pagado">$</Button>}
                        {r.status !== "anulado" && r.status !== "pagado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:bg-gray-100" onClick={() => setStatus(r, "anulado")} disabled={busyId === r.id} title="Anular"><Ban className="h-3.5 w-3.5" /></Button>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar" disabled={r.status === "pagado"}><Pencil className="h-3.5 w-3.5" /></Button>
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
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar doble sueldo" : "Nuevo doble sueldo"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label>
                <EmployeeSelect value={editing.employee_id} onSelect={emp => { if (emp) calcularDoble(emp.empleado_id, Number(editing.anio || new Date().getFullYear())); else setEditing({ ...editing, employee_id: "" }) }} /></div>

              {editing.employee_id && !editing.fecha_ingreso && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Este empleado no tiene fecha de ingreso laboral registrada. Complétala en la ficha de Empleados para el cálculo proporcional.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Año *</Label><Input type="number" value={editing.anio ?? new Date().getFullYear()} onChange={e => { const v = Number(e.target.value); setEditing(p => p ? { ...p, anio: v } : p); if (editing.employee_id) calcularDoble(editing.employee_id, v) }} /></div>
                <div className="space-y-1"><Label className="text-xs">Sueldo mensual (RD$)</Label><Input type="number" step="0.01" value={editing.sueldo_mensual ?? 0} onChange={e => setEditing({ ...editing, sueldo_mensual: Number(e.target.value) })} /></div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Fecha ingreso laboral</span><span className="font-mono">{editing.fecha_ingreso || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Antigüedad</span><span className="font-mono">{fmtAntig(Number(editing.antiguedad_anios || 0))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Meses trabajados en {editing.anio}</span><span className="font-mono font-bold">{editing.proporcional ? editing.meses : 12}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>Monto</span><span className="font-mono">{rd(montoCalc)}</span></div>
              </div>

              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.proporcional ?? false} onChange={e => setEditing({ ...editing, proporcional: e.target.checked })} />Proporcional (por meses trabajados en el año)</label>
              {editing.proporcional && (
                <div className="space-y-1"><Label className="text-xs">Meses (auto desde fecha de ingreso, editable)</Label><Input type="number" step="0.5" min="0" max="12" value={editing.meses ?? 12} onChange={e => setEditing({ ...editing, meses: Number(e.target.value) })} /></div>
              )}
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              <p className="text-[11px] text-muted-foreground">{calcing ? "Calculando meses…" : "Bloqueo de doble pago por empleado y año."}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSave} disabled={busy || calcing}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
