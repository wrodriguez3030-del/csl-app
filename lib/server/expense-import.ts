/**
 * Importador del libro de gastos por sucursal (Incentivos › Importador › Gastos).
 *
 * El navegador parsea el .xlsx y manda un payload validado con zod. Aquí:
 *   1. dedup por archivo (file_hash) y por fila (row_hash),
 *   2. cabecera en `expense_imports`, filas en `expenses`, inversiones en
 *      `bi_finance_investments`, retiros en `bi_finance_partner_withdrawals`,
 *      histórico en `sales_history_monthly`,
 *   3. «supersede»: los TOTALES MENSUALES cargados a mano (categoría
 *      «Gastos operativos (histórico)») de cada (sucursal, mes) que ahora llega
 *      en detalle se retiran con soft-delete reversible — si no, BI Finanzas
 *      contaría el gasto dos veces,
 *   4. compensación: si algo falla a mitad se deshace TODO lo de esta importación.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { getBusinessContext, requirePermission, hasPermission, getBranchScope } from "@/lib/server/business-context"
import { textValue } from "@/lib/server/csl-helpers"
import type { ActionParams, ActionUser } from "@/lib/server/csl-types"
import { normalizeSucursal, sucursalAllowedForTenant } from "@/lib/normalize-pulse"
import { monthBounds } from "@/lib/commission/period"
import { expenseImportSchema, type ExpenseImportPayload } from "@/lib/finanzas/expense-import-schema"

type Row = Record<string, unknown>
export const HIST_CATEGORY = "Gastos operativos (histórico)"
const INVEST_CATEGORY = "Inversión mensual"
const IMPORT_TYPE = "EXPENSES"
const CHUNK_READ = 300
const CHUNK_WRITE = 500

const chunk = <T,>(arr: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100
const nowISO = () => new Date().toISOString()

function requireImportPerm(): void {
  if (hasPermission("sales_commission.import.expenses")) return
  requirePermission("sales_commission.import")
}
function requireBizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo")
  return id
}
function branchInScope(raw: string | null | undefined): string | null {
  const canon = normalizeSucursal(String(raw ?? ""))
  if (!canon) return null
  const slug = getBusinessContext()?.businessSlug || "csl"
  if (!sucursalAllowedForTenant(canon, slug)) throw new Error(`Sucursal no pertenece a este negocio: ${raw}`)
  const scope = getBranchScope()
  if (!scope.all && scope.branches.length && !scope.branches.includes(canon)) throw new Error(`No tienes permiso para operar la sucursal ${canon}`)
  return canon
}

async function logAudit(user: ActionUser, entityId: string | null, action: string, oldV: unknown, newV: unknown, reason?: string | null): Promise<void> {
  try {
    await getSupabaseAdmin().from("sales_commission_audit_logs").insert({
      business_id: requireBizId(), entity_type: "expense_import", entity_id: entityId, action,
      old_values: oldV ?? null, new_values: newV ?? null, reason: reason ?? null, user_id: user.id || null,
    })
  } catch { /* la auditoría nunca rompe la operación */ }
}

function mapImport(r: Row) {
  return {
    id: r.id, periodMonth: 0, periodYear: 0, filename: r.filename, fileHash: r.file_hash,
    rowsCount: Number(r.rows_count) || 0, grossTotal: Number(r.gross_total) || 0, status: r.status,
    importType: r.import_type || IMPORT_TYPE, detectedPeriodStart: r.detected_period_start ?? null,
    detectedPeriodEnd: r.detected_period_end ?? null, rawSummary: r.raw_summary ?? null,
    importedBy: r.imported_by ?? null, importedAt: r.imported_at ?? null, committedAt: r.committed_at ?? null, createdAt: r.created_at,
  }
}

