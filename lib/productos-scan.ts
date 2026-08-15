/**
 * Emparejado de un código escaneado con un producto del catálogo.
 *
 * PURO: sin React, sin DOM. Se prueba en `scripts/test-productos-inventario.mjs`.
 *
 * El archivo de productos usa el campo SKU para el código de barra, pero no
 * siempre limpio: hay códigos con espacios, con ceros a la izquierda, y códigos
 * internos que no son EAN (`3030`, `1111`). Además, el mismo producto físico
 * puede leerse como UPC-A de 12 dígitos y estar guardado como EAN-13 de 13 (que
 * es el mismo número con un cero delante).
 */

export interface ScannableProduct {
  id: string
  nombre: string
  sku: string
}

/** Deja el código como se compara: sin espacios ni guiones, en mayúsculas. */
export function normalizeBarcode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\s\-_]+/g, "")
    .toUpperCase()
    .trim()
}

/**
 * Forma canónica para comparar dos códigos numéricos: sin ceros a la izquierda.
 * Así un UPC-A `047000019086` encuentra al EAN-13 `0047000019086` y viceversa.
 * Un código no numérico se devuelve tal cual.
 */
export function canonicalBarcode(raw: unknown): string {
  const norm = normalizeBarcode(raw)
  if (!norm) return ""
  if (!/^\d+$/.test(norm)) return norm
  const sinCeros = norm.replace(/^0+/, "")
  return sinCeros || "0"
}

/**
 * Busca el producto de un código escaneado.
 *
 * 1. Coincidencia exacta del SKU.
 * 2. Coincidencia canónica (ignora ceros a la izquierda).
 * 3. Si NADA coincide, devuelve null — nunca adivina por parecido, porque
 *    asignarle una unidad al producto equivocado corrompe el conteo en silencio.
 */
export function matchProductByCode<T extends ScannableProduct>(
  code: unknown,
  productos: T[],
): T | null {
  const norm = normalizeBarcode(code)
  if (!norm) return null

  const exacto = productos.find((p) => normalizeBarcode(p.sku) === norm)
  if (exacto) return exacto

  const canon = canonicalBarcode(norm)
  const porCanon = productos.find((p) => p.sku && canonicalBarcode(p.sku) === canon)
  return porCanon || null
}

/**
 * ¿Esta lectura es repetida?
 *
 * Las cámaras devuelven el mismo código muchas veces por segundo mientras el
 * envase siga delante del lente. Sin esta guardia, apuntar dos segundos a una
 * caja sumaría veinte unidades.
 */
export function isRepeatScan(
  code: string,
  last: { code: string; at: number } | null,
  now: number,
  ventanaMs = 1500,
): boolean {
  if (!last) return false
  return last.code === code && now - last.at < ventanaMs
}

/**
 * Acumulador de la pistola lectora (USB/Bluetooth), que se comporta como un
 * teclado: teclea el código muy rápido y cierra con Enter.
 *
 * Una persona no escribe a menos de ~35 ms por tecla; si el intervalo es mayor,
 * el buffer se reinicia y lo tecleado a mano no se confunde con una lectura.
 */
export interface WedgeState {
  buffer: string
  lastKeyAt: number
}

export function pushWedgeKey(
  state: WedgeState,
  key: string,
  at: number,
  maxGapMs = 60,
): { state: WedgeState; code: string | null } {
  if (key === "Enter") {
    const code = state.buffer.length >= 4 ? state.buffer : null
    return { state: { buffer: "", lastKeyAt: at }, code }
  }
  if (key.length !== 1) return { state, code: null }
  const seguido = at - state.lastKeyAt <= maxGapMs
  const buffer = seguido ? state.buffer + key : key
  return { state: { buffer, lastKeyAt: at }, code: null }
}
