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
import { PiggyBank, Plus, Pencil, Trash2, Save, X, Loader2, Banknote, Ban, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface Loan {
  id: string
  employee_id: string
  employee_nombre: string | null
  principal: number
  cuotas: number
  monto_cuota: number
  balance: number
  descripcion: string | null
  status: string
  start_date: string
}
interface LoanPayment { id: string; loan_id: string; monto: number; fecha: string; tipo: string; notes: string | null }

const STATUS_CLASS: Record<string, string> = {
  activo: "bg-blue-100 text-blue-700 border-blue-200",
  pagado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelado: "bg-gray-100 text-gray-500 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function emptyLoan(): Partial<Loan> {
  return { employee_id: "", principal: 0, cuotas: 1, descripcion: "", start_date: new Date().toISOString().slice(0, 10), status: "activo" }
}

export function RrhhPrestamosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [loans, setLoans] = useState<Loan[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Loan> | null>(null)
  const [paying, setPaying] = useState<Loan | null>(null)
  const [payForm, setPayForm] = useState<{ monto: number; fecha: string; tipo: string; notes: string }>({ monto: 0, fecha: new Date().toISOString().slice(0, 10), tipo: "extra", notes: "" })
  const [payments, setPayments] = useState<LoanPayment[]>([])
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrLoans" }) as { ok?: boolean; records?: Loan[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setLoans(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar préstamos: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const counts = useMemo(() => ({
    total: loans.length,
    activos: loans.filter(l => l.status === "activo").length,
    balance: loans.filter(l => l.status === "activo").reduce((s, l) => s + Number(l.balance || 0), 0),
    pagados: loans.filter(l => l.status === "pagado").length,
  }), [loans])

  const montoCuotaPreview = editing && Number(editing.cuotas) > 0 ? round2(Number(editing.principal || 0) / Number(editing.cuotas)) : 0

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!(Number(editing.principal) > 0)) { showToast("El monto debe ser mayor a 0", "error"); return }
    setSaving(true)
    try {
      const payload: Record<string, string | number> = {
        employee_id: editing.employee_id.trim(),
        principal: Number(editing.principal || 0),
        cuotas: Number(editing.cuotas || 1),
        start_date: editing.start_date || new Date().toISOString().slice(0, 10),
        status: editing.status || "activo",
      }
      if (editing.id) payload.id = editing.id
      if (editing.descripcion) payload.descripcion = editing.descripcion
      const res = await call({ action: "saveHrLoan", data: JSON.stringify(payload) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_loans aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Préstamo guardado", "success")
      setEditing(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const openPay = async (loan: Loan) => {
    setPaying(loan)
    setPayForm({ monto: Number(loan.monto_cuota) || 0, fecha: new Date().toISOString().slice(0, 10), tipo: "extra", notes: "" })
    setPayments([])
    try {
      const res = await call({ action: "getHrLoanPayments", loan_id: loan.id }) as { ok?: boolean; records?: LoanPayment[] }
      setPayments(res?.records ?? [])
    } catch { /* noop */ }
  }

  const submitPay = async () => {
    if (!paying) return
    if (!(Number(payForm.monto) > 0)) { showToast("El monto del pago debe ser mayor a 0", "error"); return }
    if (Number(payForm.monto) > Number(paying.balance) + 0.001) {
      if (!confirm(`El pago (${rd(payForm.monto)}) supera el balance (${rd(paying.balance)}). ¿Continuar?`)) return
    }
    setSaving(true)
    try {
      const res = await call({ action: "addHrLoanPayment", data: JSON.stringify({ loan_id: paying.id, monto: Number(payForm.monto), fecha: payForm.fecha, tipo: payForm.tipo, notes: payForm.notes }) }) as
        { ok?: boolean; balance?: number; status?: string; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo registrar el pago"}`, "error"); return }
      showToast(`Pago registrado. Balance: ${rd(res.balance ?? 0)}`, "success")
      setPaying(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const cancelLoan = async (loan: Loan) => {
    if (!confirm("¿Cancelar este préstamo? Dejará de descontarse.")) return
    setBusyId(loan.id)
    try {
      await call({ action: "saveHrLoan", data: JSON.stringify({ id: loan.id, employee_id: loan.employee_id, principal: loan.principal, cuotas: loan.cuotas, start_date: loan.start_date, descripcion: loan.descripcion || "", status: "cancelado" }) })
      showToast("Préstamo cancelado", "success")
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const del = async (id: string) => {
    if (!confirm("¿Eliminar este préstamo y todos sus pagos? Esta acción no se puede deshacer.")) return
    if (!confirm("Confirma de nuevo: se eliminará permanentemente el préstamo y su historial de pagos.")) return
    setBusyId(id)
    try {
      await call({ action: "deleteHrLoan", id })
      setLoans(prev => prev.filter(l => l.id !== id))
      showToast("Préstamo eliminado", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><PiggyBank className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Préstamos y avances</h2>
            <p className="mt-1 text-sm text-muted-foreground">Préstamos al personal con cuotas; los pagos (por nómina o extra) reducen el balance en tiempo real.</p>
          </div>
        </div>
        <Button onClick={() => setEditing(emptyLoan())} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nuevo préstamo</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_loans</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020005_hr_loans.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Préstamos</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-blue-600">{counts.activos}</div><div className="text-xs text-muted-foreground uppercase mt-1">Activos</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-amber-700">{rd(counts.balance)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Balance pendiente</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.pagados}</div><div className="text-xs text-muted-foreground uppercase mt-1">Pagados</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : loans.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin préstamos registrados.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs text-right">Principal</TableHead>
                <TableHead className="text-xs text-center">Cuotas</TableHead>
                <TableHead className="text-xs text-right">Cuota</TableHead>
                <TableHead className="text-xs text-right">Balance</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-40">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {loans.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm font-medium">{l.employee_nombre || l.employee_id}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{rd(l.principal)}</TableCell>
                    <TableCell className="text-xs text-center">{l.cuotas}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{rd(l.monto_cuota)}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(l.balance)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[l.status] || ""}>{l.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {l.status === "activo" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => openPay(l)} title="Registrar pago"><Banknote className="h-3.5 w-3.5" /></Button>
                        )}
                        {l.status === "activo" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:bg-gray-100" onClick={() => cancelLoan(l)} disabled={busyId === l.id} title="Cancelar"><Ban className="h-3.5 w-3.5" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(l)} title="Editar" disabled={l.status === "pagado"}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => del(l.id)} disabled={busyId === l.id} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog préstamo */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar préstamo" : "Nuevo préstamo"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", employee_nombre: emp?.nombre || "" })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Monto principal (RD$) *</Label><Input type="number" step="0.01" value={editing.principal ?? 0} onChange={e => setEditing({ ...editing, principal: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cuotas</Label><Input type="number" min="1" value={editing.cuotas ?? 1} onChange={e => setEditing({ ...editing, cuotas: Number(e.target.value) })} /></div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2 text-sm flex justify-between"><span className="text-muted-foreground">Monto por cuota (principal ÷ cuotas)</span><span className="font-mono font-bold">{rd(montoCuotaPreview)}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Fecha inicio</Label><Input type="date" value={editing.start_date || ""} onChange={e => setEditing({ ...editing, start_date: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Descripción</Label><Input value={editing.descripcion || ""} onChange={e => setEditing({ ...editing, descripcion: e.target.value })} placeholder="Avance de quincena, préstamo personal..." /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog pago + historial */}
      <Dialog open={!!paying} onOpenChange={open => !open && setPaying(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar pago · {paying?.employee_nombre || paying?.employee_id}</DialogTitle></DialogHeader>
          {paying && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border bg-muted/30 p-2 text-sm flex justify-between"><span className="text-muted-foreground">Balance actual</span><span className="font-mono font-bold">{rd(paying.balance)}</span></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Monto (RD$) *</Label><Input type="number" step="0.01" value={payForm.monto} onChange={e => setPayForm({ ...payForm, monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Fecha</Label><Input type="date" value={payForm.fecha} onChange={e => setPayForm({ ...payForm, fecha: e.target.value })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={payForm.tipo} onValueChange={v => setPayForm({ ...payForm, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="extra">Pago extra</SelectItem><SelectItem value="nomina">Por nómina</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Nota</Label><Input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} /></div>
              </div>
              {payments.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-muted/50"><th className="text-left p-1.5">Fecha</th><th className="text-left p-1.5">Tipo</th><th className="text-right p-1.5">Monto</th></tr></thead>
                    <tbody>{payments.map(p => <tr key={p.id} className="border-t"><td className="p-1.5">{p.fecha}</td><td className="p-1.5">{p.tipo}</td><td className="p-1.5 text-right font-mono">{rd(p.monto)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cerrar</Button>
            <Button onClick={submitPay} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Banknote className="w-4 h-4 mr-1" />}Registrar pago</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