async function findActiveImport(business_id: string, fileHash: string): Promise<Row | null> {
  const { data } = await getSupabaseAdmin().from("expense_imports").select("*")
    .eq("business_id", business_id).eq("import_type", IMPORT_TYPE).eq("file_hash", fileHash).neq("status", "anulado").limit(1).maybeSingle()
  return (data as Row | null) || null
}

const periodRanges = (periods: readonly string[]) => periods.map((p) => { const [y, m] = p.split("-").map(Number); return { key: p, ...monthBounds(y, m) } })

async function existingRowHashes(table: string, business_id: string, hashes: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>()
  await Promise.all(chunk(hashes, CHUNK_READ).map(async (part) => {
    const { data } = await getSupabaseAdmin().from(table).select("row_hash").eq("business_id", business_id).is("deleted_at", null).in("row_hash", part)
    for (const r of (data || []) as Row[]) seen.add(String(r.row_hash))
  }))
  return seen
}

async function insertChunks(table: string, rows: readonly Row[]): Promise<void> {
  const results = await Promise.all(chunk(rows, CHUNK_WRITE).map((part) => getSupabaseAdmin().from(table).insert(part)))
  const failed = results.find((r) => r.error)
  if (failed?.error) throw new Error(`Error insertando en ${table}: ${failed.error.message}`)
}

// ── Pre-check ────────────────────────────────────────────────────────────────
export async function checkExpenseImport(params: ActionParams) {
  requireImportPerm()
  const business_id = requireBizId()
  const sb = getSupabaseAdmin()
  const fileHash = textValue(params, "fileHash")
  const periods = textValue(params, "periods").split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s))
  const existing = fileHash ? await findActiveImport(business_id, fileHash) : null
  const ranges = periodRanges(periods)
  const aggregates: Row[] = [], detail: Row[] = [], investments: Row[] = [], withdrawals: Row[] = []
  for (const r of ranges) {
    const { data: hist } = await sb.from("expenses").select("id, branch, amount").eq("business_id", business_id)
      .eq("category", HIST_CATEGORY).is("import_id", null).is("deleted_at", null).gte("expense_date", r.from).lte("expense_date", r.to)
    for (const h of (hist || []) as Row[]) aggregates.push({ id: h.id, branch: h.branch, month: r.key, amount: Number(h.amount) || 0 })
    const { data: det } = await sb.from("expenses").select("branch, amount").eq("business_id", business_id)
      .not("import_id", "is", null).is("deleted_at", null).gte("expense_date", r.from).lte("expense_date", r.to)
    const byBranch = ((det || []) as Row[]).reduce<Record<string, { n: number; total: number }>>((acc, d) => {
      const b = String(d.branch || ""); const prev = acc[b] || { n: 0, total: 0 }
      return { ...acc, [b]: { n: prev.n + 1, total: round2(prev.total + (Number(d.amount) || 0)) } }
    }, {})
    for (const [branch, v] of Object.entries(byBranch)) detail.push({ month: r.key, branch, n: v.n, total: v.total })
    const { data: inv } = await sb.from("bi_finance_investments").select("branch, monto_inversion").eq("business_id", business_id)
      .eq("categoria", INVEST_CATEGORY).is("deleted_at", null).eq("fecha_inicio", r.from)
    for (const i of (inv || []) as Row[]) investments.push({ branch: i.branch ?? null, month: r.key, amount: Number(i.monto_inversion) || 0 })
    const { data: ret } = await sb.from("bi_finance_partner_withdrawals").select("kind, amount").eq("business_id", business_id)
      .is("deleted_at", null).gte("withdrawal_date", r.from).lte("withdrawal_date", r.to)
    for (const w of (ret || []) as Row[]) withdrawals.push({ month: r.key, kind: w.kind, amount: Number(w.amount) || 0 })
  }
  return { ok: true, exists: Boolean(existing), existing: existing ? mapImport(existing) : null, aggregates, detail, investments, withdrawals }
}

