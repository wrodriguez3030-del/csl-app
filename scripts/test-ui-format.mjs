/**
 * Pruebas del formateo de KPIs (tarjetas de los tableros).
 * Ejecutar:  pnpm test:ui
 */
const { kpiValueClass, KPI_VALUE_BASE } = await import("../lib/ui/kpi-value.ts")

let pass = 0, fail = 0
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log("── Tarjetas de KPI: el número se ve COMPLETO (§45)")

// Nunca se recorta: `truncate` cortaba con «…» los importes largos.
t("la clase base no recorta", !KPI_VALUE_BASE.includes("truncate"), `(${KPI_VALUE_BASE})`)
t("el número no se parte en dos líneas", KPI_VALUE_BASE.includes("whitespace-nowrap"))
t("dígitos de ancho fijo", KPI_VALUE_BASE.includes("tabular-nums"))

// Escalones: cuanto más largo el valor, más pequeña la letra — pero entero.
t("valor corto → letra grande", kpiValueClass("2,213") === "text-lg", `(${kpiValueClass("2,213")})`)
t("porcentaje → letra grande", kpiValueClass("58.7%") === "text-lg")
t("RD$1,974,512.00 (mes) entra en text-sm", kpiValueClass("RD$1,974,512.00") === "text-sm", `(${kpiValueClass("RD$1,974,512.00")})`)
t("RD$147,733,900.35 (historial) entra en text-sm", kpiValueClass("RD$147,733,900.35") === "text-sm", `(${kpiValueClass("RD$147,733,900.35")})`)
t("valor descomunal → el escalón más pequeño", kpiValueClass("RD$1,234,567,890,123.45") === "text-xs")

// Monotonía: alargar el texto nunca puede AGRANDAR la letra.
{
  const orden = ["text-lg", "text-base", "text-sm", "text-xs"]
  let ok = true, prev = 0
  for (let n = 1; n <= 40; n++) {
    const i = orden.indexOf(kpiValueClass("9".repeat(n)))
    if (i < 0 || i < prev) ok = false
    prev = i
  }
  t("más caracteres nunca dan letra más grande", ok)
}

// Bordes.
t("cadena vacía no revienta", typeof kpiValueClass("") === "string")
t("null/undefined no revienta", typeof kpiValueClass(undefined) === "string")

console.log("── Conteo físico · visibilidad al escanear (§61)")
{
  const { ajusteVisibilidad } = await import("../lib/productos-scan.ts")
  const P = { nombre: "HELIOCARE 360 GEL", sku: "HC360", sistema: 5, contado: "" }
  const sinFiltros = ajusteVisibilidad(P, { search: "", incluirCeros: false })
  t("sin filtros no hay nada que soltar", !sinFiltros.limpiarBusqueda && !sinFiltros.mostrarCeros)
  t("búsqueda que no casa → se limpia", ajusteVisibilidad(P, { search: "URIAGE", incluirCeros: false }).limpiarBusqueda === true)
  t("casa por nombre → no se toca", ajusteVisibilidad(P, { search: "helio", incluirCeros: false }).limpiarBusqueda === false)
  t("casa por SKU → no se toca", ajusteVisibilidad(P, { search: "hc360", incluirCeros: false }).limpiarBusqueda === false)
  t("existencia 0 y oculto → se muestran los ceros", ajusteVisibilidad({ ...P, sistema: 0 }, { search: "", incluirCeros: false }).mostrarCeros === true)
  t("existencia 0 pero ya contado → ya se ve", ajusteVisibilidad({ ...P, sistema: 0, contado: "3" }, { search: "", incluirCeros: false }).mostrarCeros === false)
  t("no muta lo que recibe", (() => {
    const p = Object.freeze({ ...P }), v = Object.freeze({ search: "x", incluirCeros: false })
    ajusteVisibilidad(p, v); return p.contado === "" && v.search === "x"
  })())
}

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
