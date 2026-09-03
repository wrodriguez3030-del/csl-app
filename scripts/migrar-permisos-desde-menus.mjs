/**
 * ARRANQUE DEL MODELO DE PERMISOS — deriva los permisos desde los menús.
 *
 * Por defecto SOLO IMPRIME lo que haría. No escribe nada sin `--aplicar`.
 *
 *   node --import tsx scripts/migrar-permisos-desde-menus.mjs
 *   node --import tsx scripts/migrar-permisos-desde-menus.mjs --aplicar
 *
 * Reglas (las decidió el dueño el 03/09/2026):
 *   · Cada usuario hereda los permisos NUEVOS que impliquen sus menús.
 *   · La CAJA FUERTE no se hereda: nace cerrada y la concede el dueño a mano.
 *   · Los permisos que YA existían no se derivan: se conserva lo que cada uno
 *     tenga. Compras, Incentivos, BI, Credenciales e Integraciones ya estaban
 *     cerrados; derivarlos del menú regalaría accesos que hoy nadie tiene.
 *   · Los administradores no se tocan: se saltan los permisos corrientes por su
 *     rol (y la caja fuerte ya no, desde v0.119.0).
 *   · Las tabletas de kiosko se quedan en cero: marcan por /api/public/punch.
 *
 * Cada cambio queda respaldado en `csl_permission_changes`, así que deshacerlo
 * es leer esa tabla y reponer `permisos_antes`.
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { permisosHeredados } from "../lib/permissions/inherit.ts"
import { CAJA_FUERTE } from "../lib/permissions/catalog.ts"

const APLICAR = process.argv.includes("--aplicar")

// Mismo criterio que scripts/db-query.js: la conexión sale de .env.local.
const env = {}
for (const linea of readFileSync(".env.local", "utf8").split("\n")) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local")
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data, error } = await sb
  .from("csl_user_profiles")
  .select("user_id, username, nombre, is_admin, is_superadmin, activo, business_id, menus, permissions")
  .eq("activo", true)
  .order("nombre")
if (error) throw error

const perfiles = (data || []).filter((p) => !p.is_admin && !p.is_superadmin)

console.log(`\n🔐 Arranque de permisos — ${APLICAR ? "APLICANDO" : "SOLO VISTA PREVIA"}`)
console.log(`   ${perfiles.length} usuarios normales activos (los administradores no se tocan)\n`)

const plan = []
for (const p of perfiles) {
  const menus = Array.isArray(p.menus) ? p.menus : []
  const actuales = Array.isArray(p.permissions) ? p.permissions : []
  const nuevos = permisosHeredados(menus, actuales)
  const anadidos = nuevos.filter((x) => !actuales.includes(x))
  // La caja fuerte no debe aparecer nunca aquí. Si aparece, hay un error en
  // `inherit.ts` y prefiero abortar antes que repartirla sin querer.
  const fuga = anadidos.filter((x) => CAJA_FUERTE.has(x))
  if (fuga.length) {
    console.error(`\n❌ ABORTADO: la herencia intentó conceder caja fuerte a ${p.username}: ${fuga.join(", ")}`)
    process.exit(1)
  }
  plan.push({ p, actuales, nuevos, anadidos })
}

const ancho = Math.max(...plan.map((x) => (x.p.username || "").length), 8)
for (const { p, actuales, anadidos } of plan) {
  const etiqueta = `${(p.username || "").padEnd(ancho)}  ${(p.nombre || "").slice(0, 22).padEnd(22)}`
  if (!anadidos.length) {
    console.log(`  ·  ${etiqueta} sin cambios (${actuales.length} permisos)`)
    continue
  }
  console.log(`  ✚  ${etiqueta} ${actuales.length} → ${actuales.length + anadidos.length}`)
  for (const perm of anadidos) console.log(`        + ${perm}`)
}

const total = plan.reduce((n, x) => n + x.anadidos.length, 0)
console.log(`\n   ${total} permisos a conceder en ${plan.filter((x) => x.anadidos.length).length} usuarios`)

if (!APLICAR) {
  console.log("\n   Vista previa. Para aplicarlo de verdad: --aplicar\n")
  process.exit(0)
}

let escritos = 0
for (const { p, actuales, nuevos, anadidos } of plan) {
  if (!anadidos.length) continue
  const { error: upErr } = await sb.from("csl_user_profiles").update({ permissions: nuevos }).eq("user_id", p.user_id)
  if (upErr) {
    console.error(`  ❌ ${p.username}: ${upErr.message}`)
    continue
  }
  await sb.from("csl_permission_changes").insert({
    business_id: p.business_id,
    target_user_id: p.user_id,
    target_username: p.username,
    actor_user_id: null,
    actor_email: "migracion:arranque-permisos",
    permisos_antes: actuales,
    permisos_despues: nuevos,
  })
  escritos++
}
console.log(`\n✅ ${escritos} usuarios actualizados. Respaldo en csl_permission_changes.\n`)
