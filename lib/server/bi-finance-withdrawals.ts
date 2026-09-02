/**
 * Retiros de socios (dividendos / retiros de cuenta) — handlers del dispatcher.
 *
 * Salida de caja que NO es gasto operativo: vive en su propia tabla para no
 * inflar `expenses` ni la rentabilidad. Entra al flujo de efectivo del BI.
 */
import { z } from "zod"
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { getBusinessContext, requirePermission, requireAnyPermission } from "@/lib/server/business-context"
import { textValue, parsePayload } from "@/lib/server/csl-helpers"
import type { ActionParams, ActionUser } from "@/lib/server/csl-types"
import { logBiAudit } from "@/lib/server/bi-finance-secrets"
import { normalizeSucursal, sucursalAllowedForTenant } from "@/lib/normalize-pulse"

const READ_PERMS = ["bi_finance.view", "sales_commission.view"] as const
const MANAGE_PERM = "sales_commission.finance.manage"
const LIMIT = 500

const withdrawalSchema = z.object({
  id: z.string().uuid().optional(),
  withdrawal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (AAAA-MM-DD)"),
  kind: z.enum(["dividendo", "cuenta"]),
  partner: z.string().trim().max(200).default(""),
  branch: z.string().max(100).nullable().optional(),
  amount: z.number().finite().positive("El monto debe ser mayor que cero"),
  notes: z.string().max(1000).nullable().optional(),
})

function bizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo")
  return id
}

/** Sucursal canónica y permitida para el tenant; vacío = del negocio. */
function branchInScope(raw: string | null | undefined): string | null {
  const canon = normalizeSucursal(String(raw ?? ""))
  if (!canon) return null
  const slug = getBusinessContext()?.businessSlug || "csl"
  if (!sucursalAllowedForTenant(canon, slug)) throw new Error(`Sucursal no válida para este negocio: ${raw}`)
  return canon
}

export async function getPartnerWithdrawals(params: ActionParams) {
  requireAnyPermission(READ_PERMS)
  const business_id = bizId()
  let q = getSupabaseAdmin().from("bi_finance_partner_withdrawals").select("*")
    .eq("business_id", business_id).is("deleted_at", null)
    .order("withdrawal_date", { ascending: false }).limit(LIMIT)
  const from = textValue(params, "from"), to = textValue(params, "to")
  const kind = textValue(params, "kind"), branch = textValue(params, "branch")
  if (from) q = q.gte("withdrawal_date", from)
  if (to) q = q.lte("withdrawal_date", to)
  if (kind) q = q.eq("kind", kind)
  if (branch) q = q.eq("branch", normalizeSucursal(branch))
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return { ok: true, rows: data || [] }
}

export async function savePartnerWithdrawal(params: ActionParams, user: ActionUser) {
  requirePermission(MANAGE_PERM)
  const business_id = bizId()
  const raw = parsePayload(params) as Record<string, unknown>
  const parsed = withdrawalSchema.safeParse({ ...raw, amount: Number(raw.amount) })
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Datos del retiro inválidos")
  const w = parsed.data
  const now = new Date().toISOString()
  const record = {
    business_id, withdrawal_date: w.withdrawal_date, kind: w.kind, partner: w.partner || null,
    branch: branchInScope(w.branch), amount: w.amount, notes: w.notes || null, updated_by: user.id || null, updated_at: now,
  }
  const sb = getSupabaseAdmin()
  if (w.id) {
    const { error } = await sb.from("bi_finance_partner_withdrawals").update(record).eq("id", w.id).eq("business_id", business_id)
    if (error) throw new Error(error.message)
    await logBiAudit("withdrawal_updated", user.id || null, { id: w.id, amount: w.amount, kind: w.kind })
    return { ok: true, id: w.id }
  }
  const { data, error } = await sb.from("bi_finance_partner_withdrawals")
    .insert({ ...record, created_by: user.id || null, created_by_name: user.email || null }).select("id").single()
  if (error) throw new Error(error.message)
  const id = String((data as Record<string, unknown>).id)
  await logBiAudit("withdrawal_created", user.id || null, { id, amount: w.amount, kind: w.kind })
  return { ok: true, id }
}

export async function deletePartnerWithdrawal(params: ActionParams, user: ActionUser) {
  requirePermission(MANAGE_PERM)
  const business_id = bizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el id")
  const { error } = await getSupabaseAdmin().from("bi_finance_partner_withdrawals")
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id || null, deleted_reason: textValue(params, "reason") || null })
    .eq("id", id).eq("business_id", business_id).is("deleted_at", null)
  if (error) throw new Error(error.message)
  await logBiAudit("withdrawal_deleted", user.id || null, { id })
  return { ok: true }
}
