/**
 * Reprocesa los eventos de pago que quedaron en 'requires_mapping'/'failed'
 * (tras agregar los mapas de sucursal/servicio). Usa el payload guardado.
 * Ejecutar: node --import tsx scripts/_reprocess-agendapro-pending.mjs
 */
import { readFileSync } from "node:fs"
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(m[1] in process.env)) process.env[m[1]] = v
}
const { runSql } = await import("./db-query.js")
const { createSupabaseRepo, processAgendaProPayment } = await import("../lib/server/agendapro-payments.ts")

const pending = await runSql(
  "select id, agendapro_payment_id, payload_json from public.csl_agendapro_webhook_events where status in ('requires_mapping','failed','queued') order by received_at",
)
console.log(`Pendientes a reprocesar: ${pending.length}`)
const repo = createSupabaseRepo()
let processed = 0, still = 0, other = 0, nopayload = 0
for (const ev of pending) {
  if (!ev.payload_json) { nopayload++; console.log(`  ${ev.agendapro_payment_id}: (sin payload guardado)`); continue }
  try {
    const r = await processAgendaProPayment(ev.payload_json, repo, { storePayload: true })
    if (r.status === "processed") processed++
    else if (r.status === "requires_mapping") still++
    else other++
    console.log(`  ${ev.agendapro_payment_id}: ${r.status}`)
  } catch (e) {
    other++
    console.log(`  ${ev.agendapro_payment_id}: ERROR ${e instanceof Error ? e.message : e}`)
  }
}
console.log(`\nProcesados OK: ${processed} · aún requieren mapeo: ${still} · sin payload: ${nopayload} · otros: ${other}`)
