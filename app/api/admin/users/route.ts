/**
 * /api/admin/users — gestión de usuarios cross-tenant (solo superadmin)
 *
 * GET   → lista todos los usuarios con su business + role + menus
 * POST  → crea usuario en Supabase Auth + profile en csl_user_profiles
 *
 * Diferencias vs el `saveUser` heredado en /api/csl:
 *   - Requiere is_superadmin = true (no solo is_admin)
 *   - Acepta business_id (asigna al tenant correspondiente)
 *   - Acepta is_superadmin para el nuevo user (cross-tenant access)
 *   - Validaciones más estrictas (no auto-demote del último superadmin)
 *
 * Seguridad:
 *   - requireAuthenticatedUser valida el JWT del caller
 *   - requireSuperadmin se cierra con error 403 si caller no es superadmin
 *   - Service Role solo se usa server-side (getSupabaseAdmin)
 *   - business_id se valida contra la tabla businesses antes de aceptarlo
 */

import { NextResponse } from "next/server"
import { getSupabaseAdmin, requireAuthenticatedUser } from "@/lib/server/supabase"
import { requireSuperadmin } from "@/lib/server/csl-crud"
import { errorMessage } from "@/lib/server/csl-helpers"
import { ALL_MENU_IDS, MENU_ID_SET, type MenuPermission } from "@/lib/menus"
import { normalizePermissions } from "@/lib/permissions"
import { normalizeSucursal } from "@/lib/normalize-pulse"

/** Persiste las sucursales permitidas del usuario (normalizadas). Revoca con
 *  active=false (sin DELETE). Devuelve la lista normalizada. */
