"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
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
import { Folder, Plus, Pencil, Trash2, Save, X, Loader2, AlertTriangle, ExternalLink } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { HrPageShell } from "@/components/hr-page-shell"

interface HrDocument {
  id: string
  business_id: string
  employee_id: string
  document_type: string
  title: string
  file_url: string | null
  uploaded_at: string
  expires_at: string | null
  visibility: string
  status: string
  observations: string | null
}

const TYPE_OPTIONS = [
  "cedula", "contrato", "licencia", "certificado_medico",
  "carta", "recibo", "amonestacion", "documento_salida", "otros",
]
const VISIBILITY_OPTIONS = ["rrhh", "supervisor", "empleado", "publico"]
const STATUS_OPTIONS = ["activo", "vencido", "archivado", "eliminado"]

const STATUS_CLASS: Record<string, string> = {
  activo: "bg-emerald-100 text-emerald-700 border-emerald-200",
  vencido: "bg-red-100 text-red-700 border-red-200",
  archivado: "bg-amber-100 text-amber-700 border-amber-200",
  eliminado: "bg-gray-100 text-gray-500 border-gray-200",
}

function emptyForm(): Partial<HrDocument> {
  return {
    employee_id: "",
    document_type: "otros",
    title: "",
    file_url: "",
    expires_at: null,
    visibility: "rrhh",
    status: "activo",
    observations: "",
  }
}

function daysUntil(date: string | null): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)
}

export function RrhhDocumentosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<HrDocument[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<HrDocument> | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [filterType, setFilterType] = useState<string>("all")
  const [search, setSearch] = useState("")

  const apiCallLocal = (params: Record<string, string | number | boolean>) =>
    apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await apiCallLocal({ action: "getHrDocuments" }) as
        { ok?: boolean; records?: HrDocument[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRecords(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar documentos: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false
      if (filterType !== "all" && r.document_type !== filterType) return false
      if (search) {
        const q = search.toLowerCase()
        if (!String(r.employee_id).toLowerCase().includes(q) &&
            !String(r.title || "").toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [records, filterStatus, filterType, search])

  const counts = useMemo(() => ({
    total: records.length,
    activos: records.filter(r => r.status === "activo").length,
    venciendo: records.filter(r => {
      if (r.status !== "activo") return false
      const d = daysUntil(r.expires_at)
      return d !== null && d >= 0 && d <= 30
    }).length,
    vencidos: records.filter(r => {
      const d = daysUntil(r.expires_at)
      return r.status === "vencido" || (d !== null && d < 0)
    }).length,
  }), [records])

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id) { showToast("Empleado obligatorio", "error"); return }
    if (!editing.title) { showToast("Título obligatorio", "error"); return }
    setSaving(true)
    try {
      const payload: Record<string, string> = {
        employee_id: editing.employee_id,
        document_type: editing.document_type || "otros",
        title: editing.title,
        visibility: editing.visibility || "rrhh",
        status: editing.status || "activo",
      }
      if (editing.id) payload.id = editing.id
      if (editing.file_url) payload.file_url = editing.file_url
      if (editing.expires_at) payload.expires_at = editing.expires_at
      if (editing.observations) payload.observations = editing.observations

      const res = await apiCallLocal({ action: "saveHrDocument", data: JSON.stringify(payload) }) as
        { ok?: boolean; record?: HrDocument; tableMissing?: boolean; error?: string }
      if (res?.tableMissing) { showToast("Tabla hr_documents aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      if (res.record) {
        setRecords(prev => {
          const idx = prev.findIndex(r => r.id === res.record!.id)
          if (idx >= 0) { const next = [...prev]; next[idx] = res.record!; return next }
          return [res.record!, ...prev]
        })
      }
      showToast("Documento guardado", "success")
      setEditing(null)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) return
    setDeletingId(id)
    try {
      const res = await apiCallLocal({ action: "deleteHrDocument", id }) as
        { ok?: boolean; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_documents aún no existe", "info"); return }
      if (res?.ok) {
        setRecords(prev => prev.filter(r => r.id !== id))
        showToast("Documento eliminado", "success")
      }
    } catch (err) {
      showToast(`Error al eliminar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally {
      setDeletingId(null)
    }
  }

  if (tableMissing && !loading) {
    return (
      <HrPageShell
        icon={Folder}
        title="Documentos empleados"
        section="RR.HH. · Personal"
        phase={1}
        description="Archivo digital por empleado: cédulas, contratos, licencias, certificados médicos, amonestaciones."
      >
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-1">
              <div className="font-semibold">Migración pendiente</div>
              <div>Aplica el SQL <code className="text-xs bg-amber-100 px-1 rounded">supabase/migrations/202606010002_hr_contracts_documents.sql</code> en Supabase para habilitar el módulo.</div>
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
            <Folder className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              RR.HH. · Personal · {business.shortName}
            </p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Documentos empleados</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Archivo digital por empleado: cédulas, contratos, licencias, certificados, amonestaciones.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyForm())} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" />Nuevo documento
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
          <Label className="text-xs">Buscar (empleado o título)</Label>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ID empleado, título..." className="h-8" />
        </div>
        <div className="min-w-[140px]">
          <Label className="text-xs">Tipo</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
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
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando documentos...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {records.length === 0 ? "Sin documentos registrados. Crea el primero con el botón de arriba." : "Sin documentos que coincidan con el filtro."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Empleado</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Título</TableHead>
                  <TableHead className="text-xs">Subido</TableHead>
                  <TableHead className="text-xs">Vence</TableHead>
                  <TableHead className="text-xs">Visibilidad</TableHead>
                  <TableHead className="text-xs">Estado</TableHead>
                  <TableHead className="text-xs text-center w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => {
                  const d = daysUntil(r.expires_at)
                  const expiryClass = d === null ? "" : d < 0 ? "text-red-600 font-semibold" : d <= 30 ? "text-amber-600 font-semibold" : ""
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm font-medium">{r.employee_id}</TableCell>
                      <TableCell className="text-xs">{r.document_type}</TableCell>
                      <TableCell className="text-xs">{r.title}</TableCell>
                      <TableCell className="text-xs">{String(r.uploaded_at).slice(0, 10)}</TableCell>
                      <TableCell className={`text-xs ${expiryClass}`}>{r.expires_at || "—"}</TableCell>
                      <TableCell className="text-xs">{r.visibility}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {r.file_url && (
                            <a href={r.file_url} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir archivo">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </a>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(r.id)} disabled={deletingId === r.id} title="Eliminar">
                            {deletingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Editar documento" : "Nuevo documento"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Empleado *</Label>
                  <EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "" })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo *</Label>
                  <Select value={editing.document_type || "otros"} onValueChange={v => setEditing({ ...editing, document_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Visibilidad</Label>
                  <Select value={editing.visibility || "rrhh"} onValueChange={v => setEditing({ ...editing, visibility: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VISIBILITY_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Título *</Label>
                  <Input value={editing.title || ""} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Cédula 2026, Contrato indefinido..." />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">URL del archivo</Label>
                  <Input value={editing.file_url || ""} onChange={e => setEditing({ ...editing, file_url: e.target.value })} placeholder="https://..." />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha vencimiento</Label>
                  <Input type="date" value={editing.expires_at || ""} onChange={e => setEditing({ ...editing, expires_at: e.target.value || null })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Estado</Label>
                  <Select value={editing.status || "activo"} onValueChange={v => setEditing({ ...editing, status: v })}>
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
