# Continuidad del Pulsos Inicio en PulseControl — diseño

**Fecha:** 2026-07-31
**Módulo:** PulseControl (menú *Auditoría / IA* y hermanos)
**Estado:** aprobado, pendiente de plan de implementación

## Problema

El **Pulsos Inicio** de una semana debe ser el **Pulsos Fin** de la semana anterior
del **mismo equipo**. Hoy no se cumple, y el usuario corrige filas a mano cada
semana. Peor: las correcciones se pierden ("se me cambia").

Evidencia real (captura del 2026-07-31):

| Semana | Operadora | Sucursal / Cab. | Eq. | Inicio | Fin |
|---|---|---|---|---|---|
| 06-11 jul | ASHLEY | Rafael Vidal / 4 | **1** | 782,751 | **789,933** |
| 20-25 jul | ROSA | Rafael Vidal / 5 | **4** | **789,933** | 7,314,744 |

El cierre del equipo 1 aparece como inicio del equipo 4. Resultado: Disp. Láser
6,524,811 contra 34,970 del operador → −99 %, "Crítico" falso. En esa misma
captura hay 7 filas marcadas *"✓ corregido"*: correcciones manuales del usuario.

## Causa raíz

La misma regla está implementada en **cuatro lugares**, y uno está mal:

| Ubicación | Rol | Estado |
|---|---|---|
| `lib/pulse-engine.ts` → `calculateLecturaInicial` | regla canónica | correcta |
| `lib/pulse-engine.ts` → `recalculateContinuity` | reparación | **código muerto, nadie la llama** |
| `components/pulsos-auditoria-page.tsx:304-307` | cálculo de la pantalla | **con el bug** |
| `components/pulsos-lecturas-page.tsx:131-149` | contador de problemas | copia inline |
| `app/api/csl/_handlers.ts:5211-5225` | reparación en servidor | copia inline a mano |

### El bug (`pulsos-auditoria-page.tsx:304`)

```js
const pulsosInicio =
  storedInicial > 0 && prevFinal != null && storedInicial !== prevFinal ? storedInicial
  : prevFinal != null ? prevFinal
  : storedInicial
```

La intención era respetar una corrección manual. Pero el código no puede
distinguir una corrección deliberada de un dato malo llegado por importación,
así que **cualquier valor guardado que difiera del encadenado gana**. Como el
import de Excel escribe `LecturaInicial` tal cual viene de la hoja
(`pulsos-auditoria-page.tsx:643,658`), el encadenado queda anulado de hecho en
toda fila importada.

### Defectos asociados

1. **El import no encadena.** Toma `Pulsos Inicio` de la casilla y nunca llama al
   motor ni dispara la reparación. Esto es el "se me cambia": el usuario corrige
   en *Lecturas* y un import posterior reescribe el valor de la hoja.
2. **La reparación casi no corre.** `recalculatePulseContinuity` solo se invoca
   desde `pulsos-lecturas-page.tsx` (líneas 326, 402, 453). No corre al importar,
   ni desde la sincronización, ni de forma programada.
3. **La reparación deja la fila a medias.** `_handlers.ts:5220` actualiza
   `lectura_inicial` pero **no recalcula `disp_laser`**, que queda con el valor
   viejo. La versión del motor sí devuelve `disp_laser`; la copia del servidor lo
   ignora.
4. **Falta guardia de tenant.** El `update` de `_handlers.ts:5218-5221` filtra por
   `.eq("id", cur.id)` sin `.eq("business_id", bizId)`. Hoy los ids provienen de
   una consulta ya filtrada por negocio, así que no hay fuga real, pero la
   guardia debe estar igual (defensa en profundidad, ver regla del proyecto).
5. **Divergencia visible entre pantallas.** *Cuadre Semanal*
   (`pulsos-cuadre-semanal-page.tsx:362-366`) ya encadena correctamente. Auditoría
   no. Las dos muestran hoy cifras distintas de la misma semana.
