/**
 * Configuración de correo POR NEGOCIO (multi-tenant), SOLO servidor.
 *
 * Cada negocio (Cibao, Depicenter) tiene su propia cuenta de Gmail desde la que
 * salen los correos cara al cliente (Ficha Dermatológica + Consentimientos). Las
 * credenciales se guardan en `csl_email_settings` con la "contraseña de
 * aplicación" CIFRADA (AES-256-GCM, reusa `bi-finance-crypto`). Este módulo:
 *
 *   - `getEmailSettingsStatus`  → estado seguro para la UI (NUNCA la clave).
 *   - `saveEmailSettings`       → guarda/cifra la app password del negocio.
 *   - `resolveGmailCredentialsForBusiness` → credenciales efectivas para enviar.
 *
 * Aislamiento por tenant NO NEGOCIABLE: el resolver solo devuelve el Gmail del
 * `business_id` pedido; Cibao jamás usa el de Depicenter ni viceversa. Si el
 * negocio no está configurado, devuelve `null` y el envío cae al respaldo Resend.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase"
import { encryptSecret, decryptSecret, last4 } from "@/lib/server/bi-finance-crypto"
import { getBusinessBranding } from "@/lib/business"

interface EmailSettingsRow {
  business_id: string
  gmail_user: string | null
  encrypted_password: string | null
  key_last4: string | null
  from_name: string | null
  active: boolean
  created_at: string | null
  updated_at: string | null
}

/** Lee la fila cruda (incluye ciphertext). Uso interno — nunca se expone tal cual. */
async function readSettingsRow(businessId: string): Promise<EmailSettingsRow | null> {
  if (!businessId) return null
  const { data, error } = await getSupabaseAdmin()
    .from("csl_email_settings")
    .select("business_id, gmail_user, encrypted_password, key_last4, from_name, active, created_at, updated_at")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) return null
  return (data as EmailSettingsRow | null) ?? null
}

/** Nombre visible por defecto del remitente cuando no se guardó `from_name`. */
function defaultFromName(businessSlug?: string | null): string {
  return getBusinessBranding(businessSlug).name || "Cibao Spa Laser"
}

export interface EmailSettingsStatus {
  configured: boolean
  gmailUser: string
  /** `usuario@dominio` enmascarado (`us***@dominio`). Nunca la clave. */
  gmailUserMasked: string
  keyLast4: string
  fromName: string | null
  active: boolean
  updatedAt: string | null
}

/** Estado seguro para la UI — nunca incluye la app password ni el ciphertext. */
export async function getEmailSettingsStatus(
  businessId: string,
  businessSlug?: string | null,
): Promise<EmailSettingsStatus> {
  const row = await readSettingsRow(businessId)
  const configured = !!(row?.active && row.gmail_user && row.encrypted_password)
  return {
    configured,
    gmailUser: row?.gmail_user || "",
    gmailUserMasked: maskUser(row?.gmail_user || ""),
    keyLast4: row?.key_last4 || "",
    fromName: row?.from_name || null,
    active: !!row?.active,
    updatedAt: row?.updated_at ?? null,
  }
}

/**
 * Guarda (cifra) la configuración de correo del negocio. Devuelve estado seguro.
 *
 * Si `appPassword` viene vacío y ya existe una fila, NO cambia la clave: solo
 * actualiza `gmail_user`/`from_name` (permite editar el remitente sin re-pegar la
 * contraseña, igual que el resto de la app).
 */
export async function saveEmailSettings(args: {
  businessId: string
  gmailUser: string
  appPassword: string
  fromName?: string | null
  businessSlug?: string | null
  userId: string
}): Promise<EmailSettingsStatus> {
  const supabase = getSupabaseAdmin()
  const gmailUser = String(args.gmailUser || "").trim()
  // Google muestra la app password en grupos de 4 con espacios; los quitamos.
  const appPassword = String(args.appPassword || "").replace(/\s+/g, "")
  if (!gmailUser) throw new Error("La cuenta de Gmail (remitente) es obligatoria.")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailUser)) throw new Error("La cuenta de Gmail no tiene un formato válido.")

  const existing = await readSettingsRow(args.businessId)
  if (!appPassword && !existing?.encrypted_password) {
    throw new Error("Ingresa la contraseña de aplicación de Gmail.")
  }

  const now = new Date().toISOString()
  const fromName = args.fromName?.trim() || existing?.from_name || defaultFromName(args.businessSlug)
  const row: Record<string, unknown> = {
    business_id: args.businessId,
    gmail_user: gmailUser,
    from_name: fromName,
    active: true,
    updated_by: args.userId,
    updated_at: now,
  }
  // Solo re-cifrar si el usuario pegó una nueva app password.
  if (appPassword) {
    row.encrypted_password = encryptSecret(appPassword)
    row.key_last4 = last4(appPassword)
  }
  if (!existing) {
    row.created_by = args.userId
    row.created_at = now
  }

  const { error } = await supabase
    .from("csl_email_settings")
    .upsert(row, { onConflict: "business_id" })
  if (error) throw new Error(`No se pudo guardar la configuración de correo: ${error.message}`)

  return getEmailSettingsStatus(args.businessId, args.businessSlug)
}

export interface GmailCredentials {
  user: string
  pass: string
  fromName: string
}

/**
 * SOLO servidor: credenciales SMTP efectivas del negocio para enviar.
 * Aislado por tenant. Devuelve `null` si el negocio no está configurado o si el
 * descifrado falla (el envío entonces cae al respaldo Resend).
 */
export async function resolveGmailCredentialsForBusiness(
  businessId: string,
  businessSlug?: string | null,
): Promise<GmailCredentials | null> {
  const row = await readSettingsRow(businessId)
  if (!row?.active || !row.gmail_user || !row.encrypted_password) return null
  const pass = decryptSecret(row.encrypted_password)
  if (!pass) return null
  return {
    user: row.gmail_user,
    pass,
    fromName: row.from_name || defaultFromName(businessSlug),
  }
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
