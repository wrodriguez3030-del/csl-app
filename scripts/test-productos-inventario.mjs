/**
 * Pruebas del módulo INVENTARIO DE PRODUCTOS.
 * Cubre la lógica PURA: detección de columnas de stock, normalización de
 * nombres, parseo de filas, armado del reporte de existencias y diferencias
 * del conteo físico. No toca la base de datos.
 *
 * Correr:  node --import tsx scripts/test-productos-inventario.mjs
 */
import assert from "node:assert/strict"
import { code128Svg, codificable } from "../lib/barcode-code128.ts"

import {
  normalizeProductName,
  productKey,
  toNumberOrNull,
  toQuantity,
  diffConteo,
  periodoActual,
  fmtQty,
} from "../lib/productos-client.ts"
import {
  detectStockColumns,
  unresolvedStockColumns,
  mapHeaderFields,
  parseProductSheet,
  dedupeByClave,
  summarizeImport,
} from "../lib/productos-import.ts"
import {
  buildReporteData,
  kpisDeSucursal,
  buildConsolidado,
} from "../lib/inventario-productos-pdf.ts"
import {
  normalizeBarcode,
  matchProductByCode,
  isRepeatScan,
  pushWedgeKey,
} from "../lib/productos-scan.ts"

let pasadas = 0
const ok = (label) => {
  pasadas += 1
  console.log(`  ✓ ${label}`)
}

// Cabecera REAL del archivo productos_3552_1786823521.xlsx (17 columnas).
const HEADER = [
  "SKU", "Categoría", "Marca", "Nombre", "Formato", "Costo", "Precio venta externa",
  "Precio venta interna", "Comisión", "Tipo de comisión (0: %, 1: $)", "Descripción",
  "Estado", "Precio contiene IVA", "% IVA (vacio por defecto)",
  "Stock Cibao Spa Laser  Av. Rafael Vidal ",
  "Stock Cibao Spa Laser Los Jardines",
  "Stock Cibao Spa Laser Villa Olga",
]

