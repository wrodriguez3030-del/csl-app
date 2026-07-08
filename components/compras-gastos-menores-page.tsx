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
import { Wallet, Plus, MoreHorizontal, Pencil, Check, XCircle, BadgeDollarSign, Trash2, RefreshCcw, Loader2, Printer, FileSpreadsheet } from "lucide-react"
import { AttachmentInput, ViewAttachmentButton } from "@/components/compras/attachment-input"
import { canPerm } from "@/lib/permissions"
import { fmtMoney, currentMonth, PETTY_STATUS_BADGE, PETTY_STATUS_LABEL, RECURRING_CATEGORIES } from "@/lib/purchases-client"
import type { PettyExpense, PettyStatus } from "@/lib/purchases-client"
import { printListPdf, exportListExcel } from "@/lib/purchases-export"

export function ComprasGastosMenoresPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const user = useSessionUser()
  const responsable = user?.nombre || user?.username || "—"
  const can = (p: string) => canPerm(user, p)

  const [items, setItems] = useState<PettyExpense[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [branch, setBranch] = useState("todas")
  const [status, setStatus] = useState("todos")
  const [form, setForm] = useState<PettyExpense | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br] = await Promise.all([
        apiCallCached(endpoint, { action: "getPettyExpenses", month, branch: branch === "todas" ? "" : branch, status }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseBranches" }),
      ])
      if (res?.ok) setItems((res.records as PettyExpense[]) || [])
      if (br?.ok) setBranches((br.records as string[]) || [])
    } catch (e) { showToast(e instanceof Error ? e.message : "Error al cargar", "error") } finally { setLoading(false) }
  }, [apiUrl, month, branch, status, branches.length, showToast])

  useEffect(() => { void load() }, [load])
  const pag = usePagination(items, { initialPageSize: 50, resetKey: `${month}|${branch}|${status}` })
  const total = useMemo(() => items.reduce((s, r) => s + (r.amount || 0), 0), [items])

  const setStatusAction = async (r: PettyExpense, newStatus: PettyStatus, reason?: string) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "setPettyStatus", id: r.id, status: newStatus, reason: reason || "", userName: responsable })
    if (res?.ok) { showToast(`Marcado ${PETTY_STATUS_LABEL[newStatus].toLowerCase()}`, "success"); invalidateReadCache("getPettyExpenses"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }
  const doReject = (r: PettyExpense) => { const reason = window.prompt("Motivo del rechazo:", ""); if (reason) void setStatusAction(r, "rechazado", reason) }
  const doDelete = async (r: PettyExpense) => {
    const reason = window.prompt("Eliminar gasto menor. Motivo (opcional):", ""); if (reason === null) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deletePettyExpense", id: r.id, reason })
    if (res?.ok) { showToast("Eliminado", "success"); invalidateReadCache("getPettyExpenses"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }

  const exportRows = items.map((r) => ({ fecha: (r.expenseDate || "").slice(0, 10), responsable: r.responsible, categoria: r.category, concepto: r.concept, sucursal: r.branch, monto: r.amount, estado: PETTY_STATUS_LABEL[r.status], comprobante: r.receiptNumber }))
  const exportCols = [{ key: "fecha", label: "Fecha" }, { key: "responsable", label: "Responsable" }, { key: "categoria", label: "Categoría" }, { key: "concepto", label: "Concepto" }, { key: "sucursal", label: "Sucursal" }, { key: "comprobante", label: "Comprobante" }, { key: "monto", label: "Monto", money: true }, { key: "estado", label: "Estado" }]
  const exportOpts = () => ({ business, title: "Gastos menores", subtitle: `Mes ${month}${branch !== "todas" ? " · " + branch : ""}`, columns: exportCols, rows: exportRows, generadoPor: responsable, origin: window.location.origin })

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Wallet className="h-4 w-4 text-[color:var(--brand-primary)]" /> Gastos menores <Badge variant="secondary">{items.length}</Badge></div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {can("compras.exportar") && <><Button variant="outline" size="sm" className="h-9" onClick={() => printListPdf(exportOpts())}><Printer className="mr-1.5 h-4 w-4" />PDF</Button><Button variant="outline" size="sm" className="h-9" onClick={() => exportListExcel(exportOpts())}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button></>}
              <Button variant="outline" size="sm" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
              {can("compras.crear") && <Button size="sm" className="h-9" onClick={() => setForm({ id: "", amount: 0, status: "pendiente", expenseDate: new Date().toISOString().slice(0, 10), responsible: responsable } as PettyExpense)}><Plus className="mr-1.5 h-4 w-4" />Nuevo</Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div><Label className="text-xs">Mes</Label><Input type="month" className="mt-1 h-9" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} /></div>
            <div><Label className="text-xs">Sucursal</Label><Select value={branch} onValueChange={setBranch}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Estado</Label><Select value={status} onValueChange={setStatus}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos</SelectItem>{(["pendiente", "aprobado", "rechazado", "pagado"] as PettyStatus[]).map((s) => <SelectItem key={s} value={s}>{PETTY_STATUS_LABEL[s]}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-end"><div className="text-xs"><div className="text-muted-foreground">Total</div><div className="font-semibold">{fmtMoney(total)}</div></div></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
            : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay gastos menores.</div>
            : <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Responsable</th><th className="px-2 py-2">Concepto</th><th className="px-2 py-2">Sucursal</th><th className="px-2 py-2 text-right">Monto</th><th className="px-2 py-2">Estado</th><th className="px-4 py-2 text-right">Acciones</th></tr></thead>
              <tbody>{pag.pageItems.map((r) => (<tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-2">{(r.expenseDate || "").slice(0, 10)}</td>
                <td className="px-2 py-2 text-xs">{r.responsible || "—"}</td>
                <td className="px-2 py-2">{r.concept || "—"}{r.category ? <div className="text-xs text-muted-foreground">{r.category}</div> : null}<ViewAttachmentButton path={r.attachmentPath} /></td>
                <td className="px-2 py-2 text-xs">{r.branch || "—"}</td>
                <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.amount)}</td>
                <td className="px-2 py-2"><Badge variant="outline" className={PETTY_STATUS_BADGE[r.status]}>{PETTY_STATUS_LABEL[r.status]}</Badge></td>
                <td className="px-4 py-2 text-right">
                  <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {can("compras.editar") && r.status === "pendiente" && <DropdownMenuItem onClick={() => setForm(r)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                      {can("compras.aprobar") && r.status === "pendiente" && <DropdownMenuItem onClick={() => setStatusAction(r, "aprobado")}><Check className="mr-2 h-4 w-4" />Aprobar</DropdownMenuItem>}
                      {can("compras.aprobar") && r.status === "pendiente" && <DropdownMenuItem onClick={() => doReject(r)}><XCircle className="mr-2 h-4 w-4" />Rechazar</DropdownMenuItem>}
                      {can("compras.pagar") && r.status === "aprobado" && <DropdownMenuItem onClick={() => setStatusAction(r, "pagado")}><BadgeDollarSign className="mr-2 h-4 w-4" />Marcar pagado</DropdownMenuItem>}
                      {can("compras.eliminar") && r.status === "pendiente" && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => doDelete(r)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem></>}
                    </DropdownMenuContent></DropdownMenu>
                </td></tr>))}</tbody></table></div>}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="gastos" />
        </CardContent>
      </Card>

      {form && <PettyForm petty={form} branches={branches} responsable={responsable} onClose={() => setForm(null)} onSaved={() => { setForm(null); invalidateReadCache("getPettyExpenses"); void load() }} />}
    </div>
  )
}

function PettyForm({ petty, branches, responsable, onClose, onSaved }: { petty: PettyExpense; branches: string[]; responsable: string; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [f, setF] = useState({
    expenseDate: (petty.expenseDate || "").slice(0, 10), branch: petty.branch || "", responsible: petty.responsible || responsable,
    category: petty.category || "", concept: petty.concept || "", amount: String(petty.amount || 0), method: petty.method || "",
    receiptNumber: petty.receiptNumber || "", notes: petty.notes || "",
  })
  const [attachment, setAttachment] = useState<string | null>(petty.attachmentPath || null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!(Number(f.amount) > 0)) return showToast("El monto debe ser mayor que 0", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "savePettyExpense", id: petty.id || "", ...f, attachmentPath: attachment || "", userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      showToast("Gasto menor guardado", "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{petty.id ? "Editar" : "Nuevo"} gasto menor</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">Fecha</Label><Input type="date" className="mt-1 h-9" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></div>
          <div><Label className="text-xs">Sucursal</Label><Select value={f.branch || "__none__"} onValueChange={(v) => setF({ ...f, branch: v === "__none__" ? "" : v })}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sucursal" /></SelectTrigger><SelectContent><SelectItem value="__none__">Sin sucursal</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
          <div><Label className="text-xs">Responsable</Label><Input className="mt-1 h-9" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></div>
          <div><Label className="text-xs">Categoría</Label><Input list="pcat-list" className="mt-1 h-9" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="pcat-list">{RECURRING_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="col-span-2"><Label className="text-xs">Concepto</Label><Input className="mt-1 h-9" value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} /></div>
          <div><Label className="text-xs">Monto *</Label><Input type="number" step="any" inputMode="decimal" className="mt-1 h-10 text-base" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><Label className="text-xs">Método de pago</Label><Input className="mt-1 h-9" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></div>
          <div><Label className="text-xs">No. comprobante</Label><Input className="mt-1 h-9" value={f.receiptNumber} onChange={(e) => setF({ ...f, receiptNumber: e.target.value })} /></div>
          <div><Label className="text-xs">Observación</Label><Input className="mt-1 h-9" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs">Foto/archivo del comprobante</Label><div className="mt-1"><AttachmentInput kind="menores" refId={petty.id || "nuevo"} value={attachment} onChange={setAttachment} /></div></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button><Button onClick={submit} disabled={saving || !(Number(f.amount) > 0)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Guardar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
