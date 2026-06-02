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
import { TrendingUp, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface Incentive {
  id: string
  employee_id: string
  employee_nombre: string | null
  tipo: string
  monto: number
  periodo: string | null
  descripcion: string | null
  salida: string
  status: string
}

const TIPOS: Record<string, string> = {
  comision: "Comisión", bono_fijo: "Bono fijo", bono_meta: "Bono por meta",
  incentivo_especial: "Incentivo especial", ajuste: "Ajuste manual",
}
const SALIDA: Record<string, string> = { nomina: "A nómina", txt_separado: "TXT separado" }
const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-blue-100 text-blue-700 border-blue-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function emptyForm(): Partial<Incentive> {
  return { employee_id: "", tipo: "comision", monto: 0, periodo: new Date().toISOString().slice(0, 7), salida: "nomina", status: "pendiente" }
}

export function RrhhIncentivosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Incentive[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Incentive> | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("all")

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrIncentives" }) as { ok?: boolean; records?: Incentive[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRecords(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar incentivos: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => filterStatus === "all" ? records : records.filter(r => r.status === filterStatus), [records, filterStatus])
  const counts = useMemo(() => ({
    total: records.length,
    pendiente: records.filter(r => r.status === "pendiente").length,
    aprobado: records.filter(r => r.status === "aprobado").length,
    monto: records.filter(r => r.status === "aprobado").reduce((s, r) => s + Number(r.monto || 0), 0),
  }), [records])

  const buildPayload = (r: Partial<Incentive>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "", tipo: r.tipo || "comision",
      monto: Number(r.monto || 0), salida: r.salida || "nomina", status: r.status || "pendiente",
    }
    if (r.id) p.id = r.id
    if (r.employee_nombre) p.employee_nombre = r.employee_nombre
    if (r.periodo) p.periodo = r.periodo
    if (r.descripcion) p.descripcion = r.descripcion
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!(Number(editing.monto) > 0)) { showToast("El monto debe ser mayor a 0", "error"); return }
    setSaving(true)
    try {
      const res = await call({ action: "saveHrIncentive", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_incentives aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Incentivo guardado", "success")
      setEditing(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const setStatus = async (r: Incentive, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrIncentive", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo actualizar"}`, "error"); return }
      showToast(status === "aprobado" ? "Incentivo aprobado" : "Incentivo anulado", "success")
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const del = async (id: string) => {
    if (!confirm("¿Eliminar este incentivo? Esta acción no se puede deshacer.")) return
    if (!confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try {
      await call({ action: "deleteHrIncentive", id })
      setRecords(prev => prev.filter(r => r.id !== id))
      showToast("Incentivo eliminado", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><TrendingUp className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Incentivos y comisiones</h2>
            <p className="mt-1 text-sm text-muted-foreground">Comisiones, bonos y ajustes. Requieren aprobación antes del pago; salen a nómina o a TXT separado.</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo incentivo</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_incentives</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020006_hr_incentives.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.pendiente}</div><div className="text-xs text-muted-foreground uppercase mt-1">Pendientes</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto aprobado</div></CardContent></Card>
      </div>

      <div className="max-w-[180px]">
        <Label className="text-xs">Estado</Label>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="aprobado">Aprobado</SelectItem>
            <SelectItem value="pagado">Pagado</SelectItem>
            <SelectItem value="anulado">Anulado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{records.length === 0 ? "Sin incentivos registrados." : "Sin incentivos con ese filtro."}</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Período</TableHead>
                <TableHead className="text-xs text-right">Monto</TableHead>
                <TableHead className="text-xs">Salida</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
                    <TableCell className="text-xs">{TIPOS[r.tipo] || r.tipo}</TableCell>
                    <TableCell className="text-xs">{r.periodo || "—"}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.monto)}</TableCell>
                    <TableCell className="text-xs">{SALIDA[r.salida] || r.salida}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {r.status === "pendiente" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">
                            {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        {r.status !== "anulado" && r.status !== "pagado" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:bg-gray-100" onClick={() => setStatus(r, "anulado")} disabled={busyId === r.id} title="Anular"><Ban className="h-3.5 w-3.5" /></Button>
                        )}
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
          <DialogHeader><DialogTitle>{editing?.id ? "Editar incentivo" : "Nuevo incentivo"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="sol_... o EMP-001" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editing.tipo || "comision"} onValueChange={v => setEditing({ ...editing, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(TIPOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Monto (RD$) *</Label><Input type="number" step="0.01" value={editing.monto ?? 0} onChange={e => setEditing({ ...editing, monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Período</Label><Input value={editing.periodo || ""} onChange={e => setEditing({ ...editing, periodo: e.target.value })} placeholder="2026-06" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Salida</Label>
                  <Select value={editing.salida || "nomina"} onValueChange={v => setEditing({ ...editing, salida: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(SALIDA).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Descripción</Label><Input value={editing.descripcion || ""} onChange={e => setEditing({ ...editing, descripcion: e.target.value })} placeholder="Comisión por ventas junio..." /></div>
              <p className="text-[11px] text-muted-foreground">La aprobación se hace desde la tabla. No se marca como pagado automáticamente (eso ocurre al incluirlo en Nómina/TXT).</p>
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