// ── Commit ───────────────────────────────────────────────────────────────────
interface CommitCounters { expenses: { inserted: number; duplicated: number }; investments: { inserted: number; duplicated: number; differs: Row[] }; withdrawals: { inserted: number; duplicated: number }; history: { upserted: number }; superseded: string[] }

async function insertExpenses(business_id: string, importId: string, user: ActionUser, p: ExpenseImportPayload): Promise<CommitCounters["expenses"]> {
  const seen = await existingRowHashes("expenses", business_id, p.expenses.map((e) => e.rowHash))
  const fresh = p.expenses.filter((e) => !seen.has(e.rowHash))
  const rows: Row[] = fresh.map((e) => ({
    business_id, import_id: importId, row_hash: e.rowHash, branch: branchInScope(e.branch), expense_date: e.date,
    kind: "gasto_operativo", category: e.category || null, payee: null, concept: e.concept, method: null, account: e.account,
    amount: e.amount, notes: e.notes || null, status: "registrado", created_by: user.id || null, created_by_name: user.email || null,
  }))
  await insertChunks("expenses", rows)
  return { inserted: rows.length, duplicated: p.expenses.length - rows.length }
}

async function insertInvestments(business_id: string, importId: string, user: ActionUser, p: ExpenseImportPayload): Promise<CommitCounters["investments"]> {
  if (!p.investments.length) return { inserted: 0, duplicated: 0, differs: [] }
  const sb = getSupabaseAdmin()
  const dates = [...new Set(p.investments.map((i) => i.fechaInicio))]
  const { data: existing } = await sb.from("bi_finance_investments").select("branch, fecha_inicio, monto_inversion")
    .eq("business_id", business_id).eq("categoria", INVEST_CATEGORY).is("deleted_at", null).in("fecha_inicio", dates)
  const byKey = new Map(((existing || []) as Row[]).map((r) => [`${r.branch || ""}|${String(r.fecha_inicio).slice(0, 10)}`, Number(r.monto_inversion) || 0]))
  const differs: Row[] = []
  const candidates = p.investments.filter((i) => {
    const prev = byKey.get(`${i.branch || ""}|${i.fechaInicio}`)
    if (prev == null) return true
    if (Math.abs(prev - i.amount) > 0.01) differs.push({ branch: i.branch, month: `${i.year}-${String(i.month).padStart(2, "0")}`, existing: prev, file: i.amount })
    return false
  })
  const seen = await existingRowHashes("bi_finance_investments", business_id, candidates.map((i) => i.rowHash))
  const fresh = candidates.filter((i) => !seen.has(i.rowHash))
  await insertChunks("bi_finance_investments", fresh.map((i) => ({
    business_id, import_id: importId, row_hash: i.rowHash, nombre: i.nombre, categoria: INVEST_CATEGORY, branch: branchInScope(i.branch),
    monto_inversion: i.amount, beneficio_estimado: 0, fecha_inicio: i.fechaInicio, estado: "completada",
    notas: `Importado de ${p.import.filename} · hoja consolidado`, created_by: user.id || null,
  })))
  return { inserted: fresh.length, duplicated: p.investments.length - fresh.length, differs }
}

async function insertWithdrawals(business_id: string, importId: string, user: ActionUser, p: ExpenseImportPayload): Promise<CommitCounters["withdrawals"]> {
  if (!p.withdrawals.length) return { inserted: 0, duplicated: 0 }
  const seen = await existingRowHashes("bi_finance_partner_withdrawals", business_id, p.withdrawals.map((w) => w.rowHash))
  const fresh = p.withdrawals.filter((w) => !seen.has(w.rowHash))
  await insertChunks("bi_finance_partner_withdrawals", fresh.map((w) => ({
    business_id, import_id: importId, row_hash: w.rowHash, withdrawal_date: w.date, kind: w.kind, amount: w.amount,
    notes: `Importado de ${p.import.filename} · hoja consolidado`, created_by: user.id || null, created_by_name: user.email || null,
  })))
  return { inserted: fresh.length, duplicated: p.withdrawals.length - fresh.length }
}