async function persistUserBranches(supabase: ReturnType<typeof getSupabaseAdmin>, businessId: string, userId: string, input: unknown): Promise<string[]> {
  if (!businessId || !userId) return []
  const branches = Array.from(new Set((Array.isArray(input) ? input : []).map((b) => normalizeSucursal(b)).filter(Boolean)))
  try {
    for (const bn of branches) {
      await supabase.from("user_branch_permissions").upsert(
        { business_id: businessId, user_id: userId, branch_name: bn, active: true, updated_at: new Date().toISOString() },
        { onConflict: "business_id,user_id,branch_name" })
    }
    const { data: ex } = await supabase.from("user_branch_permissions").select("branch_name").eq("business_id", businessId).eq("user_id", userId).eq("active", true)
    for (const r of ((ex || []) as { branch_name: string }[])) {
      if (!branches.includes(r.branch_name)) await supabase.from("user_branch_permissions").update({ active: false, updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("user_id", userId).eq("branch_name", r.branch_name)
    }
  } catch { /* tabla aún no migrada */ }
  return branches
}

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
  // Acepta UUID directo o slug ("csl" / "depicenter")
  const byId = await supabase.from("businesses").select("id").eq("id", slugOrId).maybeSingle()
  if (byId.data?.id) return byId.data.id as string
  const bySlug = await supabase.from("businesses").select("id").eq("slug", slugOrId).maybeSingle()
  return (bySlug.data?.id as string | undefined) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — lista usuarios con business + role
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    const caller = await requireAuthenticatedUser(request)
    await requireSuperadmin(caller.id)

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("csl_user_profiles")
      .select(
        "user_id, nombre, username, is_admin, is_superadmin, activo, business_id, menus, permissions, created_at, businesses(slug, name)",
      )
      .order("nombre", { ascending: true })

    if (error) throw error

    const users = (data ?? []) as Record<string, unknown>[]
    try {
      const ids = users.map((u) => String(u.user_id)).filter(Boolean)
      if (ids.length) {
        const { data: bp } = await supabase.from("user_branch_permissions").select("user_id, branch_name").eq("active", true).in("user_id", ids)
        const m = new Map<string, string[]>()
        for (const r of ((bp || []) as { user_id: string; branch_name: string }[])) { if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id)!.push(r.branch_name) }
        for (const u of users) u.branches = m.get(String(u.user_id)) || []
      }
    } catch { /* tabla no migrada */ }
    return NextResponse.json({ ok: true, users })
  } catch (e) {
    const message = errorMessage(e)
    const status = message.includes("Acceso denegado") || message.includes("superadmin") ? 403 : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — crear nuevo usuario (auth + profile)
// ─────────────────────────────────────────────────────────────────────────────
//
// Body esperado:
// {
//   nombre: "Nombre Apellido",
//   email: "user@example.com",
//   password: "temporal123",
//   businessId: "<uuid o slug 'csl'/'depicenter'>",
//   isAdmin: false,         // admin del tenant (todos los menús)
//   isSuperadmin: false,    // cross-tenant
//   activo: true,
//   menus: ["panel", "reportes", ...]   // ignorado si isAdmin || isSuperadmin
// }
export async function POST(request: Request) {
  try {
    const caller = await requireAuthenticatedUser(request)
    await requireSuperadmin(caller.id)

    let body: Record<string, unknown> = {}
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 })
    }

    const nombre = String(body.nombre ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "").trim()
    const businessIdInput = String(body.businessId ?? "").trim()
    const isAdmin = Boolean(body.isAdmin)
    const isSuperadmin = Boolean(body.isSuperadmin)
    const activo = body.activo !== false
    const menusInput = normalizeMenus(body.menus)

    // Validaciones
    if (!nombre) return NextResponse.json({ ok: false, error: "Falta el nombre" }, { status: 400 })
    if (!email) return NextResponse.json({ ok: false, error: "Falta el email" }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Email con formato inválido" }, { status: 400 })
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "La contraseña temporal debe tener al menos 6 caracteres" },
        { status: 400 },
      )
    }

    const businessId = await resolveBusinessId(businessIdInput)
    if (!businessId) {
      return NextResponse.json(
        { ok: false, error: "Business inválido. Usá slug 'csl' o 'depicenter' o el UUID" },
        { status: 400 },
      )
    }

    // Menús efectivos: admin/superadmin tienen todos; usuario normal solo los marcados
    const effectiveMenus = isAdmin || isSuperadmin ? [...ALL_MENU_IDS] : menusInput
    if (!isAdmin && !isSuperadmin && effectiveMenus.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Selecciona al menos un módulo o marca como administrador/superadmin",
        },
        { status: 400 },
      )
    }

    const supabase = getSupabaseAdmin()

    // Prevenir duplicado por email (profile existente con ese username)
    const { data: existingProfile } = await supabase
      .from("csl_user_profiles")
      .select("user_id, username")
      .ilike("username", email)
      .maybeSingle()
    if (existingProfile) {
      return NextResponse.json(
        { ok: false, error: `Ya existe un usuario con el email ${email}` },
        { status: 409 },
      )
    }

    // 1. Crear user en Supabase Auth.
    // Si Supabase falla con "email_exists" significa que en auth.users hay un
    // usuario con ese email PERO sin profile en csl_user_profiles (huérfano
    // de un intento previo fallido). En ese caso, recuperamos: buscamos el
    // user_id existente y le creamos el profile, sin override del password.
    let userId: string | null = null
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre, username: email, is_admin: isAdmin, activo, menus: effectiveMenus },
    })

    if (createError) {
      const msg = (createError.message || "").toLowerCase()
      const isDuplicate = msg.includes("already") || msg.includes("exists") || (createError as { code?: string }).code === "email_exists"

      if (isDuplicate) {
        // Buscar el user_id en auth.users (huérfano) y recuperar
        // listUsers no permite filtrar por email server-side; iteramos hasta encontrar.
        let foundUser: { id: string; email?: string } | undefined
        for (let page = 1; page <= 5 && !foundUser; page += 1) {
          const { data: list, error: listError } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
          if (listError) throw listError
          foundUser = (list.users || []).find((u) => (u.email || "").toLowerCase() === email)
          if (!list.users || list.users.length < 200) break
        }
        if (!foundUser) {
          // Auth user existe pero no lo encontramos — probablemente leaked password rejection
          return NextResponse.json(
            {
              ok: false,
              error: `Supabase rechazó el usuario: ${createError.message}. ${msg.includes("weak") || msg.includes("leaked") ? "La contraseña fue rechazada por seguridad (puede estar en la lista de contraseñas filtradas). Probá con una más fuerte." : ""}`,
            },
            { status: 400 },
          )
        }
        userId = foundUser.id
        // Como recuperamos a un huérfano, NO overrideamos su password.
      } else if (msg.includes("weak") || msg.includes("leaked") || msg.includes("pwned") || msg.includes("compromised")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Contraseña rechazada: aparece en listas de contraseñas filtradas. Usá una más fuerte (mezcla letras, números y símbolos).",
          },
          { status: 400 },
        )
      } else if (msg.includes("password")) {
        return NextResponse.json(
          { ok: false, error: `Contraseña inválida: ${createError.message}` },
          { status: 400 },
        )
      } else if (msg.includes("database error") || msg.includes("constraint") || msg.includes("violates")) {
        // Trigger en auth.users intentando insertar en csl_user_profiles sin
        // business_id — bug clásico tras la migración multi-tenant. Se arregla
        // con `alter table csl_user_profiles alter column business_id set default <csl-uuid>`
        // (SQL ya aplicado el 2026-05-22). Si aparece otra vez, probablemente
        // el default se perdió o hay otro trigger nuevo.
        console.error("[admin/users/POST] Database trigger error during createUser:", createError.message)
        return NextResponse.json(
          {
            ok: false,
            error: "Error de trigger de Supabase al crear el usuario. Falta DEFAULT en csl_user_profiles.business_id — pegá en SQL Editor: alter table public.csl_user_profiles alter column business_id set default (select id from public.businesses where slug='csl');",
          },
          { status: 500 },
        )
      } else {
        // Mantener el mensaje crudo de Supabase pero con prefijo claro
        console.error("[admin/users/POST] Unhandled createUser error:", createError)
        return NextResponse.json(
          { ok: false, error: `Supabase Auth rechazó: ${createError.message}` },
          { status: 500 },
        )
      }
    } else {
      userId = created.user.id
    }

    if (!userId) {
      return NextResponse.json({ ok: false, error: "No se pudo determinar el user_id" }, { status: 500 })
    }

    // 2. Insertar profile con business_id + role
    const profilePayload = {
      user_id: userId,
      nombre,
      username: email,
      is_admin: isAdmin,
      is_superadmin: isSuperadmin,
      activo,
      business_id: businessId,
      menus: effectiveMenus,
      permissions: normalizePermissions(body.permissions),
    }
    const { error: profileError } = await supabase
      .from("csl_user_profiles")
      .upsert(profilePayload, { onConflict: "user_id" })

    if (profileError) {
      // Cleanup: si profile falla, intentar borrar el auth user para no dejar huérfanos
      await supabase.auth.admin.deleteUser(userId).catch(() => undefined)
      throw profileError
    }

    const branches = await persistUserBranches(supabase, businessId, userId, body.branches)
    return NextResponse.json({ ok: true, user: { ...profilePayload, user_id: userId, branches } })
  } catch (e) {
    const message = errorMessage(e)
    const status = message.includes("Acceso denegado") || message.includes("superadmin")
      ? 403
      : message.includes("inválido") || message.includes("Falta") || message.includes("Ya existe")
        ? 400
        : 500
    return NextResponse.json({ ok: false, error: message }, { status })
  }
}
