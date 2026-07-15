/**
 * Pruebas del módulo CF PARA IMPRIMIR (certificados de regalo).
 * Cubre la lógica PURA: auto-fit, fecha en español, etiquetas exactas,
 * validación, máquina de estados, wrapping, SVG y no-duplicación de menú.
 *
 * Correr:  node --import tsx scripts/test-gift-certificates.mjs
 *          (o vía  pnpm test:gift)
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  autoFitSize,
  formatSpanishDateUpper,
  displayText,
  validateGiftCert,
  addDaysIso,
  wrapText,
  buildCertificateModel,
  LABELS,
} from "../lib/certificados/cert-layout.ts"
import {
  transitionError,
  effectiveEstado,
  isExpired,
} from "../lib/certificados/cert-state.ts"
import { renderCertificate } from "../lib/certificados/cert-talonario.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let passed = 0
function test(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log("CF PARA IMPRIMIR · pruebas")

// 1. Auto-fit por conteo de caracteres (§9)
test("auto-fit 'Otorgado a' por longitud", () => {
  assert.equal(autoFitSize("otorgadoA", "A".repeat(20)), 46)
  assert.equal(autoFitSize("otorgadoA", "A".repeat(28)), 40)
  assert.equal(autoFitSize("otorgadoA", "A".repeat(40)), 34)
})
test("auto-fit 'Válido para' por longitud", () => {
  assert.equal(autoFitSize("validoPara", "A".repeat(20)), 37)
  assert.equal(autoFitSize("validoPara", "A".repeat(40)), 32)
  assert.equal(autoFitSize("validoPara", "A".repeat(60)), 27)
})
test("auto-fit 'Sucursal' por longitud", () => {
  assert.equal(autoFitSize("sucursal", "A".repeat(30)), 33)
  assert.equal(autoFitSize("sucursal", "A".repeat(40)), 29)
})

// 2. Fecha en español, mayúsculas (§13)
test("fecha ISO → '14 DE AGOSTO DE 2026'", () => {
  assert.equal(formatSpanishDateUpper("2026-08-14"), "14 DE AGOSTO DE 2026")
  assert.equal(formatSpanishDateUpper(""), "")
  assert.equal(formatSpanishDateUpper("no-fecha"), "")
})

// 3. Normalización: acentos, Ñ, espacios (§23)
test("displayText conserva acentos/Ñ y colapsa espacios", () => {
  assert.equal(displayText("  licely   germosén  "), "LICELY GERMOSÉN")
  assert.equal(displayText("muñoz peña"), "MUÑOZ PEÑA")
  assert.equal(displayText("josé maría"), "JOSÉ MARÍA")
})

// 4. Validación (§5, §13, §23)
test("validación exige campos obligatorios", () => {
  const errs = validateGiftCert({})
  assert.ok(errs.length >= 5)
})
test("vencimiento no puede ser anterior a emisión", () => {
  const errs = validateGiftCert({
    otorgadoA: "A", cortesiaDe: "B", validoPara: "C", sucursal: "D",
    fechaEmision: "2026-08-10", validoHasta: "2026-08-01",
  })
  assert.ok(errs.some((e) => e.includes("no puede ser anterior")))
})
test("caso válido no arroja errores", () => {
  const errs = validateGiftCert({
    otorgadoA: "LICELY", cortesiaDe: "WENDY", validoPara: "MASAJE",
    sucursal: "RAFAEL VIDAL", fechaEmision: "2026-08-01", validoHasta: "2026-08-31",
  })
  assert.equal(errs.length, 0)
})

// 5. Vigencia automática (§13)
test("addDaysIso suma días", () => {
  assert.equal(addDaysIso("2026-08-01", 30), "2026-08-31")
})

// 6. Wrapping (§9): nombres 1 línea, servicio/sucursal hasta 2
test("nombres se mantienen en una sola línea", () => {
  assert.equal(wrapText("NOMBRE MUY LARGO DE PRUEBA PARA VER", 34, 1).length, 1)
})
test("servicio largo envuelve hasta 2 líneas", () => {
  const lines = wrapText("MASAJE RELAJANTE CON PIEDRAS CALIENTES Y AROMATERAPIA COMPLETA", 27, 2)
  assert.ok(lines.length <= 2 && lines.length >= 1)
})

// 7. Máquina de estados (§15)
const HOY = "2026-08-15"
test("emitir solo desde Borrador", () => {
  assert.equal(transitionError("emitir", "Borrador", "2026-12-01", HOY), null)
  assert.ok(transitionError("emitir", "Emitido", "2026-12-01", HOY))
})
test("entregar solo desde Emitido", () => {
  assert.equal(transitionError("entregar", "Emitido", "2026-12-01", HOY), null)
  assert.ok(transitionError("entregar", "Borrador", "2026-12-01", HOY))
})
test("no doble canje", () => {
  assert.ok(transitionError("canjear", "Canjeado", "2026-12-01", HOY))
})
test("no canjear vencido / anulado / borrador", () => {
  assert.ok(transitionError("canjear", "Emitido", "2026-01-01", HOY)) // vencido efectivo
  assert.ok(transitionError("canjear", "Anulado", "2026-12-01", HOY))
  assert.ok(transitionError("canjear", "Borrador", "2026-12-01", HOY))
})
test("canjear permitido desde Emitido/Entregado vigente", () => {
  assert.equal(transitionError("canjear", "Emitido", "2026-12-01", HOY), null)
  assert.equal(transitionError("canjear", "Entregado", "2026-12-01", HOY), null)
})
test("anular bloqueado en terminales", () => {
  assert.ok(transitionError("anular", "Canjeado", "2026-12-01", HOY))
  assert.ok(transitionError("anular", "Anulado", "2026-12-01", HOY))
  assert.equal(transitionError("anular", "Emitido", "2026-12-01", HOY), null)
})
test("editar solo borradores", () => {
  assert.equal(transitionError("editar", "Borrador", "2026-12-01", HOY), null)
  assert.ok(transitionError("editar", "Emitido", "2026-12-01", HOY))
})

// 8. Estado efectivo (vencido calculado)
test("Emitido vencido → efectivo Vencido", () => {
  assert.equal(effectiveEstado("Emitido", "2026-01-01", HOY), "Vencido")
  assert.equal(effectiveEstado("Emitido", "2026-12-01", HOY), "Emitido")
  assert.equal(isExpired("2026-01-01", HOY), true)
})

// 9. SVG: etiquetas exactas, socials, sin "VÁLIDO POR"
test("SVG usa etiquetas exactas y socials, nunca 'VÁLIDO POR'", () => {
  const svg = renderCertificate({
    codigo: "CSL-REG-2026-000001",
    otorgadoA: "Licely Germosen",
    cortesiaDe: "Wendy Chaljub",
    validoPara: "Masaje relajante con piedras",
    validoHasta: "2026-08-14",
    fechaEmision: "2026-07-15",
    sucursal: "Rafael Vidal – Plaza Mediterránea",
    sucursalTelefono: "809-555-1234",
    templateId: "moderno",
  }, { code: "CSL-REG-2026-000001" })
  assert.ok(svg.includes("VÁLIDO PARA:"), "falta VÁLIDO PARA:")
  assert.ok(svg.includes("SUCURSAL DE ENTREGA:"), "falta SUCURSAL DE ENTREGA:")
  assert.ok(!svg.includes("VÁLIDO POR"), "no debe contener VÁLIDO POR")
  assert.ok(svg.includes("@cibaospalaser"), "falta @cibaospalaser")
  assert.ok(svg.includes("14 DE AGOSTO DE 2026"), "falta fecha en español")
  assert.ok(svg.includes("Fecha de entrega:"), "falta la fecha de entrega en el pie")
  assert.ok(svg.includes("Tel. 809-555-1234"), "falta el teléfono de la sucursal")
  assert.ok(svg.startsWith("<svg"))
})
test("buildCertificateModel expone las 5 etiquetas correctas", () => {
  const m = buildCertificateModel({
    codigo: "X", otorgadoA: "a", cortesiaDe: "b", validoPara: "c",
    validoHasta: "2026-08-14", fechaEmision: "2026-07-15", sucursal: "d", templateId: "moderno",
  })
  assert.equal(m.fields.validoPara.label, "VÁLIDO PARA:")
  assert.equal(LABELS.validoPara, "VÁLIDO PARA:")
  assert.equal(m.fields.sucursal.label, "SUCURSAL DE ENTREGA:")
})

// 10. Menú NO duplicado (§27.2, §30)
test("el menú 'CF para imprimir' no está duplicado", () => {
  const menus = fs.readFileSync(path.join(__dirname, "../lib/menus.ts"), "utf8")
  const count = (menus.match(/cliente-certificados-imprimir/g) || []).length
  assert.equal(count, 1, `esperaba 1 definición, hay ${count}`)
})

console.log(`\n${passed} pruebas OK`)
