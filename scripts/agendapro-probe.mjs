// Probe diagnóstico de paginación AgendaPro.
// Lee credenciales de un .env temporal local. NO loguea Authorization,
// USER ni PASSWORD. Solo cuenta, primer/último id de cada página y meta.
//
// Uso (bash):
//   vercel env pull .env.agendapro.tmp --yes --environment=production > /dev/null 2>&1
//   node scripts/agendapro-probe.mjs
//   rm -f .env.agendapro.tmp
//
// El script borra el archivo .env.agendapro.tmp al terminar.

import { readFileSync, unlinkSync, existsSync } from "node:fs"

const TMP_FILE = ".env.agendapro.tmp"
const env = {}
try {
  for (const rawLine of readFileSync(TMP_FILE, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[m[1]] = value
  }
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: `No se pudo leer ${TMP_FILE}: ${e.message}` }))
  process.exit(1)
}

const BASE = (env.AGENDAPRO_API_BASE_URL || "").replace(/\/$/, "")
const PATH = env.AGENDAPRO_API_CLIENTS_PATH || "/clients"
const USER = env.AGENDAPRO_API_USER
const PASSWORD = env.AGENDAPRO_API_PASSWORD

if (!BASE || !USER || !PASSWORD) {
  console.error(JSON.stringify({ ok: false, error: "Faltan AGENDAPRO_API_* en .env.agendapro.tmp" }))
  if (existsSync(TMP_FILE)) try { unlinkSync(TMP_FILE) } catch {}
  process.exit(1)
}

const auth = Buffer.from(`${USER}:${PASSWORD}`).toString("base64")

const probes = [
  { label: "plain", qs: "" },
  { label: "page=1", qs: "?page=1" },
  { label: "page=2", qs: "?page=2" },
  { label: "page=3", qs: "?page=3" },
  { label: "page=1&per_page=100", qs: "?page=1&per_page=100" },
  { label: "page=2&per_page=100", qs: "?page=2&per_page=100" },
  { label: "page=1&per_page=200", qs: "?page=1&per_page=200" },
  { label: "limit=100&offset=0", qs: "?limit=100&offset=0" },
  { label: "limit=100&offset=100", qs: "?limit=100&offset=100" },
]

function maskId(id) {
  if (id === null || id === undefined) return null
  const s = String(id)
  if (s.length <= 4) return s
  return s.slice(0, 4) + "***"
}

const results = []
for (const p of probes) {
  const url = `${BASE}${PATH}${p.qs}`
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "Authorization": `Basic ${auth}` },
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = String(text).slice(0, 200) }

    const arr = Array.isArray(body)
      ? body
      : (body?.clients || body?.data || body?.records || body?.items || body?.results
        || (body && body.id ? [body] : []))
    const count = Array.isArray(arr) ? arr.length : 0
    const firstId = count > 0 ? (arr[0].id ?? arr[0].client_id ?? null) : null
    const lastId = count > 0 ? (arr[count - 1].id ?? arr[count - 1].client_id ?? null) : null

    const relevantHeaders = {}
    res.headers.forEach((v, k) => {
      if (/total|page|link|count|next|prev/i.test(k)) relevantHeaders[k] = v
    })

    const meta = (body && typeof body === "object" && !Array.isArray(body))
      ? (body.meta || body.pagination || body.page_info || null)
      : null
    const bodyKeys = (body && typeof body === "object" && !Array.isArray(body))
      ? Object.keys(body).slice(0, 20) : null

    results.push({
      label: p.label,
      status: res.status,
      count,
      firstIdMasked: maskId(firstId),
      lastIdMasked: maskId(lastId),
      meta,
      relevantHeaders,
      bodyKeys,
    })
  } catch (e) {
    results.push({ label: p.label, error: e.message })
  }
}

// Análisis
const p1 = results.find(r => r.label === "page=1")
const p2 = results.find(r => r.label === "page=2")
const p3 = results.find(r => r.label === "page=3")
const p1pp = results.find(r => r.label === "page=1&per_page=200")
const plain = results.find(r => r.label === "plain")
const offset100 = results.find(r => r.label === "limit=100&offset=100")

const ignoresPage = !!(p1?.firstIdMasked && p1.firstIdMasked === p2?.firstIdMasked)
const ignoresPerPage = !!(plain?.count && p1pp?.count && plain.count === p1pp.count)
const offsetWorks = !!(offset100?.firstIdMasked && p1?.firstIdMasked && offset100.firstIdMasked !== p1.firstIdMasked)

const analysis = {
  plainCount: plain?.count ?? null,
  page1Count: p1?.count ?? null,
  page2Count: p2?.count ?? null,
  page3Count: p3?.count ?? null,
  page1per200Count: p1pp?.count ?? null,
  offset100FirstChanges: offsetWorks,
  ignoresPage,
  ignoresPerPage,
  recommendation:
    offsetWorks ? "Usar ?limit&offset — AgendaPro respeta esa paginación."
    : ignoresPage ? "AgendaPro ignora ?page. Pedir a soporte el parámetro real (cursor, ?next=, etc.)."
    : "AgendaPro respeta ?page — confirmar con soporte el max per_page.",
}

console.log(JSON.stringify({ ok: true, probes: results, analysis }, null, 2))

// Cleanup
if (existsSync(TMP_FILE)) try { unlinkSync(TMP_FILE) } catch {}
