/**
 * Simula offline el bucketing por semana operativa que hace Cuadre Semanal
 * cuando el usuario sube un AgendaPro. Sirve para predecir cuántas filas
 * deberían terminar en csl_operator_shots tras el upload.
 */

const fs = require("fs")
const path = require("path")
const XLSX = require("xlsx")

const FILE = process.argv[2] || "C:\\Users\\ADMIN\\Downloads\\ReporteDisparos-2026-05-24.xlsx"

// ── Replica de lib/normalize-pulse.ts ──────────────────────────────────────
const HEADER_SKIP = new Set([
  "SUCURSAL", "OPERADORA", "OPERADOR", "EQUIPO", "EQUIPOID",
  "CABINA", "PULSOS", "ESTADO", "FALLAS", "SERIAL", "SEMANA",
  "FECHA", "CLIENTE", "TRATAMIENTO", "POTENCIA", "SPOT", "DISPAROS",
  "SECUENCIAL", "CONTACTO", "TOTAL", "TOTALES",
])

const BRAND_PREFIX_RE =
  /^(?:cibao\s+spa\s+l[aá]ser|cibao\s+spa\s+laser|depicenter|csl)\s*[-–—]?\s*/i

function cleanUpper(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSucursal(value) {
  const s = String(value || "").trim()
  if (!s) return ""
  const stripped = s.replace(BRAND_PREFIX_RE, "").trim() || s
  const up = cleanUpper(stripped)
  if (!up || HEADER_SKIP.has(up)) return ""
  if (up.includes("JARDINES")) return "LOS JARDINES"
  if (up === "R VIDAL" || up.includes("RAFAEL") || up.includes("VIDAL") ||
      up.includes("PLAZA") || up.includes("MEDITERR")) return "RAFAEL VIDAL"
  if ((up.includes("VILLA") && up.includes("OLGA")) || up === "V OLGA") return "VILLA OLGA"
  if (up.includes("LA VEGA")) return "LA VEGA"
  if (up === "DEPICENTER") return "LA VEGA"
  return up
}

const OPERADORA_ALIASES = {
  KATHERINE: "KATHERIN", EMELY: "EMELI", RIQUELMI: "ROQUELMI",
  YESICA: "YESSICA", SAOMY: "SAHOMY",
}
const OPERADORA_SKIP = new Set([
  "SISTEMA", "SYSTEM", "ADMIN",
  "OPERADORA", "OPERADOR", "EQUIPO", "EQUIPOID", "SUCURSAL",
])

function normalizeOperadora(value) {
  const up = cleanUpper(value)
  if (!up || OPERADORA_SKIP.has(up)) return ""
  return OPERADORA_ALIASES[up] ?? up
}

// ── Replica de lib/operational-week.ts ─────────────────────────────────────
function getOperationalWeek(input) {
  const s = String(input).slice(0, 10)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(d.getTime())) return null
  const dow = d.getDay() // 0=Dom, 1=Lun, ..., 6=Sab
  const monday = new Date(d)
  if (dow === 0) monday.setDate(monday.getDate() + 1)
  else monday.setDate(monday.getDate() - (dow - 1))
  const saturday = new Date(monday)
  saturday.setDate(saturday.getDate() + 5)
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`
  return { period_start: iso(monday), period_end: iso(saturday) }
}

// ── Replica de parseDisparos / toIsoDate ───────────────────────────────────
function parseDisparos(raw) {
  if (raw === null || raw === undefined) return NaN
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : NaN
  const str = String(raw).trim()
  if (!str) return NaN
  const parts = str.split(",").map(p => p.trim()).filter(Boolean)
  let total = 0
  for (const part of parts) {
    const cleaned = part.replace(/\.0+$/, "").replace(/[^\d-]/g, "")
    if (!cleaned) return NaN
    const n = parseInt(cleaned, 10)
    if (!Number.isFinite(n)) return NaN
    total += n
  }
  return total
}

function toIsoDate(raw) {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10)
  if (typeof raw === "number") {
    return new Date((raw - 25569) * 86400000).toISOString().slice(0, 10)
  }
  const str = String(raw || "").trim()
  if (!str) return ""
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`
  return str.slice(0, 10)
}

// ── Parser principal ────────────────────────────────────────────────────────
console.log(`Reading ${FILE}\n`)
const wb = XLSX.read(fs.readFileSync(FILE))
const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes("detalle") && n.toLowerCase().includes("disparos")) || wb.SheetNames[0]
console.log(`Hoja: ${sheetName}`)
const ws = wb.Sheets[sheetName]
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" })

