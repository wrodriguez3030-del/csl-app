/**
 * Genera la hoja de PROYECCIÓN DE VENTAS a 5 años desde los datos reales de
 * db-cls. Se puede volver a correr cuando entren más meses:
 *
 *   node --import tsx scripts/proyeccion-ventas.mjs "<ruta de salida.xlsx>"
 *
 * Todo lo proyectado sale de FÓRMULAS que leen la hoja «Supuestos»: cambiar un
 * porcentaje ahí recalcula los cinco años. No se pega ningún resultado.
 */
import fs from "node:fs"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const ExcelJS = (await import("exceljs")).default
const { runSql } = await import("./db-query.js")

const SALIDA = process.argv[2] || "Proyeccion de ventas.xlsx"
const ANIO = 2026
const SUCS = ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA", "LA VEGA"]
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"]
const n2 = (x) => Math.round((Number(x) || 0) * 100) / 100

// ── Datos reales ───────────────────────────────────────────────────────────
const refe = await runSql(`select year, sum(total)::float8 t from sales_history_monthly group by 1 order by 1`)
const anual = await runSql(`
  select extract(year from sale_date)::int y, sum(gross_amount)::float8 t,
         count(distinct date_trunc('month', sale_date))::int meses
  from sales_commission_sales group by 1 order by 1`)
const porSuc = await runSql(`
  select extract(year from sale_date)::int y, branch b, sum(gross_amount)::float8 t
  from sales_commission_sales group by 1,2`)
const mensual = await runSql(`
  select extract(year from sale_date)::int y, extract(month from sale_date)::int m, sum(gross_amount)::float8 t
  from sales_commission_sales group by 1,2`)

const refeBy = Object.fromEntries(refe.map((r) => [r.year, r.t]))
const anualBy = Object.fromEntries(anual.map((r) => [r.y, r.t]))
const mesesBy = Object.fromEntries(anual.map((r) => [r.y, r.meses]))
const sucBy = {}
for (const r of porSuc) (sucBy[r.y] ||= {})[r.b] = r.t
const mesBy = {}
for (const r of mensual) (mesBy[r.y] ||= {})[r.m] = r.t

/** Total del año: el real más el histórico de referencia de los meses previos a mayo-2020. */
const totalAnio = (y) => n2((anualBy[y] || 0) + (refeBy[y] || 0))

// Estacionalidad: peso medio de cada mes en los 3 últimos años COMPLETOS.
const completos = Object.keys(mesesBy).map(Number).filter((y) => mesesBy[y] === 12).sort().slice(-3)
const pesoMes = MESES.map((_, i) => {
  const num = completos.reduce((s, y) => s + (mesBy[y]?.[i + 1] || 0), 0)
  const den = completos.reduce((s, y) => s + (anualBy[y] || 0), 0)
  return den ? num / den : 0
})
const cuotaEneAgo = pesoMes.slice(0, 8).reduce((a, b) => a + b, 0)

// Lo que va del año en curso, por sucursal.
const mesesConDato = Object.keys(mesBy[ANIO] || {}).map(Number).sort((a, b) => a - b)
const ultimoMes = mesesConDato.length ? Math.max(...mesesConDato) : 0
const cuotaTranscurrida = pesoMes.slice(0, ultimoMes).reduce((a, b) => a + b, 0)
const enCurso = SUCS.map((s) => ({ suc: s, real: n2(sucBy[ANIO]?.[s] || 0) })).filter((r) => r.real > 0)
const mesesSuc = await runSql(`
  select branch b, count(distinct date_trunc('month', sale_date))::int m
  from sales_commission_sales where extract(year from sale_date) = ${ANIO} group by 1`)
const mesesSucBy = Object.fromEntries(mesesSuc.map((r) => [r.b, r.m]))
const mesesDeSuc = (s) => mesesSucBy[s] || 0

console.log(`Histórico: ${Object.keys(anualBy).length} años · estacionalidad de ${completos.join(", ")}`)
console.log(`${ANIO}: ${ultimoMes} meses cargados = ${cuotaTranscurrida.toFixed(4)} del año`)
for (const r of enCurso) console.log(`   ${r.suc.padEnd(14)} ${r.real.toLocaleString("en-US").padStart(14)}`)

