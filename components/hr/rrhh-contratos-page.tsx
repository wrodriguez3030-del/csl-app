"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileSignature, Plus, Pencil, Trash2, Save, X, Loader2, AlertTriangle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { HrPageShell } from "@/components/hr-page-shell"

interface HrContract {
  id: string
  business_id: string
  employee_id: string
  contract_type: string
  start_date: string
  end_date: string | null
  salary: number | null
  position_name: string | null
  schedule: string | null
  workday: string | null
  status: string
  file_url: string | null
  observations: string | null
  created_at?: string
  updated_at?: string
}

type ContractStatus = "borrador" | "activo" | "vencido" | "renovado" | "archivado" | "anulado"

const STATUS_OPTIONS: ContractStatus[] = ["borrador", "activo", "vencido", "renovado", "archivado", "anulado"]
const TYPE_OPTIONS = ["indefinido", "fijo", "prueba", "prestacion_servicios"]
const WORKDAY_OPTIONS = ["completa", "media", "por_horas"]

const STATUS_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  activo: "bg-emerald-100 text-emerald-700 border-emerald-200",
  vencido: "bg-red-100 text-red-700 border-red-200",
  renovado: "bg-blue-100 text-blue-700 border-blue-200",
  archivado: "bg-amber-100 text-amber-700 border-amber-200",
  anulado: "bg-gray-100 text-gray-500 border-gray-200",
}

function emptyForm(): Partial<HrContract> {
  const today = new Date().toISOString().slice(0, 10)
  return {
    employee_id: "",
    contract_type: "indefinido",
    start_date: today,
    end_date: null,
    salary: null,
    position_name: "",
    schedule: "",
    workday: "completa",
    status: "borrador",
    observations: "",
  }
}

