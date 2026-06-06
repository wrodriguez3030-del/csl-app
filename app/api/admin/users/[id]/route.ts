/**
 * /api/admin/users/[id] — operaciones por-usuario (solo superadmin)
 *
 * PATCH  → actualizar nombre, business, role, menus, activo, contraseña
 * DELETE → borrar usuario (auth + profile)
 *
 * Protecciones contra lockout:
 *   - No permite que el último superadmin activo se quite el rol o se desactive
 *   - No permite borrar el último superadmin
 *   - No permite que el caller se borre a sí mismo
 */

import { NextResponse } from "next/server"
import { getSupabaseAdmin, requireAuthenticatedUser } from "@/lib/server/supabase"
import { requireSuperadmin } from "@/lib/server/csl-crud"
import { errorMessage } from "@/lib/server/csl-helpers"
import { ALL_MENU_IDS, MENU_ID_SET, type MenuPermission } from "@/lib/menus"
import { normalizeSucursal } from "@/lib/normalize-pulse"

export const runtime = "nodejs"

function normalizeMenus(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (id): id is MenuPermission => typeof id === "string" && MENU_ID_SET.has(id as MenuPermission),
  )
}

async function resolveBusinessId(slugOrId: string | undefined): Promise<string | null> {
  if (!slugOrId) return null
  const supabase = getSupabaseAdmin()
  const byId = await supabase.from("businesses").select("id").eq("id", slugOrId).maybeSingle()
  if (byId.data?.id) return byId.data.id as string
  const bySlug = await supabase.from("businesses").select("id").eq("slug", slugOrId).maybeSingle()
  return (bySlug.data?.id as string | undefined) ?? null
}

/**
 * Cuenta cuántos otros superadmins activos existen (excluyendo el target).
 * Usado para evitar dejar al sistema sin ningún superadmin activo.
 */
