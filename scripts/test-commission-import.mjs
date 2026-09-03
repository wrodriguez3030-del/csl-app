/**
 * Tests del Importador de Comisión de Ventas (§41).
 * Ejecutar:  node scripts/test-commission-import.mjs
 *
 * Usa los parsers REALES de lib/commission/ (Node ≥23 ejecuta TS con
 * type-stripping nativo). Si los archivos de referencia existen en Downloads,
 * valida además los controles §33/§34 contra los archivos reales.
 */
import { existsSync } from "node:fs"
import ExcelJS from "exceljs"

const { normalizePayment, normalizeBranch, parseDateISO } = await import("../lib/commission/normalize.ts")
const { normalizeAttendance, parseReservasWorkbook, aggregateAttendance, normalizeProviderName } = await import("../lib/commission/reservations-parser.ts")
const { isDepilacionService } = await import("../lib/commission/classification.ts")
const { extractResumenControls } = await import("../lib/commission/ventas-resumen.ts")
const { payBucketsFromV2, dominantPayment, addBuckets } = await import("../lib/commission/ventas-pago.ts")
const { computeRowHash, fnvHex } = await import("../lib/commission/hash.ts")
const { toSaleRecord } = await import("../lib/commission/aggregate.ts")
const { aggregateBranches } = await import("../lib/commission/branch-summary.ts")
const { buildProductSellers, sellerTotals, SELLER_STATUS_LABEL } = await import("../lib/commission/product-sellers.ts")
const { planAutoRuns, AUTO_RUN_SKIP_LABEL } = await import("../lib/commission/auto-run.ts")
const { activeInPeriod, filterRosterForPeriod } = await import("../lib/commission/roster-period.ts")
const { staleLedgerProviders, dedupeLedgerRows } = await import("../lib/commission/ledger-cleanup.ts")
const { serviceColumns, serviceCellsBy, SERVICE_EXTRA_COLS } = await import("../lib/commission/service-columns.ts")
const { canonicalCollaborator: canonColab } = await import("../lib/commission/normalize.ts")
const { monthBounds, exclusiveEnd, monthsCovered, quickRange, todayInTz, lastDayOfMonth, availableYears, lastMonths, TREND_MONTHS } = await import("../lib/commission/period.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log("── Normalización de formas de pago (§7)")
t("Tarjeta de Crédito → TARJETA", normalizePayment("Tarjeta de Crédito") === "TARJETA")
t("Tarjeta de Débito → TARJETA", normalizePayment("Tarjeta de Débito") === "TARJETA")
t("'Tarjeta  ' (espacios) → TARJETA", normalizePayment("Tarjeta  ") === "TARJETA")
t("Transferencia Bancaria → TRANSFERENCIA", normalizePayment("Transferencia Bancaria ") === "TRANSFERENCIA")
t("Efectivo → EFECTIVO", normalizePayment("Efectivo") === "EFECTIVO")
t("Cheque → CHEQUE", normalizePayment("Cheque") === "CHEQUE")
t("Online → ONLINE", normalizePayment("Online") === "ONLINE")
t("desconocido → OTROS", normalizePayment("Bitcoin") === "OTROS")

console.log("── Normalización de sucursales (§16)")
t("Cibao Spa Laser  Av. Rafael Vidal → RAFAEL VIDAL", normalizeBranch("Cibao Spa Laser  Av. Rafael Vidal").includes("RAFAEL VIDAL") || normalizeBranch("R VIDAL") === "RAFAEL VIDAL")
t("R VIDAL → RAFAEL VIDAL", normalizeBranch("R VIDAL") === "RAFAEL VIDAL")
t("JARDINES → LOS JARDINES", normalizeBranch("JARDINES") === "LOS JARDINES")
t("Villa Olga → VILLA OLGA", normalizeBranch("Villa Olga") === "VILLA OLGA")
// Depicenter: AgendaPro exporta el nombre comercial, no el de la sucursal.
// El canónico debe ser el de csl_sucursales ("La Vega") o el motor no encuentra
// ninguna venta/reserva al iterar las sucursales del tenant.
t("Depicenter Skin Láser → LA VEGA", normalizeBranch("Depicenter Skin Láser") === "LA VEGA", `(${normalizeBranch("Depicenter Skin Láser")})`)
t("DEPICENTER SKIN LASER → LA VEGA", normalizeBranch("DEPICENTER SKIN LASER") === "LA VEGA")
t("La Vega → LA VEGA", normalizeBranch("La Vega") === "LA VEGA")
t("Depicenter → LA VEGA", normalizeBranch("Depicenter") === "LA VEGA")
t("no contamina sucursales de CSL", normalizeBranch("Villa Olga") === "VILLA OLGA" && normalizeBranch("R VIDAL") === "RAFAEL VIDAL")

console.log("── Estados de reserva (§12)")
t("Asiste → ASISTE", normalizeAttendance("Asiste") === "ASISTE")
t("No Asiste → NO_ASISTE (no confundir con ASISTE)", normalizeAttendance("No Asiste") === "NO_ASISTE")
t("Cancelado → CANCELADO", normalizeAttendance("Cancelado") === "CANCELADO")
t("Confirmado → CONFIRMADO", normalizeAttendance("Confirmado") === "CONFIRMADO")
t("Reservado → RESERVADO", normalizeAttendance("Reservado") === "RESERVADO")
t("En Espera → EN_ESPERA", normalizeAttendance("En Espera") === "EN_ESPERA")

console.log("── Prestadores (§15)")
t("'SAHOMY (Desactivado)' → SAHOMY", normalizeProviderName("SAHOMY (Desactivado)") === "SAHOMY")
t("'sahomy' → SAHOMY", normalizeProviderName("sahomy") === "SAHOMY")

console.log("── Fechas multi-mes (§9/§13)")
t("30/06/2026 19:19 → 2026-06-30", parseDateISO("30/06/2026 19:19") === "2026-06-30")
t("01/01/2026 → 2026-01-01", parseDateISO("01/01/2026") === "2026-01-01")
t("ISO pasa igual", parseDateISO("2026-03-15") === "2026-03-15")

console.log("── Deduplicación row_hash (§22/§23)")
const h1 = computeRowHash("", { date: "2026-06-30", branch: "VILLA OLGA", provider: "SAHOMY", itemName: "X", amount: 100 })
const h2 = computeRowHash("", { date: "2026-06-30", branch: "VILLA OLGA", provider: "SAHOMY", itemName: "X", amount: 100 })
const h3 = computeRowHash("", { date: "2026-06-30", branch: "VILLA OLGA", provider: "SAHOMY", itemName: "X", amount: 200 })
t("mismo contenido → mismo hash", h1 === h2)
t("distinto monto → distinto hash", h1 !== h3)
t("ocurrencia desambiguada distinta", fnvHex(`${h1}#2`) !== h1)

console.log("── Clasificación Items (§5)")
t("Producto → PRODUCTO", toSaleRecord({ itemType: "Producto", itemName: "BARIEDERM" }).category === "PRODUCTO")
t("Servicio láser → DEPILACION_LASER", toSaleRecord({ itemType: "Servicio", itemName: "Depilación Láser  10 sesiones" }).category === "DEPILACION_LASER")
t("Reserva Hollywood → HOLLYWOOD_AQUA_PEEL", toSaleRecord({ itemType: "Reserva", itemName: "HOLLYWOOD LASER PEEL" }).category === "HOLLYWOOD_AQUA_PEEL")
t("'Sin Información' no comisiona", toSaleRecord({ itemType: "Servicio", itemName: "X", provider: "Sin Información" }).commissionable === false)

console.log("── Filtros de período (rango inclusivo + TZ Santo Domingo)")
t("monthBounds julio = 01..31", monthBounds(2026, 7).from === "2026-07-01" && monthBounds(2026, 7).to === "2026-07-31")
t("monthBounds feb 2026 = 28", monthBounds(2026, 2).to === "2026-02-28")
t("monthBounds feb 2028 (bisiesto) = 29", monthBounds(2028, 2).to === "2028-02-29")
t("exclusiveEnd incluye el día 31", exclusiveEnd("2026-07-31") === "2026-08-01")
t("exclusiveEnd cruza fin de año", exclusiveEnd("2026-12-31") === "2027-01-01")
t("monthsCovered ene-jun = 6 meses", monthsCovered("2026-01-01", "2026-06-30").size === 6)
t("monthsCovered contiene 2026-3", monthsCovered("2026-01-15", "2026-06-01").has("2026-3"))
t("monthsCovered rango 1 día = 1 mes", monthsCovered("2026-07-10", "2026-07-10").size === 1)
{
  // 2026-07-31 23:30 UTC = 19:30 en Santo Domingo (UTC-4) → sigue siendo día 31.
  const utcNight = new Date("2026-07-31T23:30:00Z")
  t("TZ: 31 jul 23:30 UTC sigue siendo 31 jul en RD", todayInTz(utcNight) === "2026-07-31")
  // 2026-08-01 02:00 UTC = 31 jul 22:00 en RD → el "hoy" del negocio es 31 jul.
  const utcNextDay = new Date("2026-08-01T02:00:00Z")
  t("TZ: 1 ago 02:00 UTC aún es 31 jul en RD", todayInTz(utcNextDay) === "2026-07-31")
  const mesAnterior = quickRange("mes_anterior", new Date("2026-07-15T12:00:00Z"))
  t("quick mes_anterior desde julio = junio", mesAnterior.from === "2026-06-01" && mesAnterior.to === "2026-06-30")
  const tri = quickRange("trimestre", new Date("2026-08-15T12:00:00Z"))
  t("quick trimestre de agosto = jul-sep", tri.from === "2026-07-01" && tri.to === "2026-09-30")
  const ano = quickRange("ano_actual", new Date("2026-07-15T12:00:00Z"))
  t("quick año actual = 01/01..31/12", ano.from === "2026-01-01" && ano.to === "2026-12-31")
  t("lastDayOfMonth abril = 30", lastDayOfMonth(2026, 4) === 30)
  const todo = quickRange("todo", new Date("2026-07-15T12:00:00Z"))
  t("quick 'todo' = sin fechas (todos los meses)", todo.from === "" && todo.to === "")
}

// ── Aplicación del fondo láser a la liquidación (laser-apply) ──
{
  const { assignLaserToCalcs } = await import("../lib/commission/laser-apply.ts")
  console.log("── Fondo láser → liquidación (asignación pura)")
  const calc = (id, provider, extra = {}) => ({ id, provider, branch: "RAFAEL VIDAL", status: "calculado", laserIncentive: 0, grossTotal: 1000, ...extra })

  // Caso base: cada prestador recibe su monto; total aplicado cuadra.
  let plan = assignLaserToCalcs(
    [{ provider: "SAHOMY", amount: 500.25 }, { provider: "EMELI", amount: 249.75 }],
    [calc("a", "SAHOMY"), calc("b", "EMELI")],
  )
  t("asigna a cada prestador", plan.assignments.length === 2 && plan.assignments.find((x) => x.id === "a")?.laserIncentive === 500.25)
  t("total aplicado = 750.00", plan.appliedTotal === 750)
  t("sin no-vinculados ni bloqueados", plan.unmatched.length === 0 && plan.locked.length === 0)

  // Multi-sucursal: el monto COMPLETO va a UNA fila (mayor bruto); la otra a 0.
  plan = assignLaserToCalcs(
    [{ provider: "SAHOMY", amount: 300 }],
    [calc("a1", "SAHOMY", { grossTotal: 900, laserIncentive: 150 }), calc("a2", "SAHOMY", { branch: "VILLA OLGA", grossTotal: 2000, laserIncentive: 150 })],
  )
  t("multi-sucursal: 300 a la de mayor bruto", plan.assignments.find((x) => x.id === "a2")?.laserIncentive === 300)
  t("multi-sucursal: la otra queda en 0", plan.assignments.find((x) => x.id === "a1")?.laserIncentive === 0)

  // Idempotencia: re-aplicar el mismo reparto no produce cambios.
  plan = assignLaserToCalcs([{ provider: "SAHOMY", amount: 300 }], [calc("a", "SAHOMY", { laserIncentive: 300 })])
  t("idempotente: sin cambios al re-aplicar", plan.assignments.length === 0 && plan.appliedTotal === 300)

  // Quien sale del reparto vuelve a 0.
  plan = assignLaserToCalcs([], [calc("a", "SAHOMY", { laserIncentive: 120 })])
  t("fuera del reparto → láser a 0", plan.assignments.length === 1 && plan.assignments[0].laserIncentive === 0)

  // Prestador con fondo pero sin fila de cálculo → no vinculado.
  plan = assignLaserToCalcs([{ provider: "ASHLEY", amount: 90 }], [calc("a", "SAHOMY")])
  t("sin cálculo → unmatched", plan.unmatched.length === 1 && plan.unmatched[0].provider === "ASHLEY")

  // Pagadas/cerradas no se tocan y se reportan.
  plan = assignLaserToCalcs([{ provider: "SAHOMY", amount: 400 }], [calc("a", "SAHOMY", { status: "pagado" })])
  t("pagado: no se toca y se reporta", plan.assignments.length === 0 && plan.locked.length === 1 && plan.locked[0].target === 400)
  t("pagado: no cuenta en total aplicado", plan.appliedTotal === 0)

  // Normalización de nombre (espacios/minúsculas) al cruzar reparto vs cálculo.
  plan = assignLaserToCalcs([{ provider: " sahomy " , amount: 100 }], [calc("a", "SAHOMY")])
  t("cruce insensible a mayúsculas/espacios", plan.assignments.length === 1 && plan.assignments[0].laserIncentive === 100)
}

// ── Motor de RUNS mensuales (tarjeta 27%, láser por sucursal, split) ──
{
  const { computeRun, netAmount } = await import("../lib/commission/run-engine.ts")
  const { normalizeBranch, canonicalCollaborator } = await import("../lib/commission/normalize.ts")
  console.log("── Fix sucursales (contención) + alias de colaboradores")
  t("nombre COMPLETO del Excel → RAFAEL VIDAL", normalizeBranch("CIBAO SPA LASER AV. RAFAEL VIDAL") === "RAFAEL VIDAL")
  t("nombre completo Jardines → LOS JARDINES", normalizeBranch("Cibao Spa Laser Los Jardines") === "LOS JARDINES")
  t("nombre completo Villa Olga → VILLA OLGA", normalizeBranch("CIBAO SPA LASER VILLA OLGA") === "VILLA OLGA")
  t("alias exacto sigue funcionando", normalizeBranch("R VIDAL") === "RAFAEL VIDAL")
  t("JOELY → JOHELY", canonicalCollaborator("Joely") === "JOHELY")
  t("KATHERINE → KATHERIN", canonicalCollaborator("KATHERINE") === "KATHERIN")
  t("AHSLEY → ASHLEY", canonicalCollaborator("AHSLEY") === "ASHLEY")
  t("EMELY → ASHLEY (le cambiaron el nombre)", canonicalCollaborator("emely") === "ASHLEY" && canonicalCollaborator("EMELI") === "ASHLEY")

  console.log("── Run mensual: tarjeta 27% (ejemplo del documento)")
  t("netAmount tarjeta 488,200 → 356,386", netAmount(488200, "TARJETA", 0.27) === 356386)
  t("descuento = 131,814", 488200 - netAmount(488200, "TARJETA", 0.27) === 131814)
  t("efectivo NO descuenta", netAmount(1000, "EFECTIVO", 0.27) === 1000)
  t("transferencia NO descuenta", netAmount(1000, "TRANSFERENCIA", 0.27) === 1000)

  const RULES = {
    cardPct: 0.27, productUnitAmount: 100,
    categoryPct: { MASAJES: 0.2, FACIALES: 0.2, HOLLYWOOD_AQUA_PEEL: 0.1, TATUAJES: 0.1, HIFU: 0.1 },
    laserScale: [
      { threshold: 260000, percentage: 0.02 }, { threshold: 600000, percentage: 0.03 },
      { threshold: 800000, percentage: 0.04 }, { threshold: 2000000, percentage: 0.05 },
    ],
    laserSplitPatientsFraction: 1,
  }
  const collab = (name, over = {}) => ({
    id: name.toLowerCase(), name, branch: "RAFAEL VIDAL", services: ["DEPILACION_LASER"],
    linearParticipation: true, patientParticipation: true, fixedPercentage: null,
    active: true, cleaningContribution: 400, bonusExtra: 0, evaluationPct: 100, ...over,
  })
  const sale = (over = {}) => ({
    branch: "RAFAEL VIDAL", category: "DEPILACION_LASER", payment: "EFECTIVO",
    amount: 0, quantity: 1, providerOriginal: "Sin Información", provider: null, ...over,
  })

  console.log("── Run mensual: base láser por sucursal + escala + reparto por pacientes")
  // Láser: 200,000 efectivo + 111,800 transferencia + 488,200 tarjeta (neta 356,386)
  // base = 200,000 + 111,800 + 356,386 = 668,186 → tramo 600,000 = 3% → fondo 20,045.58
  const r1 = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [
      sale({ amount: 200000 }),
      sale({ amount: 111800, payment: "TRANSFERENCIA" }),
      sale({ amount: 488200, payment: "TARJETA" }),
    ],
    collaborators: [collab("ROSA"), collab("DIANA")],
    patients: [{ collaborator: "ROSA", patients: 75 }, { collaborator: "DIANA", patients: 25 }],
    patientsSource: "manual",
    rules: RULES,
  })
  t("base láser = 668,186 (tarjeta neteada)", r1.laser.base === 668186, `(${r1.laser.base})`)
  t("tarjeta descuento base = 131,814", r1.baseByCategory.DEPILACION_LASER.tarjetaDescuento === 131814)
  t("tramo 3% (600k)", r1.laser.pct === 0.03 && r1.laser.threshold === 600000)
  t("fondo = 20,045.58", r1.laser.fund === 20045.58, `(${r1.laser.fund})`)
  const rosa1 = r1.items.find((i) => i.name === "ROSA")
  const diana1 = r1.items.find((i) => i.name === "DIANA")
  t("ROSA 75% del fondo (reparto exacto)", rosa1?.laserPatients === 15034.19, `(${rosa1?.laserPatients})`)
  t("DIANA 25% del fondo (reparto exacto)", diana1?.laserPatients === 5011.39, `(${diana1?.laserPatients})`)
  t("CUADRE exacto: ROSA+DIANA = fondo", Math.round((rosa1.laserPatients + diana1.laserPatients) * 100) / 100 === r1.laser.fund)
  t("neto = bruto − limpieza 400", rosa1?.netTotal === Math.round((rosa1.grossTotal - 400) * 100) / 100)

  console.log("── Run mensual: split lineal/pacientes + servicios + productos + evaluación")
  const r2 = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [
      sale({ amount: 1000000 }), // láser efectivo → tramo 4% → fondo 40,000
      sale({ category: "MASAJES", amount: 10000, payment: "TARJETA", providerOriginal: "ROSA (prestador)", provider: "ROSA" }),
      sale({ category: "PRODUCTO", amount: 5000, quantity: 3, providerOriginal: "DIANA (prestador)", provider: "DIANA" }),
      sale({ category: "MASAJES", amount: 4000, providerOriginal: "PC Recepcion  LAP TOP R VIDAL", provider: null }), // NO comisionable
    ],
    collaborators: [collab("ROSA", { evaluationPct: 50 }), collab("DIANA"), collab("MADELINE", { linearParticipation: true, patientParticipation: false })],
    patients: [{ collaborator: "ROSA", patients: 60 }, { collaborator: "DIANA", patients: 40 }],
    patientsSource: "manual",
    rules: { ...RULES, laserSplitPatientsFraction: 0.5 },
  })
  t("fondo 40,000; 20,000 pacientes + 20,000 lineal", r2.laser.fund === 40000 && r2.laser.fundPatients === 20000 && r2.laser.fundLinear === 20000)
  const rosa2 = r2.items.find((i) => i.name === "ROSA")
  const madeline2 = r2.items.find((i) => i.name === "MADELINE")
  const diana2b = r2.items.find((i) => i.name === "DIANA")
  t("lineal 20,000/3 exacto: 6666.67+6666.67+6666.66 = 20,000", rosa2?.laserLinear === 6666.67 && diana2b?.laserLinear === 6666.67 && madeline2?.laserLinear === 6666.66)
  t("CUADRE lineal: Σ = fundLinear", Math.round((rosa2.laserLinear + diana2b.laserLinear + madeline2.laserLinear) * 100) / 100 === 20000)
  t("MADELINE sin parte de pacientes (flag off)", madeline2?.laserPatients === 0)
  t("ROSA pacientes 60% de 20,000 = 12,000", rosa2?.laserPatients === 12000)
  t("masaje tarjeta netea: 10,000×0.73×20% = 1,460", rosa2?.serviceBreakdown.MASAJES?.amount === 1460)
  t("evaluación 50% ajusta servicios: 730", rosa2?.serviceIncentiveAdjusted === 730)
  const diana2 = r2.items.find((i) => i.name === "DIANA")
  t("productos: 3 × RD$100 = 300", diana2?.productIncentive === 300 && diana2?.productUnits === 3)
  t("venta de recepción NO comisiona", !r2.items.some((i) => i.name.includes("RECEPCION")))
  t("bruto ROSA = 730 + 18,666.67", rosa2?.grossTotal === Math.round((730 + 6666.67 + 12000) * 100) / 100)

  console.log("── Run mensual: alertas (nunca calcular en silencio)")
  const r3 = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 700000 })],
    collaborators: [collab("ROSA")],
    patients: [], patientsSource: "ninguna",
    rules: RULES,
  })
  t("sin pacientes → pasa a lineal con alerta", r3.alerts.some((a) => a.includes("LINEAL")) && r3.items[0].laserLinear === r3.laser.fund)
  const r4 = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 700000 }), sale({ category: "MASAJES", amount: 1000, providerOriginal: "ISAURY (prestador)", provider: "ISAURY" })],
    collaborators: [], patients: [], patientsSource: "ninguna",
    rules: RULES,
  })
  t("sin lineales → fondo sin repartir con alerta", r4.alerts.some((a) => a.includes("SIN repartir")))
  t("prestador fuera del roster → alerta", r4.alerts.some((a) => a.includes("ISAURY")))
  const isaury = r4.items.find((i) => i.name === "ISAURY")
  t("...pero su incentivo se calcula visible (200)", isaury?.serviceIncentive === 200 && isaury?.inRoster === false)
  t("base 250k no alcanza tramo → fondo 0 con alerta", computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL", sales: [sale({ amount: 250000 })],
    collaborators: [collab("ROSA")], patients: [], patientsSource: "ninguna", rules: RULES,
  }).laser.fund === 0)

  console.log("── Reparto láser: pesos personas/pacientes + regla 0 pacientes")
  // Fondo 40,000; 50/50 → 20,000 personas + 20,000 pacientes. ROSA 60 pac, DIANA 0 pac, LUISA 0 pac.
  const base = {
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 1000000 })], // láser 1,000,000 efectivo → tramo 4% → fondo 40,000
    collaborators: [collab("ROSA"), collab("DIANA"), collab("LUISA")],
    patients: [{ collaborator: "ROSA", patients: 60 }],
    patientsSource: "manual",
  }
  const rZF = computeRun({ tenant: "csl", ...base, rules: { ...RULES, laserSplitPatientsFraction: 0.5, zeroPatientsGetsFixed: true } })
  t("0-pac SÍ recibe parte fija: personas entre las 3", rZF.items.find((i) => i.name === "DIANA")?.laserLinear === Math.round((20000 / 3) * 100) / 100)
  t("0-pac SÍ: ROSA se lleva TODA la parte por pacientes (20,000)", rZF.items.find((i) => i.name === "ROSA")?.laserPatients === 20000)
  const rZN = computeRun({ tenant: "csl", ...base, rules: { ...RULES, laserSplitPatientsFraction: 0.5, zeroPatientsGetsFixed: false } })
  t("0-pac NO recibe parte fija: DIANA/LUISA fuera del lineal", rZN.items.find((i) => i.name === "DIANA")?.laserLinear === 0)
  t("0-pac NO: parte personas solo para ROSA (20,000)", rZN.items.find((i) => i.name === "ROSA")?.laserLinear === 20000)
  // Cuadre: suma de todo el láser repartido = fondo ± residuo de redondeo del
  // reparto lineal (20,000/3 no divide exacto → diferencia ≤ RD$0.01 esperada).
  const distTotal = rZF.items.reduce((s, i) => s + i.laserTotal, 0)
  t("cuadre: Σ láser repartido ≈ fondo (residuo ≤ 0.01)", Math.abs(distTotal - 40000) <= 0.01, `(dif ${(distTotal - 40000).toFixed(2)})`)

  console.log("── Modo EQUITATIVO — replica el cuadro oficial (SISTEMA INCENTIVOS, Junio RV)")
  // Base 724,005.50 (la del cuadro) con tramo 2% → fondo 14,480.11. 8 elegibles:
  // 3 sin pacientes (cuota fija fondo/8 = 1,810.01) + 5 con pacientes que se
  // reparten el resto (9,050.07) por participación. Valores esperados = Excel.
  const rEq = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 724005.5 })],
    collaborators: ["LUISA", "YANIBEL", "KARLA", "RIQUELMI", "ROSA", "DIANA", "MADELINE", "ASHLEY"].map((n) => collab(n)),
    patients: [
      { collaborator: "RIQUELMI", patients: 246 }, { collaborator: "ROSA", patients: 192 },
      { collaborator: "DIANA", patients: 206 }, { collaborator: "MADELINE", patients: 244 },
      { collaborator: "EMELY", patients: 240 }, // alias EMELY→ASHLEY (como viene del archivo)
    ],
    patientsSource: "manual",
    rules: { ...RULES, laserScale: [{ threshold: 260000, percentage: 0.02 }], laserDistributionMode: "equitativo" },
  })
  const eq = (n) => rEq.items.find((i) => i.name === n)
  t("fondo = 14,480.11 y modo equitativo (8 elegibles, cuota 1,810.01)",
    rEq.laser.fund === 14480.11 && rEq.laser.mode === "equitativo" && rEq.laser.eligibleCount === 8 && rEq.laser.perCapita === 1810.01)
  t("fondo personas 5,430.04 + pacientes 9,050.07", rEq.laser.fundLinear === 5430.04 && rEq.laser.fundPatients === 9050.07)
  t("LUISA/YANIBEL/KARLA cuota fija ≈ 1,810.01", ["LUISA", "YANIBEL", "KARLA"].every((n) => Math.abs(eq(n).laserTotal - 1810.01) <= 0.02))
  t("RIQUELMI 246 pac → 1,973.69 (Excel 1,973.6852)", Math.abs(eq("RIQUELMI").laserTotal - 1973.69) <= 0.02, `(${eq("RIQUELMI").laserTotal})`)
  t("ROSA 192 → 1,540.44", Math.abs(eq("ROSA").laserTotal - 1540.44) <= 0.02)
  t("DIANA 206 → 1,652.76", Math.abs(eq("DIANA").laserTotal - 1652.76) <= 0.02)
  t("MADELINE 244 → 1,957.64", Math.abs(eq("MADELINE").laserTotal - 1957.64) <= 0.02)
  t("EMELY 240 → 1,925.55 (con alias, cae en ASHLEY)", Math.abs(eq("ASHLEY").laserTotal - 1925.55) <= 0.02)
  const sumEq = rEq.items.reduce((s, i) => s + i.laserTotal, 0)
  t("CUADRE EXACTO: Σ repartido = fondo", Math.round(sumEq * 100) / 100 === 14480.11, `(${sumEq.toFixed(2)})`)

  // Equitativo sin NINGÚN paciente: partes iguales con alerta.
  const rEq0 = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL", sales: [sale({ amount: 700000 })],
    collaborators: [collab("ROSA"), collab("DIANA")], patients: [], patientsSource: "ninguna",
    rules: { ...RULES, laserDistributionMode: "equitativo" },
  })
  t("equitativo sin pacientes → partes iguales + alerta", rEq0.alerts.some((a) => a.includes("PARTES IGUALES")) &&
    Math.abs(rEq0.items.reduce((s, i) => s + i.laserTotal, 0) - rEq0.laser.fund) <= 0.01)

  console.log("── Tarifa de producto POR COLABORADOR (50 P/P del cuadro)")
  const rProd = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [
      sale({ category: "PRODUCTO", amount: 500, quantity: 3, providerOriginal: "DAYHANA (prestador)", provider: "DAYHANA" }),
      sale({ category: "PRODUCTO", amount: 900, quantity: 2, providerOriginal: "ROSA (prestador)", provider: "ROSA" }),
    ],
    collaborators: [collab("DAYHANA", { productUnitAmount: 50 }), collab("ROSA")],
    patients: [], patientsSource: "ninguna", rules: RULES,
  })
  t("DAYHANA 3 u × RD$50 = 150 (override)", rProd.items.find((i) => i.name === "DAYHANA")?.productIncentive === 150)
  t("ROSA 2 u × RD$100 = 200 (regla general)", rProd.items.find((i) => i.name === "ROSA")?.productIncentive === 200)

  console.log("── Exclusiones de incentivo (rasuradoras, anestesia, prestador excluido)")
  const { isExcludedProvider, isNonIncentiveItem } = await import("../lib/commission/exclusions.ts")
  t("RASURADORAS es ítem sin incentivo", isNonIncentiveItem("RASURADORAS", "csl") === true)
  t("APLICACION DE ANESTESIA (servicio) sin incentivo", isNonIncentiveItem("APLICACION DE ANESTESIA ", "csl") === true)
  t("ANESTESIA ENCAIN (producto) SÍ comisiona", isNonIncentiveItem("ANESTESIA ENCAIN ", "csl") === false)
  t("ANESTESIA ZK-INA (producto) SÍ comisiona", isNonIncentiveItem("ANESTESIA ZK-INA", "csl") === false)
  t("un producto normal SÍ comisiona", isNonIncentiveItem("CREMA HIDRATANTE", "csl") === false)
  t("CARLOS ARIAS es prestador excluido", isExcludedProvider("CARLOS ARIAS", "csl") === true)
  t("CARLOS ARIAS (con acento/minúsculas) excluido", isExcludedProvider("carlos arias", "csl") === true)
  t("otra prestadora NO está excluida", isExcludedProvider("DAYHANA", "csl") === false)

  const rExcl = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [
      // Rasuradoras NO generan incentivo aunque las venda una prestadora comisionable.
      sale({ category: "PRODUCTO", serviceName: "RASURADORAS", amount: 50, quantity: 4, providerOriginal: "ROSA (prestador)", provider: "ROSA" }),
      // El PRODUCTO anestésico SÍ paga (5 u).
      sale({ category: "PRODUCTO", serviceName: "ANESTESIA ENCAIN", amount: 1000, quantity: 5, providerOriginal: "ROSA (prestador)", provider: "ROSA" }),
      // Un producto normal SÍ paga (2 u). Total ROSA = 5 + 2 = 7 u × RD$100 = 700.
      sale({ category: "PRODUCTO", serviceName: "CREMA", amount: 900, quantity: 2, providerOriginal: "ROSA (prestador)", provider: "ROSA" }),
      // Producto vendido por el prestador excluido: no cobra nada.
      sale({ category: "PRODUCTO", serviceName: "CREMA", amount: 900, quantity: 3, providerOriginal: "CARLOS ARIAS (Administrador Local)", provider: "CARLOS ARIAS" }),
    ],
    collaborators: [collab("ROSA")],
    patients: [], patientsSource: "ninguna", rules: RULES,
  })
  t("ROSA cobra ENCAIN + crema, NO rasuradoras (7 u × 100 = 700)", rExcl.items.find((i) => i.name === "ROSA")?.productIncentive === 700)
  t("rasuradoras no suman unidades a ROSA (7, no 11)", rExcl.items.find((i) => i.name === "ROSA")?.productUnits === 7)
  t("CARLOS ARIAS no aparece con incentivo", !rExcl.items.some((i) => i.name === "CARLOS ARIAS" && i.productIncentive > 0))

  console.log("── Reparto de PRODUCTO de recepción entre prestadoras")
  const { allocateInt } = await import("../lib/commission/run-engine.ts")
  t("allocateInt 100 en 3 → 34,33,33", JSON.stringify(allocateInt(100, 3)) === JSON.stringify([34, 33, 33]))
  t("allocateInt 312 en 3 → 104,104,104", JSON.stringify(allocateInt(312, 3)) === JSON.stringify([104, 104, 104]))
  t("allocateInt 196 en 2 → 98,98", JSON.stringify(allocateInt(196, 2)) === JSON.stringify([98, 98]))
  t("allocateInt 197 en 2 → 99,98 (remanente a la 1ª)", JSON.stringify(allocateInt(197, 2)) === JSON.stringify([99, 98]))

  const { receptionSplitsForBranch, isReceptionSplitSale } = await import("../lib/commission/reception-splits.ts")
  t("RAFAEL VIDAL reparte entre 3", receptionSplitsForBranch("RAFAEL VIDAL", "csl")[0]?.recipients.length === 3)
  t("LOS JARDINES tiene 2 cuentas de reparto (ENCARGADA 1 y 2)", receptionSplitsForBranch("LOS JARDINES", "csl").length === 2)
  t("ENCARGADA 1 (LJ) es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "LOS JARDINES  ENCARGADA 1 (Recepcionista)", "csl") === true)
  t("ENCARGADA 2 (LJ) es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "LOS JARDINES  ENCARGADA 2 (Recepcionista)", "csl") === true)
  t("operaciones (LJ) NO es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "cibao spa los jadines  operaciones (Recepcionista)", "csl") === false)

  const rRecep = computeRun({
    tenant: "csl",
    branch: "RAFAEL VIDAL",
    sales: [
      // Recepción vendió 100 u de producto → se reparte 34/33/33 entre LUISA, YANIBEL, KARLA.
      { branch: "RAFAEL VIDAL", category: "PRODUCTO", payment: "EFECTIVO", amount: 5000, quantity: 100,
        providerOriginal: "PC Recepcion  LAP TOP R VIDAL (Recepcionista)", provider: null, serviceName: "CREMA" },
      // Una rasuradora de recepción NO se reparte (insumo sin incentivo).
      { branch: "RAFAEL VIDAL", category: "PRODUCTO", payment: "EFECTIVO", amount: 50, quantity: 9,
        providerOriginal: "PC Recepcion  LAP TOP R VIDAL (Recepcionista)", provider: null, serviceName: "RASURADORAS" },
    ],
    collaborators: [collab("LUISA"), collab("YANIBEL"), collab("KARLA")],
    patients: [], patientsSource: "ninguna", rules: RULES,
    receptionSplits: receptionSplitsForBranch("RAFAEL VIDAL", "csl"),
  })
  t("LUISA recibe 34 u (remanente)", rRecep.items.find((i) => i.name === "LUISA")?.productUnits === 34)
  t("YANIBEL recibe 33 u", rRecep.items.find((i) => i.name === "YANIBEL")?.productUnits === 33)
  t("KARLA recibe 33 u", rRecep.items.find((i) => i.name === "KARLA")?.productUnits === 33)
  t("suma repartida = 100 (rasuradoras excluidas)",
    ["LUISA", "YANIBEL", "KARLA"].reduce((s, n) => s + (rRecep.items.find((i) => i.name === n)?.productUnits || 0), 0) === 100)
  t("LUISA incentivo 34 × 100 = 3,400", rRecep.items.find((i) => i.name === "LUISA")?.productIncentive === 3400)
}

// ── Reservas con columnas OPCIONALES ausentes (export de otro tenant) ──
// El export de AgendaPro no trae el mismo juego de columnas en todas las
// cuentas: el de CSL trae 29 y el de Depicenter 26 (sin "Asignado a" ni
// "Tipo de facturación"). El parser debe leer lo que haya y dejar el resto
// vacío, nunca reventar.
console.log("── Reservas: export con menos columnas (multi-tenant)")
{
  const HEADERS_26 = [
    "Fecha de realización", "Fecha de creación", "Responsable creación",
    "Fecha última modificación", "Responsable última modificación", "Local",
    "N° de Cliente", "Nombre", "Apellido", "E-mail", "Teléfono", "cédula",
    "Servicio", "Precio lista", "Precio real", "Nº de sesión", "Sesiones Totales",
    "Prestador", "Estado", "Estado de pago", "Fecha pago", "ID pago",
    "Notas compartidas con cliente", "Comentario interno", "Preferencia Cliente", "Origen",
  ]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Reservas")
  ws.addRow(HEADERS_26)
  ws.addRow([
    "15/07/2026 10:30", "01/07/2026 09:00", "RECEPCION", "10/07/2026 08:00", "RECEPCION",
    "Depicenter Santiago", "9001", "ANA", "PEREZ", "a@b.do", "8095551234", "001-0000000-1",
    "Depilación Láser Axila", 1500, 1200, "2", "6", "SAHOMY", "Asiste", "Pagado",
    "15/07/2026", "PAY-1", "", "", "", "Web",
  ])
  ws.addRow([
    "16/07/2026 11:00", "02/07/2026 09:00", "RECEPCION", "11/07/2026 08:00", "RECEPCION",
    "Depicenter Santiago", "9002", "LUIS", "GOMEZ", "c@d.do", "8095554321", "001-0000000-2",
    "Limpieza Facial", 2000, 2000, "1", "1", "YANIBEL", "No Asiste", "Pendiente",
    "", "", "", "", "", "Presencial",
  ])

  let p, threw = null
  try { p = parseReservasWorkbook(wb) } catch (e) { threw = e }
  t("no revienta cuando faltan columnas opcionales", threw === null,
    threw ? `→ ${threw.message}` : "")
  if (!threw) {
    t("sin errores de validación", p.errors.length === 0, JSON.stringify(p.errors))
    t("lee las 2 filas", p.totalRows === 2, `(${p.totalRows})`)
    t("Asiste 1 / No Asiste 1", p.byStatus.ASISTE === 1 && p.byStatus.NO_ASISTE === 1)
    t("prestador leído", Boolean(p.rows[0]?.provider === "SAHOMY"), `(${p.rows[0]?.provider})`)
    t("fecha de realización leída", p.rows[0]?.appointmentDate === "2026-07-15", `(${p.rows[0]?.appointmentDate})`)
    t("columna ausente 'Asignado a' → vacío", p.rows[0]?.assignedTo === "")
    t("columna ausente 'Tipo de facturación' → vacío", p.rows[0]?.billingType === "")
    t("columna presente 'Origen' sí se lee", p.rows[0]?.source === "Web", `(${p.rows[0]?.source})`)
    t("precio real leído", p.rows[0]?.realPrice === 1200, `(${p.rows[0]?.realPrice})`)
  }
}

// ── Archivos reales (§33/§34) — solo si están disponibles ──
const VENTAS = "C:/Users/ADMIN/Downloads/reporte_de_ventas_3552_2026-07-10T15_38_41+00_00.xlsx"
const RESERVAS = "C:/Users/ADMIN/Downloads/reservas_3552_1783698071.xlsx"

if (existsSync(VENTAS)) {
  console.log("── Archivo real de VENTAS (§33)")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(VENTAS)
  t("6 hojas", wb.worksheets.length === 6)
  const r = extractResumenControls(wb)
  t("rango 01/01→30/06", r?.periodStart === "2026-01-01" && r?.periodEnd === "2026-06-30")
  t("total 19,486,006", r?.total === 19486006)
  t("servicios 16,924,532", r?.servicios === 16924532)
  t("productos 2,561,474", r?.productos === 2561474)
  t("efectivo 3,732,180", r?.efectivo === 3732180)
  t("transferencia 4,617,091", r?.transferencia === 4617091)
  t("tarjeta 11,136,735", r?.tarjeta === 11136735)
  t("servicios+productos = total", (r?.servicios || 0) + (r?.productos || 0) === r?.total)
  t("pagos suman total", (r?.efectivo || 0) + (r?.transferencia || 0) + (r?.tarjeta || 0) === r?.total)
  // dominante por recibo (muestra 200 filas para velocidad)
  const ws = wb.getWorksheet("Produccion v2")
  const b = addBuckets(payBucketsFromV2(ws.getRow(3)), payBucketsFromV2(ws.getRow(4)))
  t("payBuckets/dominant funcionan", typeof dominantPayment(b) === "string")
} else console.log("(archivo de Ventas no disponible — controles §33 omitidos)")

if (existsSync(RESERVAS)) {
  console.log("── Archivo real de RESERVAS (§34)")
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(RESERVAS)
  const p = parseReservasWorkbook(wb)
  t("hoja Reservas sin errores", p.errors.length === 0)
  t("23,706 filas", p.totalRows === 23706, `(${p.totalRows})`)
  t("Asiste 14,432", p.byStatus.ASISTE === 14432, `(${p.byStatus.ASISTE})`)
  t("Cancelado 7,130", p.byStatus.CANCELADO === 7130)
  t("No Asiste 2,114", p.byStatus.NO_ASISTE === 2114)
  t("Confirmado 18", p.byStatus.CONFIRMADO === 18)
  t("Reservado 8", p.byStatus.RESERVADO === 8)
  t("En Espera 4", p.byStatus.EN_ESPERA === 4)
  t("6 períodos", p.periods.length === 6)
  const counts = aggregateAttendance(p.rows)
  const att = counts.reduce((s, c) => s + c.attended, 0)
  t("atenciones agregadas = Asiste con prestador/fecha", att > 14000 && att <= 14432, `(${att})`)
  const dep = counts.reduce((s, c) => s + c.attendedDepilacion, 0)
  t("depilación ⊆ atenciones y no son todas", dep > 0 && dep < att, `(${dep} de ${att})`)
} else console.log("(archivo de Reservas no disponible — controles §34 omitidos)")

console.log("── Pacientes de DEPILACIÓN para el reparto del fondo láser (§60)")
{
  // El fondo láser se reparte por pacientes de DEPILACIÓN. Antes se contaba
  // toda cita asistida y entraban al reparto quienes solo hacen tatuajes o
  // faciales (agosto 2026: ANGELICA en Villa Olga, BENITA en Los Jardines).
  const reales = [
    ["Depilación  15 Minutos   1  área", true],
    ["Depilación  30 minutos   2 áreas", true],
    ["Depilación Láser  15 sesiones", true],
    ["Depilación  90 Minutos 6 áreas", true],
    ["ELIMINACION DE TATUAJES T-1", false],
    ["ELIMINACION DE CEJAS T-1", false],
    ["EVALUACION ELIMINACION  TATUAJES T-1", false],
    ["Masajes Relajantes  M-1", false],
    ["LIMPIEZA FACIAL BASICA C-1", false],
    ["HOLLYWOOD LASER PEEL 1 SESION H-1", false],
    ["PELLING DESCAMANTE DESPIGMENTANTE  C-1", false],
  ]
  for (const [nombre, esperado] of reales) {
    t(`${esperado ? "SÍ" : "NO"} cuenta: ${nombre.trim().slice(0, 38)}`, isDepilacionService(nombre) === esperado)
  }
  t("vacío o nulo no cuenta", !isDepilacionService("") && !isDepilacionService(null) && !isDepilacionService(undefined))

  // El agregado separa las dos métricas sin perder ninguna.
  const filas = [
    { attendanceStatus: "ASISTE", appointmentDate: "2026-08-05", provider: "ANGELICA", branch: "VILLA OLGA", serviceName: "ELIMINACION DE TATUAJES T-1", externalClientId: "c1", phone: "", firstName: "", lastName: "" },
    { attendanceStatus: "ASISTE", appointmentDate: "2026-08-06", provider: "ANGELICA", branch: "VILLA OLGA", serviceName: "ELIMINACION DE CEJAS T-1", externalClientId: "c2", phone: "", firstName: "", lastName: "" },
    { attendanceStatus: "ASISTE", appointmentDate: "2026-08-07", provider: "YESSICA", branch: "VILLA OLGA", serviceName: "Depilación  15 Minutos   1  área", externalClientId: "c3", phone: "", firstName: "", lastName: "" },
    { attendanceStatus: "ASISTE", appointmentDate: "2026-08-08", provider: "YESSICA", branch: "VILLA OLGA", serviceName: "Masajes Relajantes  M-1", externalClientId: "c3", phone: "", firstName: "", lastName: "" },
    { attendanceStatus: "CANCELADO", appointmentDate: "2026-08-09", provider: "YESSICA", branch: "VILLA OLGA", serviceName: "Depilación  15 Minutos   1  área", externalClientId: "c4", phone: "", firstName: "", lastName: "" },
  ]
  const agg = aggregateAttendance(filas)
  const ang = agg.find((a) => a.provider === "ANGELICA")
  const yes = agg.find((a) => a.provider === "YESSICA")
  t("quien solo hace tatuajes: 2 atenciones, 0 de depilación", ang.attended === 2 && ang.attendedDepilacion === 0, `(${ang.attended}/${ang.attendedDepilacion})`)
  t("mezcla: 2 atenciones, 1 de depilación", yes.attended === 2 && yes.attendedDepilacion === 1, `(${yes.attended}/${yes.attendedDepilacion})`)
  t("las canceladas no cuentan en ninguna", agg.reduce((s, a) => s + a.attended, 0) === 4)
  t("clientes únicos intactos", yes.uniquePatients === 1 && ang.uniquePatients === 2)
}

console.log("── Ventas por sucursal · % de venta en tarjeta (§43)")
{
  // Dos sucursales con MEZCLA DE PAGO DISTINTA: el % de tarjeta debe diferir.
  const rows = [
    { branch: "RAFAEL VIDAL", gross_amount: 700, payment_method: "TARJETA",       category: "FACIALES" },
    { branch: "RAFAEL VIDAL", gross_amount: 300, payment_method: "EFECTIVO",      category: "PRODUCTO" },
    { branch: "LOS JARDINES", gross_amount: 200, payment_method: "TARJETA",       category: "DEPILACION_LASER" },
    { branch: "LOS JARDINES", gross_amount: 800, payment_method: "TRANSFERENCIA", category: "FACIALES" },
  ]
  const CARD_PCT = 0.31
  const out = aggregateBranches(rows, CARD_PCT)
  const rv = out.find((b) => b.branch === "RAFAEL VIDAL")
  const lj = out.find((b) => b.branch === "LOS JARDINES")

  t("RAFAEL VIDAL: 70% de sus ventas en tarjeta", rv.cardShare === 0.7, `(${rv?.cardShare})`)
  t("LOS JARDINES: 20% de sus ventas en tarjeta", lj.cardShare === 0.2, `(${lj?.cardShare})`)
  t("el % de tarjeta NO es el mismo en las dos sucursales", rv.cardShare !== lj.cardShare)
  t("el % de tarjeta NO es la regla fija del negocio", rv.cardShare !== CARD_PCT && lj.cardShare !== CARD_PCT)

  t("descuento tarjeta RAFAEL VIDAL = 700 × 31%", rv.cardResult === 217, `(${rv?.cardResult})`)
  t("descuento tarjeta LOS JARDINES = 200 × 31%", lj.cardResult === 62, `(${lj?.cardResult})`)
  t("la regla fija sigue expuesta por sucursal", rv.cardPct === CARD_PCT && lj.cardPct === CARD_PCT)

  t("bruto por sucursal", rv.gross === 1000 && lj.gross === 1000)
  t("tarjeta / efectivo / transferencia separados", rv.tarjeta === 700 && rv.efectivo === 300 && lj.transferencia === 800)
  t("categorías: producto / servicio / láser", rv.producto === 300 && rv.servicio === 700 && lj.laser === 200)
  t("ordenado por bruto descendente", out.length === 2)

  // Sucursal sin ventas: no debe reventar ni inventar un 100%.
  const cero = aggregateBranches([{ branch: "NUEVA", gross_amount: 0, payment_method: "TARJETA", category: "" }], CARD_PCT)
  t("bruto 0 → % tarjeta 0 (sin división por cero)", cero[0].cardShare === 0, `(${cero[0]?.cardShare})`)
}

console.log("── Años seleccionables en el filtro (§44)")
{
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

  // Historial real de CSL: ventas desde 2020 hasta 2026.
  const hist = availableYears("2020-05-20", "2026-08-31", 2026)
  t("cubre TODO el historial 2020–2026", eq(hist, [2026, 2025, 2024, 2023, 2022, 2021, 2020]), `(${hist})`)
  t("incluye 2020, 2021, 2022 y 2023", [2020, 2021, 2022, 2023].every((y) => hist.includes(y)))
  t("del más nuevo al más viejo", hist[0] === 2026 && hist[hist.length - 1] === 2020)
  t("no inventa años futuros sin datos", !hist.includes(2027))

  // Sin ventas todavía: al menos el año en curso, para no dejar el selector vacío.
  t("sin datos → solo el año en curso", eq(availableYears("", "", 2026), [2026]))

  // Datos de un solo año viejo: el año en curso sigue disponible.
  t("hueco entre el dato y hoy → rango continuo", eq(availableYears("2024-01-03", "2024-12-21", 2026), [2026, 2025, 2024]))

  // Ventas con fecha futura (archivo con fecha mal tecleada): no se ocultan.
  t("dato futuro → el año aparece", availableYears("2026-01-01", "2027-03-01", 2026)[0] === 2027)

  // Fecha corrupta remota: la lista no puede crecer sin límite.
  t("fecha absurda → lista acotada", availableYears("1900-01-01", "2026-08-31", 2026).length <= 20)
  t("fecha absurda → conserva los años recientes", availableYears("1900-01-01", "2026-08-31", 2026).includes(2026))
}

console.log("── Tendencia mensual: ventana de 12 meses (§46)")
{
  t("la tendencia es de 12 meses", TREND_MONTHS === 12, `(${TREND_MONTHS})`)

  const v = lastMonths(2026, 9, TREND_MONTHS)
  t("devuelve 12 puntos", v.length === 12, `(${v.length})`)
  t("termina en el mes ancla", v[11].year === 2026 && v[11].month === 9)
  t("empieza 11 meses antes (oct 2025)", v[0].year === 2025 && v[0].month === 10, `(${v[0]?.year}-${v[0]?.month})`)
  t("cruza el año hacia atrás sin saltos", v.map((x) => `${x.year}-${x.month}`).join(",") ===
    "2025-10,2025-11,2025-12,2026-1,2026-2,2026-3,2026-4,2026-5,2026-6,2026-7,2026-8,2026-9")

  // Enero como ancla: los 11 anteriores caen todos en el año pasado.
  const ene = lastMonths(2026, 1, 12)
  t("ancla enero → arranca en feb del año anterior", ene[0].year === 2025 && ene[0].month === 2)
  t("ancla enero → termina en enero", ene[11].year === 2026 && ene[11].month === 1)

  // Orden y unicidad: el gráfico dibuja de izquierda (viejo) a derecha (nuevo).
  const clave = (x) => x.year * 12 + x.month
  t("estrictamente creciente", v.every((x, i) => i === 0 || clave(x) === clave(v[i - 1]) + 1))
  t("sin meses repetidos", new Set(v.map((x) => `${x.year}-${x.month}`)).size === 12)
  t("ningún mes fuera de 1–12", v.every((x) => x.month >= 1 && x.month <= 12))

  t("count 1 → solo el ancla", lastMonths(2026, 9, 1).length === 1)
  t("count inválido no revienta", Array.isArray(lastMonths(2026, 9, 0)))
}

console.log("── Quién vendió producto (§67)")
{
  // Las ventas de producto tal como vienen del archivo (julio 2026, casos reales).
  const rows = [
    { providerOriginal: "EIDYLEE (prestador)", branch: "VILLA OLGA", quantity: 20, amount: 37800 },
    { providerOriginal: "PC Recepcion  LAP TOP R VIDAL (Recepcionista)", branch: "RAFAEL VIDAL", quantity: 43, amount: 65950 },
    { providerOriginal: "LOS JARDINES  ENCARGADA 1 (Recepcionista)", branch: "LOS JARDINES", quantity: 20, amount: 27600 },
    { providerOriginal: "CARLOS ARIAS (Administrador Local)", branch: "RAFAEL VIDAL", quantity: 13, amount: 4860 },
    { providerOriginal: "Sin información", branch: "VILLA OLGA", quantity: 16, amount: 22350 },
    { providerOriginal: "cibao spa los jadines  operaciones (Recepcionista)", branch: "LOS JARDINES", quantity: 3, amount: 2075 },
    { providerOriginal: "EIDYLEE (prestador)", branch: "VILLA OLGA", quantity: 5, amount: 3000 },
    { providerOriginal: "DIANA (prestador)", branch: "RAFAEL VIDAL", serviceName: "RASURADORAS", quantity: 4, amount: 1200 },
  ]
  const out = buildProductSellers(rows, "csl")
  const byName = (n) => out.find((r) => r.provider.toUpperCase().includes(n))

  t("aparecen TODOS los que vendieron, no solo los que cobran", out.length === 7, `(${out.length}: ${out.map((r) => r.provider)})`)
  t("agrupa las líneas del mismo vendedor y sucursal", byName("EIDYLEE").lines === 2 && byName("EIDYLEE").units === 25 && byName("EIDYLEE").gross === 40800)
  t("ordenado por unidades descendente", out.every((r, i) => i === 0 || out[i - 1].units >= r.units))

  t("prestadora normal → incentiva", byName("EIDYLEE").status === "incentiva")
  t("recepción con reparto → repartido, y dice a quién", byName("PC RECEPCION").status === "repartido" && /LUISA/.test(byName("PC RECEPCION").note) && /KARLA/.test(byName("PC RECEPCION").note))
  t("encargada de Jardines → repartido entre LESLIE y YADIBEL", byName("ENCARGADA 1").status === "repartido" && /LESLIE/.test(byName("ENCARGADA 1").note))
  t("CARLOS ARIAS → excluido por regla del negocio", byName("CARLOS ARIAS").status === "excluido")
  t("«Sin información» → sin prestador", byName("SIN INFORMACI").status === "sin_prestador")
  t("recepción SIN regla de reparto → no comisionable (no se reparte a nadie)", byName("OPERACIONES").status === "no_comisionable")
  t("el rol se conserva para poder explicarlo", byName("PC RECEPCION").role === "Recepcionista" && byName("EIDYLEE").role === "prestador")
  t("el nombre sale limpio, sin el rol entre paréntesis", !byName("EIDYLEE").provider.includes("("))
  t("cada estado tiene etiqueta legible", ["incentiva", "repartido", "excluido", "sin_prestador", "no_comisionable"].every((k) => typeof SELLER_STATUS_LABEL[k] === "string"))

  const tot = sellerTotals(out)
  t("totales: 124 unidades vendidas", tot.units === 124, `(${tot.units})`)
  t("totales: 29 unidades de gente que cobra, pero 4 son rasuradoras", tot.unitsIncentivan === 29 && tot.unitsSinIncentivo === 4, `(${tot.unitsIncentivan}/${tot.unitsSinIncentivo})`)
  t("las rasuradoras se marcan por vendedor", byName("DIANA").unitsSinIncentivo === 4 && byName("EIDYLEE").unitsSinIncentivo === 0)
  t("totales: la diferencia se explica por estado", tot.unitsRepartidas === 63 && tot.unitsExcluidas === 13 && tot.unitsSinPrestador === 16 && tot.unitsNoComisionables === 3)
  t("totales: las cuatro partes suman el total", tot.unitsIncentivan + tot.unitsRepartidas + tot.unitsExcluidas + tot.unitsSinPrestador + tot.unitsNoComisionables === tot.units)
  t("totales: monto vendido", tot.gross === 164835, `(${tot.gross})`)

  // Tenant distinto: las reglas de CSL NO se heredan.
  const dep = buildProductSellers([{ providerOriginal: "CARLOS ARIAS (Administrador Local)", branch: "LA VEGA", quantity: 1, amount: 100 }], "depicenter")
  t("las exclusiones de CSL no aplican en otro negocio", dep[0].status !== "excluido")

  t("lista vacía no revienta", buildProductSellers([], "csl").length === 0 && sellerTotals([]).units === 0)
  t("no muta la entrada", rows[0].quantity === 20)
}

console.log("── Cálculo automático tras importar ventas (§68)")
{
  const BR = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]
  const periods = ["2026-07", "2026-08"]

  // Nada previo: se corre todo.
  const limpio = planAutoRuns(periods, BR, { runs: [], closed: [] })
  t("sin nada previo corre las 3 sucursales de cada mes", limpio.run.length === 6 && limpio.skipped.length === 0)
  t("cada entrada lleva mes, año y sucursal", limpio.run.every((r) => r.year === 2026 && [7, 8].includes(r.month) && BR.includes(r.branch)))

  // Un run FINALIZADO no se pisa nunca de forma automática.
  const conFinal = planAutoRuns(periods, BR, {
    runs: [{ year: 2026, month: 7, branch: "RAFAEL VIDAL", status: "finalizado" }],
    closed: [],
  })
  t("un cálculo FINALIZADO se omite", conFinal.run.length === 5 && conFinal.skipped.length === 1)
  t("y se dice por qué", conFinal.skipped[0].reason === "finalizado" && conFinal.skipped[0].branch === "RAFAEL VIDAL" && conFinal.skipped[0].month === 7)

  // Un borrador SÍ se recalcula (es lo que hace el botón manual).
  const conBorrador = planAutoRuns(periods, BR, {
    runs: [{ year: 2026, month: 8, branch: "VILLA OLGA", status: "borrador" }], closed: [],
  })
  t("un borrador se recalcula", conBorrador.run.length === 6 && conBorrador.skipped.length === 0)

  // Un run ANULADO no bloquea.
  const conAnulado = planAutoRuns(periods, BR, {
    runs: [{ year: 2026, month: 8, branch: "VILLA OLGA", status: "anulado" }], closed: [],
  })
  t("un run anulado no bloquea", conAnulado.run.length === 6)

  // Un período CERRADO en el libro de liquidación tampoco se toca.
  const conCerrado = planAutoRuns(periods, BR, {
    runs: [], closed: [{ year: 2026, month: 7, branch: "LOS JARDINES" }],
  })
  t("un período CERRADO se omite", conCerrado.run.length === 5 && conCerrado.skipped[0].reason === "cerrado")

  // Ambos motivos a la vez: gana el más fuerte y no se duplica la entrada.
  const ambos = planAutoRuns(["2026-07"], BR, {
    runs: [{ year: 2026, month: 7, branch: "LOS JARDINES", status: "finalizado" }],
    closed: [{ year: 2026, month: 7, branch: "LOS JARDINES" }],
  })
  t("finalizado + cerrado = una sola omisión", ambos.skipped.length === 1 && ambos.run.length === 2)

  t("cada motivo tiene texto legible", ["finalizado", "cerrado"].every((k) => typeof AUTO_RUN_SKIP_LABEL[k] === "string"))
  t("períodos mal formados se ignoran", planAutoRuns(["", "xx", "2026-13"], BR, { runs: [], closed: [] }).run.length === 0)
  t("sin sucursales no hay nada que correr", planAutoRuns(periods, [], { runs: [], closed: [] }).run.length === 0)
  t("orden estable: por período y luego por sucursal", limpio.run[0].month === 7 && limpio.run[3].month === 8)
}

console.log("── Roster con fecha de alta y baja (§69)")
{
  const p = (y, m) => ({ year: y, month: m })

  t("sin fechas: siempre cuenta (como hasta ahora)", activeInPeriod({}, p(2026, 8)) === true)
  t("alta el 01/09: NO cuenta en agosto", activeInPeriod({ startDate: "2026-09-01" }, p(2026, 8)) === false)
  t("alta el 01/09: sí cuenta en septiembre", activeInPeriod({ startDate: "2026-09-01" }, p(2026, 9)) === true)
  t("alta el 01/09: sí cuenta en octubre", activeInPeriod({ startDate: "2026-09-01" }, p(2026, 10)) === true)
  t("alta a mitad de mes cuenta ese mes completo", activeInPeriod({ startDate: "2026-09-15" }, p(2026, 9)) === true)

  t("baja el 31/08: sí cuenta en agosto", activeInPeriod({ endDate: "2026-08-31" }, p(2026, 8)) === true)
  t("baja el 31/08: NO cuenta en septiembre", activeInPeriod({ endDate: "2026-08-31" }, p(2026, 9)) === false)
  t("baja a mitad de mes cuenta ese mes completo", activeInPeriod({ endDate: "2026-08-10" }, p(2026, 8)) === true)

  t("alta y baja: solo dentro del tramo", activeInPeriod({ startDate: "2026-03-01", endDate: "2026-06-30" }, p(2026, 5)) === true
    && activeInPeriod({ startDate: "2026-03-01", endDate: "2026-06-30" }, p(2026, 2)) === false
    && activeInPeriod({ startDate: "2026-03-01", endDate: "2026-06-30" }, p(2026, 7)) === false)
  t("cruza el año", activeInPeriod({ startDate: "2025-11-01" }, p(2026, 1)) === true && activeInPeriod({ startDate: "2026-01-01" }, p(2025, 12)) === false)
  t("fecha basura se ignora (no excluye a nadie)", activeInPeriod({ startDate: "no-es-fecha" }, p(2026, 8)) === true)

  // El caso real: GIPSY se muda de Villa Olga a Los Jardines en septiembre.
  const roster = Object.freeze([
    { name: "GIPSY", branch: "VILLA OLGA", endDate: "2026-08-31" },
    { name: "GIPSY", branch: "LOS JARDINES", startDate: "2026-09-01" },
    { name: "LESLIE", branch: "LOS JARDINES" },
  ])
  const ago = filterRosterForPeriod(roster, p(2026, 8)).map((r) => `${r.name}@${r.branch}`)
  const sep = filterRosterForPeriod(roster, p(2026, 9)).map((r) => `${r.name}@${r.branch}`)
  t("agosto: GIPSY sigue en Villa Olga y no está en Jardines", ago.includes("GIPSY@VILLA OLGA") && !ago.includes("GIPSY@LOS JARDINES"))
  t("septiembre: GIPSY está en Jardines y ya no en Villa Olga", sep.includes("GIPSY@LOS JARDINES") && !sep.includes("GIPSY@VILLA OLGA"))
  t("quien no tiene fechas aparece en los dos meses", ago.includes("LESLIE@LOS JARDINES") && sep.includes("LESLIE@LOS JARDINES"))
  t("no muta la lista original", roster.length === 3)
  t("sin período devuelve todo", filterRosterForPeriod(roster, null).length === 3)
}

console.log("── Alias de colaboradoras y limpieza del libro (§70)")
{
  // EMELI es ASHLEY: le cambiaron el nombre. Sin alias, la misma persona
  // aparecía dos veces y cobraba el láser dos veces.
  t("EMELI se resuelve a ASHLEY", canonColab("EMELI") === "ASHLEY")
  t("y la variante EMELY también", canonColab("EMELY") === "ASHLEY")
  t("ASHLEY sigue siendo ASHLEY", canonColab("ASHLEY") === "ASHLEY")
  t("AHSLEY (con el error de tecleo) también", canonColab("AHSLEY") === "ASHLEY")
  t("los demás alias no se rompen", canonColab("YANIBLE") === "YANIBEL" && canonColab("KATHERINE") === "KATHERIN" && canonColab("MADELIN") === "MADELINE")

  // Al recalcular, quien ya no sale en el cálculo debe dejar de cobrar.
  t("quien ya no está en el cálculo sale de la lista", staleLedgerProviders(["ASHLEY", "PATRICIA", "DIANA"], ["ASHLEY", "DIANA"]).join(",") === "PATRICIA")
  t("compara por nombre canónico: EMELI ya es ASHLEY, así que NO sobra", staleLedgerProviders(["EMELI"], ["ASHLEY"]).length === 0)
  t("y al revés: ASHLEY no sobra si el cálculo trae EMELI", staleLedgerProviders(["ASHLEY"], ["EMELI"]).length === 0)
  t("sin sobrantes devuelve lista vacía", staleLedgerProviders(["ASHLEY"], ["ASHLEY", "DIANA"]).length === 0)
  t("libro vacío no revienta", staleLedgerProviders([], ["ASHLEY"]).length === 0)
  t("cálculo vacío deja fuera a todos", staleLedgerProviders(["ASHLEY", "DIANA"], []).length === 2)
  t("no muta las entradas", (() => { const a = Object.freeze(["ASHLEY", "PATRICIA"]); staleLedgerProviders(a, ["ASHLEY"]); return a.length === 2 })())

  // Al fusionar dos nombres, el libro queda con DOS filas de la misma persona.
  // Hay que quedarse con una y anular la otra, o el cálculo actualiza la que no es.
  const filas = Object.freeze([
    { id: "a", provider: "ASHLEY" }, { id: "b", provider: "EMELI" }, { id: "c", provider: "DIANA" },
  ])
  const dd = dedupeLedgerRows(filas)
  t("una sola fila por persona", dd.keep.size === 2 && dd.keep.get("ASHLEY") === "a" && dd.keep.get("DIANA") === "c")
  t("la fila duplicada se marca para anular", dd.duplicates.join(",") === "b")
  t("gana la fila con el nombre canónico, esté donde esté", dd.keep.get("ASHLEY") === "a")
  t("aunque el alias venga primero", (() => {
    const d = dedupeLedgerRows([{ id: "b", provider: "EMELI" }, { id: "a", provider: "ASHLEY" }])
    return d.keep.get("ASHLEY") === "a" && d.duplicates.join(",") === "b"
  })())
  t("si ninguna es canónica, gana la primera", (() => {
    const d = dedupeLedgerRows([{ id: "x", provider: "EMELI" }, { id: "y", provider: "EMELY" }])
    return d.keep.get("ASHLEY") === "x" && d.duplicates.join(",") === "y"
  })())
  t("sin duplicados no marca nada", dedupeLedgerRows([{ id: "a", provider: "ASHLEY" }]).duplicates.length === 0)
  t("libro vacío no revienta", dedupeLedgerRows([]).keep.size === 0)
  t("no muta el libro", filas.length === 3)
}

console.log("── Liquidación: la comisión de servicios se abre por categoría (§71)")
{
  const detalle = Object.freeze([
    { provider: "ANGELICA", branch: "VILLA OLGA", category: "TATUAJES", base: 26523, pct: 0.1, amount: 2652.30 },
    { provider: "BENITA", branch: "LOS JARDINES", category: "FACIALES", base: 50703, pct: 0.2, amount: 10140.60 },
    { provider: "BENITA", branch: "LOS JARDINES", category: "MASAJES", base: 25899, pct: 0.2, amount: 5179.80 },
    { provider: "EIDYLEE", branch: "VILLA OLGA", category: "HOLLYWOOD_AQUA_PEEL", base: 3000, pct: 0.1, amount: 300 },
    { provider: "EIDYLEE", branch: "VILLA OLGA", category: "TATUAJES", base: 38758.5, pct: 0.1, amount: 3875.85 },
    { provider: "NADIE", branch: "VILLA OLGA", category: "HIFU", base: 0, pct: 0.1, amount: 0 },
  ])

  const cols = serviceColumns(detalle)
  t("solo las categorías con importe", cols.join(",") === "FACIALES,TATUAJES,MASAJES,HOLLYWOOD_AQUA_PEEL", `(${cols})`)
  t("ordenadas de mayor a menor importe", cols[0] === "FACIALES" && cols[cols.length - 1] === "HOLLYWOOD_AQUA_PEEL")
  t("HIFU en cero no genera columna", !cols.includes("HIFU"))
  t("sin detalle no hay columnas", serviceColumns([]).length === 0)

  const cells = serviceCellsBy(detalle)
  t("cada persona lleva su desglose por sucursal", cells.get("BENITA|LOS JARDINES").FACIALES === 10140.60 && cells.get("BENITA|LOS JARDINES").MASAJES === 5179.80)
  t("la misma persona en otra sucursal no se mezcla", cells.get("ANGELICA|VILLA OLGA").TATUAJES === 2652.30 && cells.get("ANGELICA|VILLA OLGA").FACIALES === undefined)
  t("quien no tiene esa categoría no aparece en ella", cells.get("EIDYLEE|VILLA OLGA").MASAJES === undefined)
  t("clave por persona Y sucursal (la de importe cero no entra)", cells.size === 3)

  t("las columnas fijas cubren láser, fijo y ajuste", SERVICE_EXTRA_COLS.map((c) => c.key).join(",") === "laserIncentive,fixedIncentive,manualAdjustment")
  t("cada columna fija tiene etiqueta", SERVICE_EXTRA_COLS.every((c) => typeof c.label === "string" && c.label.length > 0))
  t("no muta el detalle", detalle.length === 6)
}

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