async function upsertHistory(business_id: string, importId: string, user: ActionUser, p: ExpenseImportPayload): Promise<CommitCounters["history"]> {
  if (!p.import.includeHistory || !p.history.length) return { upserted: 0 }
  const rows = p.history.map((h) => ({
    business_id, year: h.year, month: h.month, efectivo: h.efectivo, tarjeta: h.tarjeta, total: h.total,
    source: "excel:Historico ventas", import_id: importId, created_by: user.id || null, updated_at: nowISO(),
  }))
  const { error } = await getSupabaseAdmin().from("sales_history_monthly").upsert(rows, { onConflict: "business_id,year,month" })
  if (error) throw new Error(`Error guardando el histórico: ${error.message}`)
  return { upserted: rows.length }
}

/** Retira (soft-delete) los totales mensuales cargados a mano de cada (sucursal, mes) que ahora llega en detalle. */
async function supersedeAggregates(business_id: string, importId: string, user: ActionUser, p: ExpenseImportPayload): Promise<string[]> {
  const sb = getSupabaseAdmin()
  const pairs = [...new Set(p.expenses.map((e) => `${normalizeSucursal(e.branch)}|${e.date.slice(0, 7)}`))]
  const ids: string[] = []
  for (const pair of pairs) {
    const [branch, ym] = pair.split("|"); const [y, m] = ym.split("-").map(Number); const b = monthBounds(y, m)
    const { data } = await sb.from("expenses").select("id").eq("business_id", business_id).eq("category", HIST_CATEGORY)
      .eq("branch", branch).is("import_id", null).is("deleted_at", null).gte("expense_date", b.from).lte("expense_date", b.to)
    for (const r of (data || []) as Row[]) ids.push(String(r.id))
  }
  if (ids.length) {
    const { error } = await sb.from("expenses").update({ deleted_at: nowISO(), deleted_by: user.id || null, deleted_reason: `superseded:expense_import:${importId}` }).in("id", ids)
    if (error) throw new Error(`Error reemplazando totales mensuales: ${error.message}`)
  }
  return ids
}

async function restoreSuperseded(importId: string): Promise<void> {
  await getSupabaseAdmin().from("expenses").update({ deleted_at: null, deleted_by: null, deleted_reason: null })
    .eq("deleted_reason", `superseded:expense_import:${importId}`)
}

async function undoImport(business_id: string, importId: string): Promise<void> {
  const sb = getSupabaseAdmin()
  try {
    await sb.from("expenses").delete().eq("business_id", business_id).eq("import_id", importId)
    await sb.from("bi_finance_investments").delete().eq("business_id", business_id).eq("import_id", importId)
    await sb.from("bi_finance_partner_withdrawals").delete().eq("business_id", business_id).eq("import_id", importId)
    await restoreSuperseded(importId)
    await sb.from("expense_imports").update({ status: "anulado", void_reason: "fallo durante la importación", voided_at: nowISO(), updated_at: nowISO() }).eq("id", importId)
  } catch { /* best-effort */ }
}