async function otherActiveSuperadminCount(excludeUserId: string): Promise<number> {
  const supabase = getSupabaseAdmin()
  const { count, error } = await supabase
    .from("csl_user_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("is_superadmin", true)
    .eq("activo", true)
    .neq("user_id", excludeUserId)
  if (error) throw error
  return count ?? 0
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — actualizar usuario
// ─────────────────────────────────────────────────────────────────────────────
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAuthenticatedUser(request)
    await requireSuperadmin(caller.id)

    const { id: targetId } = await ctx.params
    if (!targetId) {
      return NextResponse.json({ ok: false, error: "Falta el id del usuario" }, { status: 400 })
    }

    let body: Record<string, unknown> = {}
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Cargar profile target para comparar cambios
    const { data: target, error: loadError } = await supabase
      .from("csl_user_profiles")
      .select("user_id, is_superadmin, activo, business_id")
      .eq("user_id", targetId)
      .maybeSingle()
    if (loadError) throw loadError
    if (!target) {
      return NextResponse.json({ ok: false, error: "Usuario no encontrado" }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    const authUpdates: Record<string, unknown> = {}

    if (typeof body.nombre === "string") {
      const nombre = body.nombre.trim()
      if (!nombre) {
        return NextResponse.json({ ok: false, error: "Nombre vacío" }, { status: 400 })
      }
      updates.nombre = nombre
    }

    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length < 6) {
        return NextResponse.json(
          { ok: false, error: "La contraseña debe tener al menos 6 caracteres" },
          { status: 400 },
        )
      }
      authUpdates.password = body.password
    }

    if (body.businessId !== undefined) {
      const newBusinessId = await resolveBusinessId(String(body.businessId))
      if (!newBusinessId) {
        return NextResponse.json(
          { ok: false, error: "Business inválido" },
          { status: 400 },
        )
      }
      updates.business_id = newBusinessId
    }

    if (typeof body.isAdmin === "boolean") updates.is_admin = body.isAdmin
    if (typeof body.activo === "boolean") updates.activo = body.activo
    if (Array.isArray(body.menus)) updates.menus = normalizeMenus(body.menus)
    if (typeof body.isSuperadmin === "boolean") updates.is_superadmin = body.isSuperadmin

    // Si caller se está auto-modificando para quitarse superadmin o desactivarse,
    // chequear que quede al menos otro superadmin activo.
    if (caller.id === targetId) {
      const wouldLoseSuperadmin =
        updates.is_superadmin === false && target.is_superadmin === true
      const wouldDeactivate = updates.activo === false && target.activo === true
      if (wouldLoseSuperadmin || wouldDeactivate) {
        const others = await otherActiveSuperadminCount(caller.id)
        if (others === 0) {
          return NextResponse.json(
            {
              ok: false,
              error: wouldDeactivate
                ? "No puedes desactivarte: serías el único superadmin activo"
                : "No puedes quitarte el rol de superadmin: serías el único activo",
            },
            { status: 400 },
          )
        }
      }
    }

    // Si es admin o superadmin, asignar TODOS los menús (no respetar lista parcial)
    if (updates.is_admin === true || updates.is_superadmin === true) {
      updates.menus = [...ALL_MENU_IDS]
    }

    // Actualizar profile
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from("csl_user_profiles")
        .update(updates)
        .eq("user_id", targetId)
      if (updateError) throw updateError
    }

    // Actualizar auth (password o metadatos)
    if (Object.keys(authUpdates).length > 0 || updates.nombre || updates.activo !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(targetId, {
        ...authUpdates,
        user_metadata: {
          ...(updates.nombre ? { nombre: updates.nombre } : {}),
          ...(updates.activo !== undefined ? { activo: updates.activo } : {}),
        },
      })
      if (authError) throw authError
    }

    // Sucursales permitidas (si vienen en el payload). Revoca con active=false.
    if (Array.isArray(body.branches)) {
      const bizId = String((updates.business_id as string) || target.business_id || "")
      if (bizId) {
        const branches = Array.from(new Set((body.branches as unknown[]).map((b) => normalizeSucursal(b)).filter(Boolean)))
        try {
          for (const bn of branches) {
            await supabase.from("user_branch_permissions").upsert({ business_id: bizId, user_id: targetId, branch_name: bn, active: true, updated_at: new Date().toISOString() }, { onConflict: "business_id,user_id,branch_name" })
          }
          const { data: ex } = await supabase.from("user_branch_permissions").select("branch_name").eq("business_id", bizId).eq("user_id", targetId).eq("active", true)
          for (const r of ((ex || []) as { branch_name: string }[])) {
            if (!branches.includes(r.branch_name)) await supabase.from("user_branch_permissions").update({ active: false, updated_at: new Date().toISOString() }).eq("business_id", bizId).eq("user_id", targetId).eq("branch_name", r.branch_name)
          }
        } catch { /* tabla no migrada */ }
      }
    }

    return NextResponse.json({ ok: true, user_id: targetId })
  } catch (e) {
    const message = errorMessage(e)
    const status = message.includes("Acceso denegado") || message.includes("superadmin")
      ? 403
      : message.includes("inválido") || message.includes("Falta") || message.includes("no encontrado") || message.includes("vacío")
        ? 400
        : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — borrar usuario (auth + profile)
// ─────────────────────────────────────────────────────────────────────────────
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAuthenticatedUser(request)
    await requireSuperadmin(caller.id)

    const { id: targetId } = await ctx.params
    if (!targetId) {
      return NextResponse.json({ ok: false, error: "Falta el id del usuario" }, { status: 400 })
    }
    if (targetId === caller.id) {
      return NextResponse.json(
        { ok: false, error: "No puedes eliminar tu propia cuenta" },
        { status: 400 },
      )
    }

    const supabase = getSupabaseAdmin()

    // No permitir borrar al último superadmin activo
    const { data: target, error: targetError } = await supabase
      .from("csl_user_profiles")
      .select("user_id, is_superadmin, activo")
      .eq("user_id", targetId)
      .maybeSingle()
    if (targetError) throw targetError

    if (target?.is_superadmin && target?.activo) {
      const others = await otherActiveSuperadminCount(targetId)
      if (others === 0) {
        return NextResponse.json(
          { ok: false, error: "No puedes eliminar al único superadmin activo" },
          { status: 400 },
        )
      }
    }

    // 1. Borrar profile primero (RLS-safe; si falla, no tocamos auth)
    const { error: profileError } = await supabase
      .from("csl_user_profiles")
      .delete()
      .eq("user_id", targetId)
    if (profileError) throw profileError

    // 2. Borrar auth user
    const { error: authError } = await supabase.auth.admin.deleteUser(targetId)
    if (authError) {
      // No re-insertamos el profile borrado — el auth.user huérfano queda como
      // residual aceptable. Reportamos el error pero el profile ya se fue.
      throw new Error(`Profile eliminado pero auth user falló: ${authError.message}`)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = errorMessage(e)
    const status = message.includes("Acceso denegado") || message.includes("superadmin")
      ? 403
      : message.includes("Falta") || message.includes("No puedes")
        ? 400
        : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
