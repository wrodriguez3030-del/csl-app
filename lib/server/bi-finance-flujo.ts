/**
 * Lecturas de INVERSIONES y RETIROS DE SOCIOS para el flujo de efectivo.
 *
 * Inversiones: `bi_finance_investments` con `fecha_inicio` en la ventana. Solo
 * cuentan como salida de caja las `en_curso` y `completada`; las `planificada`
 * y `cancelada` no han salido (o no saldrán) de la caja.
 * Retiros: `bi_finance_partner_withdrawals` no borrados.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { InvestmentRow, WithdrawalRow } from "@/lib/bi-finance/flujo"

type Row = Record<string, unknown>

export const CASH_OUT_ESTADOS = ["en_curso", "completada"] as const

export async function loadInvestments(sb: SupabaseClient, businessId: string, from: string, to: string): Promise<InvestmentRow[]> {
  try {
    const { data } = await sb.from("bi_finance_investments").select("branch, monto_inversion, fecha_inicio, estado")
      .eq("business_id", businessId).is("deleted_at", null)
      .in("estado", [...CASH_OUT_ESTADOS])
      .gte("fecha_inicio", from).lte("fecha_inicio", to)
    return ((data || []) as Row[]).map((r) => ({
      branch: r.branch ? String(r.branch) : null, monto_inversion: Number(r.monto_inversion) || 0, fecha_inicio: String(r.fecha_inicio || ""),
    }))
  } catch { return [] }
}

export async function loadWithdrawals(sb: SupabaseClient, businessId: string, from: string, to: string): Promise<WithdrawalRow[]> {
  try {
    const { data } = await sb.from("bi_finance_partner_withdrawals").select("kind, amount, withdrawal_date, branch")
      .eq("business_id", businessId).is("deleted_at", null)
      .gte("withdrawal_date", from).lte("withdrawal_date", to)
    return ((data || []) as Row[]).map((r) => ({
      kind: String(r.kind || "dividendo"), amount: Number(r.amount) || 0,
      withdrawal_date: String(r.withdrawal_date || ""), branch: r.branch ? String(r.branch) : null,
    }))
  } catch { return [] }
}