export async function commitExpenseImport(params: ActionParams, user: ActionUser) {
  requireImportPerm()
  const business_id = requireBizId()
  let raw: unknown
  try { raw = JSON.parse(textValue(params, "importJson") || "{}") } catch { throw new Error("Payload de importación inválido") }
  const parsed = expenseImportSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`Payload inválido: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`)
  const p = parsed.data
  const dup = await findActiveImport(business_id, p.import.fileHash)
  if (dup) {
    await logAudit(user, String(dup.id), "duplicate_file_blocked", null, { fileHash: p.import.fileHash })
    return { ok: false, duplicate: true, existing: mapImport(dup) }
  }
  for (const e of p.expenses) branchInScope(e.branch) // valida TODO antes de escribir
  const sb = getSupabaseAdmin()
  const { data: header, error: hErr } = await sb.from("expense_imports").insert({
    business_id, import_type: IMPORT_TYPE, filename: p.import.filename, file_hash: p.import.fileHash, status: "importado",
    rows_count: p.import.rowsCount, gross_total: p.import.grossTotal, detected_period_start: p.import.detectedPeriodStart || null,
    detected_period_end: p.import.detectedPeriodEnd || null, raw_summary: p.rawSummary ?? null, imported_by: user.email || user.id || null,
  }).select("*").single()
  if (hErr || !header) throw new Error(hErr?.message || "No se pudo crear la importación")
  const importId = String((header as Row).id)
  await logAudit(user, importId, "expense_import_started", null, { rows: p.expenses.length, fileHash: p.import.fileHash })
  try {
    const expenses = await insertExpenses(business_id, importId, user, p)
    const investments = await insertInvestments(business_id, importId, user, p)
    const withdrawals = await insertWithdrawals(business_id, importId, user, p)
    const history = await upsertHistory(business_id, importId, user, p)
    const superseded = await supersedeAggregates(business_id, importId, user, p)
    const rawSummary = { ...((p.rawSummary as Row) || {}), supersededExpenseIds: superseded, counters: { expenses, investments: { ...investments, differs: undefined }, withdrawals, history } }
    await sb.from("expense_imports").update({ rows_count: expenses.inserted, committed_at: nowISO(), updated_at: nowISO(), raw_summary: rawSummary }).eq("id", importId)
    await logAudit(user, importId, "expense_import_committed", null, { expenses, investments: { inserted: investments.inserted, duplicated: investments.duplicated }, withdrawals, history, superseded: superseded.length })
    return { ok: true, importId, expenses, investments, withdrawals, history, superseded: superseded.length }
  } catch (e) {
    await undoImport(business_id, importId)
    throw e instanceof Error ? e : new Error("La importación falló y se deshizo")
  }
}

// ── Historial y anulación ────────────────────────────────────────────────────
export async function getExpenseImports(_params: ActionParams) {
  requireImportPerm()
  const business_id = requireBizId()
  const { data, error } = await getSupabaseAdmin().from("expense_imports").select("*").eq("business_id", business_id)
    .order("created_at", { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  return { ok: true, records: ((data || []) as Row[]).map(mapImport) }
}

export async function voidExpenseImport(params: ActionParams, user: ActionUser) {
  requirePermission("sales_commission.import")
  const business_id = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta id")
  const sb = getSupabaseAdmin()
  const { data: prev } = await sb.from("expense_imports").select("*").eq("id", id).eq("business_id", business_id).maybeSingle()
  if (!prev) throw new Error("Importación no encontrada")
  if ((prev as Row).status === "anulado") return { ok: true }
  const stamp = { deleted_at: nowISO(), deleted_by: user.id || null, deleted_reason: "import_voided" }
  await sb.from("expenses").update(stamp).eq("business_id", business_id).eq("import_id", id).is("deleted_at", null)
  await sb.from("bi_finance_investments").update({ deleted_at: stamp.deleted_at }).eq("business_id", business_id).eq("import_id", id).is("deleted_at", null)
  await sb.from("bi_finance_partner_withdrawals").update(stamp).eq("business_id", business_id).eq("import_id", id).is("deleted_at", null)
  await restoreSuperseded(id)
  const reason = textValue(params, "reason") || null
  const { error } = await sb.from("expense_imports").update({ status: "anulado", void_reason: reason, voided_at: nowISO(), voided_by: user.id || null, updated_at: nowISO() }).eq("id", id)
  if (error) throw new Error(error.message)
  await logAudit(user, String(id), "expense_import_voided", { status: (prev as Row).status }, { status: "anulado" }, reason)
  return { ok: true }
}
