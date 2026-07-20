/**
 * Credenciales AgendaPro POR NEGOCIO (multi-tenant), SOLO servidor.
 *
 * Cada negocio (Cibao, Depicenter) tiene su propia cuenta de API Pública de
 * AgendaPro. Las credenciales se guardan en `csl_agendapro_credentials` con la
 * clave CIFRADA (AES-256-GCM). Este módulo resuelve la config efectiva para el
 * business activo:
 *
 *   1. Si el negocio tiene credenciales en la tabla → se usan esas.
 *   2. Si NO tiene y su slug coincide con el de las env vars legadas
 *      (AGENDAPRO_ENV_BUSINESS_SLUG, default 'csl') → cae a las env vars.
 *   3. En cualquier otro caso → "no configurado" (NUNCA se usan credenciales de
 *      un tenant para otro; Depicenter jamás usa las de Cibao ni viceversa).
 *
 * NUNCA se devuelve la clave en claro ni el ciphertext al frontend.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase"
import { encryptSecret, decryptSecret, last4 } from "@/lib/server/bi-finance-crypto"
import { getAgendaProConfig, type AgendaProConfig } from "@/lib/server/agendapro"

const PROVIDER = "agendapro"

/** Slug del negocio al que pertenecen las env vars AGENDAPRO_* legadas. */
function envBusinessSlug(): string {
  return String(process.env.AGENDAPRO_ENV_BUSINESS_SLUG || "csl").trim().toLowerCase()
}

interface CredentialRow {
  business_id: string
  api_user: string | null
  encrypted_api_key: string | null
  key_last4: string | null
  base_url: string | null
  clients_path: string | null
  active: boolean
  created_at: string | null
  updated_at: string | null
}

/** Lee la fila cruda (incluye ciphertext). Uso interno — nunca se expone tal cual. */
async function readCredentialRow(businessId: string): Promise<CredentialRow | null> {
  if (!businessId) return null
  const { data, error } = await getSupabaseAdmin()
    .from("csl_agendapro_credentials")
    .select("business_id, api_user, encrypted_api_key, key_last4, base_url, clients_path, active, created_at, updated_at")
    .eq("business_id", businessId)
    .eq("provider", PROVIDER)
    .maybeSingle()
  if (error) return null
  return (data as CredentialRow | null) ?? null
}

export type AgendaProConfigSource = "db" | "env" | "none"

export interface ResolvedAgendaProConfig extends AgendaProConfig {
  source: AgendaProConfigSource
  businessId: string
}

/**
 * Config AgendaPro efectiva para un negocio. Aislada por tenant: solo cae a las
 * env vars cuando el slug del negocio coincide con `AGENDAPRO_ENV_BUSINESS_SLUG`.
 */
export async function resolveAgendaProConfigForBusiness(
  businessId: string,
  businessSlug: string,
): Promise<ResolvedAgendaProConfig> {
  const env = getAgendaProConfig()
  const row = await readCredentialRow(businessId)

  if (row && row.active && row.api_user && row.encrypted_api_key) {
    const password = decryptSecret(row.encrypted_api_key)
    if (password) {
      // baseUrl / clientsPath: propios del negocio si se guardaron; si no, se
      // reutiliza el host común de la API de AgendaPro desde las env vars.
      const baseUrl = String(row.base_url || env.baseUrl || "").trim().replace(/\/$/, "")
      const clientsPath = String(row.clients_path || env.clientsPath || "/api/v1/clients").trim()
      return {
        enabled: Boolean(baseUrl),
        baseUrl,
        user: String(row.api_user).trim(),
        password,
        clientsPath,
        webhookSecret: env.webhookSecret,
        source: "db",
        businessId,
      }
    }
  }

  // Fallback env — SOLO para el negocio dueño de las env vars (CSL por defecto).
  if ((businessSlug || "").trim().toLowerCase() === envBusinessSlug() && env.user && env.password) {
    return { ...env, source: "env", businessId }
  }

  // Sin credenciales para este negocio: nunca se usan las de otro tenant.
  return {
    enabled: false,
    baseUrl: env.baseUrl,
    user: "",
    password: "",
    clientsPath: env.clientsPath,
    webhookSecret: env.webhookSecret,
    source: "none",
    businessId,
  }
}

