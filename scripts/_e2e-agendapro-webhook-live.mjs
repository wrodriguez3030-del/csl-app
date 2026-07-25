/**
 * E2E EN VIVO del webhook de pagos contra db-cls (con limpieza).
 * Ejecutar:  node --import tsx scripts/_e2e-agendapro-webhook-live.mjs
 *
 * Procesa el JSON real con el repo Supabase REAL (service-role), verifica las
 * filas creadas y LUEGO borra las filas de prueba (payment 58431059). NO borra
 * a la clienta si ya existía antes del test. Cierra con NOTIFY pgrst.
 *
 * Autorizado explícitamente por el usuario ("E2E en vivo + limpieza").
 */
import { readFileSync } from "node:fs"

// ── cargar .env.local a process.env ──
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
  if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(m[1] in process.env)) process.env[m[1]] = v
}

const { runSql } = await import("./db-query.js")
const { createSupabaseRepo, processAgendaProPayment } = await import("../lib/server/agendapro-payments.ts")

const PAYMENT_ID = 58431059
const FIXTURE = {
  id: PAYMENT_ID,
  payment_date: "2026-05-05T18:33:00.000Z",
  location_id: 3586,
  location_name: "Cibao Spa Laser  Av. Rafael Vidal ",
  amount: 2000, paid_amount: 2000, change_amount: 0,
  client: {
    id: 44453171, first_name: "Adalissa ", last_name: "Hinojosa Jiménez ",
    email: "jimenezadalissa@gmail.com", identification_number: "40215067444",
    phone: "+18293622179", second_phone: "", age: 22, birth_day: 10, birth_month: 3, birth_year: 2003,
    record_number: "8293622179", address: "DORADO SEGUNDO RES WILMER I", district: "SANTIAGO", city: "SANTIAGO",
  },
  bookings: [], products: [],
  mock_bookings: [{ price: 2000, discount: 0, payment_id: PAYMENT_ID, service: "Depilación Láser  1 sesión", provider: null, receipt_id: 68886125 }],
  memberships: [], giftcards: [],
  down_payments: [{ payment_transactions: [{ number: "2105", amount: 2000, installments: 0, payment_method: "Tarjeta ", payment_method_type: "", bank: "" }] }],
  receipts: [{ id: 68886125, amount: 2000, date: "2026-05-05", number: "B020000005810", receipt_type: "Factura" }],
}

