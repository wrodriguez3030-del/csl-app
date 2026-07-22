/**
 * GET /api/settings/email?activeBusinessId=...   → estado del correo del NEGOCIO
 *   ACTIVO (cuenta Gmail + si está configurado). SIN la contraseña.
 * PUT /api/settings/email                          → guarda/cifra la app password.
 *
 * Solo admin/superadmin del negocio activo. La contraseña nunca se devuelve.
 * La UI SIEMPRE manda `activeBusinessId` (evita fuga de tenant en superadmin
 * "Todos"). Cibao y Depicenter usan cuentas separadas.
 */

import { NextResponse } from "next/server"
import { requireAuthenticatedUser } from "@/lib/server/supabase"
import { resolveEffectiveBusinessContext } from "@/lib/server/integration-auth"
import { getEmailSettingsStatus, saveEmailSettings } from "@/lib/server/email-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const runtime = "nodejs"

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

function canConfigure(ctx: { isAdmin: boolean; isSuperadmin: boolean }): boolean {
  return ctx.isAdmin || ctx.isSuperadmin
}

export async function GET(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  const activeBusinessId = new URL(request.url).searchParams.get("activeBusinessId")
  const ctx = await resolveEffectiveBusinessContext(user.id, activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)

  const settings = await getEmailSettingsStatus(ctx.businessId, ctx.businessSlug)
  return json({
    ok: true,
    businessId: ctx.businessId,
    businessSlug: ctx.businessSlug,
    canConfigure: canConfigure(ctx),
    settings,
  })
}

export async function PUT(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }

  let body: { activeBusinessId?: string; gmail_user?: string; app_password?: string; from_name?: string } = {}
  try {
    const raw = await request.text()
    body = raw ? JSON.parse(raw) : {}
  } catch {
    body = {}
  }

  const ctx = await resolveEffectiveBusinessContext(user.id, body.activeBusinessId)
  if (!ctx) return json({ ok: false, error: "Contexto de negocio no encontrado." }, 403)
  if (!canConfigure(ctx)) return json({ ok: false, error: "Solo un administrador puede configurar el correo." }, 403)

  try {
    const settings = await saveEmailSettings({
      businessId: ctx.businessId,
      businessSlug: ctx.businessSlug,
      gmailUser: body.gmail_user || "",
      appPassword: body.app_password || "",
      fromName: body.from_name ?? null,
      userId: user.id,
    })
    return json({ ok: true, message: "Configuración de correo guardada.", settings })
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "No se pudo guardar la configuración de correo." }, 400)
  }
}
