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
import { FileText, Plus, MoreHorizontal, Eye, Pencil, DollarSign, Printer, FileSpreadsheet, Ban, Trash2, RefreshCcw, Loader2, X } from "lucide-react"
import { AttachmentInput, ViewAttachmentButton } from "@/components/compras/attachment-input"
import { canPerm } from "@/lib/permissions"
import { fmtMoney, currentMonth, INVOICE_STATUS_BADGE, INVOICE_STATUS_LABEL } from "@/lib/purchases-client"
import type { PurchaseInvoice, PurchaseInvoiceItem, InvoiceStatus } from "@/lib/purchases-client"
import { printInvoicePdf, printListPdf, exportListExcel } from "@/lib/purchases-export"

type ItemDraft = { materialName: string; description: string; quantity: string; unit: string; unitCost: string; itbis: string }
const emptyItem = (): ItemDraft => ({ materialName: "", description: "", quantity: "1", unit: "unidad", unitCost: "0", itbis: "0" })
const num = (s: string) => Number(s) || 0

export function ComprasFacturasPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const user = useSessionUser()
  const responsable = user?.nombre || user?.username || "—"
  const can = (p: string) => canPerm(user, p)

  const [items, setItems] = useState<PurchaseInvoice[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [branch, setBranch] = useState("todas")
  const [status, setStatus] = useState("todos")

  const [form, setForm] = useState<PurchaseInvoice | null>(null)
  const [detail, setDetail] = useState<PurchaseInvoice | null>(null)
  const [payFor, setPayFor] = useState<PurchaseInvoice | null>(null)
  const [fromReqOpen, setFromReqOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br, sup] = await Promise.all([
        apiCallCached(endpoint, { action: "getPurchaseInvoices", month, branch: branch === "todas" ? "" : branch, status }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseBranches" }),
        suppliers.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getPurchaseSuppliers" }),
      ])
      if (res?.ok) setItems((res.records as PurchaseInvoice[]) || [])
      if (br?.ok) setBranches((br.records as string[]) || [])
      if (sup?.ok) setSuppliers((sup.records as string[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, month, branch, status, branches.length, suppliers.length, showToast])

  useEffect(() => { void load() }, [load])
  const pag = usePagination(items, { initialPageSize: 50, resetKey: `${month}|${branch}|${status}` })

  const totals = useMemo(() => ({
    total: items.reduce((s, r) => s + (r.total || 0), 0),
    pagado: items.reduce((s, r) => s + (r.paidAmount || 0), 0),
    balance: items.reduce((s, r) => s + (r.balance || 0), 0),
  }), [items])

  const openNew = () => setForm({
    id: "", branch: "", supplier: "", condition: "contado", status: "pendiente",
    subtotal: 0, discount: 0, itbis: 0, total: 0, paidAmount: 0, balance: 0,
    invoiceDate: new Date().toISOString().slice(0, 10), items: [],
  } as PurchaseInvoice)

  const openEdit = async (r: PurchaseInvoice) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseInvoice", id: r.id })
    if (res?.ok) setForm(res.record as PurchaseInvoice)
    else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
  }
  const openDetail = async (r: PurchaseInvoice) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseInvoice", id: r.id })
    if (res?.ok) setDetail(res.record as PurchaseInvoice)
    else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
  }
  const doPrint = async (r: PurchaseInvoice) => {
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseInvoice", id: r.id })
    if (res?.ok) printInvoicePdf(res.record as PurchaseInvoice, business, window.location.origin, responsable)
  }
  const doVoid = async (r: PurchaseInvoice) => {
    if (!window.confirm(`¿Anular la factura ${r.invoiceNumber || ""} de ${r.supplier || ""}?`)) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "voidPurchaseInvoice", id: r.id })
    if (res?.ok) { showToast("Factura anulada", "success"); invalidateReadCache("getPurchaseInvoices"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }
  const doDelete = async (r: PurchaseInvoice) => {
    const reason = window.prompt("Eliminar borrador. Motivo (opcional):", "")
    if (reason === null) return
    const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deletePurchaseInvoice", id: r.id, reason })
    if (res?.ok) { showToast("Factura eliminada", "success"); invalidateReadCache("getPurchaseInvoices"); void load() }
    else showToast((res as { error?: string })?.error || "Error", "error")
  }

  const exportRows = items.map((r) => ({
    fecha: (r.invoiceDate || "").slice(0, 10), factura: r.invoiceNumber, ncf: r.ncf, proveedor: r.supplier,
    sucursal: r.branch, estado: INVOICE_STATUS_LABEL[r.status], total: r.total, pagado: r.paidAmount, balance: r.balance,
  }))
  const exportCols = [
    { key: "fecha", label: "Fecha" }, { key: "factura", label: "No. Factura" }, { key: "ncf", label: "NCF" },
    { key: "proveedor", label: "Proveedor" }, { key: "sucursal", label: "Sucursal" }, { key: "estado", label: "Estado" },
    { key: "total", label: "Total", money: true }, { key: "pagado", label: "Pagado", money: true }, { key: "balance", label: "Balance", money: true },
  ]
  const exportOpts = () => ({ business, title: "Facturas de proveedores", subtitle: `Mes ${month}${branch !== "todas" ? " · " + branch : ""}`, filters: `Estado: ${status}`, columns: exportCols, rows: exportRows, generadoPor: responsable, origin: window.location.origin })

  return (
    <div className="space-y-5">
      {/* Filtros + acciones */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4 text-[color:var(--brand-primary)]" /> Facturas de proveedores
              <Badge variant="secondary">{items.length}</Badge>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {can("compras.exportar") && <>
                <Button variant="outline" size="sm" className="h-9" onClick={() => printListPdf(exportOpts())}><Printer className="mr-1.5 h-4 w-4" />PDF</Button>
                <Button variant="outline" size="sm" className="h-9" onClick={() => exportListExcel(exportOpts())}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button>
              </>}
              <Button variant="outline" size="sm" className="h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
              {can("compras.crear") && <Button variant="outline" size="sm" className="h-9" onClick={() => setFromReqOpen(true)}><FileText className="mr-1.5 h-4 w-4" />Desde requisición</Button>}
              {can("compras.crear") && <Button size="sm" className="h-9" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Nueva factura</Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div><Label className="text-xs">Mes</Label><Input type="month" className="mt-1 h-9" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())} /></div>
            <div><Label className="text-xs">Sucursal</Label>
              <Select value={branch} onValueChange={setBranch}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="todas">Todas</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Estado</Label>
              <Select value={status} onValueChange={setStatus}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="todos">Todos</SelectItem>
                  {(["borrador", "pendiente", "parcial", "pagada", "vencida", "anulada"] as InvoiceStatus[]).map((s) => <SelectItem key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex items-end gap-3 text-xs">
              <div><div className="text-muted-foreground">Total</div><div className="font-semibold">{fmtMoney(totals.total)}</div></div>
              <div><div className="text-muted-foreground">Balance</div><div className="font-semibold text-amber-600">{fmtMoney(totals.balance)}</div></div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
            : items.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay facturas.</div>
            : <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2">Fecha</th><th className="px-2 py-2">No. / NCF</th><th className="px-2 py-2">Proveedor</th>
                  <th className="px-2 py-2">Sucursal</th><th className="px-2 py-2 text-right">Total</th><th className="px-2 py-2 text-right">Balance</th>
                  <th className="px-2 py-2">Estado</th><th className="px-4 py-2 text-right">Acciones</th>
                </tr></thead>
                <tbody>{pag.pageItems.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{(r.invoiceDate || "").slice(0, 10)}</td>
                    <td className="px-2 py-2 text-xs">{r.invoiceNumber || "—"}{r.ncf ? <div className="text-muted-foreground">{r.ncf}</div> : null}</td>
                    <td className="px-2 py-2">{r.supplier || "—"}{r.attachmentPath ? <ViewAttachmentButton path={r.attachmentPath} /> : null}</td>
                    <td className="px-2 py-2 text-xs">{r.branch || "—"}</td>
                    <td className="px-2 py-2 text-right">{fmtMoney(r.total)}</td>
                    <td className="px-2 py-2 text-right font-medium">{fmtMoney(r.balance)}</td>
                    <td className="px-2 py-2"><Badge variant="outline" className={INVOICE_STATUS_BADGE[r.status]}>{INVOICE_STATUS_LABEL[r.status]}</Badge></td>
                    <td className="px-4 py-2 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openDetail(r)}><Eye className="mr-2 h-4 w-4" />Ver detalle</DropdownMenuItem>
                          {can("compras.editar") && r.status !== "anulada" && <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>}
                          {can("compras.pagar") && !["pagada", "anulada", "borrador"].includes(r.status) && <DropdownMenuItem onClick={() => setPayFor(r)}><DollarSign className="mr-2 h-4 w-4" />Registrar pago</DropdownMenuItem>}
                          <DropdownMenuItem onClick={() => doPrint(r)}><Printer className="mr-2 h-4 w-4" />Descargar / Imprimir PDF</DropdownMenuItem>
                          {can("compras.anular") && r.status !== "anulada" && r.status !== "borrador" && <DropdownMenuItem onClick={() => doVoid(r)}><Ban className="mr-2 h-4 w-4" />Anular</DropdownMenuItem>}
                          {can("compras.eliminar") && r.status === "borrador" && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => doDelete(r)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Eliminar borrador</DropdownMenuItem></>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="facturas" />
        </CardContent>
      </Card>

      {form && <InvoiceForm invoice={form} branches={branches} suppliers={suppliers} responsable={responsable} onClose={() => setForm(null)} onSaved={() => { setForm(null); invalidateReadCache("getPurchaseInvoices"); void load() }} />}
      {payFor && <PaymentDialog invoice={payFor} responsable={responsable} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); invalidateReadCache("getPurchaseInvoices"); void load() }} />}
      {detail && <InvoiceDetail invoice={detail} onClose={() => setDetail(null)} />}
      {fromReqOpen && <FromRequisitionDialog suppliers={suppliers} responsable={responsable} onClose={() => setFromReqOpen(false)} onCreated={async (id) => { setFromReqOpen(false); invalidateReadCache("getPurchaseInvoices"); const r = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseInvoice", id }); if (r?.ok) setForm(r.record as PurchaseInvoice); void load() }} />}
    </div>
  )
}

// ── Formulario de factura ────────────────────────────────────────────────────
function InvoiceForm({ invoice, branches, suppliers, responsable, onClose, onSaved }: {
  invoice: PurchaseInvoice; branches: string[]; suppliers: string[]; responsable: string; onClose: () => void; onSaved: () => void
}) {
  const { apiUrl, showToast } = useAppStore()
  const [f, setF] = useState({
    invoiceNumber: invoice.invoiceNumber || "", ncf: invoice.ncf || "", supplier: invoice.supplier || "",
    supplierRnc: invoice.supplierRnc || "", invoiceDate: (invoice.invoiceDate || "").slice(0, 10), dueDate: (invoice.dueDate || "").slice(0, 10),
    branch: invoice.branch || "", purchaseType: invoice.purchaseType || "", paymentMethod: invoice.paymentMethod || "",
    condition: invoice.condition || "contado", status: String(invoice.status || "pendiente"), discount: String(invoice.discount || 0),
    notes: invoice.notes || "",
  })
  const [attachment, setAttachment] = useState<string | null>(invoice.attachmentPath || null)
  const [lines, setLines] = useState<ItemDraft[]>(
    (invoice.items && invoice.items.length ? invoice.items.map((it: PurchaseInvoiceItem) => ({
      materialName: it.materialName || "", description: it.description || "", quantity: String(it.quantity || 0),
      unit: it.unit || "unidad", unitCost: String(it.unitCost || 0), itbis: String(it.itbis || 0),
    })) : [emptyItem()]))
  const [saving, setSaving] = useState(false)

  const lineTotal = (l: ItemDraft) => num(l.quantity) * num(l.unitCost) + num(l.itbis)
  const subtotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0)
  const itbis = lines.reduce((s, l) => s + num(l.itbis), 0)
  const total = subtotal - num(f.discount) + itbis

  const setLine = (i: number, patch: Partial<ItemDraft>) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l))

  const submit = async () => {
    if (!f.supplier.trim()) return showToast("Indica el proveedor", "error")
    setSaving(true)
    try {
      const items = lines.filter((l) => l.materialName.trim() || l.description.trim()).map((l) => ({
        materialName: l.materialName, description: l.description, quantity: num(l.quantity), unit: l.unit, unitCost: num(l.unitCost), itbis: num(l.itbis),
      }))
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "savePurchaseInvoice", id: invoice.id || "", ...f, subtotal, itbis, total, attachmentPath: attachment || "",
        userName: responsable, items: JSON.stringify(items),
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error al guardar")
      showToast("Factura guardada", "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{invoice.id ? "Editar factura" : "Nueva factura de proveedor"}</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div><Label className="text-xs">No. Factura</Label><Input className="mt-1 h-9" value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></div>
            <div><Label className="text-xs">NCF</Label><Input className="mt-1 h-9" value={f.ncf} onChange={(e) => setF({ ...f, ncf: e.target.value })} /></div>
            <div><Label className="text-xs">Sucursal</Label>
              <Select value={f.branch || "__none__"} onValueChange={(v) => setF({ ...f, branch: v === "__none__" ? "" : v })}><SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                <SelectContent><SelectItem value="__none__">Sin sucursal</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-xs">Proveedor *</Label><Input list="sup-list" className="mt-1 h-9" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
              <datalist id="sup-list">{suppliers.map((s) => <option key={s} value={s} />)}</datalist></div>
            <div><Label className="text-xs">RNC/Cédula</Label><Input className="mt-1 h-9" value={f.supplierRnc} onChange={(e) => setF({ ...f, supplierRnc: e.target.value })} /></div>
            <div><Label className="text-xs">Tipo de compra</Label><Input className="mt-1 h-9" value={f.purchaseType} onChange={(e) => setF({ ...f, purchaseType: e.target.value })} placeholder="Materiales, servicio..." /></div>
            <div><Label className="text-xs">Fecha factura</Label><Input type="date" className="mt-1 h-9" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} /></div>
            <div><Label className="text-xs">Vencimiento</Label><Input type="date" className="mt-1 h-9" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></div>
            <div><Label className="text-xs">Condición</Label>
              <Select value={f.condition} onValueChange={(v) => setF({ ...f, condition: v })}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contado">Contado</SelectItem><SelectItem value="credito">Crédito</SelectItem></SelectContent></Select></div>
            <div><Label className="text-xs">Forma de pago</Label><Input className="mt-1 h-9" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} placeholder="Efectivo, transf..." /></div>
            <div><Label className="text-xs">Estado</Label>
              <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}><SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="borrador">Borrador</SelectItem><SelectItem value="pendiente">Pendiente</SelectItem></SelectContent></Select></div>
          </div>

          {/* Detalle */}
          <div>
            <div className="mb-1 flex items-center justify-between"><Label className="text-xs">Detalle</Label>
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setLines((ls) => [...ls, emptyItem()])}><Plus className="mr-1 h-3.5 w-3.5" />Línea</Button></div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead><tr className="border-b bg-slate-50 text-left text-muted-foreground">
                  <th className="p-1.5">Material/Descripción</th><th className="w-16 p-1.5">Cant.</th><th className="w-20 p-1.5">Unidad</th><th className="w-24 p-1.5">Costo</th><th className="w-20 p-1.5">ITBIS</th><th className="w-24 p-1.5 text-right">Total</th><th className="w-8"></th>
                </tr></thead>
                <tbody>{lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-1"><Input className="h-8" value={l.description || l.materialName} onChange={(e) => setLine(i, { description: e.target.value, materialName: e.target.value })} placeholder="Descripción" /></td>
                    <td className="p-1"><Input type="number" step="any" inputMode="decimal" className="h-8" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                    <td className="p-1"><Input className="h-8" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                    <td className="p-1"><Input type="number" step="any" inputMode="decimal" className="h-8" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></td>
                    <td className="p-1"><Input type="number" step="any" inputMode="decimal" className="h-8" value={l.itbis} onChange={(e) => setLine(i, { itbis: e.target.value })} /></td>
                    <td className="p-1 text-right font-medium">{fmtMoney(lineTotal(l))}</td>
                    <td className="p-1"><button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><X className="h-3.5 w-3.5 text-muted-foreground" /></button></td>
                  </tr>))}</tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Adjunto (foto o PDF de la factura)</Label>
              <div className="mt-1"><AttachmentInput kind="facturas" refId={invoice.id || "nueva"} value={attachment} onChange={setAttachment} /></div>
              <Label className="mt-2 block text-xs">Observaciones</Label>
              <Input className="mt-1 h-9" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
            <div className="rounded-md border bg-slate-50 p-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><b>{fmtMoney(subtotal)}</b></div>
              <div className="flex items-center justify-between"><span>Descuento</span><Input type="number" step="any" inputMode="decimal" className="h-7 w-28 text-right" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></div>
              <div className="flex justify-between"><span>ITBIS</span><b>{fmtMoney(itbis)}</b></div>
              <div className="mt-1 flex justify-between border-t pt-1 text-base"><span>Total</span><b className="text-[color:var(--brand-primary)]">{fmtMoney(total)}</b></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !f.supplier.trim()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Guardar factura</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Registrar pago ───────────────────────────────────────────────────────────