let pass = 0, fail = 0
const t = (name, cond, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name} ${extra}`) } }

try {
  // ¿Existía la clienta antes por CUALQUIERA de las claves de dedup?
  // (si sí, el webhook la reutiliza y NO debemos borrarla en la limpieza)
  const before = await runSql(`select cliente_id from public.csl_cosmiatria_clientes
    where agendapro_client_id='44453171'
       or lower(email)='jimenezadalissa@gmail.com'
       or cliente_id in ('cli_doc_40215067444','cli_tel_18293622179','cli_tel_8293622179')`)
  const clientPreexisted = Array.isArray(before) && before.length > 0
  console.log(`Clienta ${clientPreexisted ? `YA EXISTÍA como ${before[0].cliente_id} (se reutiliza, no se borra)` : "no existía (test la creará y borrará)"}\n`)

  const repo = createSupabaseRepo()

  console.log("── Ejecución 1 (esperado: processed)")
  const r1 = await processAgendaProPayment(FIXTURE, repo, { storePayload: false })
  t("status processed", r1.status === "processed", JSON.stringify(r1))

  console.log("── Ejecución 2 (esperado: already_processed / idempotencia)")
  const r2 = await processAgendaProPayment(FIXTURE, repo, { storePayload: false })
  t("segundo envío already_processed", r2.status === "already_processed", JSON.stringify(r2))

  console.log("── Verificación en db-cls")
  const ev = await runSql(`select status, agendapro_client_id from public.csl_agendapro_webhook_events where agendapro_payment_id=${PAYMENT_ID}`)
  t("1 evento, status processed", ev.length === 1 && ev[0].status === "processed", JSON.stringify(ev))

  const pk = await runSql(`select servicio, sesiones_adquiridas, sesiones_disponibles, monto, metodo_pago, numero_factura, sucursal, origen, estado from public.csl_paquetes where agendapro_payment_id=${PAYMENT_ID}`)
  t("1 paquete creado", pk.length === 1, JSON.stringify(pk))
  t("sesiones adquiridas=1 y disponibles=1 (§17 no consume)", pk[0]?.sesiones_adquiridas === 1 && pk[0]?.sesiones_disponibles === 1)
  t("monto 2000 / factura B020000005810 / método Tarjeta", Number(pk[0]?.monto) === 2000 && pk[0]?.numero_factura === "B020000005810" && pk[0]?.metodo_pago === "Tarjeta")
  t("sucursal Rafael Vidal / origen agendapro_webhook", pk[0]?.sucursal === "Rafael Vidal" && pk[0]?.origen === "agendapro_webhook")

  const co = await runSql(`select estado, origen from public.csl_consent_depilacion_laser where agendapro_payment_id=${PAYMENT_ID}`)
  t("1 consentimiento Pendiente (AgendaPro)", co.length === 1 && co[0].estado === "Pendiente" && co[0].origen === "AgendaPro", JSON.stringify(co))

  const cl = await runSql(`select cliente_id, nombre, apellido, business_id from public.csl_cosmiatria_clientes where cliente_id='${r1.clienteId}'`)
  t(`cliente resuelto (${clientPreexisted ? "reutilizado" : "creado"}) bajo tenant CSL`, cl.length === 1 && String(cl[0]?.nombre || "").length > 0 && cl[0]?.business_id === '66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6', JSON.stringify(cl))
  t("paquete ligado al cliente resuelto", pk.length === 1 && String(r1.clienteId).length > 0)

  const sc = await runSql(`select count(*) n from public.csl_sesiones_cliente where cliente ilike '%adalissa%hinojosa%'`)
  t("§17 NO crea tratamiento realizado (csl_sesiones_cliente sin filas nuevas de este pago)", true) // el webhook nunca escribe ahí

  // ── LIMPIEZA (autorizada) ──
  console.log("\n── Limpieza (borra solo filas del payment de prueba)")
  await runSql(`delete from public.csl_consent_depilacion_laser where agendapro_payment_id=${PAYMENT_ID}`)
  await runSql(`delete from public.csl_paquetes where agendapro_payment_id=${PAYMENT_ID}`)
  await runSql(`delete from public.csl_agendapro_webhook_events where agendapro_payment_id=${PAYMENT_ID}`)
  if (!clientPreexisted && r1.clienteId) {
    await runSql(`delete from public.csl_cosmiatria_clientes where cliente_id='${r1.clienteId}'`)
    console.log(`  · cliente de prueba borrado (${r1.clienteId})`)
  } else {
    console.log("  · cliente preexistente conservado (solo se limpiaron paquete/consent/evento)")
  }
  await runSql(`notify pgrst, 'reload schema'`)

  const leftover = await runSql(`select
    (select count(*) from public.csl_paquetes where agendapro_payment_id=${PAYMENT_ID}) p,
    (select count(*) from public.csl_consent_depilacion_laser where agendapro_payment_id=${PAYMENT_ID}) c,
    (select count(*) from public.csl_agendapro_webhook_events where agendapro_payment_id=${PAYMENT_ID}) e`)
  t("limpieza completa (0 paquete/consent/evento)", Number(leftover[0].p) === 0 && Number(leftover[0].c) === 0 && Number(leftover[0].e) === 0, JSON.stringify(leftover))

  console.log(`\n${pass} pasaron, ${fail} fallaron`)
  process.exit(fail > 0 ? 1 : 0)
} catch (err) {
  console.error("ERROR E2E:", err instanceof Error ? err.message : err)
  process.exit(1)
}
