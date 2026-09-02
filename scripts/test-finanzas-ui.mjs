/**
 * Pruebas del formato de las pantallas financieras de Incentivos de Ventas.
 * Ejecutar:  pnpm test:finanzas
 */
const { SERVICE_LABELS, ALWAYS_SHOWN_SERVICES, serviceRows, shareRows, fmtGrowth, rentPct, flujoTotals, inversionBranches, analysisToText } =
  await import("../lib/bi-finance/finanzas-format.ts")
const { finanzasSheets, finanzasPdfSection } = await import("../lib/bi-finance/bi-export-finanzas.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps
const deepFreeze = (o) => { if (o && typeof o === "object") { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v) } return o }

console.log("── Etiquetas de servicio (§60)")
{
  t("las 8 del Excel", ["LÁSER", "PRODUCTO", "FACIALES", "MASAJE", "TATUAJES", "HOLLYWOOD PEEL", "APLICACIÓN ANEST.", "BOTOX/PLASMA"]
    .every((l) => Object.values(SERVICE_LABELS).includes(l)))
  t("láser y masaje con el nombre del negocio", SERVICE_LABELS.DEPILACION_LASER === "LÁSER" && SERVICE_LABELS.MASAJES === "MASAJE")
  t("HIFU y OTROS no están en las fijas", !ALWAYS_SHOWN_SERVICES.includes("HIFU") && !ALWAYS_SHOWN_SERVICES.includes("OTROS") && ALWAYS_SHOWN_SERVICES.length === 8)
}

console.log("── Ventas por servicio (§61)")
{
  const ps = deepFreeze({ DEPILACION_LASER: 1141500, PRODUCTO: 352575, TATUAJES: 71625, FACIALES: 69800, MASAJES: 48500, HOLLYWOOD_AQUA_PEEL: 3000, ANESTESIA: 0, BOTOX_PLASMA: 0, HIFU: 0, OTROS: 4000 })
  const rows = serviceRows(ps)
  t("láser primero", rows[0].id === "DEPILACION_LASER" && near(rows[0].monto, 1141500))
  t("orden descendente", rows.every((r, i) => i === 0 || rows[i - 1].monto >= r.monto))
  t("OTROS aparece porque tiene ventas; HIFU no", rows.some((r) => r.id === "OTROS") && !rows.some((r) => r.id === "HIFU"))
  t("las 8 fijas siempre están (aunque estén en 0)", ALWAYS_SHOWN_SERVICES.every((k) => rows.some((r) => r.id === k)))
  t("los % suman 100", near(rows.reduce((s, r) => s + r.pct, 0), 100, 0.2), `(${rows.reduce((s, r) => s + r.pct, 0)})`)
  t("láser = 67.5 % del total", near(rows[0].pct, 67.5, 0.05), `(${rows[0].pct})`)
  const cero = serviceRows({})
  t("todo en 0 → sin NaN y 8 filas", cero.length === 8 && cero.every((r) => r.monto === 0 && r.pct === 0))
  t("undefined no revienta", Array.isArray(serviceRows(undefined)))
}

console.log("── Participación por sucursal (§62)")
{
  const rows = shareRows(deepFreeze({ "LOS JARDINES": 808625, "RAFAEL VIDAL": 768175, "VILLA OLGA": 114200 }))
  t("orden descendente", rows[0].branch === "LOS JARDINES" && rows[2].branch === "VILLA OLGA")
  t("% suman 100", near(rows.reduce((s, r) => s + r.pct, 0), 100, 0.05))
  t("sin datos → lista vacía", shareRows({}).length === 0 && shareRows(undefined).length === 0)
  t("rentPct(0, 0) = null (no aplica, no cero)", rentPct(0, 0) === null && rentPct(50, 100) === 50)
}

console.log("── Crecimiento (§63)")
{
  t("null → «—»", fmtGrowth(null) === "—" && fmtGrowth(undefined) === "—")
  t("positivo", fmtGrowth(12.34) === "▲ 12.3%")
  t("negativo", fmtGrowth(-4) === "▼ 4.0%")
  t("cero", fmtGrowth(0) === "▲ 0.0%")
}

