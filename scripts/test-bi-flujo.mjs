/**
 * Pruebas de los núcleos PUROS del flujo de efectivo, histórico anual y ventas
 * por servicio (BI Finanzas / Incentivos de Ventas › Dashboard financiero).
 * Ejecutar:  pnpm test:bi
 */
const { trailingMonths } = await import("../lib/bi-finance/months.ts")
const { buildFlujo, sumInversiones, sumRetiros, buildFlujoMensual } = await import("../lib/bi-finance/flujo.ts")
const { growthPct, mergeHistorico } = await import("../lib/bi-finance/historico.ts")
const { SALE_CATEGORY_KEYS, porServicioFrom } = await import("../lib/bi-finance/categorias.ts")
const { ANALISIS_SCOPE, ANALISIS_QUESTION } = await import("../lib/bi-finance/analisis-prompt.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) } return o }

console.log("── Ventana de 12 meses (§47)")
{
  const m = trailingMonths(2026, 1, 12)
  t("12 meses", m.length === 12, `(${m.length})`)
  t("del más viejo al más nuevo: 2025-02 … 2026-01", m[0].key === "2025-02" && m[11].key === "2026-01", `(${m[0]?.key}…${m[11]?.key})`)
  t("sin repetidos", new Set(m.map((x) => x.key)).size === 12)
  t("etiqueta larga y corta", m[11].label === "ene 2026" && m[11].short === "Ene 26", `(${m[11]?.label} / ${m[11]?.short})`)
  t("el año solo se escribe donde cambia (y en el primer punto)", m[0].short === "Feb 25" && m[1].short === "Mar" && m[11].short === "Ene 26", `(${m.map((x) => x.short).join(",")})`)
}

console.log("── Flujo de efectivo del período (§48)")
{
  const f = buildFlujo({ ingresos: 1691000, egresosOperativos: 1436572.8, inversiones: 887361.18, retiros: 0 })
  t("egresos = operativos + inversiones + retiros", near(f.egresos, 2323933.98), `(${f.egresos})`)
  t("neto = ingresos − egresos (enero 2026 = −632.933,98)", near(f.neto, -632933.98), `(${f.neto})`)
  t("redondeo a 2 decimales", String(f.neto).split(".")[1]?.length <= 2)

  const inv = deepFreeze([
    { branch: null, monto_inversion: 403117.98, fecha_inicio: "2026-01-01" },
    { branch: "VILLA OLGA", monto_inversion: 484243.2, fecha_inicio: "2026-01-01" },
    { branch: "LOS JARDINES", monto_inversion: 500000, fecha_inicio: "2026-03-01" },
  ])
  const si = sumInversiones(inv, () => true)
  t("inversión general = branch null", near(si.general, 403117.98))
  t("inversión por sucursal", near(si.byBranch["VILLA OLGA"], 484243.2) && near(si.byBranch["LOS JARDINES"], 500000))
  t("total inversiones", near(si.total, 1387361.18), `(${si.total})`)
  const soloVO = sumInversiones(inv, (b) => b === "VILLA OLGA")
  t("keep filtra sucursal (solo Villa Olga)", near(soloVO.total, 484243.2) && soloVO.general === 0)

  const ret = deepFreeze([
    { kind: "dividendo", amount: 315000, withdrawal_date: "2026-03-05", branch: null },
    { kind: "cuenta", amount: 1000, withdrawal_date: "2026-03-20", branch: null },
  ])
  const sr = sumRetiros(ret, () => true)
  t("retiros: dividendos + cuentas", near(sr.dividendos, 315000) && near(sr.cuentas, 1000) && near(sr.total, 316000))
}

console.log("── Flujo mensual de 12 meses (§49)")
{
  const months = trailingMonths(2026, 9, 12)
  const ventasByMonth = deepFreeze({ "2026-01": 1691000, "2026-03": 2060266 })
  const gastosByMonth = deepFreeze({ "2026-01": 1436572.8, "2026-03": 1900979.33 })
  const invRows = deepFreeze([
    { branch: null, monto_inversion: 403117.98, fecha_inicio: "2026-01-01" },
    { branch: "VILLA OLGA", monto_inversion: 484243.2, fecha_inicio: "2026-01-01" },
    { branch: "LOS JARDINES", monto_inversion: 500000, fecha_inicio: "2026-03-01" },
  ])
  const retRows = deepFreeze([{ kind: "dividendo", amount: 315000, withdrawal_date: "2026-03-05", branch: null }])
  const rows = buildFlujoMensual({ months, ventasByMonth, gastosByMonth, invRows, retRows, keep: () => true })
  t("12 filas", rows.length === 12)
  const ene = rows.find((r) => r.key === "2026-01")
  const mar = rows.find((r) => r.key === "2026-03")
  const feb = rows.find((r) => r.key === "2026-02")
  t("enero: ventas / gastos / inv. general / inv. VO", near(ene.ventas, 1691000) && near(ene.gastosOperativos, 1436572.8) && near(ene.inversionGeneral, 403117.98) && near(ene.inversionByBranch["VILLA OLGA"], 484243.2))
  t("enero: neto −632.933,98", near(ene.neto, -632933.98), `(${ene?.neto})`)
  t("marzo: inv. Jardines + retiro dividendo", near(mar.inversionByBranch["LOS JARDINES"], 500000) && near(mar.retiros, 315000))
  t("marzo: neto = 2.060.266 − 1.900.979,33 − 500.000 − 315.000", near(mar.neto, -655713.33), `(${mar?.neto})`)
  t("mes sin datos → ceros, no undefined", feb.ventas === 0 && feb.gastosOperativos === 0 && feb.retiros === 0 && feb.neto === 0)
  t("cada fila lleva label y short", rows.every((r) => r.label && r.short))
  const soloVO = buildFlujoMensual({ months, ventasByMonth, gastosByMonth, invRows, retRows, keep: (b) => b === "VILLA OLGA" })
  t("keep excluye la inversión general y la de otras sucursales", soloVO.find((r) => r.key === "2026-01").inversionGeneral === 0 && soloVO.find((r) => r.key === "2026-03").inversionByBranch["LOS JARDINES"] == null)
}

console.log("── Histórico anual (§50)")
{
  t("growthPct(110, 100) = 10", growthPct(110, 100) === 10)
  t("growthPct(50, 0) = null (sin base)", growthPct(50, 0) === null)
  t("growthPct redondea a 1 decimal", growthPct(1234, 1000) === 23.4)

  // Referencia (Excel) 2019-12 … 2020-06; real desde 2020-05.
  const ref = deepFreeze([
    { year: 2019, month: 11, total: 100 }, { year: 2019, month: 12, total: 200 },
    { year: 2020, month: 1, total: 10 }, { year: 2020, month: 4, total: 40 },
    { year: 2020, month: 5, total: 9999 }, { year: 2020, month: 6, total: 9999 },
  ])
  const real = deepFreeze([
    { key: "2020-05", total: 500 }, { key: "2020-06", total: 0 }, { key: "2020-07", total: 700 },
    { key: "2021-01", total: 1000 }, { key: "2021-02", total: 1000 },
  ])
  const h = mergeHistorico(ref, real, "2020-05", { anchorYear: 2021, anchorMonth: 2 })
  const y = (yr) => h.find((r) => r.year === yr)
  t("años ascendentes", h.map((r) => r.year).join(",") === "2019,2020,2021", `(${h.map((r) => r.year)})`)
  t("2019 = solo referencia (300)", y(2019).ventas === 300)
  t("2020 = referencia ene–abr (50) + real may–dic (1.200); la referencia de may/jun se IGNORA aunque el real sea 0", y(2020).ventas === 1250, `(${y(2020)?.ventas})`)
  t("2021 = solo real (2.000)", y(2021).ventas === 2000)
  t("primer año sin crecimiento", y(2019).crecimientoPct === null)
  t("crecimiento 2020 vs 2019 = 316,7 %", y(2020).crecimientoPct === 316.7, `(${y(2020)?.crecimientoPct})`)
  t("año ancla marcado como parcial", y(2021).parcial === true && y(2020).parcial === false)
  t("sin referencia ni real → lista vacía", mergeHistorico([], [], "2020-05", { anchorYear: 2026, anchorMonth: 9 }).length === 0)
}

console.log("── Ventas por servicio (§51)")
{
  t("10 categorías conocidas", SALE_CATEGORY_KEYS.length === 10 && SALE_CATEGORY_KEYS.includes("DEPILACION_LASER"))
  const rows = deepFreeze([
    { category: "DEPILACION_LASER", branch: "RAFAEL VIDAL", gross: 562500 },
    { category: "DEPILACION_LASER", branch: "LOS JARDINES", gross: 579000 },
    { category: "PRODUCTO", branch: "RAFAEL VIDAL", gross: 140775 },
    { category: "RARA", branch: "RAFAEL VIDAL", gross: 4000 },
  ])
  const s = porServicioFrom(rows)
  t("siempre las 10 claves (forma estable)", Object.keys(s.total).length === 10)
  t("suma por categoría entre sucursales", s.total.DEPILACION_LASER === 1141500 && s.total.PRODUCTO === 140775)
  t("categoría desconocida → OTROS", s.total.OTROS === 4000)
  t("categoría sin ventas = 0, no undefined", s.total.HIFU === 0)
  t("desglose por sucursal", s.byBranch["LOS JARDINES"].DEPILACION_LASER === 579000 && s.byBranch["LOS JARDINES"].PRODUCTO === 0)
}

console.log("── Prompt del análisis IA (§52)")
{
  t("scope propio", ANALISIS_SCOPE === "incentivos-analisis")
  t("la pregunta fija es estable (forma parte del data_hash de la caché)", typeof ANALISIS_QUESTION === "string" && ANALISIS_QUESTION.length > 400)
  t("pide las cinco secciones", ["resumen_ejecutivo", "hallazgos", "riesgos", "recomendaciones", "acciones"].every((k) => ANALISIS_QUESTION.includes(k)))
  t("sin emojis", !/[\u{1F300}-\u{1FAFF}]/u.test(ANALISIS_QUESTION))
}

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