export interface AgendaProCredentialStatus {
  configured: boolean
  source: AgendaProConfigSource
  apiUserMasked: string
  keyLast4: string
  baseUrlSet: boolean
  active: boolean
  updatedAt: string | null
  createdAt: string | null
}

/** Estado seguro para la UI — nunca incluye la clave ni el ciphertext. */
export async function getAgendaProCredentialStatus(
  businessId: string,
  businessSlug: string,
): Promise<AgendaProCredentialStatus> {
  const row = await readCredentialRow(businessId)
  if (row && row.api_user && row.encrypted_api_key) {
    return {
      configured: Boolean(row.active),
      source: "db",
      apiUserMasked: maskUser(row.api_user),
      keyLast4: row.key_last4 || "****",
      baseUrlSet: Boolean(row.base_url || getAgendaProConfig().baseUrl),
      active: Boolean(row.active),
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    }
  }
  // ¿Cae a env? (solo el negocio dueño)
  const env = getAgendaProConfig()
  if ((businessSlug || "").trim().toLowerCase() === envBusinessSlug() && env.user && env.password) {
    return {
      configured: env.enabled,
      source: "env",
      apiUserMasked: maskUser(env.user),
      keyLast4: last4(env.password),
      baseUrlSet: Boolean(env.baseUrl),
      active: true,
      updatedAt: null,
      createdAt: null,
    }
  }
  return { configured: false, source: "none", apiUserMasked: "", keyLast4: "", baseUrlSet: false, active: false, updatedAt: null, createdAt: null }
}

/** Guarda (cifra) las credenciales del negocio. Devuelve estado seguro. */
export async function saveAgendaProCredentials(args: {
  businessId: string
  apiUser: string
  apiKey: string
  baseUrl?: string | null
  clientsPath?: string | null
  userId: string
}): Promise<AgendaProCredentialStatus> {
  const supabase = getSupabaseAdmin()
  const apiUser = String(args.apiUser || "").trim()
  const apiKey = String(args.apiKey || "").trim()
  if (!apiUser) throw new Error("El usuario de la API Pública es obligatorio.")
  if (!apiKey) throw new Error("La clave de la API Pública es obligatoria.")

  const existing = await readCredentialRow(args.businessId)
  const now = new Date().toISOString()
  const row: Record<string, unknown> = {
    business_id: args.businessId,
    provider: PROVIDER,
    api_user: apiUser,
    encrypted_api_key: encryptSecret(apiKey),
    key_last4: last4(apiKey),
    base_url: args.baseUrl ? String(args.baseUrl).trim() : null,
    clients_path: args.clientsPath ? String(args.clientsPath).trim() : null,
    active: true,
    updated_by: args.userId,
    updated_at: now,
  }
  if (!existing) {
    row.created_by = args.userId
    row.created_at = now
  }

  const { error } = await supabase
    .from("csl_agendapro_credentials")
    .upsert(row, { onConflict: "business_id,provider" })
  if (error) throw new Error(`No se pudieron guardar las credenciales: ${error.message}`)

  return getAgendaProCredentialStatus(args.businessId, "")
}

/** `usuario@dominio` → `us***@dominio`; nombres cortos → `us***`. */
function maskUser(user: string): string {
  const u = String(user || "").trim()
  if (!u) return ""
  const at = u.indexOf("@")
  if (at > 0) {
    const local = u.slice(0, at)
    const dom = u.slice(at)
    return `${local.slice(0, Math.min(2, local.length))}***${dom}`
  }
  return `${u.slice(0, Math.min(3, u.length))}***`
}
