/**
 * Backfill: normaliza a MAYÚSCULA los campos CABINA y OPERADORA existentes.
 *
 * Solo cambia el case (trim + colapso de espacios + toUpperCase) — NO borra
 * datos ni toca filas ya normalizadas. Idempotente. Multi-tenant (recorre
 * todas las filas; cada tabla ya está scopeada por business_id en su PK/uso).
 *
 * Tablas/columnas:
 *   csl_equipos            → cabina, operadora
 *   csl_operadoras         → nombre
 *   csl_lecturas_semanales → cabina
 *   csl_sesiones_cliente   → cabina
 *   csl_auditorias_semanales → cabina
 *   csl_pulse_readings     → cabina, operadora
 *   csl_equipo_snapshots   → cabina, operadora
 *
 * Uso: node scripts/normalize-cabina-operadora.js
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local"); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

const upper = (v) => v == null ? null : String(v).trim().replace(/\s+/g, " ").toUpperCase()

async function get(p) {
  const r = await fetch(URL + p, { headers: H })
  if (!r.ok) throw new Error(`GET ${p}: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}
async function patch(p, body) {
  const r = await fetch(URL + p, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`PATCH ${p}: HTTP ${r.status} ${await r.text()}`)
}

// [tabla, columna-PK, [columnas a normalizar]]
const TARGETS = [
  ["csl_equipos", "equipo_id", ["cabina", "operadora"]],
  ["csl_operadoras", "operadora_id", ["nombre"]],
  ["csl_lecturas_semanales", "lectura_id", ["cabina"]],
  ["csl_sesiones_cliente", "sesion_id", ["cabina"]],
  ["csl_auditorias_semanales", "auditoria_id", ["cabina"]],
  ["csl_pulse_readings", "id", ["cabina", "operadora"]],
  ["csl_equipo_snapshots", "id", ["cabina", "operadora"]],
]

;(async () => {
  let grandTotal = 0
  for (const [table, pk, cols] of TARGETS) {
    const select = [pk, ...cols].join(",")
    let rows
    try {
      rows = await get(`/rest/v1/${table}?select=${select}`)
    } catch (e) {
      console.log(`! ${table}: omitida (${e.message.split("\n")[0]})`)
      continue
    }
    let changed = 0
    for (const row of rows) {
      const patchBody = {}
      for (const c of cols) {
        const cur = row[c]
        if (cur == null || cur === "") continue
        const up = upper(cur)
        if (up !== cur) patchBody[c] = up
      }
      if (Object.keys(patchBody).length === 0) continue
      await patch(`/rest/v1/${table}?${pk}=eq.${encodeURIComponent(row[pk])}`, patchBody)
      changed++
    }
    grandTotal += changed
    console.log(`✓ ${table}: ${changed} fila(s) normalizada(s) (de ${rows.length})`)
  }
  console.log(`\nTotal normalizado: ${grandTotal} fila(s).`)
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })
