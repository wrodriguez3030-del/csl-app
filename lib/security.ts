"use client"

import type { BusinessSlug, TabId } from "@/lib/types"
import { supabaseBrowser } from "@/lib/supabase-client"
import { ALL_MENU_IDS, MENU_ID_SET, MENU_OPTIONS, type MenuPermission } from "@/lib/menus"

export { MENU_OPTIONS, ALL_MENU_IDS, type MenuPermission }

export interface SystemUser {
  id: string
  nombre: string
  username: string
  password: string
  activo: boolean
  isAdmin: boolean
  menus: MenuPermission[]
  createdAt: string

  // ─── Multi-tenant (opcional) ──────────────────────────────────────────────
  // Estos campos vienen de csl_user_profiles cuando las migraciones SQL ya se
  // aplicaron (ver supabase/migrations/202605220002*). Hasta entonces son
  // undefined y el sistema cae a CSL por default vía useCurrentBusiness().
  /** Slug del negocio del usuario. undefined = pre-migración (asumimos CSL). */
  businessSlug?: BusinessSlug
  /** UUID del negocio en businesses table. undefined = pre-migración. */
  businessId?: string
  /** Si true, ignora filtros multi-tenant (acceso global). undefined = false. */
  isSuperadmin?: boolean
  /** Permisos granulares (csl_user_profiles.permissions), p.ej.
   *  "material_requisitions.delete". Independientes de menus y de
   *  isAdmin/isSuperadmin. undefined = pre-migración 202607020001. */
  permissions?: string[]
}

export const USERS_STORAGE_KEY = "csl_system_users_v1"
export const SESSION_STORAGE_KEY = "csl_system_session_v1"

function nowIso() {
  return new Date().toISOString()
}

function dispatchAuthChanged() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("csl-auth-changed"))
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function normalizeMenus(value: unknown): MenuPermission[] {
  if (!Array.isArray(value)) return []
  return value.filter((menu): menu is MenuPermission => typeof menu === "string" && MENU_ID_SET.has(menu as MenuPermission))
}

function userFromProfile(profile: Record<string, unknown>, fallbackId: string, fallbackEmail: string): SystemUser {
  const isAdmin = Boolean(profile.is_admin ?? profile.isAdmin)
  // Multi-tenant: estos campos solo existen después de la migración
  // 202605220002. Antes de eso, son undefined y el sistema sigue tratando
  // a todos los usuarios como CSL vía useCurrentBusiness() fallback.
  const businessId = profile.business_id ? String(profile.business_id) : undefined
  // El slug viene del join con businesses(slug) en la query del login.
  // Fallback: campo plano business_slug si alguna ruta vieja lo provee.
  const businessRel = profile.businesses as { slug?: unknown } | null | undefined
  const businessSlug =
    (businessRel?.slug ? String(businessRel.slug) : undefined) ??
    (profile.business_slug ? String(profile.business_slug) : undefined)
  const isSuperadmin = Boolean(profile.is_superadmin ?? profile.isSuperadmin)
  return {
    id: String(profile.user_id ?? profile.id ?? fallbackId),
    nombre: String(profile.nombre ?? profile.name ?? fallbackEmail.split("@")[0] ?? "Usuario"),
    username: String(profile.username ?? fallbackEmail),
    password: "",
    activo: profile.activo !== false,
    isAdmin,
    // Admin y Superadmin tienen acceso total. Antes solo se contemplaba isAdmin,
    // de modo que un superadmin con menus=[] quedaba sin menús visibles.
    menus: isAdmin || isSuperadmin ? [...ALL_MENU_IDS] : normalizeMenus(profile.menus),
    createdAt: String(profile.created_at ?? profile.createdAt ?? nowIso()),
    businessId,
    businessSlug: businessSlug === "csl" || businessSlug === "depicenter" ? businessSlug : undefined,
    isSuperadmin,
    permissions: Array.isArray(profile.permissions)
      ? (profile.permissions as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0)
      : [],
  }
}

export function getUsers(): SystemUser[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveUsers(users: SystemUser[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
  dispatchAuthChanged()
}

export function clearLocalSession() {
  if (typeof window === "undefined") return
  localStorage.removeItem(SESSION_STORAGE_KEY)
  dispatchAuthChanged()
}

export function upsertUser(user: SystemUser) {
  const users = getUsers()
  const idx = users.findIndex((u) => u.id === user.id)
  if (idx >= 0) users[idx] = user
  else users.unshift(user)
  saveUsers(users)
}

export function deleteUser(userId: string) {
  const users = getUsers().filter((u) => u.id !== userId && u.username !== "admin")
  saveUsers(users)
}

export async function login(username: string, password: string): Promise<{ ok: boolean; user?: SystemUser; error?: string }> {
  const email = String(username).trim()
  const { data, error } = await withTimeout(
    supabaseBrowser.auth.signInWithPassword({ email, password }),
    "Supabase no respondio al iniciar sesion. Verifica internet, URL y anon key."
  )

  if (error || !data.user) return { ok: false, error: error?.message || "No se pudo iniciar sesion" }

  // Pull profile + joined businesses(slug) so the frontend knows the tenant
  // slug immediately on login. The csl_user_profiles table only stores
  // business_id (uuid); the slug lives in businesses.slug. Without this
  // join, useCurrentBusiness() falls back to CSL for every user (bug).
  const { data: profile } = await withTimeout(
    Promise.resolve(
      supabaseBrowser
      .from("csl_user_profiles")
      .select("*, businesses(slug, name)")
      .eq("user_id", data.user.id)
        .maybeSingle()
    ),
    "Supabase Auth entro, pero no respondio la tabla csl_user_profiles."
  )

  // Fuente única de verdad: csl_user_profiles. Si la fila aún no existe (caso
  // marginal: usuario creado en Supabase Auth sin que el trigger haya corrido),
  // caemos a `user_metadata` como fallback transitorio.
  const metadata = data.user.user_metadata || {}
  const user = userFromProfile(
    (profile as Record<string, unknown> | null) || {
      user_id: data.user.id,
      nombre: metadata.nombre || metadata.name,
      username: metadata.username || data.user.email,
      is_admin: metadata.is_admin,
      activo: metadata.activo ?? true,
      menus: metadata.menus,
      created_at: data.user.created_at,
    },
    data.user.id,
    data.user.email || email
  )

  if (!user.activo) {
    await supabaseBrowser.auth.signOut()
    return { ok: false, error: "Usuario inactivo" }
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user))
    dispatchAuthChanged()
  }

  return { ok: true, user }
}