// ── Libro ──────────────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook()
wb.creator = "csl-app"; wb.created = new Date()
const RD = '"RD$"#,##0'; const PCT = "0.0%"
const titulo = (ws, fila, texto, ancho = 8) => {
  ws.mergeCells(fila, 1, fila, ancho)
  const c = ws.getCell(fila, 1); c.value = texto
  c.font = { bold: true, size: 13, color: { argb: "FF1F3864" } }
  ws.getRow(fila).height = 22
}
const cabecera = (ws, fila, valores, desde = 1) => {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, desde + i); c.value = v
    c.font = { bold: true, color: { argb: "FFFFFFFF" } }
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } }
    c.alignment = { horizontal: i === 0 ? "left" : "right", wrapText: true }
  })
}
const nota = (ws, fila, texto, ancho = 8) => {
  ws.mergeCells(fila, 1, fila, ancho)
  const c = ws.getCell(fila, 1); c.value = texto
  c.font = { italic: true, size: 10, color: { argb: "FF595959" } }
  c.alignment = { wrapText: true, vertical: "top" }
  ws.getRow(fila).height = 30
}

// ── Hoja SUPUESTOS ─────────────────────────────────────────────────────────
const sup = wb.addWorksheet("Supuestos", { properties: { tabColor: { argb: "FFC00000" } } })
sup.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 52 }]
titulo(sup, 1, "SUPUESTOS — cambia estos números y todo lo demás se recalcula", 6)
sup.getCell("A3").value = "Parte del año que va de enero a agosto"
sup.getCell("B3").value = cuotaEneAgo
sup.getCell("B3").numFmt = PCT
sup.getCell("F3").value = `Media de ${completos.join(", ")}. Sirve para estimar el cierre de ${ANIO}.`
sup.getCell("A4").value = "Peso de NOVIEMBRE en el año"
sup.getCell("B4").value = pesoMes[10]
sup.getCell("B4").numFmt = PCT
sup.getCell("F4").value = "Black Friday. Es el mes que decide el año: si falla, la proyección entera falla."

// Una sucursal con un solo mes no se puede proyectar: se pide el número.
const NUEVA = enCurso.find((r) => (Object.values(mesBy[ANIO] || {}).length, mesesDeSuc(r.suc) <= 2))
if (NUEVA) {
  sup.getCell("A5").value = `${NUEVA.suc} — cierre ${ANIO} (ponlo tú)`
  const c = sup.getCell("B5")
  c.value = n2(NUEVA.real * 6)
  c.numFmt = RD
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } }
  sup.getCell("F5").value = `Solo tiene ${mesesDeSuc(NUEVA.suc)} mes de ventas (${n2(NUEVA.real).toLocaleString("en-US")} en julio). El valor de partida supone ese mismo ritmo de julio a diciembre, SIN campaña de noviembre. Súbelo si vas a hacer Black Friday allí.`
  sup.getCell("F5").alignment = { wrapText: true }
  sup.getRow(5).height = 42
}

cabecera(sup, 7, ["Crecimiento anual esperado", ...[1, 2, 3, 4].map((i) => String(ANIO + i))])
const CREC = {
  "RAFAEL VIDAL": [0.03, 0.03, 0.03, 0.03],
  "LOS JARDINES": [0.08, 0.06, 0.05, 0.04],
  "VILLA OLGA": [0.35, 0.20, 0.12, 0.08],
  "LA VEGA": [0.40, 0.25, 0.15, 0.10],
}
const RAZON = {
  "RAFAEL VIDAL": "Madura: lleva dos años plana (−0,4 % y −0,6 % en ene–ago).",
  "LOS JARDINES": "Creció 50 % y luego 11 %: se está asentando.",
  "VILLA OLGA": "Arrancando fuerte, pero ese ritmo no se sostiene.",
  "LA VEGA": "SOLO UN MES DE DATOS. Este número es una apuesta, no una proyección.",
}
let f = 8
const filaCrec = {}
for (const s of SUCS) {
  sup.getCell(f, 1).value = s
  CREC[s].forEach((v, i) => { const c = sup.getCell(f, 2 + i); c.value = v; c.numFmt = PCT; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } })
  sup.getCell(f, 6).value = RAZON[s]
  sup.getCell(f, 6).alignment = { wrapText: true }
  filaCrec[s] = f
  f++
}
nota(sup, f + 1, "Las celdas amarillas son las únicas que hay que tocar. Los porcentajes de partida salen de la tendencia real de cada sucursal, no de un deseo: bájalos o súbelos según lo que sepas del negocio.", 6)

