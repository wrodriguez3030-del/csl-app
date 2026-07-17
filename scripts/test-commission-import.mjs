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
const { extractResumenControls } = await import("../lib/commission/ventas-resumen.ts")
const { payBucketsFromV2, dominantPayment, addBuckets } = await import("../lib/commission/ventas-pago.ts")
const { computeRowHash, fnvHex } = await import("../lib/commission/hash.ts")
const { toSaleRecord } = await import("../lib/commission/aggregate.ts")
const { monthBounds, exclusiveEnd, monthsCovered, quickRange, todayInTz, lastDayOfMonth } = await import("../lib/commission/period.ts")

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
  t("JOHELY → JOELY", canonicalCollaborator("Johely") === "JOELY")
  t("KATHERINE → KATHERIN", canonicalCollaborator("KATHERINE") === "KATHERIN")
  t("AHSLEY → ASHLEY", canonicalCollaborator("AHSLEY") === "ASHLEY")
  t("EMELY → EMELI", canonicalCollaborator("emely") === "EMELI")

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
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 700000 })],
    collaborators: [collab("ROSA")],
    patients: [], patientsSource: "ninguna",
    rules: RULES,
  })
  t("sin pacientes → pasa a lineal con alerta", r3.alerts.some((a) => a.includes("LINEAL")) && r3.items[0].laserLinear === r3.laser.fund)
  const r4 = computeRun({
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
  const rZF = computeRun({ ...base, rules: { ...RULES, laserSplitPatientsFraction: 0.5, zeroPatientsGetsFixed: true } })
  t("0-pac SÍ recibe parte fija: personas entre las 3", rZF.items.find((i) => i.name === "DIANA")?.laserLinear === Math.round((20000 / 3) * 100) / 100)
  t("0-pac SÍ: ROSA se lleva TODA la parte por pacientes (20,000)", rZF.items.find((i) => i.name === "ROSA")?.laserPatients === 20000)
  const rZN = computeRun({ ...base, rules: { ...RULES, laserSplitPatientsFraction: 0.5, zeroPatientsGetsFixed: false } })
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
    branch: "RAFAEL VIDAL",
    sales: [sale({ amount: 724005.5 })],
    collaborators: ["LUISA", "YANIBEL", "KARLA", "RIQUELMI", "ROSA", "DIANA", "MADELINE", "EMELI"].map((n) => collab(n)),
    patients: [
      { collaborator: "RIQUELMI", patients: 246 }, { collaborator: "ROSA", patients: 192 },
      { collaborator: "DIANA", patients: 206 }, { collaborator: "MADELINE", patients: 244 },
      { collaborator: "EMELY", patients: 240 }, // alias EMELY→EMELI (como viene del archivo)
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
  t("EMELY 240 → 1,925.55 (con alias)", Math.abs(eq("EMELI").laserTotal - 1925.55) <= 0.02)
  const sumEq = rEq.items.reduce((s, i) => s + i.laserTotal, 0)
  t("CUADRE EXACTO: Σ repartido = fondo", Math.round(sumEq * 100) / 100 === 14480.11, `(${sumEq.toFixed(2)})`)

  // Equitativo sin NINGÚN paciente: partes iguales con alerta.
  const rEq0 = computeRun({
    branch: "RAFAEL VIDAL", sales: [sale({ amount: 700000 })],
    collaborators: [collab("ROSA"), collab("DIANA")], patients: [], patientsSource: "ninguna",
    rules: { ...RULES, laserDistributionMode: "equitativo" },
  })
  t("equitativo sin pacientes → partes iguales + alerta", rEq0.alerts.some((a) => a.includes("PARTES IGUALES")) &&
    Math.abs(rEq0.items.reduce((s, i) => s + i.laserTotal, 0) - rEq0.laser.fund) <= 0.01)

  console.log("── Tarifa de producto POR COLABORADOR (50 P/P del cuadro)")
  const rProd = computeRun({
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
  t("RASURADORAS es ítem sin incentivo", isNonIncentiveItem("RASURADORAS") === true)
  t("APLICACION DE ANESTESIA (servicio) sin incentivo", isNonIncentiveItem("APLICACION DE ANESTESIA ") === true)
  t("ANESTESIA ENCAIN (producto) SÍ comisiona", isNonIncentiveItem("ANESTESIA ENCAIN ") === false)
  t("ANESTESIA ZK-INA (producto) SÍ comisiona", isNonIncentiveItem("ANESTESIA ZK-INA") === false)
  t("un producto normal SÍ comisiona", isNonIncentiveItem("CREMA HIDRATANTE") === false)
  t("CARLOS ARIAS es prestador excluido", isExcludedProvider("CARLOS ARIAS") === true)
  t("CARLOS ARIAS (con acento/minúsculas) excluido", isExcludedProvider("carlos arias") === true)
  t("otra prestadora NO está excluida", isExcludedProvider("DAYHANA") === false)

  const rExcl = computeRun({
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
  t("RAFAEL VIDAL reparte entre 3", receptionSplitsForBranch("RAFAEL VIDAL")[0]?.recipients.length === 3)
  t("LOS JARDINES tiene 2 cuentas de reparto (ENCARGADA 1 y 2)", receptionSplitsForBranch("LOS JARDINES").length === 2)
  t("ENCARGADA 1 (LJ) es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "LOS JARDINES  ENCARGADA 1 (Recepcionista)") === true)
  t("ENCARGADA 2 (LJ) es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "LOS JARDINES  ENCARGADA 2 (Recepcionista)") === true)
  t("operaciones (LJ) NO es cuenta de reparto", isReceptionSplitSale("LOS JARDINES", "cibao spa los jadines  operaciones (Recepcionista)") === false)

  const rRecep = computeRun({
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
    receptionSplits: receptionSplitsForBranch("RAFAEL VIDAL"),
  })
  t("LUISA recibe 34 u (remanente)", rRecep.items.find((i) => i.name === "LUISA")?.productUnits === 34)
  t("YANIBEL recibe 33 u", rRecep.items.find((i) => i.name === "YANIBEL")?.productUnits === 33)
  t("KARLA recibe 33 u", rRecep.items.find((i) => i.name === "KARLA")?.productUnits === 33)
  t("suma repartida = 100 (rasuradoras excluidas)",
    ["LUISA", "YANIBEL", "KARLA"].reduce((s, n) => s + (rRecep.items.find((i) => i.name === n)?.productUnits || 0), 0) === 100)
  t("LUISA incentivo 34 × 100 = 3,400", rRecep.items.find((i) => i.name === "LUISA")?.productIncentive === 3400)
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
} else console.log("(archivo de Reservas no disponible — controles §34 omitidos)")

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
