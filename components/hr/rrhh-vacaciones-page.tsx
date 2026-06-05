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
import { Plane, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface Vacation {
  id: string; employee_id: string; employee_nombre: string | null; periodo: string | null
  dias: number; fecha_inicio: string | null; fecha_fin: string | null
  sueldo_diario: number; monto: number; status: string; observations: string | null
}
const STATUS_CLASS: Record<string, string> = {
  solicitado: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-blue-100 text-blue-700 border-blue-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function RrhhVacacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Vacation[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Vacation> | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrVacations" }) as { ok?: boolean; records?: Vacation[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setRecords(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const counts = useMemo(() => ({
    total: records.length,
    solicitado: records.filter(r => r.status === "solicitado").length,
    aprobado: records.filter(r => r.status === "aprobado").length,
    monto: records.filter(r => r.status === "aprobado" || r.status === "pagado").reduce((s, r) => s + Number(r.monto || 0), 0),
  }), [records])

  const buildPayload = (r: Partial<Vacation>): Record<string, string | number> => {
    const p: Record<string, string | number> = { employee_id: r.employee_id || "", dias: Number(r.dias || 0), status: r.status || "solicitado" }
    if (r.id) p.id = r.id
    if (r.periodo) p.periodo = r.periodo
    if (r.fecha_inicio) p.fecha_inicio = r.fecha_inicio
    if (r.fecha_fin) p.fecha_fin = r.fecha_fin
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!(Number(editing.dias) > 0)) { showToast("Los días deben ser mayores a 0", "error"); return }
    setBusy(true)
    try {
      const res = await call({ action: "saveHrVacation", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_vacations aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Vacación guardada", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }
  const setStatus = async (r: Vacation, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrVacation", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error}`, "error"); return }
      showToast(`Estado: ${status}`, "success"); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta vacación?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: "deleteHrVacation", id }); setRecords(prev => prev.filter(r => r.id !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Plane className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Vacaciones</h2>
            <p className="mt-1 text-sm text-muted-foreground">Solicitud, aprobación y pago de vacaciones. Monto = sueldo diario × días.</p>
          </div>
        </div>
        <Button onClick={() => setEditing({ periodo: String(new Date().getFullYear()), status: "solicitado", dias: 14 })} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nueva vacación</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_vacations</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020009_hr_vacations_christmas.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.solicitado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Solicitadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin vacaciones registradas.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Período</TableHead>
                <TableHead className="text-xs text-right">Días</TableHead><TableHead className="text-xs">Fechas</TableHead>
                <TableHead className="text-xs text-right">Monto</TableHead><TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
                    <TableCell className="text-xs">{r.periodo || "—"}</TableCell>
                    <TableCell className="text-xs text-right">{r.dias}</TableCell>
                    <TableCell className="text-xs">{r.fecha_inicio || "—"}{r.fecha_fin ? ` → ${r.fecha_fin}` : ""}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.monto)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {r.status === "solicitado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>}
                        {r.status === "aprobado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => setStatus(r, "pagado")} disabled={busyId === r.id} title="Marcar pagada">$</Button>}
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
          <DialogHeader><DialogTitle>{editing?.id ? "Editar vacación" : "Nueva vacación"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "" })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Período</Label><Input value={editing.periodo || ""} onChange={e => setEditing({ ...editing, periodo: e.target.value })} placeholder="2026" /></div>
                <div className="space-y-1"><Label className="text-xs">Días *</Label><Input type="number" step="0.5" value={editing.dias ?? 0} onChange={e => setEditing({ ...editing, dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={editing.fecha_inicio || ""} onChange={e => setEditing({ ...editing, fecha_inicio: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={editing.fecha_fin || ""} onChange={e => setEditing({ ...editing, fecha_fin: e.target.value })} /></div>
              </div>
              <p className="text-[11px] text-muted-foreground">El monto se calcula automáticamente (sueldo diario × días) usando el salario vigente del empleado.</p>
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
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
