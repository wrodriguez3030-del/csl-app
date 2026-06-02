/**
 * Ejecuta SQL contra el Supabase SELF-HOSTED (db-cls) vía pg-meta /pg/query.
 * Conexión estable: HTTPS (Cloudflare Tunnel) + service_role de .env.local.
 *
 * Uso:
 *   node scripts/db-query.js "select 1"
 *   node scripts/db-query.js --file ruta.sql
 *
 * ⚠️ Para DELETE/TRUNCATE/DROP/UPDATE masivo: confirmar DOS veces con el
 *    usuario antes de correr (regla de INSTRUCCIONES.md).
 */
const fs = require("fs")
const env = {}
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const URLBASE = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL).trim()
const KEY = env.SUPABASE_SERVICE_ROLE_KEY.trim()

async function runSql(query) {
  const r = await fetch(URLBASE + "/pg/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: KEY, Authorization: "Bearer " + KEY },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`)
  return JSON.parse(text)
}

module.exports = { runSql, URLBASE }

if (require.main === module) {
  const args = process.argv.slice(2)
  let sql
  if (args[0] === "--file") sql = fs.readFileSync(args[1], "utf8")
  else sql = args.join(" ")
  if (!sql || !sql.trim()) { console.error("Falta SQL."); process.exit(1) }
  runSql(sql)
    .then((rows) => { console.log(JSON.stringify(rows, null, 2)) })
    .catch((e) => { console.error("ERROR:", e.message); process.exit(1) })
}
