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
import { FileSignature, Plus, Pencil, Trash2, Save, X, Loader2, AlertTriangle, Printer, RefreshCw } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { HrPageShell } from "@/components/hr-page-shell"
import { buildContractHtml, contractFileName, type ContractData } from "@/lib/hr-contract-template"

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
  // Campos enriquecidos para el contrato PDF (snapshot)
  employee_nombre?: string | null
  cedula?: string | null
  estado_civil?: string | null
  direccion?: string | null
  telefono?: string | null
  email?: string | null
  branch?: string | null
  payment_frequency?: string | null
  payment_method?: string | null
  bank?: string | null
  account_type?: string | null
  account_number?: string | null
  account_holder?: string | null
  work_days?: string | null
  break_time?: string | null
  weekly_rest?: string | null
  incentive_applies?: boolean | null
  incentive_detail?: string | null
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
    employee_nombre: "", cedula: "", estado_civil: "", direccion: "", telefono: "", email: "", branch: "",
    payment_frequency: "Mensual", payment_method: "Transferencia bancaria",
    bank: "", account_type: "Ahorro", account_number: "", account_holder: "",
    work_days: "Lunes a sábado", break_time: "1 hora", weekly_rest: "1 día a la semana",
    incentive_applies: false, incentive_detail: "",
  }
}

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  indefinido: "Tiempo indefinido", fijo: "Tiempo definido", prueba: "Período de prueba", prestacion_servicios: "Prestación de servicios",
}