// Detectar headerRow
let headerRow = -1
for (let i = 0; i < raw.length; i++) {
  const first = String(raw[i][0] || "").toLowerCase()
  if (first.includes("secuencial")) { headerRow = i; break }
}
console.log(`Fila de headers (1-indexed): ${headerRow + 1}`)
console.log(`Fila 1 (rango del reporte): "${String(raw[0]?.[0] || "")}"`)

// Parsear filas válidas
const valid = []
let totalRows = 0
let skipped = { sin_fecha: 0, sin_sucursal: 0, sin_operadora: 0, sin_disparos: 0, no_secuencial: 0 }
for (let i = headerRow + 1; i < raw.length; i++) {
  const row = raw[i]
  const seqRaw = String(row[0] ?? "").trim()
  if (!seqRaw) continue
  if (Number.isNaN(parseInt(seqRaw.replace(/,/g, ""), 10))) { skipped.no_secuencial++; continue }
  totalRows++
  const operadora = String(row[4] ?? "").replace(/\s+/g, " ").trim()
  const sucursal = String(row[5] ?? "").trim()
  const fecha = toIsoDate(row[9])
  const disparos = parseDisparos(row[8])
  if (!fecha) { skipped.sin_fecha++; continue }
  const sucNorm = normalizeSucursal(sucursal)
  const opNorm = normalizeOperadora(operadora)
  if (!sucNorm) { skipped.sin_sucursal++; continue }
  if (!opNorm) { skipped.sin_operadora++; continue }
  if (!Number.isFinite(disparos) || disparos <= 0) { skipped.sin_disparos++; continue }
  valid.push({ fecha, sucursal, sucNorm, operadora, opNorm, disparos })
}

console.log(`\nFilas totales con secuencial numérico: ${totalRows}`)
console.log(`Filas válidas tras normalización: ${valid.length}`)
console.log(`Filtradas:`, skipped)

// Bucketing por semana
const buckets = new Map()
for (const r of valid) {
  const w = getOperationalWeek(r.fecha)
  if (!w) continue
  const wk = w.period_start
  if (!buckets.has(wk)) buckets.set(wk, { week: w, byKey: new Map(), sesiones: 0, disparos: 0 })
  const b = buckets.get(wk)
  const key = `${r.sucNorm}|${r.opNorm}`
  if (!b.byKey.has(key)) b.byKey.set(key, { sucNorm: r.sucNorm, opNorm: r.opNorm, sesiones: 0, disparos: 0 })
  const x = b.byKey.get(key)
  x.sesiones += 1
  x.disparos += r.disparos
  b.sesiones += 1
  b.disparos += r.disparos
}

const sortedWeeks = Array.from(buckets.values()).sort((a, b) => a.week.period_start.localeCompare(b.week.period_start))
console.log(`\n=== ${sortedWeeks.length} SEMANAS OPERATIVAS DETECTADAS ===\n`)

let totalShots = 0
let totalSesiones = 0
let totalDisparos = 0
for (const b of sortedWeeks) {
  console.log(`Semana ${b.week.period_start} → ${b.week.period_end}`)
  console.log(`  Sesiones: ${b.sesiones}  ·  Disparos: ${b.disparos.toLocaleString()}  ·  Filas operator_shots: ${b.byKey.size}`)
  const rows = Array.from(b.byKey.values()).sort((x, y) =>
    x.sucNorm !== y.sucNorm ? x.sucNorm.localeCompare(y.sucNorm) : x.opNorm.localeCompare(y.opNorm))
  for (const r of rows) {
    console.log(`    · ${r.sucNorm.padEnd(15)} ${r.opNorm.padEnd(12)} ${String(r.sesiones).padStart(4)} ses  ${String(r.disparos.toLocaleString()).padStart(10)} disp`)
  }
  totalShots += b.byKey.size
  totalSesiones += b.sesiones
  totalDisparos += b.disparos
}

console.log(`\n=== RESUMEN GLOBAL ===`)
console.log(`Semanas: ${sortedWeeks.length}`)
console.log(`Filas que se insertarán en csl_operator_shots: ${totalShots}`)
console.log(`Total sesiones: ${totalSesiones}`)
console.log(`Total disparos: ${totalDisparos.toLocaleString()}`)
