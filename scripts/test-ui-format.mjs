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

console.log(`\n${pass} pasaron · ${fail} fallaron`)
process.exit(fail ? 1 : 0)