function contractToData(r: Partial<HrContract>, businessSlug: string, businessName: string): ContractData {
  const s = (v: unknown) => (v == null ? "" : String(v))
  return {
    businessSlug,
    empresaNombre: businessSlug === "csl" ? undefined : businessName,
    empleadoNombre: s(r.employee_nombre) || s(r.employee_id),
    cedula: s(r.cedula), estadoCivil: s(r.estado_civil), direccion: s(r.direccion), telefono: s(r.telefono), email: s(r.email),
    cargo: s(r.position_name), branch: s(r.branch), contractType: CONTRACT_TYPE_LABEL[s(r.contract_type)] || "Tiempo indefinido",
    startDate: s(r.start_date).slice(0, 10), salary: Number(r.salary) || 0,
    paymentFrequency: s(r.payment_frequency) || "Mensual", paymentMethod: s(r.payment_method) || "Transferencia bancaria",
    bank: s(r.bank), accountType: s(r.account_type), accountNumber: s(r.account_number), accountHolder: s(r.account_holder) || s(r.employee_nombre),
    workDays: s(r.work_days) || s(r.schedule), breakTime: s(r.break_time), weeklyRest: s(r.weekly_rest),
    incentiveApplies: Boolean(r.incentive_applies), incentiveDetail: s(r.incentive_detail), observaciones: s(r.observations),
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
  const [prefilling, setPrefilling] = useState(false)

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  // Autocompletar contrato desde empleado central + solicitud de empleo aprobada.
  // manual=true (botón) sobreescribe; auto (al elegir empleado) solo rellena vacíos.
  const prefillFromSolicitud = async (employeeId: string, manual = false) => {
    if (!employeeId) return
    setPrefilling(true)
    try {
      const res = await apiCallLocal({ action: "getHrContractPrefill", employee_id: employeeId }) as
        { ok?: boolean; prefill?: Record<string, unknown>; source?: string; error?: string }
      if (!res?.ok || !res.prefill) { if (manual) showToast(res?.error || "No se encontró solicitud/ficha de este empleado", "error"); return }
      const p = res.prefill
      const take = (cur: unknown, inc: unknown) => {
        const c = cur == null ? "" : String(cur).trim()
        const i = inc == null ? "" : String(inc).trim()
        return manual ? (i ? inc : cur) : (c ? cur : (i ? inc : cur))
      }
      setEditing(prev => prev ? {
        ...prev,
        employee_nombre: take(prev.employee_nombre, p.employee_nombre) as string,
        cedula: take(prev.cedula, p.cedula) as string,
        estado_civil: take(prev.estado_civil, p.estado_civil) as string,
        direccion: take(prev.direccion, p.direccion) as string,
        telefono: take(prev.telefono, p.telefono) as string,
        email: take(prev.email, p.email) as string,
        position_name: take(prev.position_name, p.position_name) as string,
        branch: take(prev.branch, p.branch) as string,
        start_date: take(prev.start_date, p.fecha_ingreso) as string,
        salary: (manual ? (p.salary ?? prev.salary) : (prev.salary ?? p.salary)) as number | null,
        bank: take(prev.bank, p.bank) as string,
        account_type: take(prev.account_type, p.account_type) as string,
        account_number: take(prev.account_number, p.account_number) as string,
        account_holder: take(prev.account_holder, p.account_holder) as string,
      } : prev)
      if (manual) showToast(`Datos cargados desde ${res.source === "empleado" ? "la ficha del empleado" : "la solicitud"}`, "success")
    } catch (err) { if (manual) showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") }
    finally { setPrefilling(false) }
  }

  // Campos mínimos para generar el contrato.
  const missingContractFields = (r: Partial<HrContract>): string[] => {
    const req: [keyof HrContract, string][] = [
      ["employee_nombre", "nombre"], ["cedula", "cédula"], ["estado_civil", "estado civil"],
      ["direccion", "dirección"], ["telefono", "teléfono"], ["start_date", "fecha de inicio"],
      ["branch", "sucursal"], ["position_name", "cargo"],
    ]
    const miss = req.filter(([k]) => !String(r[k] ?? "").trim()).map(([, l]) => l)
    if (!(Number(r.salary) > 0)) miss.push("salario")
    return miss
  }

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
      const payload: Record<string, string | number | boolean> = {
        employee_id: editing.employee_id || "",
        contract_type: editing.contract_type || "indefinido",
        start_date: editing.start_date,
        status: editing.status || "borrador",
        workday: editing.workday || "completa",
        incentive_applies: Boolean(editing.incentive_applies),
      }
      if (editing.id) payload.id = editing.id
      if (editing.end_date) payload.end_date = editing.end_date
      if (editing.salary != null) payload.salary = Number(editing.salary)
      if (editing.position_name) payload.position_name = editing.position_name
      if (editing.schedule) payload.schedule = editing.schedule
      if (editing.observations) payload.observations = editing.observations
      // Campos enriquecidos para el contrato PDF
      for (const k of ["employee_nombre", "cedula", "estado_civil", "direccion", "telefono", "email", "branch", "payment_frequency", "payment_method", "bank", "account_type", "account_number", "account_holder", "work_days", "break_time", "weekly_rest", "incentive_detail"] as const) {
        const v = (editing as Record<string, unknown>)[k]
        if (v != null && String(v) !== "") payload[k] = String(v)
      }

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

  const generatePdf = (r: Partial<HrContract>) => {
    if (!r.employee_id) { showToast("Selecciona un empleado primero", "error"); return }
    const miss = missingContractFields(r)
    if (miss.length) { showToast(`Faltan datos para generar el contrato: ${miss.join(", ")}. Complétalos en el formulario o pulsa “Actualizar desde solicitud”.`, "error"); return }
    const data = contractToData(r, business.slug, business.name)
    const w = window.open("", "_blank")
    if (!w) { showToast("Permite las ventanas emergentes para generar el PDF", "error"); return }
    w.document.write(buildContractHtml(data)); w.document.title = contractFileName(data).replace(/\.pdf$/, ""); w.document.close()
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
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}</TableCell>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary" onClick={() => generatePdf(r)} title="Generar PDF del contrato">
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
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
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Empleado *</Label>
                    {editing.employee_id && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={prefilling} onClick={() => prefillFromSolicitud(editing.employee_id!, true)}>
                        {prefilling ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}Actualizar desde solicitud
                      </Button>
                    )}
                  </div>
                  <EmployeeSelect value={editing.employee_id} onSelect={emp => {
                    const id = emp?.empleado_id || ""
                    setEditing({ ...editing, employee_id: id, employee_nombre: emp?.nombre || editing.employee_nombre || "", account_holder: emp?.nombre || editing.account_holder || "" })
                    if (id) prefillFromSolicitud(id)
                  }} />
                  {prefilling && <p className="text-[11px] text-muted-foreground">Autocompletando desde la solicitud…</p>}
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
                <div className="col-span-2 mt-1 border-t pt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Datos para el contrato (PDF)</div>
                <div className="space-y-1"><Label className="text-xs">Cédula</Label><Input value={editing.cedula || ""} onChange={e => setEditing({ ...editing, cedula: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Estado civil</Label><Input value={editing.estado_civil || ""} onChange={e => setEditing({ ...editing, estado_civil: e.target.value })} placeholder="Soltero/a, Casado/a…" /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Dirección</Label><Input value={editing.direccion || ""} onChange={e => setEditing({ ...editing, direccion: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Teléfono</Label><Input value={editing.telefono || ""} onChange={e => setEditing({ ...editing, telefono: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={editing.branch || ""} onChange={e => setEditing({ ...editing, branch: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Frecuencia de pago</Label>
                  <Select value={editing.payment_frequency || "Mensual"} onValueChange={v => setEditing({ ...editing, payment_frequency: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Mensual", "Quincenal", "Semanal", "Diario"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Banco</Label><Input value={editing.bank || ""} onChange={e => setEditing({ ...editing, bank: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Tipo de cuenta</Label>
                  <Select value={editing.account_type || "Ahorro"} onValueChange={v => setEditing({ ...editing, account_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Ahorro", "Corriente"].map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Número de cuenta</Label><Input value={editing.account_number || ""} onChange={e => setEditing({ ...editing, account_number: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Titular</Label><Input value={editing.account_holder || ""} onChange={e => setEditing({ ...editing, account_holder: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Días de trabajo</Label><Input value={editing.work_days || ""} onChange={e => setEditing({ ...editing, work_days: e.target.value })} placeholder="Lunes a sábado" /></div>
                <div className="space-y-1"><Label className="text-xs">Descanso intermedio</Label><Input value={editing.break_time || ""} onChange={e => setEditing({ ...editing, break_time: e.target.value })} placeholder="1 hora" /></div>
                <div className="space-y-1"><Label className="text-xs">Descanso semanal</Label><Input value={editing.weekly_rest || ""} onChange={e => setEditing({ ...editing, weekly_rest: e.target.value })} placeholder="1 día a la semana" /></div>
                <div className="space-y-1 flex items-end"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(editing.incentive_applies)} onChange={e => setEditing({ ...editing, incentive_applies: e.target.checked })} />Aplica incentivo</label></div>
                {editing.incentive_applies && <div className="space-y-1 col-span-2"><Label className="text-xs">Detalle del incentivo</Label><Input value={editing.incentive_detail || ""} onChange={e => setEditing({ ...editing, incentive_detail: e.target.value })} /></div>}
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
            <Button variant="outline" onClick={() => editing && generatePdf(editing)} disabled={!editing?.employee_id}>
              <Printer className="w-4 h-4 mr-1" />Vista previa PDF
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
