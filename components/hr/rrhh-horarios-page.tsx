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
import { CalendarClock, Plus, Pencil, Trash2, Save, X, Loader2, UserPlus, AlertTriangle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { HrPageShell } from "@/components/hr-page-shell"

interface HrSchedule {
  id: string
  business_id: string
  name: string
  type: string
  entry_time: string | null
  exit_time: string | null
  lunch_start: string | null
  lunch_end: string | null
  workdays: string[]
  late_tolerance_min: number
  status: string
}

interface HrAssignment {
  id: string
  business_id: string
  employee_id: string
  schedule_id: string
  sucursal: string | null
  start_date: string
  end_date: string | null
}

const DAYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"]
const TYPE_OPTIONS = ["fijo", "rotativo"]

// Almuerzo SIEMPRE 60 min (regla oficial). Helpers para ajustar/validar.
const schedToMin = (t: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const schedMinToHHMM = (mins: number) => { const x = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}` }

function emptySchedule(): Partial<HrSchedule> {
  return {
    name: "", type: "fijo", entry_time: "09:00", exit_time: "18:00",
    lunch_start: "13:00", lunch_end: "14:00", workdays: ["lun", "mar", "mie", "jue", "vie", "sab"],
    late_tolerance_min: 10, status: "activo",
  }
}

export function RrhhHorariosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [schedules, setSchedules] = useState<HrSchedule[]>([])
  const [assignments, setAssignments] = useState<HrAssignment[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<HrSchedule> | null>(null)
  const [assigning, setAssigning] = useState<Partial<HrAssignment> | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([
        call({ action: "getHrSchedules" }) as Promise<{ ok?: boolean; records?: HrSchedule[]; tableMissing?: boolean }>,
        call({ action: "getHrScheduleAssignments" }) as Promise<{ ok?: boolean; records?: HrAssignment[] }>,
      ])
      setTableMissing(Boolean(s?.tableMissing))
      setSchedules(s?.records ?? [])
      setAssignments(a?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar horarios: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { reload() }, [])

  const scheduleName = useMemo(() => {
    const m = new Map(schedules.map(s => [s.id, s.name]))
    return (id: string) => m.get(id) || id
  }, [schedules])

  const toggleDay = (day: string) => {
    if (!editing) return
    const cur = editing.workdays ?? []
    setEditing({ ...editing, workdays: cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day] })
  }

  const handleSaveSchedule = async () => {
    if (!editing) return
    if (!editing.name?.trim()) { showToast("Nombre del horario obligatorio", "error"); return }
    // El almuerzo, si se define, debe ser de exactamente 60 minutos.
    const ls = schedToMin(editing.lunch_start), le = schedToMin(editing.lunch_end)
    if ((editing.lunch_start || editing.lunch_end) && (ls == null || le == null || le - ls !== 60)) {
      showToast("El almuerzo debe ser de 60 minutos.", "error"); return
    }
    setSaving(true)
    try {
      const payload: Record<string, string | number> = {
        name: editing.name.trim(),
        type: editing.type || "fijo",
        status: editing.status || "activo",
        late_tolerance_min: Number(editing.late_tolerance_min ?? 0),
        workdays: JSON.stringify(editing.workdays ?? []),
      }
      for (const k of ["entry_time", "exit_time", "lunch_start", "lunch_end"] as const) {
        if (editing[k]) payload[k] = editing[k] as string
      }
      if (editing.id) payload.id = editing.id
      const res = await call({ action: "saveHrSchedule", data: JSON.stringify(payload) }) as
        { ok?: boolean; record?: HrSchedule; tableMissing?: boolean; error?: string }
      if (res?.tableMissing) { showToast("Tabla hr_schedules aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Horario guardado", "success")
      setEditing(null)
      reload()
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const handleSaveAssignment = async () => {
    if (!assigning) return
    if (!assigning.employee_id?.trim() || !assigning.schedule_id) {
      showToast("Empleado y horario son obligatorios", "error"); return
    }
    setSaving(true)
    try {
      const payload: Record<string, string> = {
        employee_id: assigning.employee_id.trim(),
        schedule_id: assigning.schedule_id,
      }
      if (assigning.sucursal) payload.sucursal = assigning.sucursal
      if (assigning.start_date) payload.start_date = assigning.start_date
      if (assigning.id) payload.id = assigning.id
      const res = await call({ action: "saveHrScheduleAssignment", data: JSON.stringify(payload) }) as
        { ok?: boolean; tableMissing?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo asignar"}`, "error"); return }
      showToast("Horario asignado", "success")
      setAssigning(null)
      reload()
    } catch (err) {
      showToast(`Error al asignar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const delSchedule = async (id: string) => {
    if (!confirm("¿Eliminar este horario? Se quitarán sus asignaciones.")) return
    setDeletingId(id)
    try {
      await call({ action: "deleteHrSchedule", id })
      setSchedules(prev => prev.filter(s => s.id !== id))
      showToast("Horario eliminado", "success")
      reload()
    } catch (err) {
      showToast(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setDeletingId(null) }
  }

  const delAssignment = async (id: string) => {
    if (!confirm("¿Quitar esta asignación?")) return
    setDeletingId(id)
    try {
      await call({ action: "deleteHrScheduleAssignment", id })
      setAssignments(prev => prev.filter(a => a.id !== id))
      showToast("Asignación eliminada", "success")
    } catch (err) {
      showToast(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setDeletingId(null) }
  }

  if (tableMissing && !loading) {
    return (
      <HrPageShell icon={CalendarClock} title="Horarios y turnos" section="RR.HH. · Asistencia" phase={2}
        description="Definición de horarios fijos/rotativos con tolerancia y asignación por empleado.">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_schedules</code> aún no existe en este tenant. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020002_hr_phase2_schedules_punches.sql</code>.</div>
        </div>
      </HrPageShell>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><CalendarClock className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Horarios y turnos</h2>
            <p className="mt-1 text-sm text-muted-foreground">Horarios fijos/rotativos con tolerancia de tardanza y asignación por empleado.</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptySchedule())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo horario</Button>
      </div>

      {/* Horarios */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : schedules.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin horarios. Crea el primero con el botón de arriba.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Horario</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Entrada</TableHead>
                <TableHead className="text-xs">Salida</TableHead>
                <TableHead className="text-xs">Días</TableHead>
                <TableHead className="text-xs text-right">Tolerancia</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-20">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {schedules.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm font-medium">{s.name}</TableCell>
                    <TableCell className="text-xs">{s.type}</TableCell>
                    <TableCell className="text-xs">{s.entry_time || "—"}</TableCell>
                    <TableCell className="text-xs">{s.exit_time || "—"}</TableCell>
                    <TableCell className="text-xs">{(s.workdays || []).join(", ") || "—"}</TableCell>
                    <TableCell className="text-xs text-right">{s.late_tolerance_min} min</TableCell>
                    <TableCell><Badge variant="outline" className={s.status === "activo" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600"}>{s.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(s)} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => delSchedule(s.id)} disabled={deletingId === s.id} title="Eliminar">
                          {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Asignaciones */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Asignación a empleados</h3>
        <Button size="sm" variant="outline" onClick={() => setAssigning({ start_date: new Date().toISOString().slice(0, 10) })} disabled={schedules.length === 0}>
          <UserPlus className="w-4 h-4 mr-1" />Asignar horario
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {assignments.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Sin asignaciones.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Horario</TableHead>
                <TableHead className="text-xs">Sucursal</TableHead>
                <TableHead className="text-xs">Desde</TableHead>
                <TableHead className="text-xs">Hasta</TableHead>
                <TableHead className="text-xs text-center w-16">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {assignments.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm font-medium">{a.employee_id}</TableCell>
                    <TableCell className="text-xs">{scheduleName(a.schedule_id)}</TableCell>
                    <TableCell className="text-xs">{a.sucursal || "—"}</TableCell>
                    <TableCell className="text-xs">{a.start_date}</TableCell>
                    <TableCell className="text-xs">{a.end_date || "vigente"}</TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => delAssignment(a.id)} disabled={deletingId === a.id} title="Quitar">
                        {deletingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog horario */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar horario" : "Nuevo horario"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Nombre *</Label>
                <Input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Turno mañana" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editing.type || "fijo"} onValueChange={v => setEditing({ ...editing, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tolerancia tardanza (min)</Label>
                  <Input type="number" value={editing.late_tolerance_min ?? 0} onChange={e => setEditing({ ...editing, late_tolerance_min: Number(e.target.value) })} />
                </div>
                <div className="space-y-1"><Label className="text-xs">Entrada</Label><Input type="time" value={editing.entry_time || ""} onChange={e => setEditing({ ...editing, entry_time: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Salida</Label><Input type="time" value={editing.exit_time || ""} onChange={e => setEditing({ ...editing, exit_time: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Inicio almuerzo</Label><Input type="time" value={editing.lunch_start || ""} onChange={e => { const s = schedToMin(e.target.value); setEditing({ ...editing, lunch_start: e.target.value, lunch_end: s != null ? schedMinToHHMM(s + 60) : editing.lunch_end }) }} /></div>
                <div className="space-y-1"><Label className="text-xs">Fin almuerzo <span className="text-amber-600">(60 min)</span></Label><Input type="time" value={editing.lunch_end || ""} onChange={e => { const en = schedToMin(e.target.value); setEditing({ ...editing, lunch_end: e.target.value, lunch_start: en != null ? schedMinToHHMM(en - 60) : editing.lunch_start }) }} /></div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Días laborables</Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(d => (
                    <button key={d} type="button" onClick={() => toggleDay(d)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border ${(editing.workdays ?? []).includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-transparent"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select value={editing.status || "activo"} onValueChange={v => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="activo">activo</SelectItem><SelectItem value="inactivo">inactivo</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSaveSchedule} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog asignación */}
      <Dialog open={!!assigning} onOpenChange={open => !open && setAssigning(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Asignar horario a empleado</DialogTitle></DialogHeader>
          {assigning && (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Empleado *</Label>
                <EmployeeSelect value={assigning.employee_id} onSelect={emp => setAssigning({ ...assigning, employee_id: emp?.empleado_id || "", sucursal: emp?.sucursal || assigning.sucursal || "" })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Horario *</Label>
                <Select value={assigning.schedule_id || ""} onValueChange={v => setAssigning({ ...assigning, schedule_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar horario" /></SelectTrigger>
                  <SelectContent>{schedules.filter(s => s.status === "activo").map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={assigning.sucursal || ""} onChange={e => setAssigning({ ...assigning, sucursal: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={assigning.start_date || ""} onChange={e => setAssigning({ ...assigning, start_date: e.target.value })} /></div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssigning(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSaveAssignment} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Asignar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