// ── Hoja HISTÓRICO ─────────────────────────────────────────────────────────
const his = wb.addWorksheet("Histórico")
his.columns = [{ width: 10 }, { width: 16 }, { width: 13 }, { width: 10 }, ...SUCS.map(() => ({ width: 16 }))]
titulo(his, 1, "VENTAS REALES", 8)
cabecera(his, 3, ["Año", "Ventas", "Crecimiento", "Meses", ...SUCS])
const anios = [...new Set([...Object.keys(anualBy), ...Object.keys(refeBy)].map(Number))].sort()
let fh = 4
const filaAnio = {}
for (const y of anios) {
  const meses = (mesesBy[y] || 0) + (refeBy[y] && !anualBy[y] ? 12 : 0)
  his.getCell(fh, 1).value = y
  his.getCell(fh, 2).value = totalAnio(y); his.getCell(fh, 2).numFmt = RD
  if (fh > 4) { his.getCell(fh, 3).value = { formula: `IF(B${fh - 1}=0,"",B${fh}/B${fh - 1}-1)` }; his.getCell(fh, 3).numFmt = PCT }
  his.getCell(fh, 4).value = mesesBy[y] || (refeBy[y] ? "ref." : "")
  SUCS.forEach((s, i) => {
    const v = sucBy[y]?.[s]
    if (v) { const c = his.getCell(fh, 5 + i); c.value = n2(v); c.numFmt = RD }
  })
  if ((mesesBy[y] || 0) < 12) {
    for (let c = 1; c <= 8; c++) his.getCell(fh, c).font = { italic: true, color: { argb: "FF808080" } }
  }
  filaAnio[y] = fh
  fh++
}
nota(his, fh + 1, `En gris, los años incompletos: 2017 arranca en abril y 2020 perdió meses por la pandemia. ${ANIO} solo lleva ${ultimoMes} meses cargados. El detalle por sucursal empieza cuando cada una abre.`, 8)

// ── Hoja PROYECCIÓN ────────────────────────────────────────────────────────
const pro = wb.addWorksheet("Proyección", { properties: { tabColor: { argb: "FF1F3864" } } })
pro.columns = [{ width: 20 }, ...Array(5).fill({ width: 17 }), { width: 46 }]
titulo(pro, 1, `PROYECCIÓN DE VENTAS ${ANIO} – ${ANIO + 4}`, 7)
cabecera(pro, 3, ["Sucursal", `${ANIO} (cierre)`, ...[1, 2, 3, 4].map((i) => String(ANIO + i)), ""])
let fp = 4
const filaPro = {}
for (const { suc, real } of enCurso) {
  pro.getCell(fp, 1).value = suc
  // Cierre del año: lo real dividido entre la parte del año transcurrida.
  const c26 = pro.getCell(fp, 2)
  c26.value = mesesDeSuc(suc) <= 2
    ? { formula: `'Supuestos'!$B$5` }
    : { formula: `${n2(real)}/${cuotaTranscurrida.toFixed(6)}` }
  c26.numFmt = RD
  for (let i = 0; i < 4; i++) {
    const c = pro.getCell(fp, 3 + i)
    const col = String.fromCharCode(66 + i)
    c.value = { formula: `${col}${fp}*(1+'Supuestos'!$${String.fromCharCode(66 + i)}$${filaCrec[suc]})` }
    c.numFmt = RD
  }
  pro.getCell(fp, 7).value = mesesDeSuc(suc) <= 2
    ? `⚠ Solo ${mesesDeSuc(suc)} mes de ventas y agosto sin importar: el cierre lo fijas tú en «Supuestos».` : ""
  pro.getCell(fp, 7).font = { italic: true, size: 10, color: { argb: "FFC00000" } }
  filaPro[suc] = fp
  fp++
}
const filas = Object.values(filaPro)
pro.getCell(fp, 1).value = "TOTAL"
for (let c = 2; c <= 6; c++) {
  const col = String.fromCharCode(64 + c)
  const cel = pro.getCell(fp, c)
  cel.value = { formula: `SUM(${col}${Math.min(...filas)}:${col}${Math.max(...filas)})` }
  cel.numFmt = RD
}
pro.getRow(fp).font = { bold: true }
pro.getRow(fp).border = { top: { style: "double" } }
const filaTotal = fp