export function RrhhContratosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<HrContract[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<HrContract> | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [search, setSearch] = useState("")

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await apiCallLocal({ action: "getHrContracts" }) as
        { ok?: boolean; records?: HrContract[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRecords(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar contratos: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false
      if (search) {
        const q = search.toLowerCase()
        if (!String(r.employee_id).toLowerCase().includes(q) &&
            !String(r.position_name || "").toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [records, filterStatus, search])

  const counts = useMemo(() => ({
    total: records.length,
    activos: records.filter(r => r.status === "activo").length,
    venciendo: records.filter(r => {
      if (r.status !== "activo" || !r.end_date) return false
      const days = Math.ceil((new Date(r.end_date).getTime() - Date.now()) / 86400000)
      return days >= 0 && days <= 30
    }).length,
    vencidos: records.filter(r => r.status === "vencido").length,
  }), [records])

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id) {
      showToast("Empleado obligatorio", "error")
      return
    }
    if (!editing.start_date) {
      showToast("Fecha de inicio obligatoria", "error")
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, string | number> = {
        employee_id: editing.employee_id || "",
        contract_type: editing.contract_type || "indefinido",
        start_date: editing.start_date,
        status: editing.status || "borrador",
        workday: editing.workday || "completa",
      }
      if (editing.id) payload.id = editing.id
      if (editing.end_date) payload.end_date = editing.end_date
      if (editing.salary != null) payload.salary = Number(editing.salary)
      if (editing.position_name) payload.position_name = editing.position_name
      if (editing.schedule) payload.schedule = editing.schedule
      if (editing.observations) payload.observations = editing.observations

      const res = await apiCallLocal({ action: "saveHrContract", data: JSON.stringify(payload) }) as
        { ok?: boolean; record?: HrContract; tableMissing?: boolean; error?: string }
      if (res?.tableMissing) {
        showToast("Tabla hr_contracts aún no existe — aplica la migración en Supabase", "info")
        setEditing(null)
        return
      }
      if (!res?.ok) {
        showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error")
        return
      }
      if (res.record) {
        setRecords(prev => {
          const idx = prev.findIndex(r => r.id === res.record!.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = res.record!
            return next
          }
          return [res.record!, ...prev]
        })
      }
      showToast("Contrato guardado", "success")
      setEditing(null)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este contrato? Esta acción no se puede deshacer.")) return
    setDeletingId(id)
    try {
      const res = await apiCallLocal({ action: "deleteHrContract", id }) as
        { ok?: boolean; tableMissing?: boolean }
      if (res?.tableMissing) {
        showToast("Tabla hr_contracts aún no existe", "info")
        return
      }
      if (res?.ok) {
        setRecords(prev => prev.filter(r => r.id !== id))
        showToast("Contrato eliminado", "success")
      }
    } catch (err) {
      showToast(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setDeletingId(null)
    }
  }

  // Si la tabla no existe, mostrar el shell con aviso explícito.
  if (tableMissing && !loading) {
    return (
      <HrPageShell
        icon={FileSignature}
        title="Contratos laborales"
        section="RR.HH. · Personal"
        phase={1}
        description="Gestión de contratos: borradores, firmas, renovaciones, vencimientos y archivo PDF por empleado."
      >
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-1">
              <div className="font-semibold">Migración pendiente</div>
              <div>
                La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_contracts</code> aún no existe en este tenant.
                Aplica el SQL <code className="text-xs bg-amber-100 px-1 rounded">supabase/migrations/202606010002_hr_contracts_documents.sql</code>
                en el Supabase SQL Editor para habilitar el módulo.
              </div>
            </div>
          </div>
        </div>
      </HrPageShell>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <FileSignature className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              RR.HH. · Personal · {business.shortName}
            </p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Contratos laborales</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Gestión de contratos firmados, vencimientos y renovaciones por empleado.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" />Nuevo contrato
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">{counts.total}</div>
          <div className="text-xs text-muted-foreground uppercase mt-1">Total</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-emerald-600">{counts.activos}</div>
          <div className="text-xs text-muted-foreground uppercase mt-1">Activos</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-600">{counts.venciendo}</div>
          <div className="text-xs text-muted-foreground uppercase mt-1">Vencen ≤ 30 días</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-red-600">{counts.vencidos}</div>
          <div className="text-xs text-muted-foreground uppercase mt-1">Vencidos</div>
        </CardContent></Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Label className="text-xs">Buscar (empleado o cargo)</Label>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ID empleado, cargo..." className="h-8" />
        </div>
        <div className="min-w-[140px]">
          <Label className="text-xs">Estado</Label>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabla */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando contratos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {records.length === 0 ? "Sin contratos registrados. Crea el primero con el botón de arriba." : "Sin contratos que coincidan con el filtro."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Empleado</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Cargo</TableHead>
                  <TableHead className="text-xs">Inicio</TableHead>
                  <TableHead className="text-xs">Fin</TableHead>
                  <TableHead className="text-xs text-right">Salario</TableHead>
                  <TableHead className="text-xs">Estado</TableHead>
                  <TableHead className="text-xs text-center w-24">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_id}</TableCell>
                    <TableCell className="text-xs">{r.contract_type}</TableCell>
                    <TableCell className="text-xs">{r.position_name || "—"}</TableCell>
                    <TableCell className="text-xs">{r.start_date}</TableCell>
                    <TableCell className="text-xs">{r.end_date || "—"}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{r.salary != null ? `RD$ ${Number(r.salary).toLocaleString("es-DO", { minimumFractionDigits: 2 })}` : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(r.id)} disabled={deletingId === r.id} title="Eliminar">
                          {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

      {/* Dialog editar/crear */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar contrato" : "Nuevo contrato"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Empleado *</Label>
                  <EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", salary: emp?.sueldo ?? editing.salary ?? null, position_name: emp?.puesto || editing.position_name || "" })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo *</Label>
                  <Select value={editing.contract_type || "indefinido"} onValueChange={v => setEditing({ ...editing, contract_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Jornada</Label>
                  <Select value={editing.workday || "completa"} onValueChange={v => setEditing({ ...editing, workday: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORKDAY_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha inicio *</Label>
                  <Input type="date" value={editing.start_date || ""} onChange={e => setEditing({ ...editing, start_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha fin</Label>
                  <Input type="date" value={editing.end_date || ""} onChange={e => setEditing({ ...editing, end_date: e.target.value || null })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Salario (RD$)</Label>
                  <Input type="number" step="0.01" value={editing.salary ?? ""} onChange={e => setEditing({ ...editing, salary: e.target.value ? Number(e.target.value) : null })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cargo (snapshot)</Label>
                  <Input value={editing.position_name || ""} onChange={e => setEditing({ ...editing, position_name: e.target.value })} placeholder="Operadora láser, Recepción..." />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Horario</Label>
                  <Input value={editing.schedule || ""} onChange={e => setEditing({ ...editing, schedule: e.target.value })} placeholder="Lunes a sábado 9am-6pm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  <Select value={editing.status || "borrador"} onValueChange={v => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Observaciones</Label>
                  <Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              <X className="w-4 h-4 mr-1" />Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
