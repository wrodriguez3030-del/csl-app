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
  const businessSlug = profile.business_slug
    ? String(profile.business_slug)
    : undefined
  const isSuperadmin = Boolean(profile.is_superadmin ?? profile.isSuperadmin)
  return {
    id: String(profile.user_id ?? profile.id ?? fallbackId),
    nombre: String(profile.nombre ?? profile.name ?? fallbackEmail.split("@")[0] ?? "Usuario"),
    username: String(profile.username ?? fallbackEmail),
    password: "",
    activo: profile.activo !== false,
    isAdmin,
    menus: isAdmin ? [...ALL_MENU_IDS] : normalizeMenus(profile.menus),
    createdAt: String(profile.created_at ?? profile.createdAt ?? nowIso()),
    businessId,
    businessSlug: businessSlug === "csl" || businessSlug === "depicenter" ? businessSlug : undefined,
    isSuperadmin,
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

  const { data: profile } = await withTimeout(
    Promise.resolve(
      supabaseBrowser
      .from("csl_user_profiles")
      .select("*")
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

export function canAccessMenu(user: SystemUser | null, tab: TabId): boolean {
  if (!user) return false
  if (user.isAdmin) return true
  if (tab === "pulse-dashboard" || tab === "pulse-equipos" || tab === "pulse-mantenimiento") {
    return Array.isArray(user.menus) && user.menus.some((menu) => String(menu).startsWith("pulsos-"))
  }
  return Array.isArray(user.menus) && user.menus.includes(tab)
}
