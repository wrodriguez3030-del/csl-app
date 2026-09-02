/**
 * Pregunta FIJA del «Análisis IA» de Incentivos de Ventas.
 *
 * Va al asistente existente (app/api/bi-finance/assistant) como `question` con
 * `scope = ANALISIS_SCOPE`. El servidor cachea por hash de
 * (negocio | scope | modelo | pregunta | summary): mientras este texto y los
 * datos no cambien, reabrir la pantalla cuesta 0 tokens. **No retocar el texto
 * a la ligera: cada cambio invalida la caché de todos los períodos.**
 *
 * Reproduce la hoja «ANÁLISIS» del libro de incentivos (resumen ejecutivo,
 * sucursales con veredicto, servicios y concentración, flujo de efectivo,
 * prioridades y plan de acción) sobre las claves JSON que ya devuelve la IA.
 */

export const ANALISIS_SCOPE = "incentivos-analisis"

export const ANALISIS_QUESTION = [
  "Elabora el ANALISIS FINANCIERO Y RECOMENDACIONES del periodo usando exclusivamente el contexto:",
  "`resumen`, `rentabilidad` (margenNeto ya viene en porcentaje), `ingresos.porServicio`, `flujo`, `flujoMensual` e `historicoAnual`.",
  "Estructura obligatoria:",
  "(1) `resumen_ejecutivo`: ventas brutas, gastos operativos, margen, rentabilidad %, flujo de efectivo neto y tres observaciones clave;",
  "si `historicoAnual` trae el año anterior completo, compara la venta anualizada del año en curso contra ese año.",
  "(2) `hallazgos`: una entrada por sucursal con el formato «SUCURSAL - ventas, gastos, margen, rentabilidad %, % del total. Veredicto: ...»;",
  "luego una entrada «Servicios: ...» con la participacion de cada servicio sobre `ingresos.total` y aviso de concentracion si DEPILACION_LASER supera el 70 %;",
  "luego una entrada «Flujo de efectivo: ...» con ingresos, egresos operativos, inversion general, inversion por sucursal, retiros de socios y flujo neto.",
  "(3) `riesgos`: concentracion de servicios, sucursales con margen menor al 10 %, flujo neto negativo y meses de `flujoMensual` con egresos mayores que ventas.",
  "(4) `recomendaciones`: exactamente cuatro prioridades estrategicas numeradas «Prioridad 1: ...» a «Prioridad 4: ...», cada una con una meta medible.",
  "(5) `acciones`: plan de accion inmediato; cada elemento con el formato «Accion - Responsable: ... - Plazo: ... - Impacto esperado: ...».",
  "Cita las cifras en RD$ y los porcentajes tal como aparecen en el contexto, sin inventar datos.",
  "Si un bloque esta en cero o falta (por ejemplo sin gastos importados o sin retiros), dilo en `datos_faltantes` en lugar de suponerlo.",
].join(" ")
