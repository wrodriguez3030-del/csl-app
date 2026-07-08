"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Coins, Plus, MoreHorizontal, Pencil, Ban, Trash2, RefreshCcw, Loader2, Printer, FileSpreadsheet } from "lucide-react"
import { AttachmentInput, ViewAttachmentButton } from "@/components/compras/attachment-input"
import { canPerm } from "@/lib/permissions"
import { fmtMoney, currentMonth, EXPENSE_KIND_LABEL, RECURRING_CATEGORIES } from "@/lib/purchases-client"
import type { Expense, PurchaseInvoice } from "@/lib/purchases-client"
import { printListPdf, exportListExcel } from "@/lib/purchases-export"

export function ComprasPagosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const user = useSessionUser()
  const responsable = user?.nombre || user?.username || "—"
  const can = (p: string) => canPerm(user, p)

  const [items, setItems] = useState<Expense[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [branch, setBranch] = useState("todas")
  const [kind, setKind] = useState("todos")
  const [form, setForm] = useState<Expense | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br] = await Promise.all([
        apiCallCached(endpoint, { action: "getExpenses", month, branch: branch === "todas" ? "" : branch, kind }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseBranches" }),
      ])
      if (res?.ok) setItems((res.records as Expense[]) || [])
      if (br?.ok) setBranches((br.records as string[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally { setLoading(false) }
  }, [apiUrl, month, branch, kind, branches.length, showToast])

  useEffect(() => { void load() }, [load])
  const pag = usePagination(items, { initialPageSize: 50, resetKey: `${month}|${branch}|${kind}` })
  const total = useMemo(() => items.reduce((s, r) => s + (r.amount || 0), 0), [items])

  const doVoid = async (r: Expense) => {
    if (!window.confirm("¿Anular este gasto?")) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "voidExpense", id: r.id })
    if (res?.ok) { showToast("Anulado", "success"); invalidateReadCache("getExpenses"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }
  const doDelete = async (r: Expense) => {
    const reason = window.prompt("Eliminar gasto. Motivo (opcional):", "")
    if (reason === null) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteExpense", id: r.id, reason })
    if (res?.ok) { showToast("Eliminado", "success"); invalidateReadCache("getExpenses"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }

  const exportRows = items.map((r) => ({ fecha: (r.expenseDate || "").slice(0, 10), tipo: EXPENSE_KIND_LABEL[r.kind] || r.kind, categoria: r.category, beneficiario: r.payee, sucursal: r.branch, concepto: r.concept, metodo: r.method, monto: r.amount, estado: r.status }))
  const exportCols = [{ key: "fecha", label: "Fecha" }, { key: "tipo", label: "Tipo" }, { key: "categoria", label: "Categoría" }, { key: "beneficiario", label: "Beneficiario" }, { key: "sucursal", label: "Sucursal" }, { key: "concepto", label: "Concepto" }, { key: "metodo", label: "Método" }, { key: "monto", label: "Monto", money: true }, { key: "estado", label: "Estado" }]
  const exportOpts = () => ({ business, title: "Pagos y gastos", subtitle: `Mes ${month}${branch !== "todas" ? " · " + branch : ""}`, columns: exportCols, rows: exportRows, generadoPor: responsable, origin: window.location.origin })

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Coins className="h-4 w-4 text-[color:var(--brand-primary)]" /> Pagos / gastos <Badge variant="secondary">{items.length}</Badge></div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {can("compras.exportar") && <><Button variant="outline" size="sm" className="h-9" onClick={() => printListPdf(exportOpts())}><Printer className="mr-1.5 h-4 w-4" />PDF</Button><Button variant="outline" size="sm" className="h-9" onClick={() => exportListExcel(exportOpts())}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button></>}
              <Button variant="outline" size="sm" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
              {can("compras.crear") && <Button size="sm" className="h-9" onClick={() => setForm({ id: "", kind: "gasto_operativo", amount: 0, status: "registrado", expenseDate: new Date().toISOString().slice(0, 10) } as Expense)}><Plus className="mr-1.5 h-4 w-4" />Nuevo</Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div><Label className="text-xs">Mes</Label><Input type="month" className="mt-1 h-9" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} /></div>
            <div><Label className="text-xs">Sucursal</Label><Select value={branch} onValueChange={setBranch}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Tipo</Label><Select value={kind} onValueChange={setKind}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="gasto_operativo">Gasto operativo</SelectItem><SelectItem value="servicio">Servicio</SelectItem><SelectItem value="otro">Otro</SelectItem></SelectContent></Select></div>
            <div className="flex items-end"><div className="text-xs"><div className="text-muted-foreground">Total</div><div className="font-semibold">{fmtMoney(total)}</div></div></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
            : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay pagos/gastos.</div>
            : <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Beneficiario</th><th className="px-2 py-2">Concepto</th><th className="px-2 py-2">Sucursal</th><th className="px-2 py-2 text-right">Monto</th><th className="px-4 py-2 text-right">Acciones</th></tr></thead>
              <tbody>{pag.pageItems.map((r) => (<tr key={r.id} className={`border-b last:border-0 ${r.status === "anulado" ? "opacity-50" : ""}`}>
                <td className="px-4 py-2">{(r.expenseDate || "").slice(0, 10)}</td>
                <td className="px-2 py-2 text-xs">{EXPENSE_KIND_LABEL[r.kind] || r.kind}{r.category ? <div className="text-muted-foreground">{r.category}</div> : null}</td>
                <td className="px-2 py-2">{r.payee || "—"}<ViewAttachmentButton path={r.attachmentPath} /></td>
                <td className="px-2 py-2 text-xs">{r.concept || "—"}</td>
                <td className="px-2 py-2 text-xs">{r.branch || "—"}</td>
                <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.amount)}</td>
                <td className="px-4 py-2 text-right">
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {can("compras.editar") && r.status !== "anulado" && <DropdownMenuItem onClick={() => setForm(r)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                      {can("compras.anular") && r.status !== "anulado" && <DropdownMenuItem onClick={() => doVoid(r)}><Ban className="mr-2 h-4 w-4" />Anular</DropdownMenuItem>}
                      {can("compras.eliminar") && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => doDelete(r)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem></>}
                    </DropdownMenuContent></DropdownMenu>
                </td></tr>))}</tbody></table></div>}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="registros" />
        </CardContent>
      </Card>

      {form && <ExpenseForm expense={form} branches={branches} responsable={responsable} onClose={() => setForm(null)} onSaved={() => { setForm(null); invalidateReadCache("getExpenses"); void load() }} />}
    </div>
  )
}

function ExpenseForm({ expense, branches, responsable, onClose, onSaved }: { expense: Expense; branches: string[]; responsable: string; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [f, setF] = useState({
    kind: expense.kind || "gasto_operativo", category: expense.category || "", payee: expense.payee || "", branch: expense.branch || "",
    concept: expense.concept || "", method: expense.method || "", account: expense.account || "", amount: String(expense.amount || 0),
    reference: expense.reference || "", expenseDate: (expense.expenseDate || "").slice(0, 10), notes: expense.notes || "", invoiceId: expense.invoiceId || "",
  })
  const [attachment, setAttachment] = useState<string | null>(expense.attachmentPath || null)
  const [openInvoices, setOpenInvoices] = useState<PurchaseInvoice[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (f.kind === "pago_factura" && !openInvoices.length) {
      void apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseInvoices", status: "pendiente" }).then((r) => { if (r?.ok) setOpenInvoices((r.records as PurchaseInvoice[]) || []) })
    }
  }, [f.kind, apiUrl, openInvoices.length])

  const submit = async () => {
    if (!(Number(f.amount) > 0)) return showToast("El monto debe ser mayor que 0", "error")
    if (f.kind === "pago_factura" && !f.invoiceId) return showToast("Selecciona la factura a pagar", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "saveExpense", id: expense.id || "", ...f, attachmentPath: attachment || "", userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      showToast(f.kind === "pago_factura" ? "Pago registrado" : "Gasto guardado", "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{expense.id ? "Editar" : "Nuevo"} pago / gasto</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Fecha</Label><Input type="date" className="mt-1 h-9" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></div>
          <div><Label className="text-xs">Tipo</Label><Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as Expense["kind"] })} disabled={!!expense.id}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gasto_operativo">Gasto operativo</SelectItem><SelectItem value="servicio">Servicio</SelectItem><SelectItem value="otro">Otro</SelectItem><SelectItem value="pago_factura">Pago de factura</SelectItem></SelectContent></Select></div>
          {f.kind === "pago_factura" && (
            <div className="col-span-2"><Label className="text-xs">Factura a pagar *</Label><Select value={f.invoiceId} onValueChange={(v) => setF({ ...f, invoiceId: v })}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecciona factura" /></SelectTrigger><SelectContent>{openInvoices.map((i) => <SelectItem key={i.id} value={i.id}>{i.supplier} · {i.invoiceNumber || i.id.slice(0, 6)} · bal {fmtMoney(i.balance)}</SelectItem>)}</SelectContent></Select></div>
          )}
          <div><Label className="text-xs">Categoría</Label><Input list="cat-list" className="mt-1 h-9" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="cat-list">{RECURRING_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div><Label className="text-xs">Beneficiario</Label><Input className="mt-1 h-9" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></div>
          <div><Label className="text-xs">Sucursal</Label><Select value={f.branch || "__none__"} onValueChange={(v) => setF({ ...f, branch: v === "__none__" ? "" : v })}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sucursal" /></SelectTrigger><SelectContent><SelectItem value="__none__">Sin sucursal</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Monto *</Label><Input type="number" step="any" inputMode="decimal" className="mt-1 h-10 text-base" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Concepto</Label><Input className="mt-1 h-9" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} /></div>
          <div><Label className="text-xs">Método de pago</Label><Input className="mt-1 h-9" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
          <div><Label className="text-xs">Cuenta/Caja</Label><Input className="mt-1 h-9" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Referencia</Label><Input className="mt-1 h-9" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Comprobante</Label><div className="mt-1"><AttachmentInput kind="gastos" refId={expense.id || "nuevo"} value={attachment} onChange={setAttachment} /></div></div>
          <div className="col-span-2"><Label className="text-xs">Observaciones</Label><Input className="mt-1 h-9" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving || !(Number(f.amount) > 0)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