console.log("\n── 1. Detección de columnas de stock ──")
{
  const cols = detectStockColumns(HEADER)
  assert.equal(cols.length, 3)
  ok("detecta las 3 columnas de existencia del archivo real")

  assert.deepEqual(cols.map((c) => c.sucursal), ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"])
  ok("las mapea a las sucursales canónicas de CSL")

  assert.deepEqual(cols.map((c) => c.index), [14, 15, 16])
  ok("guarda el índice real de cada columna (no la posición asumida)")

  // Depicenter usa otras columnas — el mismo parser debe resolverlas.
  const dep = detectStockColumns(["Nombre", "Stock Depicenter", "Stock La Vega"])
  assert.deepEqual(dep.map((c) => c.sucursal), ["DEPICENTER", "LA VEGA"])
  ok("resuelve también las sucursales de Depicenter")

  const raras = unresolvedStockColumns(["Nombre", "Stock Sucursal Marte", "Costo"])
  assert.deepEqual(raras, ["Stock Sucursal Marte"])
  ok("reporta las columnas de stock que NO resuelven en vez de adivinar")

  const f = mapHeaderFields(HEADER)
  assert.equal(f.nombre, 3)
  assert.equal(f.costo, 5)
  assert.equal(f.estado, 11)
  ok("ubica los campos del catálogo por título, no por posición")
}

console.log("\n── 2. Normalización ──")
{
  assert.equal(normalizeProductName("ANESTESIA ENCAIN "), "ANESTESIA ENCAIN")
  assert.equal(normalizeProductName("ANESTESIA  ENCAIN"), "ANESTESIA ENCAIN")
  assert.equal(normalizeProductName("BIRETIX  BARRA DERMALOTOGICA"), "BIRETIX BARRA DERMALOTOGICA")
  ok("el mismo producto con espacios distintos es UNA sola clave")

  assert.equal(normalizeProductName("Crème Solaire"), "CREME SOLAIRE")
  ok("quita acentos y sube a mayúsculas")

  assert.equal(productKey("8470001977793", "HELIOCARE"), "8470001977793|HELIOCARE")
  assert.equal(productKey("", "ANESTESIA EN SPRAY"), "ANESTESIA EN SPRAY")
  assert.equal(productKey("  3030 ", "ANESTESIA ENCAIN"), "3030|ANESTESIA ENCAIN")
  ok("la clave combina código y nombre; sin código, solo el nombre")

  // Caso REAL del archivo: un mismo código de barra usado por dos productos
  // distintos. Si la clave fuera solo el código, se fundirían en uno.
  assert.notEqual(
    productKey("8470001682673", "AQUAFOAM"),
    productKey("8470001682673", "ENDOCARE"),
  )
  ok("dos productos que comparten código de barra NO se funden en uno")

  assert.equal(toNumberOrNull(""), null)
  assert.equal(toNumberOrNull("basura"), null)
  assert.equal(toNumberOrNull("1,684"), 1684)
  assert.equal(toNumberOrNull("1.234,50"), 1234.5)
  assert.equal(toNumberOrNull(0), 0)
  ok("los números toleran separadores de miles y distinguen vacío de cero")

  assert.equal(toQuantity(""), 0)
  assert.equal(toQuantity("basura"), 0)
  assert.equal(toQuantity("4"), 4)
  ok("una cantidad no numérica cuenta como 0, nunca como NaN")

  assert.equal(fmtQty(1204), "1,204")
  assert.equal(fmtQty(2.5), "2.5")
  ok("las cantidades se muestran legibles")

  assert.equal(periodoActual(new Date(2026, 5, 15)), "MES JUNIO")
  ok("el periodo por defecto sale del mes en curso, como en el modelo")
}

console.log("\n── 3. Parseo de filas ──")
{
  const rows = parseProductSheet(
    [
      HEADER,
      ["3030", "Otros", "Otros", "ANESTESIA ENCAIN ", "100 ml", "700", "1000", "700", "100", "0", "ANESTESIA CON LIDOCARINA", "Activo", "Inactivo", "0.0", "0", "0", "0"],
      ["", "", "", "", "", "", "", "", "", "", "", "Activo", "", "", "1", "0", "0"],
      ["1111", "Otros", "Otros", "BOXER DESECHABLES", "Otros", "80", "100", "80", "0", "0", "", "Activo", "Inactivo", "", "4", "0", "0"],
      ["8470001977793", "Otros", "Otros", "HELIOCARE 360 FLUIDO  SOLUCION PIGMENTO SPF50 ", "50 ml", "1684", "1900", "1684", "0", "0", "", "Activo", "Inactivo", "0.0", "2", "13", "8"],
    ],
    { activo: true },
  )

  assert.equal(rows.length, 3)
  ok("descarta la fila sin nombre (basura al final del export)")

  assert.equal(rows[0].clave, "3030|ANESTESIA ENCAIN")
  assert.equal(rows[0].nombre, "ANESTESIA ENCAIN")
  assert.equal(rows[0].costo, 700)
  assert.equal(rows[0].precioExterno, 1000)
  assert.equal(rows[0].activo, true)
  ok("lee catálogo, precios y estado de la fila")

  assert.equal(rows[1].stock["RAFAEL VIDAL"], 4)
  assert.equal(rows[1].stock["LOS JARDINES"], 0)
  ok("asigna cada cantidad a SU sucursal")

  assert.deepEqual(rows[2].stock, { "RAFAEL VIDAL": 2, "LOS JARDINES": 13, "VILLA OLGA": 8 })
  ok("un producto repartido en tres sucursales conserva las tres cantidades")

  // Hoja «Inactivos»: sin SKU y con Estado = Inactivo.
  const inactivos = parseProductSheet(
    [
      HEADER,
      ["", "Otros", "Otros", "ANESTESIA EN SPRAY", "Otros", "750", "1000", "750", "5", "0", "LIDOCAINA AL 10%", "Inactivo", "Inactivo", "0.0", "0", "0", "0"],
    ],
    { activo: false },
  )
  assert.equal(inactivos[0].activo, false)
  assert.equal(inactivos[0].clave, "ANESTESIA EN SPRAY")
  ok("la hoja de inactivos entra marcada como inactiva y con clave por nombre")

  const dup = dedupeByClave([
    { clave: "A", stock: { "RAFAEL VIDAL": 2 }, nombre: "A" },
    { clave: "A", stock: { "RAFAEL VIDAL": 3, "VILLA OLGA": 1 }, nombre: "A" },
  ])
  assert.equal(dup.length, 1)
  assert.deepEqual(dup[0].stock, { "RAFAEL VIDAL": 5, "VILLA OLGA": 1 })
  ok("una clave repetida se consolida y suma existencias (el upsert no acepta duplicados)")

  const resumen = summarizeImport(rows)
  assert.equal(resumen.productos, 3)
  assert.equal(resumen.unidades, 27)
  assert.equal(resumen.porSucursal["LOS JARDINES"], 13)
  ok("el resumen de previsualización cuadra")
}

console.log("\n── 4. Reporte de existencias (contra el modelo impreso) ──")
{
  // Contenido EXACTO del PDF modelo: INVENTARIO RAFAEL VIDAL MES JUNIO.
  const catalogo = [
    ["RASURADORAS", 85], ["BARIEDERM-CICA", 28], ["GEL INTIMO URIAGE GYN-PHY", 20],
    ["URIAGE DEODORANT ROLL-ON", 14], ["JABON DE MANZANILLA", 12],
    ["HELIOCARE 360 WATER GEL SPF50", 8], ["URIAGE EAU THERMAL WATER 150 ML", 6],
    ["HELIOCARE 360 FLUIDO SOLUCION PIGMENTO SPF50", 5], ["BOXER DESECHABLES", 4],
    ["URIAGE HYSEAC GEL NETTOYANT", 4], ["BIRETIX BARRA DERMALOTOGICA", 3],
    ["BIRETIX TRIACTIVE SPRAY 100ML", 3], ["HELIOCARE ULTRA 90 GEL", 3],
    ["HELIOCARE 360 MINERAL FLUID SPF50 50 ML", 2], ["HELIOCARE ADVANCED SPRAY SPF 50", 2],
    ["URIAGE THERMALE GELEE D EAU T 40 ML", 2], ["360 MD A-R EMULSION", 1],
    ["ANESTESIA ENCAIN", 1], ["URIAGE BARIDEM CICA CREME SPF 50 +", 1],
    ["PRODUCTO SIN EXISTENCIA", 0],
  ].map(([nombre, qty]) => ({ nombre, sku: "", stock: { "RAFAEL VIDAL": qty, "VILLA OLGA": 7 } }))

  const [rv] = buildReporteData(catalogo, ["RAFAEL VIDAL"])
  assert.equal(rv.sucursal, "RAFAEL VIDAL")
  assert.equal(rv.items.length, 19)
  ok("solo entran los productos CON existencia en esa sucursal (19, no 20)")

  assert.equal(rv.items[0].nombre, "RASURADORAS")
  assert.equal(rv.items[0].cantidad, 85)
  assert.equal(rv.items[18].cantidad, 1)
  ok("orden de mayor a menor cantidad, como el modelo")

  assert.deepEqual(kpisDeSucursal(rv.items, 2), { productos: 19, unidades: 204, alerta: 6 })
  ok("los 3 KPIs reproducen el modelo: 19 productos · 204 unidades · 6 en alerta")

  assert.equal(kpisDeSucursal(rv.items, 3).alerta, 9)
  ok("el umbral de stock bajo es ajustable")

  // Desempate por nombre a igualdad de cantidad.
  const empate = buildReporteData(
    [
      { nombre: "ZETA", sku: "", stock: { X: 5 } },
      { nombre: "ALFA", sku: "", stock: { X: 5 } },
    ],
    ["X"],
  )[0]
  assert.deepEqual(empate.items.map((i) => i.nombre), ["ALFA", "ZETA"])
  ok("a igual cantidad, ordena alfabético")

  const dos = buildReporteData(catalogo, ["RAFAEL VIDAL", "VILLA OLGA"])
  assert.equal(dos.length, 2)
  assert.equal(dos[1].sucursal, "VILLA OLGA")
  assert.equal(dos[1].items.length, 20)
  ok("multi-sucursal: una sección por sucursal seleccionada")

  const cons = buildConsolidado(catalogo, ["RAFAEL VIDAL", "VILLA OLGA"])
  assert.equal(cons.items[0].nombre, "RASURADORAS")
  assert.equal(cons.items[0].total, 92)
  assert.deepEqual(cons.items[0].porSucursal, { "RAFAEL VIDAL": 85, "VILLA OLGA": 7 })
  assert.equal(cons.totales["VILLA OLGA"], 140)
  ok("el consolidado suma por producto y por sucursal")
}

console.log("\n── 5. Escáner de código de barra ──")
{
  const catalogo = [
    { id: "1", nombre: "HELIOCARE 360 WATER GEL", sku: "8470001930156" },
    { id: "2", nombre: "ANESTESIA ENCAIN", sku: "3030" },
    { id: "3", nombre: "PRODUCTO SIN CODIGO", sku: "" },
    { id: "4", nombre: "UPC CON CERO", sku: "0047000019086" },
  ]

  assert.equal(normalizeBarcode(" 8470 0019-30156 "), "8470001930156")
  ok("limpia espacios y guiones de la lectura")

  assert.equal(matchProductByCode("8470001930156", catalogo)?.id, "1")
  ok("encuentra el producto por código exacto")

  assert.equal(matchProductByCode("3030", catalogo)?.id, "2")
  ok("encuentra también los códigos internos que no son EAN")

  // UPC-A de 12 dígitos leído contra un EAN-13 guardado con el cero delante.
  assert.equal(matchProductByCode("047000019086", catalogo)?.id, "4")
  ok("un UPC de 12 dígitos encuentra al EAN-13 equivalente")

  assert.equal(matchProductByCode("9999999999999", catalogo), null)
  ok("un código desconocido NO se asigna al producto más parecido: devuelve nulo")

  assert.equal(matchProductByCode("", catalogo), null)
  assert.equal(matchProductByCode("   ", catalogo), null)
  ok("una lectura vacía no empareja con el producto sin código")

  const last = { code: "111", at: 1000 }
  assert.equal(isRepeatScan("111", last, 1400), true)
  ok("la misma lectura dentro de la ventana se ignora (la cámara repite)")
  assert.equal(isRepeatScan("111", last, 3000), false)
  ok("pasada la ventana, volver a escanear el mismo producto SÍ cuenta")
  assert.equal(isRepeatScan("222", last, 1100), false)
  ok("otro código distinto nunca se considera repetido")

  // Pistola lectora: teclea rápido y cierra con Enter.
  let st = { buffer: "", lastKeyAt: 0 }
  let out = null
  for (const [i, ch] of [..."8470001930156"].entries()) {
    ({ state: st, code: out } = pushWedgeKey(st, ch, 1000 + i * 10))
  }
  ;({ state: st, code: out } = pushWedgeKey(st, "Enter", 1200))
  assert.equal(out, "8470001930156")
  ok("la pistola lectora arma el código y lo entrega con Enter")

  // Tecleo humano: lento → el buffer se reinicia y no se toma como lectura.
  let hs = { buffer: "", lastKeyAt: 0 }
  let hout = null
  for (const [i, ch] of [..."1234"].entries()) {
    ({ state: hs, code: hout } = pushWedgeKey(hs, ch, 1000 + i * 400))
  }
  ;({ state: hs, code: hout } = pushWedgeKey(hs, "Enter", 3000))
  assert.equal(hout, null)
  ok("escribir a mano NO se confunde con una lectura de pistola")
}

console.log("\n── 6. Conteo físico ──")
{
  assert.equal(diffConteo(10, 7), -3)
  ok("faltante: contado menor que sistema da negativo")
  assert.equal(diffConteo(0, 4), 4)
  ok("sobrante: aparece lo que el sistema no tenía")
  assert.equal(diffConteo(5, 5), 0)
  ok("cuadra: diferencia cero")
  assert.equal(diffConteo(null, "3"), 3)
  ok("tolera valores sucios sin devolver NaN")
}

console.log("\n── 7. Código de barras del reporte de existencias ──")
{
  // «3030» a mano, con la tabla de CODE 128-B:
  //   inicio B = 104; '3'=19, '0'=16, '3'=19, '0'=16
  //   control = (104 + 19·1 + 16·2 + 19·3 + 16·4) mod 103 = 276 mod 103 = 70
  //   7 símbolos → 6·11 + 13 = 79 módulos
  // Si el dígito de control saliera mal, el código se IMPRIME igual y solo se
  // descubre cuando no lee la pistola en el mostrador. Por eso se comprueba.
  const svg = code128Svg("3030", { moduloMm: 0.24, alturaMm: 7 })
  assert.equal(Number(svg.match(/width="([\d.]+)mm"/)[1]).toFixed(2), (79 * 0.24).toFixed(2))
  ok("ancho correcto: 79 módulos (dígito de control incluido)")
  assert.equal((svg.match(/<rect/g) || []).length, 22)
  ok("22 barras: 7 símbolos por 3, más la de la parada")

  assert.ok(code128Svg("8437008443010").startsWith("<svg"))
  ok("codifica un EAN-13 real de los productos")
  assert.ok(code128Svg("3030").startsWith("<svg"))
  ok("codifica también una clave interna corta")

  assert.equal(code128Svg(""), "")
  assert.equal(code128Svg(null), "")
  ok("el producto sin sku no lleva barras, y no revienta el reporte")
  assert.equal(code128Svg("café"), "")
  ok("rechaza lo que CODE 128-B no representa en vez de imprimir un código falso")

  assert.equal(codificable("ABC-123"), true)
  assert.equal(codificable("  "), false)
  ok("codificable() distingue el texto imprimible del vacío")
}

console.log(`\n✅ ${pasadas} pruebas pasaron\n`)