6. **Auditoría encadena por la persona, no por la máquina.**
   `prevFinalFor` (`pulsos-auditoria-page.tsx:207-231`) construye su índice con la
   clave `sucursal|operadora` y descarta las filas sin operadora ("sin operador no
   se puede encadenar de forma fiable"). Pero el contador de pulsos pertenece al
   equipo: las operadoras rotan de cabina, así que la serie se parte o se mezcla
   cuando alguien cambia de puesto.
7. **`equipo_id` no identifica una máquina de forma única.** Verificado contra
   `csl_pulse_readings` (142 filas, 15 equipos, 129 con serial):
   - El `equipo_id` **9** existe en **Los Jardines y en Rafael Vidal** — dos
     sucursales reales. Encadenar solo por `equipo_id`, que es justo lo que hace
     `findPrevLecturaFinal` en el motor, mezclaría dos máquinas distintas.
   - Los demás "multi-sucursal" son la misma sucursal escrita de varias formas
     (`JARDINES` / `Los Jardines`; `R VIDAL` / `R. VIDAL` / `Rafael Vidal`), y las
     cabinas igual (`1` / `CABINA 1`). Sin normalizar, la serie de una misma
     máquina se parte en varias.
   - El `equipo_id` **7** tiene dos seriales en la misma cabina, uno en una sola
     semana (`9914-0950-1383` el 2026-05-25 frente a `9914-0950-2627` el resto):
     con toda probabilidad un error de digitación, no un cambio de máquina.

## Decisiones tomadas

Confirmadas con el usuario en esta sesión:

1. **Inicio = Fin de la semana anterior, SIEMPRE.** El contador del láser nunca se
   reinicia. Cualquier diferencia es un error, sin excepciones. No hay caso de
   "reset de equipo" que haya que modelar.
2. **No se reescribe el histórico** de `csl_pulse_readings`.
3. **El histórico sí se ve corregido**: el valor mostrado se deriva, no se lee.
   Los "Crítico" falsos desaparecen de todas las semanas sin tocar la base.
4. **Enfoque A**: una sola función compartida, más los arreglos de higiene.
5. **La serie se encadena por `sucursal normalizada + equipo_id`**, no por
   operadora, no por `equipo_id` suelto y no por serial. Cubre las 142 filas sin
   excepciones y es tolerante con los seriales mal digitados. La normalización de
   `sucursal` y `cabina` forma parte de la clave, si no la serie de una misma
   máquina se parte por diferencias de escritura.

Consecuencia aceptada de (3): las cifras de semanas pasadas en pantalla ya no
coincidirán con PDFs exportados antes de este cambio. El usuario lo aceptó
explícitamente.

## Diseño

### 1. Núcleo: una sola definición

Nueva función pura en `lib/pulse-engine.ts`:

```ts
/** Clave de serie: sucursal normalizada + equipo_id. Ver decisión 5. */
export function seriesKey(sucursal: unknown, equipoId: unknown): string

export interface ReadingResuelta {
  id: string
  seriesKey: string
  periodStart: string
  periodEnd: string
  inicio: number        // derivado: fin de la lectura anterior de la MISMA serie
  fin: number
  dispLaser: number     // max(0, fin - inicio)
  esPrimeraLectura: boolean  // no hay lectura previa en esta serie
  faltaFinal: boolean        // fin <= inicio (la lectura final no avanzó)
}

/** Resuelve TODAS las lecturas, agrupando por seriesKey. Map id → resuelta. */
export function resolveSeries(readings: PulseReading[]): Map<string, ReadingResuelta>
```

Reglas:

- Agrupa por `seriesKey(sucursal, equipo_id)` y ordena cada grupo por
  `period_start` ascendente.
- `seriesKey` normaliza la sucursal reusando el `canonicalSucursal` que ya existe
  en el proyecto (mapea `R. VIDAL` / `R VIDAL` / `Rafael Vidal` a un mismo valor)
  y aplica `trim` + mayúsculas al `equipo_id`. La **cabina no entra en la clave**:
  una máquina puede cambiar de cabina dentro de la misma sucursal sin que su
  contador se reinicie.
- `inicio` de la fila *n* = `lectura_final` de la fila *n−1* de la misma serie.
  **El `lectura_inicial` guardado se ignora** para el cálculo siempre que exista
  una lectura anterior; queda como dato de captura.
- Primera lectura de la serie (no hay anterior): `inicio` = `lectura_inicial`
  guardado si es > 0, si no 0; `esPrimeraLectura = true`. Es el **único** caso
  donde el valor guardado se usa, porque no hay nada de donde derivarlo.
- **Conservar la neutralización de alerta que ya existe**: cuando
  `esPrimeraLectura` y no hay inicio guardado (`inicio === 0`), la fila no debe
  marcarse "Crítico" por un dato que falta. Hoy la pantalla lo resuelve con
  `faltaInicial` (`pulsos-auditoria-page.tsx:308,311,322`) forzando
  `dispLaser = 0` y `alerta = OK`. Ese comportamiento se preserva tal cual; la
  bandera se renombra a `esPrimeraLectura` pero el efecto en la alerta es el
  mismo.
- `dispLaser = max(0, fin - inicio)`.
- `faltaFinal = !esPrimeraLectura && fin <= inicio`. La pantalla ya trata este
  caso ("Falta lectura final"); se conserva el comportamiento.
- Un hueco de semanas no es un caso especial: se encadena con la última lectura
  disponible, que es lo correcto.

`recalculateContinuity` se reescribe sobre `resolveEquipoSeries` en vez de
duplicar el bucle, y pasa a devolver también el `disp_laser` corregido.

### 2. Los consumidores pasan a usarla

| Archivo | Cambio |
|---|---|
| `components/pulsos-auditoria-page.tsx` | eliminar `prevFinalFor` (207-231) y las líneas 297-311; tomar `inicio`/`dispLaser`/`faltaFinal` de `resolveSeries`. Aplica igual a la rama legacy de `lecturasSemanales`. |
| `components/pulsos-cuadre-semanal-page.tsx` | sustituir `calculateLecturaInicial` (362-366) por la nueva función. |
| `components/pulsos-lecturas-page.tsx` | `continuityIssues` (131-149) se deriva de la función; se elimina el bucle inline. |
| `app/api/csl/_handlers.ts` | `recalculatePulseContinuity` importa el motor; además actualiza `disp_laser` y añade `.eq("business_id", bizId)` al `update`. |

`getAlerta` (`lib/pulse-colors.ts`) y los umbrales 5 %/15 % **no cambian**.

### 3. El import deja de poder ensuciar

En `handleExcelUpload` (`pulsos-auditoria-page.tsx:613`):

- `Pulsos Inicio` de la hoja se usa **solo si es la primera lectura de ese
  equipo** (valor semilla, no derivable).
- Si ya existe historial del equipo, la columna se ignora.
- El resumen de importación informa cuántas filas se ignoraron:
  *"N filas: se ignoró Pulsos Inicio, se deriva del cierre anterior"*.
- `DiferenciaReal` deja de calcularse desde el inicio de la hoja (línea 660) y
  pasa a derivarse igual que el resto.

### 4. Tests

csl-app **no tiene framework de pruebas** hoy (`lint` es `tsc --noEmit`; solo hay
tres scripts manuales). Se instala **vitest**, el mismo que ya usan alojacontrol
y palusaapp, y se añade `"test": "vitest run"` a `package.json`.

`lib/pulse-engine.test.ts` cubre:

1. Encadenado normal de tres semanas consecutivas.
2. Primera lectura de un equipo (usa el guardado, marca `esPrimeraLectura`).
3. Hueco de semanas (la del 11 al 20 de julio del caso real).
4. `fin <= inicio` → `faltaFinal`.
5. Equipo con una sola lectura.
6. **Aislamiento entre equipos**: el caso ASHLEY (Eq. 1) / ROSA (Eq. 4) de la
   captura — el cierre de un equipo no puede convertirse en el inicio de otro.
7. `lectura_inicial` guardado incorrecto se ignora cuando hay anterior.
8. Primera lectura sin inicio guardado → `dispLaser = 0` y alerta neutral (no
   "Crítico"), igual que hoy.
9. **Aislamiento entre sucursales**: el caso real del `equipo_id` 9, que existe en
   Los Jardines y en Rafael Vidal — son dos series independientes y no se
   encadenan entre sí.
10. **Normalización de la clave**: filas con `R. VIDAL`, `R VIDAL` y
    `Rafael Vidal` para el mismo `equipo_id` forman **una sola** serie continua.
11. **Rotación de operadora**: si dos semanas consecutivas del mismo equipo tienen
    operadoras distintas, la serie sigue encadenada (hoy se partiría, por el
    defecto 6).

### 5. Fuera de alcance

- **No** se reescribe ninguna fila histórica de `csl_pulse_readings`.
- **No** se tocan comisiones ni nómina. Verificado: `lib/server/commission.ts` y
  `lib/commission/laser-apply.ts` no referencian `pulse_readings`, `disp_laser`
  ni lecturas; el "incentivo láser" sale de montos de venta de la categoría
  `DEPILACION_LASER`. Reparar pulsos no mueve ningún pago.
- **No** se unifican `csl_pulse_readings` y la legacy `csl_lecturas_semanales`.
  Que existan dos tablas para el mismo concepto es deuda real y merece su propio
  diseño; no hace falta resolverla para esto.
- **No** se añade IA al menú *Auditoría / IA*, que hoy no tiene ninguna pese al
  nombre. Queda anotado como oportunidad aparte.

## Criterios de aceptación

1. En Auditoría, la fila de ROSA (Rafael Vidal cab. 5, Eq. 4, semana 20-25 jul)
   muestra `Inicio` = el `Fin` de la semana anterior **de su propio equipo**, no
   789,933.
2. Auditoría y Cuadre Semanal muestran el **mismo** Disp. Láser para la misma
   semana y equipo.
2b. El `equipo_id` 9 mantiene **dos series separadas**, una por sucursal, y
   ninguna lectura de Los Jardines aparece como inicio de una de Rafael Vidal.
2c. Cambiar la operadora asignada a un equipo **no** altera su Disp. Láser.
3. Importar un Excel cuyo `Pulsos Inicio` sea incorrecto **no** cambia lo que se
   ve en Auditoría, y el resumen avisa cuántas filas ignoró.
4. `vitest run` pasa, con los 7 casos anteriores.
5. `pnpm lint` y `pnpm build` en verde.
6. Ninguna fila de `csl_pulse_readings` cambia de valor por el hecho de desplegar
   (solo cambia lo derivado en pantalla).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Las semanas pasadas muestran cifras distintas a los PDFs ya exportados | Aceptado explícitamente por el usuario; es la corrección de un dato que estaba mal |
| `resolveEquipoSeries` se llama por equipo dentro de un bucle sobre muchas filas | Agrupar una sola vez por `equipo_id` y resolver por grupo; el volumen es semanal por sucursal, no masivo |
| El tope de 1000 filas de PostgREST trunca la serie y rompe el encadenado | `recalculatePulseContinuity` ya usa `fetchAllPages`; verificar que la carga del cliente también pagine |
