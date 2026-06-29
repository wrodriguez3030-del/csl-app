// Asigna sucursal + menú req-mat-mis a las encargadas del módulo Requisición de
// materiales. Idempotente. No destructivo (upsert + merge de menus).
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }
const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"

const get = async (p) => { const r = await fetch(URL + p, { headers: H }); if (!r.ok) throw new Error(`GET ${p}: ${r.status} ${await r.text()}`); return r.json() }
const send = async (method, p, body, extra = {}) => {
  const r = await fetch(URL + p, { method, headers: { ...H, Prefer: "return=representation", ...extra }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.json()
}

const ENCARGADAS = [
  { email: "encvocibao@gmail.com",  branch: "VILLA OLGA"   },
  { email: "encjarcibao@gmail.com", branch: "LOS JARDINES" },
  { email: "encrvcibao@gmail.com",  branch: "RAFAEL VIDAL" },
]
const ADD_MENUS = ["req-mat-mis"]

;(async () => {
  for (const enc of ENCARGADAS) {
    const rows = await get(`/rest/v1/csl_user_profiles?select=user_id,nombre,username,menus,business_id&username=eq.${encodeURIComponent(enc.email)}`)
    if (!rows.length) { console.log(`! NO encontrado: ${enc.email}`); continue }
    const u = rows[0]
    console.log(`\n• ${u.nombre} (${u.username})`)

    // 1) Merge de menus (no quita nada existente)
    const cur = Array.isArray(u.menus) ? u.menus : []
    const next = Array.from(new Set([...cur, ...ADD_MENUS]))
    if (next.length !== cur.length) {
      await send("PATCH", `/rest/v1/csl_user_profiles?user_id=eq.${u.user_id}`, { menus: next })
      console.log(`  menus: +${ADD_MENUS.filter(m => !cur.includes(m)).join(", ")}  → [${next.join(", ")}]`)
    } else {
      console.log(`  menus: ya tenía req-mat-mis, sin cambios`)
    }

    // 2) Upsert de sucursal (revoca otras activas que no sean la suya)
    await send("POST", `/rest/v1/user_branch_permissions?on_conflict=business_id,user_id,branch_name`,
      { business_id: CSL, user_id: u.user_id, branch_name: enc.branch, active: true, updated_at: new Date().toISOString() },
      { Prefer: "resolution=merge-duplicates,return=representation" })
    // Desactivar cualquier otra sucursal activa que no sea la asignada
    const others = await get(`/rest/v1/user_branch_permissions?select=branch_name&user_id=eq.${u.user_id}&business_id=eq.${CSL}&active=eq.true`)
    for (const o of others) {
      if (o.branch_name !== enc.branch) {
        await send("PATCH", `/rest/v1/user_branch_permissions?user_id=eq.${u.user_id}&business_id=eq.${CSL}&branch_name=eq.${encodeURIComponent(o.branch_name)}`, { active: false, updated_at: new Date().toISOString() })
        console.log(`  branch: desactivada ${o.branch_name}`)
      }
    }
    console.log(`  branch: ✓ ${enc.branch} (activa)`)
  }

  console.log("\n=== VERIFICACIÓN ===")
  for (const enc of ENCARGADAS) {
    const rows = await get(`/rest/v1/csl_user_profiles?select=user_id,nombre,menus&username=eq.${encodeURIComponent(enc.email)}`)
    if (!rows.length) continue
    const u = rows[0]
    const bp = await get(`/rest/v1/user_branch_permissions?select=branch_name&user_id=eq.${u.user_id}&active=eq.true`)
    const reqmat = (u.menus || []).filter(m => m.startsWith("req-mat"))
    console.log(`• ${u.nombre}: req-mat=[${reqmat.join(", ")}]  branches=[${bp.map(b=>b.branch_name).join(", ")}]`)
  }
})().catch(e => { console.error("ERR", e.message); process.exit(1) })
