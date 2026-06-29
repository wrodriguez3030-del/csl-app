const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const get = async (p) => { const r = await fetch(URL + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json() }
;(async () => {
  const biz = await get("/rest/v1/businesses?select=id,slug,name")
  const bmap = Object.fromEntries(biz.map(b => [b.id, b.slug]))
  console.log("BUSINESSES:", JSON.stringify(biz))
  const users = await get("/rest/v1/csl_user_profiles?select=user_id,nombre,username,is_admin,is_superadmin,activo,business_id,menus&order=nombre")
  const bp = await get("/rest/v1/user_branch_permissions?select=user_id,branch_name,active&active=eq.true")
  const branchMap = {}
  for (const r of bp) { (branchMap[r.user_id] ||= []).push(r.branch_name) }
  console.log("\n=== USUARIOS (" + users.length + ") ===")
  for (const u of users) {
    const reqmat = (u.menus || []).filter(m => m.startsWith("req-mat"))
    const role = u.is_superadmin ? "SUPERADMIN" : u.is_admin ? "ADMIN" : "user"
    console.log(`\n• ${u.nombre} (${u.username}) [${role}] biz=${bmap[u.business_id]||u.business_id} activo=${u.activo}`)
    console.log(`  menus(${(u.menus||[]).length}): ${(u.menus||[]).join(", ") || "—"}`)
    console.log(`  req-mat: ${reqmat.join(", ") || "NINGUNO"}`)
    console.log(`  branches: ${(branchMap[u.user_id]||[]).join(", ") || "—"}`)
  }
})().catch(e => { console.error("ERR", e.message); process.exit(1) })
