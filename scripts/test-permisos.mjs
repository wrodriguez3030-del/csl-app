/**
 * PRUEBA DE COMPLETITUD DE PERMISOS.
 *
 * Es la pieza que hace que el cierre por defecto no dependa de que nadie se
 * olvide: si mañana alguien añade una acción al despachador sin declarar su
 * permiso, esta prueba falla en la consola, no en la cara de una empleada.
 *
 *   pnpm test:permisos
 */
import { readFileSync, existsSync } from "node:fs"
import { PERMISSION_OPTIONS, PERMISSION_ID_SET, CAJA_FUERTE } from "../lib/permissions/catalog.ts"
import { MENU_PERMISOS, PERMISOS_PREEXISTENTES } from "../lib/permissions/inherit.ts"
import {
  ACTION_PERMISSIONS,
  ENTITY_PERMISSIONS,
  ROUTE_PERMISSIONS,
  permisosHuerfanos,
  PUBLICO,
  POR_ENTIDAD,
} from "../lib/permissions/action-map.ts"

let fallos = 0
const ok = (msg) => console.log(`  ✅ ${msg}`)
const fail = (msg, detalle) => {
  fallos++
  console.log(`  ❌ ${msg}`)
  if (detalle?.length) console.log(`     ${detalle.join("\n     ")}`)
}

console.log("\n🔐 Permisos · prueba de completitud\n")

// ── 1. Toda acción del despachador está declarada ──────────────────────────
const handlers = readFileSync("app/api/csl/_handlers.ts", "utf8")
const acciones = [...new Set([...handlers.matchAll(/case "([A-Za-z0-9_]+)"/g)].map((m) => m[1]))]
const sinDeclarar = acciones.filter((a) => !(a in ACTION_PERMISSIONS))
if (sinDeclarar.length) {
  fail(`${sinDeclarar.length} acciones del despachador SIN permiso declarado`, sinDeclarar)
  console.log(`     → decláralas en lib/permissions/action-map.ts`)
} else {
  ok(`las ${acciones.length} acciones del despachador declaran permiso`)
}

// ── 2. No sobran entradas en el mapa ───────────────────────────────────────
const sobrantes = Object.keys(ACTION_PERMISSIONS).filter((a) => !acciones.includes(a))
if (sobrantes.length) fail(`${sobrantes.length} acciones en el mapa que ya no existen`, sobrantes)
else ok("el mapa no declara acciones inexistentes")

// ── 3. Ningún permiso inventado ────────────────────────────────────────────
const huerfanos = permisosHuerfanos()
if (huerfanos.length) fail(`${huerfanos.length} permisos citados que no están en el catálogo`, huerfanos)
else ok("todos los permisos citados existen en el catálogo")

// ── 4. Toda entidad de getRowsPaged tiene permiso ──────────────────────────
// Se lee del fuente en vez de importarlo: `csl-crud.ts` arrastra `server-only`.
const crud = readFileSync("lib/server/csl-crud.ts", "utf8")
const bloque = crud.slice(crud.indexOf("export const ENTITY_TABLES"))
const entidades = [...bloque.slice(0, bloque.indexOf("\n}")).matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1])
const entidadesSinPermiso = entidades.filter((e) => !(e in ENTITY_PERMISSIONS))
if (!entidades.length) fail("no se pudo leer ENTITY_TABLES de csl-crud.ts")
else if (entidadesSinPermiso.length) fail("entidades de getRowsPaged sin permiso", entidadesSinPermiso)
else ok(`las ${entidades.length} entidades de getRowsPaged declaran permiso`)

// ── 5. La caja fuerte existe en el catálogo ────────────────────────────────
const cajaRota = [...CAJA_FUERTE].filter((p) => !PERMISSION_ID_SET.has(p))
if (cajaRota.length) fail("permisos de caja fuerte que no están en el catálogo", cajaRota)
else ok(`los ${CAJA_FUERTE.size} permisos de caja fuerte existen en el catálogo`)

// ── 5b. Ningún menú reparte la caja fuerte ─────────────────────────────────
// La caja fuerte tiene que NACER cerrada. Un menú que la conceda la convierte
// en un rótulo, y el error sería invisible: los permisos ya repartidos se
// quedan en la fila de cada usuario aunque después se muevan a la lista.
const reparteCajaFuerte = Object.entries(MENU_PERMISOS)
  .flatMap(([menu, perms]) => perms.filter((p) => CAJA_FUERTE.has(p)).map((p) => `${menu} → ${p}`))
if (reparteCajaFuerte.length) fail("menús que heredan permisos de caja fuerte", reparteCajaFuerte)
else ok("ningún menú reparte la caja fuerte")

// ── 5c. La caja fuerte y los preexistentes no se pisan ─────────────────────
const solapan = [...CAJA_FUERTE].filter((p) => PERMISOS_PREEXISTENTES.has(p))
if (solapan.length) fail("permisos a la vez en CAJA_FUERTE y PERMISOS_PREEXISTENTES", solapan)
else ok("caja fuerte y permisos preexistentes no se solapan")

