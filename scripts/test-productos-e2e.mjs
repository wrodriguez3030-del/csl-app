/**
 * Prueba EXTREMO A EXTREMO del Inventario de Productos contra db-cls, usando
 * los HANDLERS REALES dentro de `runWithBusinessContext` (igual que /api/csl).
 *
 * Importa un archivo de prueba, verifica el catálogo y las existencias, hace un
 * conteo físico, lo aprueba, comprueba que ajustó el stock, y al final BORRA
 * todo lo que creó. No deja rastro.
 *
 * Uso:  node --import tsx scripts/test-productos-e2e.mjs <csl|depicenter>
 */
import fs from "node:fs"
import assert from "node:assert/strict"

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}

const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const inv = await import("../lib/server/products-inventory.ts")
const { runSql } = await import("./db-query.js")

const TENANTS = {
  csl: { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", businessSlug: "csl" },
  depicenter: { businessId: "03b96698-c5df-4b4b-84df-1160a7ad56b9", businessSlug: "depicenter" },
}
const slug = String(process.argv[2] || "csl").toLowerCase()
const T = TENANTS[slug]
if (!T) { console.error("Uso: node --import tsx scripts/test-productos-e2e.mjs <csl|depicenter>"); process.exit(1) }

const USER = { id: "00000000-0000-0000-0000-0000000000e2", email: "script:test-productos" }
const ctx = { ...T, isSuperadmin: true, isAdmin: true, bypassTenantFilter: false, branchScope: { all: true, branches: [] } }
const PREFIJO = "ZZTEST-E2E"

let pasadas = 0
const ok = (l) => { pasadas += 1; console.log(`  ✓ ${l}`) }

const limpiar = async () => {
  await runSql(`delete from csl_conteos_productos where business_id = '${T.businessId}' and notas like '${PREFIJO}%'`)
  await runSql(`delete from csl_productos where business_id = '${T.businessId}' and clave like '${PREFIJO}%'`)
  await runSql(`delete from csl_producto_importaciones where business_id = '${T.businessId}' and archivo like '${PREFIJO}%'`)
}

await limpiar()

try {
  await runWithBusinessContext(ctx, async () => {
    const branches = inv.getProductBranches().records
    assert.ok(branches.length > 0)
    const SUC = branches[0]
    const OTRA = branches[1] || branches[0]
    console.log(`\n══ ${slug.toUpperCase()} · sucursales: ${branches.join(", ")} ══\n`)
    ok(`el negocio expone ${branches.length} sucursales`)

    const importId = crypto.randomUUID()
    const fila = (clave, nombre, stock, activo = true) => ({
      clave: `${PREFIJO}-${clave}`, sku: `${PREFIJO}-${clave}`, nombre: `${PREFIJO} ${nombre}`,
      nombreNorm: `${PREFIJO} ${nombre}`.toUpperCase(), categoria: "Prueba", marca: "", formato: "",
      descripcion: "", costo: 100, precioExterno: 200, precioInterno: 150, comision: 0,
      comisionTipo: 0, precioConIva: null, ivaPct: null, activo, stock,
    })

    // ── 1. Importación ───────────────────────────────────────────────────────
    const r1 = await inv.importProducts({
      importId,
      rows: JSON.stringify([
        fila("A", "PRODUCTO A", { [SUC]: 10, [OTRA]: 3 }),
        fila("B", "PRODUCTO B", { [SUC]: 0 }),
        fila("C", "PRODUCTO C", { [SUC]: 5 }, false),
        // Sucursal de OTRO negocio: debe descartarse, no colarse.
        fila("D", "PRODUCTO D", { "SUCURSAL INVENTADA": 99 }),
      ]),
      archivo: `${PREFIJO}-archivo.xlsx`,
      sucursales: [SUC, OTRA].join(","),
      esUltimoLote: "true",
      userName: "Script E2E",
      unidadesTotal: 18,
    }, USER)

    assert.equal(r1.creados, 4)
    ok("importa 4 productos nuevos")
    assert.equal(r1.descartados, 1)
    ok("descarta la existencia de una sucursal que no es del negocio")

    const cat = await inv.getProductos({ search: PREFIJO })
    assert.equal(cat.records.length, 4)
    const a = cat.records.find((p) => p.nombre.endsWith("PRODUCTO A"))
    assert.equal(a.stock[SUC], 10)
    assert.equal(a.total, 13)
    ok("el catálogo devuelve la existencia por sucursal y su total")

    // ── 2. Reimportar con menos productos ────────────────────────────────────
    const importId2 = crypto.randomUUID()
    await inv.importProducts({
      importId: importId2,
      rows: JSON.stringify([fila("A", "PRODUCTO A", { [SUC]: 7 })]),
      archivo: `${PREFIJO}-archivo2.xlsx`,
      sucursales: SUC,
      esUltimoLote: "true",
      userName: "Script E2E",
    }, USER)

    const cat2 = await inv.getProductos({ search: PREFIJO })
    const a2 = cat2.records.find((p) => p.nombre.endsWith("PRODUCTO A"))
    const c2 = cat2.records.find((p) => p.nombre.endsWith("PRODUCTO C"))
    assert.equal(a2.stock[SUC], 7)
    ok("una reimportación SOBRESCRIBE la existencia (10 → 7)")
    assert.equal(c2.stock[SUC] || 0, 0)
    ok("el producto que ya no viene en el archivo queda en cero")
    assert.equal(a2.stock[OTRA] ?? 0, OTRA === SUC ? 7 : 3)
    ok("la sucursal que no se importó conserva su existencia")

    // ── 3. Conteo físico ─────────────────────────────────────────────────────
    const fecha = "2020-01-02" // fecha fija fuera de rango real, se borra al final
    const saved = await inv.saveProductCount({
      sucursal: SUC, fecha, estado: "borrador",
      notas: `${PREFIJO} conteo de prueba`, responsable: "Script E2E", userName: "Script E2E",
      items: JSON.stringify([
        { productoId: a2.id, nombre: a2.nombre, sku: a2.sku, cantidadSistema: 7, cantidadContada: 4, observacion: "faltan 3" },
      ]),
    }, USER)
    assert.equal(saved.record.estado, "borrador")
    ok("guarda el conteo como borrador")

    const draft = await inv.getProductCountDraft({ sucursal: SUC, fecha })
    assert.equal(draft.record.items.length, 1)
    assert.equal(draft.record.items[0].cantidadContada, 4)
    ok("recupera el borrador para seguir contando")

    const dupe = await inv.saveProductCount({
      sucursal: SUC, fecha, estado: "borrador",
      notas: `${PREFIJO} conteo de prueba`, userName: "Script E2E",
      items: JSON.stringify([
        { productoId: a2.id, nombre: a2.nombre, sku: a2.sku, cantidadSistema: 7, cantidadContada: 4, observacion: null },
      ]),
    }, USER)
    assert.equal(dupe.record.id, saved.record.id)
    ok("volver a guardar reanuda el mismo borrador, no duplica")

    const apr = await inv.approveProductCount({ id: saved.record.id, userName: "Script E2E" }, USER)
    assert.equal(apr.record.estado, "aprobado")
    assert.equal(apr.ajustados, 1)
    ok("aprueba el conteo y ajusta 1 producto")

    const cat3 = await inv.getProductos({ search: PREFIJO })
    const a3 = cat3.records.find((p) => p.nombre.endsWith("PRODUCTO A"))
    assert.equal(a3.stock[SUC], 4)
    ok("el stock del sistema pasó a ser lo contado (7 → 4)")

    await assert.rejects(
      () => inv.saveProductCount({
        id: saved.record.id, sucursal: SUC, fecha, estado: "borrador",
        userName: "x", items: JSON.stringify([]),
      }, USER),
      /aprobado/i,
    )
    ok("un conteo aprobado ya no se puede editar")

    // ── 4. El Excel manda SIEMPRE, incluso sobre un conteo aprobado ──────────
    await inv.importProducts({
      importId: crypto.randomUUID(),
      rows: JSON.stringify([fila("A", "PRODUCTO A", { [SUC]: 12 })]),
      archivo: `${PREFIJO}-archivo3.xlsx`, sucursales: SUC, esUltimoLote: "true", userName: "Script E2E",
    }, USER)
    const cat4 = await inv.getProductos({ search: PREFIJO })
    const a4 = cat4.records.find((p) => p.nombre.endsWith("PRODUCTO A"))
    assert.equal(a4.stock[SUC], 12)
    ok("una importación posterior SOBRESCRIBE lo que dejó el conteo (4 → 12)")

    const hist = await inv.getProductCounts({})
    const mio = hist.records.find((c) => c.id === saved.record.id)
    assert.equal(mio.diferenciaTotal, -3)
    ok("el histórico reporta la diferencia total del conteo (−3)")

    const imports = await inv.getProductImports()
    assert.ok(imports.records.some((i) => String(i.archivo).startsWith(PREFIJO)))
    ok("la bitácora registró las importaciones")
  })
} finally {
  await limpiar()
  const quedan = await runSql(`select count(*)::int n from csl_productos where clave like '${PREFIJO}%'`)
  assert.equal(quedan[0].n, 0)
  ok("limpieza: no queda ningún dato de prueba")
}

console.log(`\n✅ ${pasadas} comprobaciones extremo a extremo pasaron\n`)
