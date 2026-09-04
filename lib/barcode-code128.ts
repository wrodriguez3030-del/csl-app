/**
 * Código de barras CODE 128-B como SVG, sin dependencias.
 *
 * Por qué CODE 128 y no EAN-13: el `sku` de los productos trae códigos EAN
 * reales de 13 dígitos («8437008443010») pero también claves internas cortas
 * («3030»). EAN-13 exige exactamente 12 dígitos más un dígito verificador
 * válido, así que rechazaría las internas. CODE 128-B acepta cualquier texto
 * imprimible y lo lee cualquier escáner de comercio.
 *
 * Por qué SVG y no una imagen ni una librería de CDN: el reporte se imprime
 * abriendo una ventana con HTML suelto. Un `<script>` externo no cargaría
 * (y no debe: nada de este documento sale a internet), y un PNG se vería
 * borroso al imprimir. El SVG es nítido a cualquier tamaño y va incrustado.
 */

/**
 * Anchos de barra/espacio de los 107 símbolos de CODE 128, en módulos.
 * Cada cadena alterna barra-espacio-barra-espacio-barra-espacio; la última
 * (el símbolo de parada) lleva siete elementos.
 */
const PATRONES = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
]

const INICIO_B = 104
const PARADA = 106

/** Solo ASCII imprimible: lo que CODE 128-B sabe representar. */
export function codificable(texto: string): boolean {
  const s = String(texto ?? "").trim()
  return s.length > 0 && /^[\x20-\x7E]+$/.test(s)
}

/**
 * Devuelve el SVG del código, o cadena vacía si el texto no es codificable
 * (vacío, o con caracteres fuera del ASCII imprimible). Nunca lanza: un
 * producto con el `sku` raro sale sin barras, no revienta el reporte entero.
 *
 * `alturaMm` y `moduloMm` van en milímetros porque el destino es papel.
 */
export function code128Svg(
  texto: string,
  opciones: { alturaMm?: number; moduloMm?: number } = {},
): string {
  const valor = String(texto ?? "").trim()
  if (!codificable(valor)) return ""

  const { alturaMm = 7, moduloMm = 0.24 } = opciones

  // Valor de cada carácter en CODE 128-B: el ASCII menos 32 (el espacio es 0).
  const valores = [...valor].map((c) => c.charCodeAt(0) - 32)

  // Suma de control: el símbolo de inicio más cada valor por su posición.
  const suma = valores.reduce((acc, v, i) => acc + v * (i + 1), INICIO_B) % 103

  const simbolos = [INICIO_B, ...valores, suma, PARADA]

  let x = 0
  const barras: string[] = []
  for (const simbolo of simbolos) {
    const patron = PATRONES[simbolo]
    if (!patron) return "" // símbolo fuera de tabla: mejor sin código que uno falso
    for (let i = 0; i < patron.length; i++) {
      const modulos = Number(patron[i])
      const ancho = modulos * moduloMm
      // Los índices pares son BARRA; los impares, espacio.
      if (i % 2 === 0) {
        barras.push(`<rect x="${x.toFixed(3)}" y="0" width="${ancho.toFixed(3)}" height="${alturaMm}"/>`)
      }
      x += ancho
    }
  }

  const ancho = x
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho.toFixed(2)}mm" height="${alturaMm}mm" ` +
    `viewBox="0 0 ${ancho.toFixed(3)} ${alturaMm}" shape-rendering="crispEdges" fill="#000">` +
    barras.join("") +
    `</svg>`
  )
}
