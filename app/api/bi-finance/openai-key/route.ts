/**
 * BI FINANCIERO IA — Gestión segura de la API key de OpenAI.
 *
 * El admin/superadmin autorizado pega la key aquí (campo password). Viaja por
 * HTTPS, el backend valida permiso y la guarda CIFRADA (AES-256-GCM) en
 * `bi_finance_ai_secrets`. NUNCA se registra en logs, ni se devuelve al cliente,
 * ni se guarda en frontend. Solo se devuelve el estado + últimos 4 (sk-****abcd).
 *
 * Permiso: superadmin, o admin/usuario con `bi_finance.ai_secrets.manage` o
 * `bi_finance.config` (admin/superadmin bypassan permisos por diseño).
 */
import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"
import { applyActiveBusiness, runWithBusinessContext, hasPermission, getBusinessContext } from "@/lib/server/business-context"
import { saveOpenAiKey, deleteOpenAiKey, getKeyStatus } from "@/lib/server/bi-finance-secrets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s })

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const activeBusinessId = typeof body.activeBusinessId === "string" ? body.activeBusinessId : undefined
    const ctx = applyActiveBusiness(await loadBusinessContext(user.id), activeBusinessId)
    if (!ctx) return json({ ok: false, error: "No se pudo cargar el contexto de negocio" }, 403)

    return await runWithBusinessContext(ctx, async () => {
      if (!(hasPermission("bi_finance.ai_secrets.manage") || hasPermission("bi_finance.config"))) {
        return json({ ok: false, error: "No tienes permiso para gestionar la API key. Contacte al administrador." }, 403)
      }
      const business_id = getBusinessContext()!.businessId
      const action = String(body.action || "status")

      if (action === "save") {
        // NUNCA registrar el valor de body.apiKey en logs.
        const status = await saveOpenAiKey(String(body.apiKey || ""), user.id)
        return json({ ok: true, ...status })
      }
      if (action === "delete") {
        const status = await deleteOpenAiKey(user.id)
        return json({ ok: true, ...status })
      }
      // status
      return json({ ok: true, ...(await getKeyStatus(business_id)) })
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Error desconocido"
    const status = msg === "Sesion invalida" || msg === "No autenticado" ? 401 : msg.startsWith("No tienes permiso") ? 403 : 400
    return json({ ok: false, error: msg }, status)
  }
}
