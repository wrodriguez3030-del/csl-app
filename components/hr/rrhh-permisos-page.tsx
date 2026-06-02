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
import { CalendarOff, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface HrLeave {
  id: string
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
  days: number
  reason: string | null
  evidence_url: string | null
  impact: string
  status: string
  observations: string | null
}

const LEAVE_TYPES: Record<string, string> = {
  personal_con_disfrute: "Personal (con disfrute)",
  personal_sin_disfrute: "Personal (sin disfrute)",
  medica: "Médica",
  duelo: "Duelo",
  emergencia: "Emergencia",
  maternidad: "Maternidad",
  paternidad: "Paternidad",
}
const IMPACT: Record<string, string> = {
  no_aplica: "Sin impacto en nómina",
  con_disfrute: "Pagado (con disfrute)",
  sin_disfrute: "Descuento (sin disfrute)",
}
const STATUS_CLASS: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazado: "bg-red-100 text-red-700 border-red-200",
  cancelado: "bg-slate-100 text-slate-600 border-slate-200",
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  const d = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1
  return d > 0 ? d : 0
}
function emptyForm(): Partial<HrLeave> {
  const today = new Date().toISOString().slice(0, 10)
  return { employee_id: "", leave_type: "personal_con_disfrute", start_date: today, end_date: today, impact: "no_aplica", status: "pendiente" }
}

export function RrhhPermisosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<HrLeave[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<HrLeave> | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState("all")

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrLeaves" }) as { ok?: boolean; records?: HrLeave[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRecords(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar permisos: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => filterStatus === "all" ? records : records.filter(r => r.status === filterStatus), [records, filterStatus])
  const counts = useMemo(() => ({
    total: records.length,
    pendiente: records.filter(r => r.status === "pendiente").length,
    aprobado: records.filter(r => r.status === "aprobado").length,
    rechazado: records.filter(r => r.status === "rechazado").length,
  }), [records])

  const buildPayload = (r: Partial<HrLeave>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "",
      leave_type: r.leave_type || "personal_con_disfrute",
      start_date: r.start_date || "",
      end_date: r.end_date || "",
      days: daysBetween(r.start_date || "", r.end_date || ""),
      impact: r.impact || "no_aplica",
      status: r.status || "pendiente",
    }
    if (r.id) p.id = r.id
    if (r.reason) p.reason = r.reason
    if (r.evidence_url) p.evidence_url = r.evidence_url
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!editing.start_date || !editing.end_date) { showToast("Fechas obligatorias", "error"); return }
    if (new Date(editing.end_date) < new Date(editing.start_date)) { showToast("La fecha fin no puede ser anterior al inicio", "error"); return }
    setSaving(true)
    try {
      const res = await call({ action: "saveHrLeave", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_leave_requests aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Permiso guardado", "success")
      setEditing(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const setStatus = async (r: HrLeave, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrLeave", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo actualizar"}`, "error"); return }
      showToast(status === "aprobado" ? "Permiso aprobado" : "Permiso rechazado", "success")
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta solicitud de permiso?")) return
    setBusyId(id)
    try {
      await call({ action: "deleteHrLeave", id })
      setRecords(prev => prev.filter(r => r.id !== id))
      showToast("Permiso eliminado", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><CalendarOff className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Permisos y licencias</h2>
            <p className="mt-1 text-sm text-muted-foreground">Solicitudes de permiso (personal, médica, duelo, maternidad…), evidencia, aprobación e impacto en nómina.</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo permiso</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_leave_requests</code> aún no existe en este tenant. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020003_hr_leave_requests.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.pendiente}</div><div className="text-xs text-muted-foreground uppercase mt-1">Pendientes</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-red-600">{counts.rechazado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Rechazados</div></CardContent></Card>
      </div>

      <div className="max-w-[180px]">
        <Label className="text-xs">Estado</Label>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="aprobado">Aprobado</SelectItem>
            <SelectItem value="rechazado">Rechazado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando permisos...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{records.length === 0 ? "Sin permisos registrados." : "Sin permisos con ese filtro."}</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Desde</TableHead>
                <TableHead className="text-xs">Hasta</TableHead>
                <TableHead className="text-xs text-right">Días</TableHead>
                <TableHead className="text-xs">Impacto</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_id}</TableCell>
                    <TableCell className="text-xs">{LEAVE_TYPES[r.leave_type] || r.leave_type}</TableCell>
                    <TableCell className="text-xs">{r.start_date}</TableCell>
                    <TableCell className="text-xs">{r.end_date}</TableCell>
                    <TableCell className="text-xs text-right">{r.days}</TableCell>
                    <TableCell className="text-xs">{IMPACT[r.impact] || r.impact}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {r.status === "pendiente" && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">
                              {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => setStatus(r, "rechazado")} disabled={busyId === r.id} title="Rechazar">
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar permiso" : "Nuevo permiso"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">ID Empleado *</Label><Input value={editing.employee_id || ""} onChange={e => setEditing({ ...editing, employee_id: e.target.value })} placeholder="EMP-001" /></div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Tipo de permiso *</Label>
                  <Select value={editing.leave_type || "personal_con_disfrute"} onValueChange={v => setEditing({ ...editing, leave_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(LEAVE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Desde *</Label><Input type="date" value={editing.start_date || ""} onChange={e => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Hasta *</Label><Input type="date" value={editing.end_date || ""} onChange={e => setEditing({ ...editing, end_date: e.target.value })} /></div>
                <div className="space-y-1 col-span-2 text-xs text-muted-foreground">Duración: <b>{daysBetween(editing.start_date || "", editing.end_date || "")}</b> día(s)</div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Impacto en nómina</Label>
                  <Select value={editing.impact || "no_aplica"} onValueChange={v => setEditing({ ...editing, impact: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(IMPACT).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Motivo</Label><Input value={editing.reason || ""} onChange={e => setEditing({ ...editing, reason: e.target.value })} /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Evidencia (URL · certificado médico, etc.)</Label><Input value={editing.evidence_url || ""} onChange={e => setEditing({ ...editing, evidence_url: e.target.value })} placeholder="https://..." /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              </div>
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
