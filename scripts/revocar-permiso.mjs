/**
 * REVOCAR UN PERMISO a todos los usuarios normales que lo tengan.
 *
 * Hace falta cuando un permiso se MUEVE a la caja fuerte: meterlo en la lista
 * no se lo quita a quien ya lo tenga en su fila, así que quedaría de adorno.
 *
 *   node --import tsx scripts/revocar-permiso.mjs <permiso>
 *   node --import tsx scripts/revocar-permiso.mjs <permiso> --aplicar
 *
 * Por defecto solo imprime. Cada cambio queda en `csl_permission_changes` con
 * el antes y el después, así que deshacerlo es leer esa tabla y reponer.
 * No toca a administradores ni al superadministrador.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { PERMISSION_ID_SET } from "../lib/permissions/catalog.ts"

const permiso = process.argv[2]
const APLICAR = process.argv.includes("--aplicar")

if (!permiso || permiso.startsWith("--")) {
  console.error("Uso: node --import tsx scripts/revocar-permiso.mjs <permiso> [--aplicar]")
  process.exit(1)
}
if (!PERMISSION_ID_SET.has(permiso)) {
  console.error(`«${permiso}» no está en el catálogo. ¿Un typo?`)
  process.exit(1)
}

const env = {}
for (const linea of readFileSync(".env.local", "utf8").split("\n")) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data, error } = await sb
  .from("csl_user_profiles")
  .select("user_id, username, nombre, business_id, permissions")
  .eq("activo", true)
  .eq("is_admin", false)
  .eq("is_superadmin", false)
  .order("username")
if (error) throw error

const afectados = (data || []).filter((p) => Array.isArray(p.permissions) && p.permissions.includes(permiso))

console.log(`\n🔒 Revocar «${permiso}» — ${APLICAR ? "APLICANDO" : "SOLO VISTA PREVIA"}`)
if (!afectados.length) {
  console.log("   Nadie lo tiene. No hay nada que hacer.\n")
  process.exit(0)
}
for (const p of afectados) console.log(`  −  ${p.username.padEnd(32)} ${p.nombre || ""}`)
console.log(`\n   ${afectados.length} usuarios`)

if (!APLICAR) {
  console.log("   Vista previa. Para aplicarlo: --aplicar\n")
  process.exit(0)
}

let hechos = 0
for (const p of afectados) {
  const antes = p.permissions
  const despues = antes.filter((x) => x !== permiso)
  const { error: upErr } = await sb.from("csl_user_profiles").update({ permissions: despues }).eq("user_id", p.user_id)
  if (upErr) {
    console.error(`  ❌ ${p.username}: ${upErr.message}`)
    continue
  }
  await sb.from("csl_permission_changes").insert({
    business_id: p.business_id,
    target_user_id: p.user_id,
    target_username: p.username,
    actor_user_id: null,
    actor_email: `revocacion:${permiso}`,
    permisos_antes: antes,
    permisos_despues: despues,
  })
  hechos++
}
console.log(`\n✅ ${hechos} usuarios actualizados. Respaldo en csl_permission_changes.\n`)
