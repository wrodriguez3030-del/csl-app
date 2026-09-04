/** Cuánto mueve el refresco automático de la app. Solo LEE. */
import { readFileSync } from "node:fs"
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { getAllData, getAllPulsosData } = await import("../lib/server/csl-crud.ts")

const ctx = { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", isAdmin: true, isSuperadmin: false, permissions: [] }
const kb = (o) => (Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(0)

await runWithBusinessContext(ctx, async () => {
  let t = Date.now()
  const a = await getAllData()
  const ta = Date.now() - t
  t = Date.now()
  const p = await getAllPulsosData()
  const tp = Date.now() - t

  console.log(`\n  getAllData        ${kb(a).padStart(6)} KB   ${String(ta).padStart(5)} ms`)
  for (const [k, v] of Object.entries(a)) console.log(`      ${k.padEnd(24)} ${String(Array.isArray(v) ? v.length : "-").padStart(6)} filas  ${kb(v).padStart(6)} KB`)
  console.log(`\n  getAllPulsosData  ${kb(p).padStart(6)} KB   ${String(tp).padStart(5)} ms`)
  for (const [k, v] of Object.entries(p)) console.log(`      ${k.padEnd(24)} ${String(Array.isArray(v) ? v.length : "-").padStart(6)} filas  ${kb(v).padStart(6)} KB`)

  const total = Number(kb(a)) + Number(kb(p))
  console.log(`\n  ── POR REFRESCO: ${total} KB · ${ta + tp} ms`)
  console.log(`  ── 21 usuarios × 60 refrescos/hora × 8 h = ${(total * 21 * 60 * 8 / 1024 / 1024).toFixed(1)} GB/día\n`)
})
