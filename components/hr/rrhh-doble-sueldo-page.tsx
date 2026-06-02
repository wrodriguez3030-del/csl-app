"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Gift, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface Bonus {
  id: string; employee_id: string; employee_nombre: string | null; anio: number
  sueldo_mensual: number; proporcional: boolean; meses: number; monto: number; status: string; observations: string | null
}
const STATUS_CLASS: Record<string, string> = {
  calculado: "bg-blue-100 text-blue-700 border-blue-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-purple-100 text-purple-700 border-purple-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function RrhhDobleSueldoPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Bonus[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Bonus> | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrChristmasBonus" }) as { ok?: boolean; records?: Bonus[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setRecords(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const counts = useMemo(() => ({
    total: records.length,
    calculado: records.filter(r => r.status === "calculado").length,
    aprobado: records.filter(r => r.status === "aprobado").length,
    monto: records.filter(r => r.status === "aprobado" || r.status === "pagado").reduce((s, r) => s + Number(r.monto || 0), 0),
  }), [records])

  const buildPayload = (r: Partial<Bonus>): Record<string, string | number | boolean> => {
    const p: Record<string, string | number | boolean> = {
      employee_id: r.employee_id || "", anio: Number(r.anio || new Date().getFullYear()),
      proporcional: Boolean(r.proporcional), meses: Number(r.meses || 12), status: r.status || "calculado",
    }
    if (r.id) p.id = r.id
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Gift className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Doble sueldo (Salario de Navidad)</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cálculo anual o proporcional. Bloqueo automático de doble pago en el mismo año.</p>
          </div>
        </div>
        <Button onClick={() => setEditing({ anio: new Date().getFullYear(), proporcional: false, meses: 12, status: "calculado" })} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo cálculo</Button>
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
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin cálculos de doble sueldo.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs text-center">Año</TableHead>
                <TableHead className="text-xs">Tipo</TableHead><TableHead className="text-xs text-right">Monto</TableHead>
                <TableHead className="text-xs">Estado</TableHead><TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
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
              <div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Año *</Label><Input type="number" value={editing.anio ?? new Date().getFullYear()} onChange={e => setEditing({ ...editing, anio: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Meses (si proporcional)</Label><Input type="number" step="0.5" min="0" max="12" value={editing.meses ?? 12} onChange={e => setEditing({ ...editing, meses: Number(e.target.value) })} disabled={!editing.proporcional} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.proporcional ?? false} onChange={e => setEditing({ ...editing, proporcional: e.target.checked })} />Proporcional (por meses trabajados en el año)</label>
              <p className="text-[11px] text-muted-foreground">El monto se calcula con el salario vigente: completo = 1 sueldo mensual; proporcional = sueldo × meses ÷ 12. Bloqueo de doble pago por empleado y año.</p>
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
