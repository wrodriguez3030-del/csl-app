/**
 * Tipos y helpers de cliente del módulo Requisición de Materiales.
 * Sin imports de servidor. Usado por las pantallas req-mat-*.
 */

export type ReqStatus =
  | "borrador"
  | "enviada"
  | "en_revision"
  | "aprobada"
  | "rechazada"
  | "comprada"
  | "recibida_parcial"
  | "recibida_completa"

export type ItemStatus =
  | "enviada"
  | "aprobada"
  | "rechazada"
  | "comprada"
  | "recibida_parcial"
  | "recibida_completa"

export interface Material {
  id: string
  name: string
  category?: string | null
  supplierGroup?: string | null
  unit?: string | null
  active: boolean
}

export interface ReqItem {
  id: string
  requisitionId: string
  materialId?: string | null
  materialName: string
  supplierGroup?: string | null
  requestedQty: number | null
  approvedQty: number | null
  purchasedQty: number | null
  receivedQty: number | null
  unit?: string | null
  status: ItemStatus
  note?: string | null
  approvalNote?: string | null
  receptionNote?: string | null
  purchasedSupplier?: string | null
  purchasedCost?: number | null
  // sólo en consolidado
  branch?: string
  requisitionStatus?: string
  requestedAt?: string | null
}

export interface Requisition {
  id: string
  branch: string
  requestedBy?: string | null
  requestedAt?: string | null
  status: ReqStatus
  notes?: string | null
  approvedBy?: string | null
  approvedAt?: string | null
  rejectionReason?: string | null
  purchasedAt?: string | null
  receivedAt?: string | null
  createdAt?: string | null
  itemsCount?: number
  totalQty?: number
  items?: ReqItem[]
}

export const REQ_STATUS_LABEL: Record<ReqStatus, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  en_revision: "En revisión",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  comprada: "Comprada",
  recibida_parcial: "Recibida parcial",
  recibida_completa: "Recibida completa",
}

export const REQ_STATUS_BADGE: Record<ReqStatus, string> = {
  borrador: "bg-slate-100 text-slate-600 border-slate-200",
  enviada: "bg-amber-100 text-amber-700 border-amber-200",
  en_revision: "bg-blue-100 text-blue-700 border-blue-200",
  aprobada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazada: "bg-red-100 text-red-700 border-red-200",
  comprada: "bg-indigo-100 text-indigo-700 border-indigo-200",
  recibida_parcial: "bg-orange-100 text-orange-700 border-orange-200",
  recibida_completa: "bg-emerald-100 text-emerald-700 border-emerald-200",
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  enviada: "Enviada",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  comprada: "Comprada",
  recibida_parcial: "Recibida parcial",
  recibida_completa: "Recibida completa",
}

export const ITEM_STATUS_BADGE: Record<ItemStatus, string> = {
  enviada: "bg-amber-100 text-amber-700 border-amber-200",
  aprobada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazada: "bg-red-100 text-red-700 border-red-200",
  comprada: "bg-indigo-100 text-indigo-700 border-indigo-200",
  recibida_parcial: "bg-orange-100 text-orange-700 border-orange-200",
  recibida_completa: "bg-emerald-100 text-emerald-700 border-emerald-200",
}

// ── Pivot consolidado: (proveedor, material) × sucursal ─────────────────────
export interface ConsolidatedRow {
  supplierGroup: string
  materialName: string
  byBranch: Record<string, number>
  total: number
  approved: number
}

export function buildConsolidated(items: ReqItem[], branches: string[]): ConsolidatedRow[] {
  const map = new Map<string, ConsolidatedRow>()
  for (const it of items) {
    const supplier = it.supplierGroup || "—"
    const material = it.materialName || "—"
    const key = `${supplier}||${material}`
    let row = map.get(key)
    if (!row) {
      row = { supplierGroup: supplier, materialName: material, byBranch: {}, total: 0, approved: 0 }
      branches.forEach((b) => (row!.byBranch[b] = 0))
      map.set(key, row)
    }
    const qty = Number(it.requestedQty) || 0
    const branch = it.branch || "—"
    row.byBranch[branch] = (row.byBranch[branch] || 0) + qty
    row.total += qty
    row.approved += it.status === "rechazada" ? 0 : Number(it.approvedQty ?? it.requestedQty) || 0
  }
  return Array.from(map.values()).sort(
    (a, b) => a.supplierGroup.localeCompare(b.supplierGroup) || a.materialName.localeCompare(b.materialName),
  )
}

export function fmtNum(n: number | null | undefined): string {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}
