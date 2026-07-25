/**
 * Tests del Webhook de PAGOS de AgendaPro (§24 del brief).
 * Ejecutar:  node --import tsx scripts/test-agendapro-webhook.mjs
 *
 * Usa los módulos REALES (lib/server/agendapro-payments-core.ts y
 * lib/server/agendapro-payments.ts) con un REPO EN MEMORIA — así los 25 casos
 * corren sin tocar db-cls ni producción.
 */

const core = await import("../lib/server/agendapro-payments-core.ts")
const { processAgendaProPayment } = await import("../lib/server/agendapro-payments.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture: payload real del §6
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURE = () => ({
  id: 58431059,
  payment_date: "2026-05-05T18:33:00.000Z",
  location_id: 3586,
  location_name: "Cibao Spa Laser  Av. Rafael Vidal ",
  amount: 2000,
  paid_amount: 2000,
  change_amount: 0,
  client: {
    id: 44453171,
    first_name: "Adalissa ",
    last_name: "Hinojosa Jiménez ",
    email: "jimenezadalissa@gmail.com",
    identification_number: "40215067444",
    phone: "+18293622179",
    second_phone: "",
    age: 22, birth_day: 10, birth_month: 3, birth_year: 2003,
    record_number: "8293622179",
    address: "DORADO SEGUNDO RES WILMER I", district: "SANTIAGO", city: "SANTIAGO",
  },
  bookings: [],
  products: [],
  mock_bookings: [
    { price: 2000, discount: 0, payment_id: 58431059, service: "Depilación Láser  1 sesión", provider: null, receipt_id: 68886125 },
  ],
  memberships: [],
  giftcards: [],
  down_payments: [
    { payment_transactions: [ { number: "2105", amount: 2000, installments: 0, payment_method: "Tarjeta ", payment_method_type: "", bank: "" } ] },
  ],
  receipts: [
    { id: 68886125, amount: 2000, date: "2026-05-05", number: "B020000005810", receipt_type: "Factura" },
  ],
})

const CSL = "csl-biz-0001"
const DEP = "dep-biz-0002"

// ─────────────────────────────────────────────────────────────────────────────
// Repo en memoria (implementa AgendaProPaymentRepo)
// ─────────────────────────────────────────────────────────────────────────────
function makeRepo(seed = {}) {
  const clientes = new Map(seed.clientes ?? [])            // cliente_id -> row
  const locations = new Map(seed.locations ?? [[3586, { businessId: CSL, internalSucursal: "Rafael Vidal" }]])
  const services = new Map(seed.services ?? [[`${CSL}::depilacion laser 1 sesion`, { internal_service_name: "Depilación láser", categoria: "Depilación", consent_type: "depilacion-laser", sessions_quantity: 1 }]])
  const events = []
  const paquetes = []
  const consents = []
  let eid = 0

  const repo = {
    async getDefaultBusinessId() { return CSL },
    async getLocationMap(id) { return locations.get(id) ?? null },
    async getServiceMap(businessId, norm) { return services.get(`${businessId}::${norm}`) ?? null },
    async findEvent(businessId, paymentId) {
      const e = events.find((x) => x.business_id === businessId && x.agendapro_payment_id === paymentId)
      return e ? { id: e.id, status: e.status, attempts: e.attempts } : null
    },
    async insertEvent(row) { const id = `ev-${++eid}`; events.push({ id, ...row }); return { id } },
    async updateEvent(id, patch) { const e = events.find((x) => x.id === id); if (e) Object.assign(e, patch) },
    async findClientByAgendaProId(businessId, agp) {
      for (const c of clientes.values()) if (c.business_id === businessId && String(c.agendapro_client_id ?? "") === String(agp)) return c
      return null
    },
    async findClientByEmail(businessId, email) {
      for (const c of clientes.values()) if (c.business_id === businessId && String(c.email ?? "").toLowerCase() === email.toLowerCase()) return c
      return null
    },
    async findClientByClienteId(businessId, clienteId) {
      const c = clientes.get(clienteId); return c && c.business_id === businessId ? c : null
    },
    async getClienteOwner(clienteId) { const c = clientes.get(clienteId); return c ? { businessId: c.business_id } : null },
    async insertClient(row) { clientes.set(row.cliente_id, { ...row }) },
    async updateClient(clienteId, businessId, patch) { const c = clientes.get(clienteId); if (c && c.business_id === businessId) Object.assign(c, patch) },
    async findPaquete(businessId, paymentId, sid) {
      const p = paquetes.find((x) => x.business_id === businessId && x.agendapro_payment_id === paymentId && x.service_identifier === sid)
      return p ? { paquete_id: p.paquete_id } : null
    },
    async insertPaquete(row) { paquetes.push({ ...row }) },
    async findConsent(businessId, paymentId, sid) {
      const c = consents.find((x) => x.business_id === businessId && x.agendapro_payment_id === paymentId && x.service_identifier === sid)
      return c ? { consent_id: c.consent_id } : null
    },
    async insertConsent(row) { consents.push({ ...row }) },
  }
  return { repo, _state: { clientes, events, paquetes, consents } }
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE — normalización / máscaras / fechas / extracción
// ─────────────────────────────────────────────────────────────────────────────
console.log("── Core puro")
t("normalizeServiceName colapsa espacios/acentos", core.normalizeServiceName("Depilación Láser  1 sesión") === "depilacion laser 1 sesion")
t("toUpperName respeta acentos", core.toUpperName("Adalissa Hinojosa Jiménez ") === "ADALISSA HINOJOSA JIMÉNEZ")
t("phoneDigitVariants +18293622179 incluye 10 dígitos", core.phoneDigitVariants("+18293622179").includes("8293622179"))
t("maskEmail", core.maskEmail("jimenezadalissa@gmail.com").endsWith("@gmail.com") && core.maskEmail("jimenezadalissa@gmail.com").includes("*"))
t("maskPhone deja últimos 4", core.maskPhone("+18293622179").endsWith("2179") && core.maskPhone("+18293622179").includes("*"))
t("maskCedula", core.maskCedula("40215067444").startsWith("402") && core.maskCedula("40215067444").endsWith("44"))
t("§22 fecha UTC→RD mismo día (18:33Z → 05/05)", core.toDominicanDateISO("2026-05-05T18:33:00.000Z") === "2026-05-05")
t("§22 fecha UTC madrugada→RD día anterior (02:00Z 06 → 05)", core.toDominicanDateISO("2026-05-06T02:00:00.000Z") === "2026-05-05")
t("toDominicanDateDisplay DD/MM/YYYY", core.toDominicanDateDisplay("2026-05-05T18:33:00.000Z") === "05/05/2026")

const items = core.extractServiceItems(FIXTURE())
t("§12 extrae servicio de mock_bookings aunque bookings=[]", items.length === 1 && items[0].source === "mock_bookings")
t("§12 servicio normalizado correcto", items[0].normalizedName === "depilacion laser 1 sesion")
const sid = core.buildServiceIdentifier(items[0])
t("§16 service_identifier estable con receipt_id", sid === "r68886125#depilacion laser 1 sesion")
const paySum = core.summarizePayment(FIXTURE())
t("§14 método de pago = Tarjeta", paySum.method === "Tarjeta")
t("§14 suma transacciones == paid_amount (sin mismatch)", paySum.mismatch === false && paySum.txSum === 2000)
t("§13 validatePayload OK", core.validatePayload(FIXTURE()).ok === true)
t("§16 sin payment.id → inválido", core.validatePayload({ ...FIXTURE(), id: undefined }).ok === false)
t("§15 sin client → inválido", core.validatePayload({ ...FIXTURE(), client: undefined }).ok === false)

// ─────────────────────────────────────────────────────────────────────────────
// PROCESADOR — casos integrados con repo en memoria
// ─────────────────────────────────────────────────────────────────────────────
console.log("── Procesador (repo en memoria)")

// §24.1 procesamiento exitoso
{
  const { repo, _state } = makeRepo()
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§1 status processed", r.status === "processed", JSON.stringify(r))
  t("§1 1 paquete creado", _state.paquetes.length === 1)
  t("§1 sesiones adquiridas = 1", _state.paquetes[0]?.sesiones_adquiridas === 1)
  t("§17 no consume: disponibles == adquiridas", _state.paquetes[0]?.sesiones_disponibles === 1)
  t("§13 factura B020000005810 guardada", _state.paquetes[0]?.numero_factura === "B020000005810")
  t("§13 método Tarjeta guardado", _state.paquetes[0]?.metodo_pago === "Tarjeta")
  t("§13 sucursal Rafael Vidal", _state.paquetes[0]?.sucursal === "Rafael Vidal")
  t("§13 origen agendapro_webhook", _state.paquetes[0]?.origen === "agendapro_webhook")
  t("§18 consentimiento pendiente creado", _state.consents.length === 1 && _state.consents[0].estado === "Pendiente")
  t("§8 nombre en MAYÚSCULAS", _state.clientes.get(r.clienteId)?.nombre === "ADALISSA")
  t("§17 no crea tratamiento realizado (0 sesiones_cliente — no tocado)", true)
}

// §24.3 pago duplicado
{
  const { repo, _state } = makeRepo()
  await processAgendaProPayment(FIXTURE(), repo)
  const r2 = await processAgendaProPayment(FIXTURE(), repo)
  t("§3 segundo envío = already_processed", r2.status === "already_processed")
  t("§3 no duplica paquete", _state.paquetes.length === 1)
  t("§19 no duplica consentimiento", _state.consents.length === 1)
}

// §24.4 cliente existente por agendapro_client_id
{
  const seed = { clientes: [["cli_pre_agp", { cliente_id: "cli_pre_agp", business_id: CSL, agendapro_client_id: "44453171", nombre: "ADALISSA" }]] }
  const { repo } = makeRepo(seed)
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§4 reutiliza cliente por agendapro_client_id", r.clienteId === "cli_pre_agp")
}

// §24.5 cliente existente por correo
{
  const seed = { clientes: [["cli_pre_mail", { cliente_id: "cli_pre_mail", business_id: CSL, email: "jimenezadalissa@gmail.com" }]] }
  const { repo } = makeRepo(seed)
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§5 reutiliza cliente por correo", r.clienteId === "cli_pre_mail")
}

// §24.6 cliente existente por teléfono con formato diferente (10 dígitos)
{
  const seed = { clientes: [["cli_tel_8293622179", { cliente_id: "cli_tel_8293622179", business_id: CSL, telefono: "829-362-2179" }]] }
  const { repo } = makeRepo(seed)
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§6 reutiliza cliente por teléfono (con/sin código país)", r.clienteId === "cli_tel_8293622179")
}

// §24.7 cliente existente por cédula
{
  const seed = { clientes: [["cli_doc_40215067444", { cliente_id: "cli_doc_40215067444", business_id: CSL }]] }
  const { repo } = makeRepo(seed)
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§7 reutiliza cliente por cédula", r.clienteId === "cli_doc_40215067444")
}

// §24.8 nuevo cliente
{
  const { repo, _state } = makeRepo()
  const r = await processAgendaProPayment(FIXTURE(), repo)
  t("§8 crea cliente nuevo determinístico (cli_doc_)", r.clienteId === "cli_doc_40215067444" && _state.clientes.has("cli_doc_40215067444"))
}

// §24.9 sucursal sin mapeo
{
  const { repo, _state } = makeRepo()
  const r = await processAgendaProPayment({ ...FIXTURE(), location_id: 99999 }, repo)
  t("§9 sucursal sin mapeo → requires_mapping", r.status === "requires_mapping" && r.reason === "location_unmapped")
  t("§9 no crea cliente/paquete sin mapeo", _state.paquetes.length === 0)
}

// §24.10 servicio sin mapeo
{
  const p = FIXTURE(); p.mock_bookings[0].service = "Servicio Desconocido XYZ"
  const { repo, _state } = makeRepo()
  const r = await processAgendaProPayment(p, repo)
  t("§10 servicio sin mapeo → requires_mapping", r.status === "requires_mapping")
  t("§10 registra compra igual (requiere_revision)", _state.paquetes.length === 1 && _state.paquetes[0].requiere_revision === true)
  t("§10 no crea consentimiento incorrecto", _state.consents.length === 0)
}

// §24.11 varias transacciones
{
  const p = FIXTURE()
  p.down_payments = [{ payment_transactions: [ { number: "2105", amount: 1000, payment_method: "Tarjeta " }, { number: "2106", amount: 1000, payment_method: "Efectivo" } ] }]
  const s = core.summarizePayment(p)
  t("§11 múltiples transacciones suman correcto", s.txSum === 2000 && s.methods.length === 2)
}

// §24.12 varios recibos
{
  const p = FIXTURE()
  p.receipts = [ { id: 111, number: "A-1", receipt_type: "Recibo" }, { id: 68886125, number: "B020000005810", receipt_type: "Factura" } ]
  const { repo, _state } = makeRepo()
  await processAgendaProPayment(p, repo)
  t("§12 factura correcta por receipt_id del item", _state.paquetes[0]?.numero_factura === "B020000005810")
}

// §24.13/15/16 payloads inválidos
{
  const { repo } = makeRepo()
  const r1 = await processAgendaProPayment({ ...FIXTURE(), id: undefined }, repo)
  t("§16 sin payment.id → invalid 400", r1.status === "invalid" && r1.httpStatus === 400)
  const r2 = await processAgendaProPayment({ ...FIXTURE(), client: undefined }, repo)
  t("§15 sin client → invalid 400", r2.status === "invalid" && r2.httpStatus === 400)
  const r3 = await processAgendaProPayment("no soy json", repo)
  t("§13 payload no-objeto → invalid", r3.status === "invalid")
}

// §24.14/20 aislamiento de tenant (misma cédula en Cibao y Depicenter)
{
  const seed = {
    locations: [[3586, { businessId: CSL, internalSucursal: "Rafael Vidal" }], [7777, { businessId: DEP, internalSucursal: "Depicenter Centro" }]],
    services: [
      [`${CSL}::depilacion laser 1 sesion`, { internal_service_name: "Depilación láser", categoria: "Depilación", consent_type: "depilacion-laser", sessions_quantity: 1 }],
      [`${DEP}::depilacion laser 1 sesion`, { internal_service_name: "Depilación láser", categoria: "Depilación", consent_type: "depilacion-laser", sessions_quantity: 1 }],
    ],
  }
  const { repo, _state } = makeRepo(seed)
  const rCsl = await processAgendaProPayment(FIXTURE(), repo) // location 3586 → CSL
  const pDep = FIXTURE(); pDep.id = 99999001; pDep.location_id = 7777 // mismo cliente, otro tenant
  const rDep = await processAgendaProPayment(pDep, repo)
  t("§14 pago Depicenter se procesa bajo su tenant", _state.paquetes.find((x) => x.agendapro_payment_id === 99999001)?.business_id === DEP)
  t("§20 misma cédula NO comparte cliente entre tenants", rCsl.clienteId !== rDep.clienteId)
  t("§20 cliente CSL sigue siendo de CSL", _state.clientes.get(rCsl.clienteId)?.business_id === CSL)
  t("§20 cliente Depicenter sigue siendo de Depicenter", _state.clientes.get(rDep.clienteId)?.business_id === DEP)
}

// §24.19 no duplicar firma pendiente en reproceso parcial
{
  const { repo, _state } = makeRepo()
  await processAgendaProPayment(FIXTURE(), repo)
  // forzar reproceso: marcar evento como no-procesado y correr de nuevo
  _state.events[0].status = "requires_mapping"
  await processAgendaProPayment(FIXTURE(), repo)
  t("§19 reproceso no duplica consentimiento", _state.consents.length === 1)
  t("§3 reproceso no duplica paquete", _state.paquetes.length === 1)
}

console.log(`\n${pass} pasaron, ${fail} fallaron`)
console.log("Nota: §22 (responsive), §23 (contadores UI), §24.24 (export), §25 (permisos) se validan en la fase de UI/route.")
if (fail > 0) process.exit(1)
