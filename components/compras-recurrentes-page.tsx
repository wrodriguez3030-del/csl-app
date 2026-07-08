"use client"

import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CalendarClock, Plus, MoreHorizontal, Pencil, DollarSign, Pause, Play, ScrollText, Trash2, RefreshCcw, Loader2 } from "lucide-react"
import { canPerm } from "@/lib/permissions"
import { fmtMoney, FREQUENCY_LABEL, RECURRING_CATEGORIES } from "@/lib/purchases-client"
import type { RecurringPayment, RecurringHistoryRow, Frequency } from "@/lib/purchases-client"

export function ComprasRecurrentesPage() {
  const { apiUrl, showToast } = useAppStore()
  const user = useSessionUser()
  const responsable = user?.nombre || user?.username || "—"
  const can = (p: string) => canPerm(user, p)

  const [items, setItems] = useState<(RecurringPayment & { overdue?: boolean })[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState("1")
  const [form, setForm] = useState<RecurringPayment | null>(null)
  const [payFor, setPayFor] = useState<RecurringPayment | null>(null)
  const [history, setHistory] = useState<{ rec: RecurringPayment; rows: RecurringHistoryRow[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br] = await Promise.all([
        apiCallCached(endpoint, { action: "getRecurringPayments", active }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseBranches" }),
      ])
      if (res?.ok) setItems((res.records as (RecurringPayment & { overdue?: boolean })[]) || [])
      if (br?.ok) setBranches((br.records as string[]) || [])
    } catch (e) { showToast(e instanceof Error ? e.message : "Error al cargar", "error") } finally { setLoading(false) }
  }, [apiUrl, active, branches.length, showToast])

  useEffect(() => { void load() }, [load])

  const proximos = items.filter((r) => r.active && !r.overdue).length
  const vencidos = items.filter((r) => r.overdue).length

  const toggleActive = async (r: RecurringPayment) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "setRecurringActive", id: r.id, active: r.active ? "false" : "true" })
    if (res?.ok) { showToast(r.active ? "Pausado" : "Reactivado", "success"); invalidateReadCache("getRecurringPayments"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }
  const doDelete = async (r: RecurringPayment) => {
    if (!window.confirm(`¿Eliminar el recurrente "${r.name}"?`)) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteRecurringPayment", id: r.id })
    if (res?.ok) { showToast("Eliminado", "success"); invalidateReadCache("getRecurringPayments"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }
  const openHistory = async (r: RecurringPayment) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getRecurringHistory", id: r.id })
    if (res?.ok) setHistory({ rec: r, rows: (res.records as RecurringHistoryRow[]) || [] })
    else showToast((res as { error?: string })?.error || "Error", "error")
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-[color:var(--brand-primary)]" /> Pagos recurrentes <Badge variant="secondary">{items.length}</Badge>
            <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-200">{proximos} próximos</Badge>
            {vencidos > 0 && <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200">{vencidos} vencidos</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Select value={active} onValueChange={setActive}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Activos</SelectItem><SelectItem value="0">Inactivos</SelectItem><SelectItem value="">Todos</SelectItem></SelectContent></Select>
            <Button variant="outline" size="sm" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
            {can("compras.crear") && <Button size="sm" className="h-9" onClick={() => setForm({ id: "", name: "", frequency: "mensual", amount: 0, active: true, nextDate: new Date().toISOString().slice(0, 10) } as RecurringPayment)}><Plus className="mr-1.5 h-4 w-4" />Nuevo</Button>}
          </div>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
            : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay pagos recurrentes.</div>
            : <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2">Nombre</th><th className="px-2 py-2">Beneficiario</th><th className="px-2 py-2">Frecuencia</th><th className="px-2 py-2 text-right">Monto</th><th className="px-2 py-2">Próximo pago</th><th className="px-2 py-2">Estado</th><th className="px-4 py-2 text-right">Acciones</th></tr></thead>
              <tbody>{items.map((r) => (<tr key={r.id} className={`border-b last:border-0 ${!r.active ? "opacity-50" : ""}`}>
                <td className="px-4 py-2 font-medium">{r.name}{r.category ? <div className="text-xs text-muted-foreground">{r.category}</div> : null}</td>
                <td className="px-2 py-2 text-xs">{r.payee || "—"}</td>
                <td className="px-2 py-2 text-xs">{FREQUENCY_LABEL[r.frequency]}</td>
                <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.amount)}</td>
                <td className="px-2 py-2"><span className={r.overdue ? "font-semibold text-red-600" : ""}>{(r.nextDate || "").slice(0, 10) || "—"}</span>{r.overdue ? <Badge variant="outline" className="ml-1 bg-red-100 text-red-700 border-red-200">vencido</Badge> : null}</td>
                <td className="px-2 py-2"><Badge variant="outline" className={r.active ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}>{r.active ? "Activo" : "Inactivo"}</Badge></td>
                <td className="px-4 py-2 text-right">
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {can("compras.pagar") && r.active && <DropdownMenuItem onClick={() => setPayFor(r)}><DollarSign className="mr-2 h-4 w-4" />Registrar pago</DropdownMenuItem>}
                      {can("compras.editar") && <DropdownMenuItem onClick={() => setForm(r)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                      {can("compras.editar") && <DropdownMenuItem onClick={() => toggleActive(r)}>{r.active ? <><Pause className="mr-2 h-4 w-4" />Pausar</> : <><Play className="mr-2 h-4 w-4" />Reactivar</>}</DropdownMenuItem>}
                      <DropdownMenuItem onClick={() => openHistory(r)}><ScrollText className="mr-2 h-4 w-4" />Historial de pagos</DropdownMenuItem>
                      {can("compras.eliminar") && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => doDelete(r)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem></>}
                    </DropdownMenuContent></DropdownMenu>
                </td></tr>))}</tbody></table></div>}
        </CardContent>
      </Card>

      {form && <RecurringForm rec={form} branches={branches} responsable={responsable} onClose={() => setForm(null)} onSaved={() => { setForm(null); invalidateReadCache("getRecurringPayments"); void load() }} />}
      {payFor && <RecurringPayDialog rec={payFor} responsable={responsable} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); invalidateReadCache("getRecurringPayments"); void load() }} />}
      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Historial de pagos · {history?.rec.name}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {(history?.rows || []).length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">Sin pagos registrados.</div>
              : <table className="w-full text-sm"><thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="py-1">Fecha</th><th className="py-1">Período</th><th className="py-1">Método</th><th className="py-1 text-right">Monto</th></tr></thead>
                <tbody>{(history?.rows || []).map((h) => (<tr key={h.id} className="border-b last:border-0"><td className="py-1">{(h.paidDate || "").slice(0, 10)}</td><td className="py-1">{h.periodLabel}</td><td className="py-1">{h.method}</td><td className="py-1 text-right">{fmtMoney(h.amount)}</td></tr>))}</tbody></table>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RecurringForm({ rec, branches, responsable, onClose, onSaved }: { rec: RecurringPayment; branches: string[]; responsable: string; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [f, setF] = useState({
    name: rec.name || "", payee: rec.payee || "", category: rec.category || "", branch: rec.branch || "",
    frequency: rec.frequency || "mensual", amount: String(rec.amount || 0), nextDate: (rec.nextDate || "").slice(0, 10),
    paymentDay: rec.paymentDay ? String(rec.paymentDay) : "", method: rec.method || "", reminderDays: String(rec.reminderDays ?? 3), notes: rec.notes || "",
  })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!f.name.trim()) return showToast("Indica el nombre", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveRecurringPayment", id: rec.id || "", ...f, userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      showToast("Pago recurrente guardado", "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{rec.id ? "Editar" : "Nuevo"} pago recurrente</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Label className="text-xs">Nombre *</Label><Input className="mt-1 h-9" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Alquiler local, Internet..." /></div>
          <div><Label className="text-xs">Beneficiario</Label><Input className="mt-1 h-9" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></div>
          <div><Label className="text-xs">Categoría</Label><Input list="rcat-list" className="mt-1 h-9" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="rcat-list">{RECURRING_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div><Label className="text-xs">Sucursal</Label><Select value={f.branch || "__none__"} onValueChange={(v) => setF({ ...f, branch: v === "__none__" ? "" : v })}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sucursal" /></SelectTrigger><SelectContent><SelectItem value="__none__">Sin sucursal</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Frecuencia</Label><Select value={f.frequency} onValueChange={(v) => setF({ ...f, frequency: v as Frequency })}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((k) => <SelectItem key={k} value={k}>{FREQUENCY_LABEL[k]}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Monto estimado</Label><Input type="number" step="any" inputMode="decimal" className="mt-1 h-9" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><Label className="text-xs">Próxima fecha</Label><Input type="date" className="mt-1 h-9" value={f.nextDate} onChange={(e) => setF({ ...f, nextDate: e.target.value })} /></div>
          <div><Label className="text-xs">Día habitual</Label><Input type="number" min={1} max={31} className="mt-1 h-9" value={f.paymentDay} onChange={(e) => setF({ ...f, paymentDay: e.target.value })} /></div>
          <div><Label className="text-xs">Método de pago</Label><Input className="mt-1 h-9" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
          <div><Label className="text-xs">Recordatorio (días antes)</Label><Input type="number" min={0} className="mt-1 h-9" value={f.reminderDays} onChange={(e) => setF({ ...f, reminderDays: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Observaciones</Label><Input className="mt-1 h-9" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving || !f.name.trim()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecurringPayDialog({ rec, responsable, onClose, onSaved }: { rec: RecurringPayment; responsable: string; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [amount, setAmount] = useState(String(rec.amount || 0))
  const [method, setMethod] = useState(rec.method || "")
  const [reference, setReference] = useState("")
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!(Number(amount) > 0)) return showToast("Monto inválido", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "registerRecurringPayment", id: rec.id, amount, method, reference, paidDate, userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      const next = (res.record as RecurringPayment)?.nextDate
      showToast(`Pago registrado. Próxima fecha: ${next || "—"}`, "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Registrar pago · {rec.name}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="rounded-md bg-slate-50 p-2 text-xs text-muted-foreground">Período actual: <b>{(rec.nextDate || "").slice(0, 7)}</b> · al registrar, la próxima fecha avanza automáticamente ({FREQUENCY_LABEL[rec.frequency]}).</div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Monto</Label><Input type="number" step="any" inputMode="decimal" className="mt-1 h-10 text-base" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs">Fecha</Label><Input type="date" className="mt-1 h-10" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></div>
            <div><Label className="text-xs">Método</Label><Input className="mt-1 h-9" value={method} onChange={(e) => setMethod(e.target.value)} /></div>
            <div><Label className="text-xs">Referencia</Label><Input className="mt-1 h-9" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving || !(Number(amount) > 0)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}Registrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