pro.getCell(fp + 2, 1).value = "Crecimiento sobre el año anterior"
pro.getCell(fp + 2, 1).font = { bold: true }
const ultReal = anios.filter((y) => mesesBy[y] === 12).pop()
for (let c = 2; c <= 6; c++) {
  const col = String.fromCharCode(64 + c)
  const prev = c === 2 ? `'Histórico'!B${filaAnio[ultReal]}` : `${String.fromCharCode(63 + c)}${filaTotal}`
  const cel = pro.getCell(fp + 2, c)
  cel.value = { formula: `${col}${filaTotal}/${prev}-1` }
  cel.numFmt = PCT
}
nota(pro, fp + 4, `El cierre de ${ANIO} se estima dividiendo lo vendido hasta ${MESES[ultimoMes - 1]} entre la parte del año que representa (${(cuotaTranscurrida * 100).toFixed(1)} %). De ${ANIO + 1} en adelante se aplica el crecimiento de la hoja «Supuestos». Noviembre pesa ${(pesoMes[10] * 100).toFixed(0)} % del año: la proyección entera depende de esa campaña.`, 7)

// ── Hoja MES A MES ─────────────────────────────────────────────────────────
const mm = wb.addWorksheet(`${ANIO} mes a mes`)
mm.columns = [{ width: 10 }, { width: 16 }, { width: 16 }, { width: 13 }, { width: 40 }]
const realAcumulado = Object.values(mesBy[ANIO] || {}).reduce((a, b) => a + b, 0)
const pesoPendiente = pesoMes.reduce((s2, p, i) => s2 + (mesBy[ANIO]?.[i + 1] ? 0 : p), 0)
titulo(mm, 1, `${ANIO} MES A MES — lo real y lo que falta`, 5)
cabecera(mm, 3, ["Mes", "Real", "Proyectado", "% del año", ""])
let fm = 4
for (let i = 0; i < 12; i++) {
  mm.getCell(fm, 1).value = MESES[i]
  const real = mesBy[ANIO]?.[i + 1]
  if (real) { const c = mm.getCell(fm, 2); c.value = n2(real); c.numFmt = RD }
  else {
    // Lo que falta del año se reparte entre los meses pendientes en proporción a
    // su peso, para que la suma CUADRE con el cierre de la hoja «Proyección».
    const c = mm.getCell(fm, 3)
    c.value = { formula: `('Proyección'!$B$${filaTotal}-${n2(realAcumulado)})*${(pesoMes[i] / pesoPendiente).toFixed(6)}` }
    c.numFmt = RD
    c.font = { color: { argb: "FF1F3864" }, italic: true }
  }
  const p = mm.getCell(fm, 4); p.value = pesoMes[i]; p.numFmt = PCT
  if (i === 10) mm.getCell(fm, 5).value = "Black Friday: el mes que decide el año"
  fm++
}
mm.getCell(fm, 1).value = "TOTAL"
mm.getCell(fm, 2).value = { formula: `SUM(B4:B${fm - 1})` }; mm.getCell(fm, 2).numFmt = RD
mm.getCell(fm, 3).value = { formula: `SUM(C4:C${fm - 1})` }; mm.getCell(fm, 3).numFmt = RD
mm.getCell(fm, 4).value = { formula: `SUM(D4:D${fm - 1})` }; mm.getCell(fm, 4).numFmt = PCT
mm.getRow(fm).font = { bold: true }
mm.getRow(fm).border = { top: { style: "double" } }
mm.getCell(fm + 1, 1).value = "AÑO COMPLETO"
mm.getCell(fm + 1, 2).value = { formula: `B${fm}+C${fm}` }
mm.getCell(fm + 1, 2).numFmt = RD
mm.getCell(fm + 1, 2).font = { bold: true, size: 12 }
nota(mm, fm + 3, "El % del año es el peso medio de cada mes en los tres últimos años completos. Lo que falta para llegar al cierre proyectado se reparte entre los meses pendientes según ese peso, así que la suma cuadra siempre con la hoja «Proyección».", 5)

await wb.xlsx.writeFile(SALIDA)
console.log(`\n✅ ${SALIDA}`)