export function logout() {
  if (typeof window === "undefined") return
  void supabaseBrowser.auth.signOut()
  clearLocalSession()
  // Multi-tenant: limpiar cualquier db persistida del Zustand store en
  // localStorage. Sin esto, el próximo login (otro user, otro business)
  // vería datos del user anterior hasta que se complete el refresh.
  try {
    localStorage.removeItem("csl-maintenance-storage")     // legacy v1
    localStorage.removeItem("csl-maintenance-storage-v2")  // actual v2
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.) — no es bloqueante.
  }
}

export function getSessionUser(): SystemUser | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed || null
  } catch {
    return null
  }
}

/** Lee el perfil canónico (csl_user_profiles + businesses) y arma el SystemUser. */
async function fetchSessionUserFromDb(userId: string, email: string): Promise<SystemUser | null> {
  const { data: profile } = await withTimeout(
    Promise.resolve(
      supabaseBrowser
        .from("csl_user_profiles")
        .select("*, businesses(slug, name)")
        .eq("user_id", userId)
        .maybeSingle()
    ),
    "Supabase no respondio la tabla csl_user_profiles."
  )
  if (!profile) return null
  return userFromProfile(profile as Record<string, unknown>, userId, email)
}

/**
 * Re-sincroniza el usuario en sesión desde csl_user_profiles (fuente única de
 * verdad) usando la sesión de Supabase vigente. Mantiene menús/permisos al día
 * SIN exigir logout+login manual cuando un admin cambia permisos: el sidebar lee
 * el snapshot de localStorage, así que sin esto los permisos quedaban congelados.
 *
 * Devuelve el usuario fresco, o null si no hay sesión de Supabase / perfil / o
 * hubo error transitorio (el caller debe caer al snapshot local en ese caso).
 * Si el usuario quedó inactivo, cierra la sesión. Solo reescribe localStorage y
 * emite `csl-auth-changed` cuando algo cambió (evita loops con los listeners).
 */
export async function refreshSessionUser(): Promise<SystemUser | null> {
  if (typeof window === "undefined") return null
  let sessionUser: { id: string; email?: string } | null = null
  try {
    const { data } = await supabaseBrowser.auth.getSession()
    sessionUser = data?.session?.user ?? null
  } catch {
    return null
  }
  if (!sessionUser) return null

  let fresh: SystemUser | null = null
  try {
    fresh = await fetchSessionUserFromDb(sessionUser.id, sessionUser.email || "")
  } catch {
    return null // error de red/transitorio → el caller usa el snapshot local
  }
  if (!fresh) return null

  if (!fresh.activo) {
    await supabaseBrowser.auth.signOut()
    clearLocalSession()
    return null
  }

  // Solo persistir + notificar cuando el snapshot realmente cambió. En estado
  // estable (prev === next) no se emite evento, evitando un loop con el listener
  // `csl-auth-changed` de app/page.tsx que vuelve a llamar a esta función.
  const prevRaw = localStorage.getItem(SESSION_STORAGE_KEY)
  const nextRaw = JSON.stringify(fresh)
  if (prevRaw !== nextRaw) {
    localStorage.setItem(SESSION_STORAGE_KEY, nextRaw)
    dispatchAuthChanged()
  }
  return fresh
}

export function canAccessMenu(user: SystemUser | null, tab: TabId): boolean {
  if (!user) return false
  // Admin de Usuarios: SOLO superadmin. is_admin normal NO alcanza —
  // es una operación cross-tenant que requiere el rol más alto.
  if (tab === "admin-users") return Boolean(user.isSuperadmin)
  if (user.isAdmin) return true
  // pulse-dashboard y pulse-equipos pertenecen a PulseControl.
  // Fallback pulsos-* para usuarios con acceso genérico a PulseControl.
  // pulse-mantenimiento pertenece a Mantenimiento y se chequea por includes(tab) abajo.
  if (tab === "pulse-dashboard" || tab === "pulse-equipos") {
    if (!Array.isArray(user.menus)) return false
    if (user.menus.includes(tab)) return true
    return user.menus.some((menu) => String(menu).startsWith("pulsos-"))
  }
  return Array.isArray(user.menus) && user.menus.includes(tab)
}

/**
 * Devuelve el primer menú al que el usuario tiene acceso, siguiendo el orden
 * canónico de `MENU_OPTIONS` (que coincide con el orden visible del sidebar).
 *
 * Uso: post-login y al detectar que `activeTab` no está permitido — para
 * evitar la pantalla de "Acceso denegado" cuando el usuario sí tiene otros
 * menús habilitados. Si no encuentra ninguno permitido, devuelve null
 * (significa "este usuario no tiene menús asignados").
 */
export function getFirstAllowedMenu(user: SystemUser | null): TabId | null {
  if (!user) return null
  for (const option of MENU_OPTIONS) {
    if (canAccessMenu(user, option.id)) return option.id
  }
  return null
}