// ── 6. Sin ids duplicados ──────────────────────────────────────────────────
const vistos = new Set()
const dups = PERMISSION_OPTIONS.map((p) => p.id).filter((id) => (vistos.has(id) ? true : (vistos.add(id), false)))
if (dups.length) fail("permisos duplicados en el catálogo", dups)
else ok(`los ${PERMISSION_OPTIONS.length} permisos del catálogo son únicos`)

// ── 7. Las rutas declaradas existen en disco ───────────────────────────────
const rutasRotas = Object.keys(ROUTE_PERMISSIONS).filter((clave) => {
  const ruta = clave.split(" ")[1]
  return !existsSync(`app${ruta.replace(/^\/api/, "/api")}/route.ts`)
})
if (rutasRotas.length) fail("rutas declaradas que no existen en disco", rutasRotas)
else ok(`las ${Object.keys(ROUTE_PERMISSIONS).length} rutas declaradas existen`)

// ── 7b. Una ruta declarada tiene que APLICAR la guardia, no solo declararla ─
const sinGuardia = Object.keys(ROUTE_PERMISSIONS).filter((clave) => {
  const archivo = `app${clave.split(" ")[1]}/route.ts`
  return existsSync(archivo) && !readFileSync(archivo, "utf8").includes("enforceRoutePermission")
})
if (sinGuardia.length) fail("rutas declaradas que NO llaman a enforceRoutePermission", sinGuardia)
else ok("todas las rutas declaradas aplican la guardia")

// ── 8. Ninguna ruta de escritura autenticada se queda fuera ────────────────
// Las públicas y las de cron/webhook se guardan con un secreto, no con permiso.
const EXENTAS = [
  "/api/csl", "/api/public/", "/api/public-form-links/[token]", "/api/security/",
  "/api/integrations/agendapro/cron", "/api/integrations/agendapro/payments",
  "/api/integrations/agendapro/payments-cron", "/api/integrations/agendapro/webhook",
  // Exige requireSuperadmin, más estricto que cualquier permiso del catálogo.
  "/api/admin/users",
]
const { globSync } = await import("node:fs")
const rutasEnDisco = globSync("app/api/**/route.ts")
const noDeclaradas = []
for (const archivo of rutasEnDisco) {
  const ruta = archivo.replace(/^app/, "").replace(/\/route\.ts$/, "")
  if (EXENTAS.some((e) => ruta.startsWith(e))) continue
  const src = readFileSync(archivo, "utf8")
  const metodos = [...src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1])
  for (const metodo of metodos) {
    if (!(`${metodo} ${ruta}` in ROUTE_PERMISSIONS)) noDeclaradas.push(`${metodo} ${ruta}`)
  }
}
if (noDeclaradas.length) {
  fail(`${noDeclaradas.length} rutas fuera del despachador sin permiso declarado`, noDeclaradas)
  console.log(`     → decláralas en ROUTE_PERMISSIONS, o añádelas a EXENTAS si su guardia es un secreto`)
} else {
  ok("ninguna ruta autenticada fuera del despachador se queda sin permiso")
}

// ── 9. Lo delicado está donde debe ─────────────────────────────────────────
// Un despiste aquí devuelve la nómina o los préstamos a todo el mundo.
const ESPERADO = {
  saveHrLoan: "rrhh.prestamos",
  voidHrPunch: "rrhh.ponche.anular",
  setHrEmployeePin: "rrhh.ponche.pin",
  mergeClientes: "clientes.fusionar",
  deleteClienteCosmiatria: "clientes.borrar",
  saveHrSeverance: "rrhh.prestaciones",
  createHrPayrollRun: "rrhh.nomina",
  generateBankTxt: "rrhh.banco_txt",
}
const desviados = Object.entries(ESPERADO)
  .filter(([a, p]) => ACTION_PERMISSIONS[a] !== p)
  .map(([a, p]) => `${a}: esperaba ${p}, tiene ${ACTION_PERMISSIONS[a] ?? "NADA"}`)
if (desviados.length) fail("acciones delicadas con el permiso cambiado", desviados)
else ok("las acciones delicadas conservan su permiso")

// ── 10. PUBLICO se usa con cuentagotas ─────────────────────────────────────
const publicas = Object.entries(ACTION_PERMISSIONS).filter(([, p]) => p === PUBLICO).map(([a]) => a)
if (ACTION_PERMISSIONS.getRowsPaged !== POR_ENTIDAD) fail("getRowsPaged debe resolverse POR_ENTIDAD")
else ok("getRowsPaged se resuelve por entidad (la bóveda no se cuela por ahí)")
if (publicas.length > 8) fail(`${publicas.length} acciones marcadas como públicas (máximo razonable: 8)`, publicas)
else ok(`${publicas.length} acciones públicas: ${publicas.join(", ")}`)

console.log(fallos === 0 ? "\n✅ Permisos completos\n" : `\n❌ ${fallos} comprobaciones fallaron\n`)
process.exit(fallos === 0 ? 0 : 1)