console.log("── Totales del flujo mensual (§64)")
{
  const mes = (key, label, ventas, gastos, invG, invVO, retiros) => ({
    key, label, short: label.slice(0, 3), ventas, gastosOperativos: gastos, inversionGeneral: invG,
    inversionByBranch: invVO ? { "VILLA OLGA": invVO } : {}, retiros,
    egresos: gastos + invG + invVO + retiros, neto: ventas - (gastos + invG + invVO + retiros),
  })
  const rows = deepFreeze([
    mes("2026-01", "ene 2026", 1691000, 1452075.7, 403117.98, 484243.2, 0),
    mes("2026-02", "feb 2026", 4958464, 2183101.9, 606307.58, 1288316.46, 500000),
  ])
  const ene = rows[0]
  t("enero: neto −648.436,88 (con los montos en texto que el Excel no suma)", near(ene.neto, -648436.88), `(${ene.neto})`)
  const tot = flujoTotals(rows)
  t("TOTAL suma ventas", near(tot.ventas, 6649464))
  t("TOTAL suma gastos", near(tot.gastosOperativos, 3635177.6))
  t("TOTAL suma inversión general y por sucursal", near(tot.inversionGeneral, 1009425.56) && near(tot.inversionByBranch["VILLA OLGA"], 1772559.66))
  t("TOTAL suma retiros y neto", near(tot.retiros, 500000) && near(tot.neto, ene.neto + rows[1].neto))
  t("la fila TOTAL se identifica", tot.key === "TOTAL" && tot.label === "Total")
  t("columnas de inversión únicas y ordenadas", inversionBranches(rows).join(",") === "VILLA OLGA")
  t("no muta la entrada (estaba congelada)", rows[0].ventas === 1691000)
  t("lista vacía → todo en cero", flujoTotals([]).ventas === 0 && flujoTotals([]).neto === 0)
}

console.log("── Hojas del export (§65)")
{
  const summary = {
    ingresos: { porServicio: { DEPILACION_LASER: 100, PRODUCTO: 50, FACIALES: 0, MASAJES: 0, TATUAJES: 0, HOLLYWOOD_AQUA_PEEL: 0, ANESTESIA: 0, BOTOX_PLASMA: 0, HIFU: 0, OTROS: 0 } },
    flujoMensual: [{ key: "2026-01", label: "ene 2026", short: "Ene 26", ventas: 100, gastosOperativos: 40, inversionGeneral: 10, inversionByBranch: { "VILLA OLGA": 5 }, retiros: 5, egresos: 60, neto: 40 }],
    historicoAnual: [{ year: 2025, ventas: 42222938, crecimientoPct: 10.4, parcial: false }, { year: 2026, ventas: 25247495, crecimientoPct: -40.2, parcial: true }],
  }
  const sheets = finanzasSheets(summary)
  t("3 hojas", sheets.length === 3, `(${sheets.map((s) => s.name)})`)
  t("nombres correctos", sheets.map((s) => s.name).join("|") === "Flujo mensual|Ventas por servicio|Histórico anual")
  const flujo = sheets[0]
  t("«Flujo mensual» lleva fila TOTAL", Boolean(flujo.totals) && near(flujo.totals.neto, 40))
  t("«Flujo mensual» crea columna por sucursal con inversión", flujo.cols.some((c) => c.header === "Inv. VILLA OLGA"))
  t("«Histórico anual» marca el año parcial", sheets[2].rows[1].year === "2026 (parcial)" && sheets[2].rows[1].crecimiento === "▼ 40.2%")
  const html = finanzasPdfSection(summary)
  t("la sección PDF trae la tabla y el TOTAL", html.includes("Flujo de efectivo mensual") && html.includes("TOTAL"))
  t("sin flujo → sin hojas ni sección", finanzasSheets({ ingresos: {}, flujoMensual: [], historicoAnual: [] }).length === 0 && finanzasPdfSection({ ingresos: {}, flujoMensual: [] }) === "")
}

console.log("── Texto del análisis (§66)")
{
  const answer = { resumen_ejecutivo: "Ventas RD$1,691,000.", hallazgos: ["RAFAEL VIDAL — margen 6 %."], riesgos: ["Concentración en láser."], recomendaciones: ["Prioridad 1: bajar gastos."], acciones: ["Auditoría — Responsable: Administración — Plazo: 30 días"], nivel_confianza: "alto", datos_faltantes: [] }
  const txt = analysisToText(answer, { model: "gpt-5.2", period: "Enero 2026" })
  t("incluye período y modelo", txt.includes("Enero 2026") && txt.includes("gpt-5.2"))
  t("incluye las 5 secciones con contenido", ["RESUMEN EJECUTIVO", "HALLAZGOS", "RIESGOS", "RECOMENDACIONES", "PLAN DE ACCIÓN"].every((s) => txt.includes(s)))
  t("omite las secciones vacías", !txt.includes("DATOS FALTANTES"))
  t("incluye el nivel de confianza", txt.includes("Nivel de confianza: alto"))
}

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
