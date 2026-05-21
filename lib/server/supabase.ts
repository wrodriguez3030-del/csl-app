/**
 * Cliente administrador de Supabase y verificación de sesión.
 *
 * Server-only.  No importar desde código que corra en el cliente: el
 * `SUPABASE_SERVICE_ROLE_KEY` jamás puede llegar al navegador.
 */

import { createClient } from "@supabase/supabase-js"

const URL_ENV = "NEXT_PUBLIC_SUPABASE_URL"
const ANON_ENV = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
const SERVICE_ENV = "SUPABASE_SERVICE_ROLE_KEY"

/** Cliente admin (bypassa RLS) — sólo para uso server-side. */
export function getSupabaseAdmin() {
  const url = (process.env[URL_ENV] || "").trim()
  const serviceKey = (process.env[SERVICE_ENV] || "").trim()
  if (!url || !serviceKey) {
    throw new Error(`Faltan ${URL_ENV} o ${SERVICE_ENV}`)
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Verifica el `Authorization: Bearer <token>` del request contra Supabase Auth.
 * Devuelve el usuario o lanza con un mensaje claro.
 */
export async function requireAuthenticatedUser(request: Request) {
  const url = (process.env[URL_ENV] || "").trim()
  const anonKey = (process.env[ANON_ENV] || "").trim()
  const authHeader = request.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""

  if (!url || !anonKey) throw new Error("Faltan variables publicas de Supabase")
  if (!token) throw new Error("No autenticado")

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error("Sesion invalida")
  return data.user
}
