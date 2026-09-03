/**
 * AISLAMIENTO ENTRE NEGOCIOS — la red que faltaba.
 *
 * Esta sesión encontró tres formas distintas de cruzar datos entre las dos
 * empresas, y ninguna suite las habría detectado:
 *   · el dedupe de clientes devolvía la ficha AJENA (cédula, teléfono, correo),
 *   · los certificados guardados en el navegador se recreaban en la otra empresa,
 *   · las pantallas seguían mostrando lo del negocio anterior al cambiar.
 *
 * Aquí se comprueba, con contexto de un negocio, que ninguna lectura devuelve
 * filas del otro. Corre contra la base REAL: no inventa datos, verifica los que hay.
 *
 *   pnpm test:aislamiento
 */
import fs from "node:fs"
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const { runSql } = await import("./db-query.js")
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const commission = await import("../lib/server/commission.ts")
const bi = await import("../lib/server/bi-finance.ts")

const NEGOCIOS = {
  csl: { id: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", sucursales: ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"] },
  depicenter: { id: "03b96698-c5df-4b4b-84df-1160a7ad56b9", sucursales: ["LA VEGA", "DEPICENTER"] },
}
const ctxDe = (slug) => ({ businessId: NEGOCIOS[slug].id, businessSlug: slug, isSuperadmin: true,
  isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] }, permissions: [] })

let ok = 0, mal = 0
const t = (nombre, cond, detalle = "") => {
  if (cond) { ok++; console.log("  ✓", nombre) }
  else { mal++; console.log("  ✗", nombre, detalle) }
}

console.log("── Ninguna lectura devuelve sucursales del otro negocio (§A)")
for (const [slug, cfg] of Object.entries(NEGOCIOS)) {
  const ajenas = Object.entries(NEGOCIOS).filter(([s]) => s !== slug).flatMap(([, c]) => c.sucursales)
  await runWithBusinessContext(ctxDe(slug), async () => {
    const porSuc = await commission.getCommissionByBranch({ month: "8", year: "2026" })
    const filas = porSuc?.rows ?? porSuc?.branches ?? []
    const intrusas = filas.map((r) => r.branch ?? r.sucursal).filter((b) => ajenas.includes(b))
    t(`${slug}: ventas por sucursal sin intrusas`, intrusas.length === 0, `(${intrusas})`)

    const fin = await bi.getBiFinanceSummary({ month: 8, year: 2026 })
    const intrusasFin = Object.keys(fin.ingresos?.byBranch || {}).filter((b) => ajenas.includes(b))
    t(`${slug}: BI financiero sin intrusas`, intrusasFin.length === 0, `(${intrusasFin})`)

    // Filtrar por una sucursal AJENA no puede devolver nada.
    const conAjena = await commission.getCommissionByBranch({ month: "8", year: "2026", branch: ajenas[0] })
    const n = (conAjena?.rows ?? conAjena?.branches ?? []).length
    t(`${slug}: filtrar por «${ajenas[0]}» devuelve vacío`, n === 0, `(${n} filas)`)
  })
}

console.log("\n── Las cifras de cada negocio no se contaminan (§B)")
const ESPERADO = { csl: 93378.01, depicenter: 19819.40 }
for (const [slug, esperado] of Object.entries(ESPERADO)) {
  await runWithBusinessContext(ctxDe(slug), async () => {
    const d = await commission.getCommissionExecutiveDashboard({ month: "8", year: "2026" })
    t(`${slug}: incentivos de agosto = ${esperado.toLocaleString("en-US")}`,
      Math.abs(d.kpis.netTotal - esperado) < 0.01, `(${d.kpis.netTotal})`)
  })
}

console.log("\n── La base no deja huecos por donde colarse (§C)")
{
  const [g] = await runSql(`select count(*) n from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`)
  t("ni anon ni authenticated pueden escribir en la base", Number(g.n) === 0, `(${g.n} permisos)`)

  const sinRls = await runSql(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)
  t("todas las tablas tienen RLS activa", sinRls.length === 0, `(${sinRls.map((r) => r.relname)})`)

  const nulos = await runSql(`select 'expenses' t, count(*) n from expenses where business_id is null
    union all select 'sales_commission_sales', count(*) from sales_commission_sales where business_id is null
    union all select 'csl_cosmiatria_clientes', count(*) from csl_cosmiatria_clientes where business_id is null`)
  const conNulos = nulos.filter((r) => Number(r.n) > 0)
  t("ninguna fila de negocio sin dueño", conNulos.length === 0, `(${JSON.stringify(conNulos)})`)
}

console.log(`\n${ok} pasaron · ${mal} fallaron`)
process.exit(mal ? 1 : 0)
