/**
 * Tipos y helpers de cliente del módulo COMPRAS. Sin imports de servidor.
 * Usado por las pantallas compras-*.
 */

export type InvoiceStatus = "borrador" | "pendiente" | "parcial" | "pagada" | "vencida" | "anulada"
export type ExpenseKind = "gasto_operativo" | "servicio" | "otro" | "pago_factura"
export type PettyStatus = "pendiente" | "aprobado" | "rechazado" | "pagado"
export type Frequency = "semanal" | "quincenal" | "mensual" | "trimestral" | "semestral" | "anual"

export interface PurchaseInvoiceItem {
  id: string
  materialId?: string | null
  materialName?: string | null
  description?: string | null
  quantity: number
  unit?: string | null
  unitCost: number
  itbis: number
  total: number
}

export interface PurchasePayment {
  id: string
  invoiceId?: string
  paymentDate?: string | null
  amount: number
  method?: string | null
  account?: string | null
  reference?: string | null
  attachmentPath?: string | null
  notes?: string | null
  createdByName?: string | null
  createdAt?: string | null
}

export interface PurchaseInvoice {
  id: string
  branch?: string | null
  invoiceNumber?: string | null
  ncf?: string | null
  supplier?: string | null
  supplierRnc?: string | null
  invoiceDate?: string | null
  dueDate?: string | null
  purchaseType?: string | null
  paymentMethod?: string | null
  condition?: string | null
  subtotal: number
  discount: number
  itbis: number
  total: number
  paidAmount: number
  balance: number
  status: InvoiceStatus
  notes?: string | null
  attachmentPath?: string | null
  requisitionId?: string | null
  createdByName?: string | null
  createdAt?: string | null
  itemsCount?: number
  items?: PurchaseInvoiceItem[]
  payments?: PurchasePayment[]
}

export interface Expense {
  id: string
  branch?: string | null
  expenseDate?: string | null
  kind: ExpenseKind
  category?: string | null
  payee?: string | null
  concept?: string | null
  method?: string | null
  account?: string | null
  amount: number
  reference?: string | null
  invoiceId?: string | null
  attachmentPath?: string | null
  notes?: string | null
  status: string
  createdByName?: string | null
  createdAt?: string | null
}

export interface PettyExpense {
  id: string
  branch?: string | null
  expenseDate?: string | null
  responsible?: string | null
  category?: string | null
  concept?: string | null
  amount: number
  method?: string | null
  receiptNumber?: string | null
  attachmentPath?: string | null
  notes?: string | null
  status: PettyStatus
  approvedByName?: string | null
  approvedAt?: string | null
  rejectedAt?: string | null
  rejectReason?: string | null
  paidAt?: string | null
  createdByName?: string | null
  createdAt?: string | null
}

export interface RecurringPayment {
  id: string
  branch?: string | null
  name: string
  payee?: string | null
  category?: string | null
  frequency: Frequency
  amount: number
  nextDate?: string | null
  paymentDay?: number | null
  method?: string | null
  active: boolean
  reminderDays?: number | null
  notes?: string | null
  overdue?: boolean
  createdByName?: string | null
}

export interface RecurringHistoryRow {
  id: string
  paidDate?: string | null
  periodLabel?: string | null
  amount: number
  method?: string | null
  reference?: string | null
  notes?: string | null
  createdByName?: string | null
  createdAt?: string | null
}

export interface PurchaseDashboardKpis {
  totalComprasMes: number
  totalPagadoMes: number
  balancePendiente: number
  facturasVencidas: number
  gastosGeneralesMes: number
  gastosMenoresMes: number
  pettyPendientes: number
  recurrentesProximos: number
  recurrentesVencidos: number
}

// ── Etiquetas + colores de estado ────────────────────────────────────────────
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  borrador: "Borrador", pendiente: "Pendiente", parcial: "Parcial",
  pagada: "Pagada", vencida: "Vencida", anulada: "Anulada",
}
export const INVOICE_STATUS_BADGE: Record<InvoiceStatus, string> = {
  borrador: "bg-slate-100 text-slate-600 border-slate-200",
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  parcial: "bg-blue-100 text-blue-700 border-blue-200",
  pagada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  vencida: "bg-red-100 text-red-700 border-red-200",
  anulada: "bg-slate-200 text-slate-500 border-slate-300 line-through",
}
export const PETTY_STATUS_LABEL: Record<PettyStatus, string> = {
  pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado", pagado: "Pagado",
}
export const PETTY_STATUS_BADGE: Record<PettyStatus, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-blue-100 text-blue-700 border-blue-200",
  rechazado: "bg-red-100 text-red-700 border-red-200",
  pagado: "bg-emerald-100 text-emerald-700 border-emerald-200",
}
export const EXPENSE_KIND_LABEL: Record<string, string> = {
  gasto_operativo: "Gasto operativo", servicio: "Servicio", otro: "Otro", pago_factura: "Pago de factura",
}
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  semanal: "Semanal", quincenal: "Quincenal", mensual: "Mensual",
  trimestral: "Trimestral", semestral: "Semestral", anual: "Anual",
}

// Categorías sugeridas para pagos recurrentes / gastos.
export const RECURRING_CATEGORIES = [
  "Alquiler", "Internet", "Electricidad", "Teléfono", "Software",
  "Seguridad", "Mantenimiento", "Servicios profesionales", "Otros",
]

export function fmtMoney(n: number | null | undefined): string {
  const v = Number(n) || 0
  return v.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Mes actual en formato YYYY-MM (para el filtro por mes por defecto). */
export function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

/** Etiqueta legible del mes YYYY-MM (ej. "julio 2026"). */
export function monthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString("es-DO", { month: "long", year: "numeric" })
}
