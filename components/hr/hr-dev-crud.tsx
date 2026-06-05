"use client"

import { useEffect, useMemo, useState, type ComponentType } from "react"
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
import { Plus, Pencil, Trash2, Save, X, Loader2, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

type Row = Record<string, unknown>
export interface FieldDef { key: string; label: string; type?: "text" | "number" | "date" | "select" | "textarea" | "checklist" | "employee"; options?: string[]; items?: { key: string; label: string }[]; required?: boolean; full?: boolean }
export interface ColDef { key: string; label: string; kind?: "text" | "badge" | "date" }

export interface HrDevCrudProps {
  title: string
  subtitle: string
  section: string
  icon: ComponentType<{ className?: string }>
  getAction: string
  saveAction: string
  deleteAction: string
  migration: string
  table: string
  columns: ColDef[]
  fields: FieldDef[]
  statusKey?: string
  statusClass?: Record<string, string>
  defaults?: Row
  addLabel?: string
}

export function HrDevCrud(props: HrDevCrudProps) {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const Icon = props.icon
  const [records, setRecords] = useState<Row[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: props.getAction }) as { ok?: boolean; records?: Row[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setRecords(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({ total: records.length }), [records])

  const handleSave = async () => {
    if (!editing) return
    for (const f of props.fields) {
      if (f.required && !String(editing[f.key] ?? "").trim()) { showToast(`${f.label} es obligatorio`, "error"); return }
    }
    setBusy(true)
    try {
      const payload: Record<string, string | number | boolean> = {}
      for (const f of props.fields) {
        const v = editing[f.key]
        if (v === undefined || v === null) continue
        if (f.type === "checklist") { payload[f.key] = JSON.stringify(v) }
        else if (f.type === "number") payload[f.key] = Number(v)
        else payload[f.key] = v as string
      }
      if (editing.id) payload.id = editing.id as string
      const res = await call({ action: props.saveAction, data: JSON.stringify(payload) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast(`Tabla ${props.table} aún no existe`, "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Guardado", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }

  const del = async (id: string) => {
    if (!confirm("¿Eliminar este registro?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: props.deleteAction, id }); setRecords(prev => prev.filter(r => String(r.id) !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  const renderCell = (r: Row, c: ColDef) => {
    const v = r[c.key]
    if (c.kind === "badge") return <Badge variant="outline" className={props.statusClass?.[String(v)] || ""}>{String(v ?? "—")}</Badge>
    return <span className="text-xs">{v == null || v === "" ? "—" : String(v)}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{props.section} · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">{props.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>
          </div>
        </div>
        <Button onClick={() => setEditing({ ...(props.defaults || {}) })} className="shrink-0"><Plus className="w-4 h-4 mr-1" />{props.addLabel || "Nuevo"}</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">{props.table}</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">{props.migration}</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Registros</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin registros.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                {props.columns.map(c => <TableHead key={c.key} className="text-xs">{c.label}</TableHead>)}
                <TableHead className="text-xs text-center w-20">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {records.map(r => (
                  <TableRow key={String(r.id)}>
                    {props.columns.map(c => <TableCell key={c.key} className="text-xs">{renderCell(r, c)}</TableCell>)}
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing({ ...r })} title="Editar"><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => del(String(r.id))} disabled={busyId === String(r.id)} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
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
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : (props.addLabel || "Nuevo")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3 py-2">
              {props.fields.map(f => (
                <div key={f.key} className={`space-y-1 ${f.full || f.type === "textarea" || f.type === "checklist" ? "col-span-2" : ""}`}>
                  <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
                  {f.type === "employee" ? (
                    <EmployeeSelect value={String(editing[f.key] ?? "")} onSelect={emp => setEditing({ ...editing, [f.key]: emp?.empleado_id ?? "", employee_nombre: emp?.nombre ?? "" })} />
                  ) : f.type === "select" ? (
                    <Select value={String(editing[f.key] ?? f.options?.[0] ?? "")} onValueChange={v => setEditing({ ...editing, [f.key]: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : f.type === "checklist" ? (
                    <div className="flex flex-wrap gap-2">
                      {(f.items || []).map(it => {
                        const obj = (editing[f.key] as Record<string, boolean>) || {}
                        return (
                          <label key={it.key} className="flex items-center gap-1.5 text-xs border rounded-md px-2 py-1">
                            <input type="checkbox" checked={Boolean(obj[it.key])} onChange={e => setEditing({ ...editing, [f.key]: { ...obj, [it.key]: e.target.checked } })} />
                            {it.label}
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      step={f.type === "number" ? "0.01" : undefined}
                      value={String(editing[f.key] ?? "")}
                      onChange={e => setEditing({ ...editing, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
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
