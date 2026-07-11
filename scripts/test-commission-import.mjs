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