function PaymentDialog({ invoice, responsable, onClose, onSaved }: { invoice: PurchaseInvoice; responsable: string; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [amount, setAmount] = useState(String(invoice.balance || 0))
  const [method, setMethod] = useState(invoice.paymentMethod || "")
  const [account, setAccount] = useState("")
  const [reference, setReference] = useState("")
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [attachment, setAttachment] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!(Number(amount) > 0)) return showToast("Monto inválido", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "registerInvoicePayment", invoiceId: invoice.id, amount, method, account, reference, paymentDate,
        attachmentPath: attachment || "", userName: responsable,
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      showToast("Pago registrado", "success"); onSaved()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Registrar pago</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 p-2 text-xs text-muted-foreground">{invoice.supplier} · Total {fmtMoney(invoice.total)} · Balance <b className="text-amber-600">{fmtMoney(invoice.balance)}</b></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">Monto *</Label><Input type="number" step="any" inputMode="decimal" className="mt-1 h-10 text-base" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs">Fecha</Label><Input type="date" className="mt-1 h-10" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
            <div><Label className="text-xs">Método</Label><Input className="mt-1 h-9" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Efectivo, transferencia..." /></div>
            <div><Label className="text-xs">Cuenta/Caja</Label><Input className="mt-1 h-9" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Caja chica, Banco..." /></div>
            <div className="col-span-2"><Label className="text-xs">Referencia</Label><Input className="mt-1 h-9" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Comprobante</Label><div className="mt-1"><AttachmentInput kind="pagos" refId={invoice.id} value={attachment} onChange={setAttachment} /></div></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !(Number(amount) > 0)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DollarSign className="mr-2 h-4 w-4" />}Registrar pago</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Detalle de factura ───────────────────────────────────────────────────────
function InvoiceDetail({ invoice, onClose }: { invoice: PurchaseInvoice; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{invoice.supplier} {invoice.invoiceNumber ? `· #${invoice.invoiceNumber}` : ""}
          <Badge variant="outline" className={INVOICE_STATUS_BADGE[invoice.status]}>{INVOICE_STATUS_LABEL[invoice.status]}</Badge>
          <ViewAttachmentButton path={invoice.attachmentPath} /></DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <span>NCF: <b>{invoice.ncf || "—"}</b></span><span>RNC: <b>{invoice.supplierRnc || "—"}</b></span><span>Sucursal: <b>{invoice.branch || "—"}</b></span>
            <span>Fecha: <b>{(invoice.invoiceDate || "").slice(0, 10)}</b></span><span>Vence: <b>{(invoice.dueDate || "").slice(0, 10) || "—"}</b></span><span>Condición: <b>{invoice.condition}</b></span>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-[11px] uppercase text-muted-foreground"><th className="py-1">Descripción</th><th className="py-1 text-right">Cant.</th><th className="py-1 text-right">Costo</th><th className="py-1 text-right">ITBIS</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>{(invoice.items || []).map((it) => (<tr key={it.id} className="border-b last:border-0"><td className="py-1">{it.materialName || it.description}</td><td className="py-1 text-right">{it.quantity}</td><td className="py-1 text-right">{fmtMoney(it.unitCost)}</td><td className="py-1 text-right">{fmtMoney(it.itbis)}</td><td className="py-1 text-right">{fmtMoney(it.total)}</td></tr>))}</tbody>
          </table>
          <div className="ml-auto w-56 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><b>{fmtMoney(invoice.subtotal)}</b></div>
            <div className="flex justify-between"><span>Descuento</span><b>{fmtMoney(invoice.discount)}</b></div>
            <div className="flex justify-between"><span>ITBIS</span><b>{fmtMoney(invoice.itbis)}</b></div>
            <div className="flex justify-between border-t pt-1"><span>Total</span><b>{fmtMoney(invoice.total)}</b></div>
            <div className="flex justify-between"><span>Pagado</span><b className="text-emerald-600">{fmtMoney(invoice.paidAmount)}</b></div>
            <div className="flex justify-between"><span>Balance</span><b className="text-amber-600">{fmtMoney(invoice.balance)}</b></div>
          </div>
          {(invoice.payments && invoice.payments.length) ? (
            <div><div className="mb-1 text-xs font-semibold">Pagos</div>
              <table className="w-full text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-1">Fecha</th><th className="py-1">Método</th><th className="py-1">Ref.</th><th className="py-1 text-right">Monto</th></tr></thead>
                <tbody>{invoice.payments.map((p) => (<tr key={p.id} className="border-b last:border-0"><td className="py-1">{(p.paymentDate || "").slice(0, 10)}</td><td className="py-1">{p.method}</td><td className="py-1">{p.reference}</td><td className="py-1 text-right">{fmtMoney(p.amount)}</td></tr>))}</tbody></table>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Crear factura desde una requisición/consolidado (integración) ────────────
type ReqRow = { id: string; branch?: string; status?: string; requestedAt?: string | null; createdAt?: string | null; itemsCount?: number }
function FromRequisitionDialog({ suppliers, responsable, onClose, onCreated }: { suppliers: string[]; responsable: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [reqs, setReqs] = useState<ReqRow[]>([])
  const [reqId, setReqId] = useState("")
  const [supplier, setSupplier] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void apiJsonp(normalizeApiUrl(apiUrl), { action: "getMyRequisitions", status: "aprobada" }).then((r) => {
      if (r?.ok) setReqs((r.records as ReqRow[]) || [])
    })
  }, [apiUrl])

  const submit = async () => {
    if (!reqId) return showToast("Selecciona una requisición aprobada", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "createInvoiceFromConsolidado", requisitionId: reqId, supplier, userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      showToast("Factura borrador creada desde la requisición", "success")
      onCreated((res.record as PurchaseInvoice).id)
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Crear factura desde requisición</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Reutiliza los materiales aprobados y su proveedor. Genera una factura en borrador (no afecta inventario).</p>
          <div>
            <Label className="text-xs">Requisición aprobada *</Label>
            <Select value={reqId} onValueChange={setReqId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecciona requisición" /></SelectTrigger>
              <SelectContent>{reqs.map((r) => <SelectItem key={r.id} value={r.id}>{r.branch || "—"} · {(r.requestedAt || r.createdAt || "").slice(0, 10)} · {r.itemsCount ?? 0} ítems</SelectItem>)}</SelectContent>
            </Select>
            {reqs.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No hay requisiciones aprobadas.</p> : null}
          </div>
          <div>
            <Label className="text-xs">Proveedor (opcional — filtra los materiales)</Label>
            <Input list="fromreq-sup" className="mt-1 h-9" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Todos los del pedido" />
            <datalist id="fromreq-sup">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !reqId}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Crear borrador</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
