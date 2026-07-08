"use client"

import { useCallback, useEffect, useState } from "react"
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  History, RefreshCcw, MoreHorizontal, Eye, Printer, Copy, Pencil, Wrench, Trash2, ScrollText, Loader2,
} from "lucide-react"
import {
  INV_STATUS_BADGE, INV_STATUS_LABEL, INV_AUDIT_ACTION_LABEL, fmtNum,
} from "@/lib/materials-client"
import type { MaterialInventory, MaterialInventoryItem, InventoryAuditLog } from "@/lib/materials-client"
import { printInventarioPdf } from "@/lib/inventario-materiales-pdf"

const todayISO = () => new Date().toISOString().slice(0, 10)

export function ReqMatInventarioHistoricoPage() {
  const { apiUrl, showToast, setActiveTab } = useAppStore()
  const business = useCurrentBusiness()
  const sessionUser = useSessionUser()
  const isManager = Boolean(sessionUser?.isAdmin || sessionUser?.isSuperadmin)
  const responsable = sessionUser?.nombre || sessionUser?.username || "—"

  const [items, setItems] = useState<MaterialInventory[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [branch, setBranch] = useState("todas")
  const [status, setStatus] = useState("todos")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const [detail, setDetail] = useState<MaterialInventory | null>(null)
  const [audit, setAudit] = useState<{ inv: MaterialInventory; logs: InventoryAuditLog[] } | null>(null)
  const [correct, setCorrect] = useState<MaterialInventory | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [res, br] = await Promise.all([
        apiCallCached(endpoint, {
          action: "getInventories",
          status,
          branch: branch === "todas" ? "" : branch,
          desde, hasta,
        }),
        branches.length ? Promise.resolve(null) : apiCallCached(endpoint, { action: "getMaterialBranches" }),
      ])
      if (res?.ok) setItems((res.records as MaterialInventory[]) || [])
      if (br?.ok) setBranches((br.records as string[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, status, branch, desde, hasta, branches.length, showToast])

  useEffect(() => { void load() }, [load])

  const pag = usePagination(items, { initialPageSize: 50, resetKey: `${status}|${branch}|${desde}|${hasta}` })

  const fetchFull = async (id: string): Promise<MaterialInventory | null> => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getInventory", id })
      if (res?.ok) return res.record as MaterialInventory
      showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
    return null
  }

  const openDetail = async (r: MaterialInventory) => {
    const full = await fetchFull(r.id)
    if (full) setDetail(full)
  }

  const doPrint = async (r: MaterialInventory) => {
    const full = await fetchFull(r.id)
    if (!full) return
    printInventarioPdf({
      inventory: full,
      business,
      responsable: full.createdByName || responsable,
      generadoPor: responsable,
      origin: window.location.origin,
    })
  }

  const doEdit = (r: MaterialInventory) => {
    if (r.status !== "borrador") return
    try { sessionStorage.setItem("csl-inv-edit", JSON.stringify({ branch: r.branch, date: (r.inventoryDate || "").slice(0, 10) })) } catch { /* */ }
    setActiveTab("req-mat-inventario")
  }

  const doDuplicate = async (r: MaterialInventory) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "duplicateInventory", id: r.id, inventoryDate: todayISO(), userName: responsable })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo duplicar")
      invalidateReadCache("getInventories")
      showToast("Duplicado como nuevo borrador (hoy)", "success")
      // Abrir el nuevo borrador en la pantalla de captura.
      try { sessionStorage.setItem("csl-inv-edit", JSON.stringify({ branch: r.branch, date: todayISO() })) } catch { /* */ }
      setActiveTab("req-mat-inventario")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al duplicar", "error")
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (r: MaterialInventory) => {
    const reason = window.prompt(`Eliminar inventario de ${r.branch} (${(r.inventoryDate || "").slice(0, 10)})?\nMotivo (opcional):`, "")
    if (reason === null) return // canceló
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deleteInventory", id: r.id, reason })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo eliminar")
      invalidateReadCache("getInventories")
      showToast("Inventario eliminado", "success")
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al eliminar", "error")
    } finally {
      setBusy(false)
    }
  }

  const openAudit = async (r: MaterialInventory) => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getInventoryAuditLogs", id: r.id })
      if (res?.ok) setAudit({ inv: r, logs: (res.records as InventoryAuditLog[]) || [] })
      else showToast((res as { error?: string })?.error || "No se pudo abrir", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  const openCorrect = async (r: MaterialInventory) => {
    const full = await fetchFull(r.id)
    if (full) setCorrect(full)
  }

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-[color:var(--brand-primary)]" /> Histórico de inventarios
            <Badge variant="secondary">{items.length}</Badge>
            <Button variant="outline" size="sm" className="ml-auto h-9" onClick={load}><RefreshCcw className="h-4 w-4" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Sucursal</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="borrador">Borrador</SelectItem>
                  <SelectItem value="finalizado">Finalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Desde</Label>
              <Input type="date" className="mt-1 h-9" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Hasta</Label>
              <Input type="date" className="mt-1 h-9" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Cargando...</div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No hay inventarios registrados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-2 py-2">Sucursal</th>
                    <th className="px-2 py-2 text-right">Materiales</th>
                    <th className="px-2 py-2">Estado</th>
                    <th className="px-2 py-2">Creado por</th>
                    <th className="px-2 py-2">Finalizado por</th>
                    <th className="px-2 py-2">Fecha finalización</th>
                    <th className="px-4 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pag.pageItems.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{(r.inventoryDate || "").slice(0, 10)}</td>
                      <td className="px-2 py-2">{r.branch}</td>
                      <td className="px-2 py-2 text-right">{r.itemsCount ?? 0} <span className="text-[11px] text-muted-foreground">({fmtNum(r.totalQty)})</span></td>
                      <td className="px-2 py-2"><Badge variant="outline" className={INV_STATUS_BADGE[r.status]}>{INV_STATUS_LABEL[r.status]}</Badge></td>
                      <td className="px-2 py-2 text-xs">{r.createdByName || "—"}</td>
                      <td className="px-2 py-2 text-xs">{r.finalizedByName || "—"}</td>
                      <td className="px-2 py-2 text-xs">{r.finalizedAt ? r.finalizedAt.slice(0, 10) : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => openDetail(r)}><Eye className="mr-2 h-4 w-4" />Ver detalle</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => doPrint(r)}><Printer className="mr-2 h-4 w-4" />Imprimir / PDF</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => doDuplicate(r)}><Copy className="mr-2 h-4 w-4" />Duplicar como nuevo conteo</DropdownMenuItem>
                            {r.status === "borrador" && (
                              <DropdownMenuItem onClick={() => doEdit(r)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                            )}
                            {isManager && r.status === "finalizado" && (
                              <DropdownMenuItem onClick={() => openCorrect(r)}><Wrench className="mr-2 h-4 w-4" />Corregir (admin)</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => openAudit(r)}><ScrollText className="mr-2 h-4 w-4" />Ver historial de cambios</DropdownMenuItem>
                            {(r.status === "borrador" || isManager) && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => doDelete(r)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="inventarios" />
        </CardContent>
      </Card>

      {/* Detalle */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail?.branch} · {(detail?.inventoryDate || "").slice(0, 10)}
              {detail ? <Badge variant="outline" className={INV_STATUS_BADGE[detail.status]}>{INV_STATUS_LABEL[detail.status]}</Badge> : null}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="py-1.5">Material</th>
                  <th className="py-1.5">Proveedor</th>
                  <th className="py-1.5">Unidad</th>
                  <th className="py-1.5 text-right">Cantidad</th>
                  <th className="py-1.5">Observación</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.items || []).map((it: MaterialInventoryItem) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="py-1.5 font-medium">{it.materialName}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{it.supplierGroup}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{it.unit}</td>
                    <td className="py-1.5 text-right">{fmtNum(it.quantity)}</td>
                    <td className="py-1.5 text-xs">{it.observation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Historial de cambios */}
      <Dialog open={!!audit} onOpenChange={(o) => !o && setAudit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Historial de cambios</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {(audit?.logs || []).length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Sin cambios registrados.</div>
            ) : (
              (audit?.logs || []).map((l) => (
                <div key={l.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{INV_AUDIT_ACTION_LABEL[l.action] || l.action}</span>
                    <span className="text-muted-foreground">{(l.createdAt || "").replace("T", " ").slice(0, 16)}</span>
                  </div>
                  {l.action === "inventory_item_corrected" && (
                    <div className="mt-1 text-muted-foreground">
                      Cantidad: <b>{fmtNum((l.oldValues as { quantity?: number })?.quantity)}</b> → <b>{fmtNum((l.newValues as { quantity?: number })?.quantity)}</b>
                    </div>
                  )}
                  {l.reason ? <div className="mt-1">Motivo: {l.reason}</div> : null}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Corregir (admin, inventario finalizado) */}
      {correct && (
        <CorrectDialog
          inventory={correct}
          onClose={() => setCorrect(null)}
          onSaved={() => { setCorrect(null); void load() }}
        />
      )}
    </div>
  )
}

// ── Diálogo de corrección de cantidades (admin, con auditoría) ──────────────
function CorrectDialog({ inventory, onClose, onSaved }: { inventory: MaterialInventory; onClose: () => void; onSaved: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [itemId, setItemId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const items = inventory.items || []
  const selected = items.find((i) => i.id === itemId)

  const submit = async () => {
    if (!itemId) return showToast("Selecciona el material a corregir", "error")
    if (!reason.trim()) return showToast("Indica el motivo de la corrección", "error")
    if (quantity.trim() === "" || !Number.isFinite(Number(quantity))) return showToast("Cantidad inválida", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "correctInventoryItem", itemId, quantity, reason,
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo corregir")
      invalidateReadCache("getInventories")
      showToast("Corrección aplicada (auditada)", "success")
      onSaved()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al corregir", "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir inventario finalizado</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {inventory.branch} · {(inventory.inventoryDate || "").slice(0, 10)} — la corrección queda registrada en el historial (usuario, fecha, valor anterior, valor nuevo, motivo).
          </p>
          <div>
            <Label className="text-xs">Material</Label>
            <Select value={itemId} onValueChange={(v) => { setItemId(v); const it = items.find((i) => i.id === v); setQuantity(it?.quantity == null ? "" : String(it.quantity)) }}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecciona material" /></SelectTrigger>
              <SelectContent>
                {items.map((it) => <SelectItem key={it.id} value={it.id}>{it.materialName} ({fmtNum(it.quantity)})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <div className="text-[11px] text-muted-foreground">Cantidad actual: <b>{fmtNum(selected.quantity)}</b> {selected.unit}</div>
          )}
          <div>
            <Label className="text-xs">Nueva cantidad</Label>
            <Input type="number" min={0} step="any" inputMode="decimal" className="mt-1 h-9" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Motivo *</Label>
            <Input className="mt-1 h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo de la corrección" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={saving || !itemId || !reason.trim()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}Aplicar corrección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
