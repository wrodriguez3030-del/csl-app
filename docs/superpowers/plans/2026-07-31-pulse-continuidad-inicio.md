# Continuidad del Pulsos Inicio en PulseControl — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Pulsos Inicio de cada semana se derive siempre del Pulsos Fin de la semana anterior de la misma máquina, para que el usuario deje de corregir filas a mano cada semana.

**Architecture:** Una función pura en `lib/pulse-engine.ts` agrupa las lecturas por `sucursal normalizada + equipo_id` y devuelve el inicio y el Disp. Láser derivados. Las cuatro implementaciones actuales de esa regla (tres en componentes, una en el handler del servidor) se sustituyen por llamadas a esa función. El valor guardado `lectura_inicial` deja de ser fuente de verdad del cálculo; no se reescribe ninguna fila histórica.

**Tech Stack:** TypeScript, Next.js 16, React, pnpm, vitest (se instala en la Tarea 1), Supabase self-hosted (db-cls).

**Spec:** `docs/superpowers/specs/2026-07-31-pulse-continuidad-inicio-design.md`

## Global Constraints

- Gestor de paquetes: **pnpm**. Nunca `npm` ni `yarn` en este repo.
- `lib/pulse-engine.ts` debe seguir siendo **puro**: sin React, sin Supabase, sin Next. Solo puede importar de `lib/normalize-pulse.ts`, que también es puro. Import **relativo** (`./normalize-pulse`), no alias `@/`, para que vitest resuelva sin configuración extra.
- La regla es **Inicio = Fin de la semana anterior, SIEMPRE**. No existe caso de "reset de equipo". No añadir ramas de override.
- Clave de serie: **`sucursal normalizada + equipo_id`**. La cabina NO entra en la clave.
- **No se escribe en `csl_pulse_readings`** en las tareas 1-5. El único handler que escribe (`recalculatePulseContinuity`) conserva su comportamiento de escritura, corregido.
- Los umbrales de alerta (5 % / 15 %) y `getAlerta` en `lib/pulse-colors.ts` **no se tocan**.
- Verificación obligatoria antes de cada commit: `pnpm lint` (que es `tsc --noEmit`) en verde.
- Al terminar todo: bump SemVer en `package.json` + entrada en `CHANGELOG.md`, push a `origin` **y** a `gitea`.

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `lib/pulse-engine.ts` | Regla de continuidad. Única definición. | Modificar |
| `lib/pulse-engine.test.ts` | Pruebas de la regla. | Crear |
| `package.json` | Script `test` + dependencia vitest. | Modificar |
| `components/pulsos-auditoria-page.tsx` | Pantalla Auditoría / IA. | Modificar |
| `components/pulsos-cuadre-semanal-page.tsx` | Pantalla Cuadre Semanal. | Modificar |
| `components/pulsos-lecturas-page.tsx` | Pantalla Lecturas. | Modificar |
| `app/api/csl/_handlers.ts` | Handler `recalculatePulseContinuity`. | Modificar |

---

### Task 1: Motor de continuidad + vitest

**Files:**
- Modify: `lib/pulse-engine.ts`
- Create: `lib/pulse-engine.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `normalizeSucursal` de `lib/normalize-pulse.ts` (ya existe, es puro, sin imports).
- Produces: `seriesKey(sucursal, equipoId): string`, `resolveSeries(readings): Map<string, ReadingResuelta>`, y la interfaz `ReadingResuelta` con los campos `id`, `seriesKey`, `periodStart`, `periodEnd`, `inicio`, `fin`, `dispLaser`, `esPrimeraLectura`, `faltaFinal`. Las tareas 2, 3 y 4 dependen de estos nombres exactos.

- [ ] **Step 1: Instalar vitest y añadir el script**

```bash
cd ~/Projects/csl-app
pnpm add -D vitest
```

Luego editar `package.json` y añadir dentro de `"scripts"`, junto a los `test:*` que ya existen:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Escribir las pruebas que fallan**

Crear `lib/pulse-engine.test.ts` con este contenido completo:

```ts
import { describe, it, expect } from "vitest"
import { seriesKey, resolveSeries, type PulseReading } from "./pulse-engine"

/** Fábrica mínima: solo los campos que la regla usa. */
function r(
  id: string,
  sucursal: string,
  equipo: string,
  periodStart: string,
  inicial: number,
  final: number,
): PulseReading {
  return {
    id,
    business_id: "biz",
    equipo_id: equipo,
    sucursal,
    period_start: periodStart,
    period_end: periodStart,
    lectura_inicial: inicial,
    lectura_final: final,
    disp_laser: 0,
  } as PulseReading
}

describe("seriesKey", () => {
  it("une las variantes de escritura de la misma sucursal", () => {
    expect(seriesKey("R. VIDAL", "7")).toBe(seriesKey("Rafael Vidal", "7"))
    expect(seriesKey("R VIDAL", "7")).toBe(seriesKey("Rafael Vidal", "7"))
  })

  it("separa sucursales distintas con el mismo equipo", () => {
    expect(seriesKey("Los Jardines", "9")).not.toBe(seriesKey("Rafael Vidal", "9"))
  })
})

describe("resolveSeries", () => {
  it("encadena: el inicio es el fin de la semana anterior", () => {
    const out = resolveSeries([
      r("a", "Rafael Vidal", "4", "2026-07-06", 0, 8_715_029),
      r("b", "Rafael Vidal", "4", "2026-07-20", 789_933, 8_800_000),
    ])
    expect(out.get("b")!.inicio).toBe(8_715_029)
    expect(out.get("b")!.dispLaser).toBe(84_971)
  })

  it("ignora el lectura_inicial guardado cuando hay semana anterior", () => {
    const out = resolveSeries([
      r("a", "Rafael Vidal", "4", "2026-07-06", 0, 500),
      r("b", "Rafael Vidal", "4", "2026-07-13", 999_999, 700),
    ])
    expect(out.get("b")!.inicio).toBe(500)
  })

  it("primera lectura: usa el guardado y se marca como tal", () => {
    const out = resolveSeries([r("a", "Rafael Vidal", "4", "2026-07-06", 1_000, 1_500)])
    const a = out.get("a")!
    expect(a.esPrimeraLectura).toBe(true)
    expect(a.inicio).toBe(1_000)
    expect(a.dispLaser).toBe(500)
  })

  it("primera lectura sin inicio guardado: dispLaser 0 (alerta neutral)", () => {
    const out = resolveSeries([r("a", "Rafael Vidal", "4", "2026-07-06", 0, 9_000)])
    expect(out.get("a")!.inicio).toBe(0)
    expect(out.get("a")!.dispLaser).toBe(0)
  })

  it("un hueco de semanas no rompe la cadena", () => {
    const out = resolveSeries([
      r("a", "Rafael Vidal", "4", "2026-07-06", 0, 100),
      r("c", "Rafael Vidal", "4", "2026-07-20", 0, 180),
    ])
    expect(out.get("c")!.inicio).toBe(100)
    expect(out.get("c")!.dispLaser).toBe(80)
  })

  it("fin <= inicio marca faltaFinal", () => {
    const out = resolveSeries([
      r("a", "Rafael Vidal", "4", "2026-07-06", 0, 500),
      r("b", "Rafael Vidal", "4", "2026-07-13", 0, 500),
    ])
    expect(out.get("b")!.faltaFinal).toBe(true)
    expect(out.get("b")!.dispLaser).toBe(0)
  })

  it("caso real: el cierre del Eq.1 no puede ser el inicio del Eq.4", () => {
    const out = resolveSeries([
      r("ashley", "Rafael Vidal", "1", "2026-07-06", 782_751, 789_933),
      r("rosa_prev", "Rafael Vidal", "4", "2026-07-06", 8_637_190, 8_715_029),
      r("rosa", "Rafael Vidal", "4", "2026-07-20", 789_933, 7_314_744),
    ])
    expect(out.get("rosa")!.inicio).toBe(8_715_029)
    expect(out.get("rosa")!.inicio).not.toBe(789_933)
  })

  it("caso real: el equipo 9 mantiene series separadas por sucursal", () => {
    const out = resolveSeries([
      r("j1", "Los Jardines", "9", "2026-07-06", 0, 1_000),
      r("v1", "Rafael Vidal", "9", "2026-07-06", 0, 5_000),
      r("j2", "Los Jardines", "9", "2026-07-13", 0, 1_200),
    ])
    expect(out.get("j2")!.inicio).toBe(1_000)
  })

  it("las variantes de escritura forman UNA sola serie", () => {
    const out = resolveSeries([
      r("a", "R. VIDAL", "7", "2026-07-06", 0, 300),
      r("b", "Rafael Vidal", "7", "2026-07-13", 0, 450),
    ])
    expect(out.get("b")!.inicio).toBe(300)
    expect(out.get("b")!.esPrimeraLectura).toBe(false)
  })

  it("la rotación de operadora no parte la serie", () => {
    const a = r("a", "Rafael Vidal", "4", "2026-07-06", 0, 300)
    const b = r("b", "Rafael Vidal", "4", "2026-07-13", 0, 450)
    const out = resolveSeries([
      { ...a, operadora: "ROSA" },
      { ...b, operadora: "ASHLEY" },
    ])
    expect(out.get("b")!.inicio).toBe(300)
  })
})
```

- [ ] **Step 3: Correr las pruebas y confirmar que fallan**

Run: `pnpm test`
Expected: FAIL — `seriesKey` y `resolveSeries` no existen todavía en `./pulse-engine`.

- [ ] **Step 4: Implementar el motor**

En `lib/pulse-engine.ts`, añadir el import relativo al principio del archivo (después del bloque de comentario de cabecera):

```ts
import { normalizeSucursal } from "./normalize-pulse"
```

Añadir al final del archivo:

```ts
/**
 * Clave de serie de un contador de pulsos: sucursal normalizada + equipo.
 *
 * NO incluye la cabina: una máquina puede cambiar de cabina dentro de la misma
 * sucursal sin que su contador se reinicie.
 *
 * NO se usa el serial: el 9 % de las filas no lo tiene y hay seriales mal
 * digitados que partirían la serie (ver spec, causa raíz 7).
 */
export function seriesKey(sucursal: unknown, equipoId: unknown): string {
  const suc = normalizeSucursal(sucursal) || String(sucursal ?? "").trim().toUpperCase()
  const eq = String(equipoId ?? "").trim().toUpperCase()
  return `${suc}|${eq}`
}

export interface ReadingResuelta {
  id: string
  seriesKey: string
  periodStart: string
  periodEnd: string
  /** Derivado: lectura_final de la fila anterior de la MISMA serie. */
  inicio: number
  fin: number
  /** max(0, fin - inicio). 0 cuando es primera lectura sin inicio guardado. */
  dispLaser: number
  esPrimeraLectura: boolean
  /** fin <= inicio: la lectura final no avanzó. */
  faltaFinal: boolean
}

/**
 * Resuelve TODAS las lecturas agrupándolas por serie.
 *
 * Regla única: Inicio = Fin de la semana anterior de la misma serie. El
 * `lectura_inicial` guardado se ignora salvo en la primera lectura, donde no hay
 * nada de donde derivarlo.
 */
export function resolveSeries(readings: PulseReading[]): Map<string, ReadingResuelta> {
  const groups = new Map<string, PulseReading[]>()
  for (const r of readings) {
    const k = seriesKey(r.sucursal, r.equipo_id)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }

  const out = new Map<string, ReadingResuelta>()
  for (const [k, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      String(a.period_start).localeCompare(String(b.period_start)),
    )
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      const fin = Number(cur.lectura_final) || 0
      const esPrimeraLectura = i === 0
      const inicio = esPrimeraLectura
        ? Math.max(0, Number(cur.lectura_inicial) || 0)
        : Number(sorted[i - 1].lectura_final) || 0
      // Primera lectura sin inicio: no hay base para calcular, no inventamos
      // disparos. La pantalla lo trata como alerta neutral.
      const dispLaser = esPrimeraLectura && inicio === 0 ? 0 : Math.max(0, fin - inicio)
      out.set(String(cur.id), {
        id: String(cur.id),
        seriesKey: k,
        periodStart: String(cur.period_start),
        periodEnd: String(cur.period_end),
        inicio,
        fin,
        dispLaser,
        esPrimeraLectura,
        faltaFinal: !esPrimeraLectura && fin <= inicio,
      })
    }
  }
  return out
}
```

- [ ] **Step 5: Correr las pruebas y confirmar que pasan**

Run: `pnpm test`
Expected: PASS — 12 pruebas.

- [ ] **Step 6: Reescribir `recalculateContinuity` sobre el motor**

Sustituir por completo el cuerpo de `recalculateContinuity` (líneas 80-100 del archivo original) por:

```ts
/**
 * Cambios necesarios para que las filas guardadas cuadren con la serie derivada.
 * Devuelve también `disp_laser`: actualizar `lectura_inicial` sin recalcularlo
 * deja la fila a medias.
 */
export function recalculateContinuity(
  readings: PulseReading[],
): Array<{ id: string; lectura_inicial: number; disp_laser: number }> {
  const resolved = resolveSeries(readings)
  const changes: Array<{ id: string; lectura_inicial: number; disp_laser: number }> = []
  for (const r of readings) {
    const res = resolved.get(String(r.id))
    if (!res || res.esPrimeraLectura) continue
    if (Number(r.lectura_inicial) !== res.inicio) {
      changes.push({ id: String(r.id), lectura_inicial: res.inicio, disp_laser: res.dispLaser })
    }
  }
  return changes
}
```

- [ ] **Step 7: Verificar tipos y commitear**

```bash
cd ~/Projects/csl-app
pnpm lint
pnpm test
git add lib/pulse-engine.ts lib/pulse-engine.test.ts package.json pnpm-lock.yaml
git commit -m "feat(pulse): motor de continuidad por sucursal+equipo + vitest"
```

---

### Task 2: Auditoría / IA usa el motor

**Files:**
- Modify: `components/pulsos-auditoria-page.tsx` (eliminar 207-231 y 294-311)

**Interfaces:**
- Consumes: `resolveSeries` y `ReadingResuelta` de la Tarea 1.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Añadir el import**

En la línea 27, donde ya se importa de `@/lib/pulse-colors`, añadir debajo:

```ts
import { resolveSeries } from "@/lib/pulse-engine"
```

- [ ] **Step 2: Eliminar `prevFinalFor` y resolver UNA serie combinada**

Borrar el bloque completo `const prevFinalFor = (() => { ... })()` (líneas 207-231). En su lugar:

```ts
    // Serie derivada por sucursal+equipo, resuelta UNA sola vez. Antes se
    // encadenaba por sucursal|operadora, lo que partía la serie cada vez que una
    // operadora cambiaba de cabina.
    //
    // La serie combina AMBAS fuentes (csl_pulse_readings + la legacy
    // csl_lecturas_semanales): una misma máquina puede tener unas semanas en una
    // tabla y otras en la otra, y si se resolvieran por separado la cadena se
    // partiría en la frontera.
    const primarias = dbPulsos.pulseReadings ?? []

    // Dedup: una combinación semana|equipo|sucursal|cabina que ya exista como
    // lectura primaria NO debe entrar otra vez desde la legacy, o una encadenaría
    // con la otra y el resultado saldría corrupto.
    const clavesPrimarias = new Set(
      primarias.map(r =>
        `${String(r.period_start || "").split("T")[0].trim()}|${r.equipo_id}|${canonicalSucursal(r.sucursal)}|${String(r.cabina || "").trim()}`,
      ),
    )

    // Adaptador: la legacy tiene otra forma de fila. Solo se mapean los campos
    // que la regla de continuidad usa.
    const legacyComoReadings = dbPulsos.lecturasSemanales
      .filter(lec => {
        const desde = String(lec.FechaSemana || "").split("T")[0].trim()
        const k = `${desde}|${lec.EquipoID}|${canonicalSucursal(lec.Sucursal)}|${String(lec.Cabina || "").trim()}`
        return !clavesPrimarias.has(k)
      })
      .map(lec => {
        const desde = String(lec.FechaSemana || "").split("T")[0].trim()
        return {
          id: String(lec.LecturaID),
          business_id: "",
          equipo_id: String(lec.EquipoID || ""),
          sucursal: String(lec.Sucursal || ""),
          cabina: String(lec.Cabina || ""),
          period_start: desde,
          period_end: desde,
          lectura_inicial: Number(lec.LecturaInicial) || 0,
          lectura_final: Number(lec.LecturaFinal) || 0,
          disp_laser: 0,
        } as PulseReading
      })

    const resolved = resolveSeries([...primarias, ...legacyComoReadings])
```

Añadir `type PulseReading` al import de `@/lib/pulse-engine` del paso 1.

- [ ] **Step 3: Sustituir el cálculo del inicio**

Reemplazar las líneas 294-311 (desde el comentario `// Pulsos Inicio: encadenado...` hasta `const dispLaser = ...`) por:

```ts
      // Inicio y DISP LÁSER derivados por el motor. El lectura_inicial guardado
      // NO manda: esa rama anulaba el encadenado en toda fila importada.
      const res = resolved.get(String(r.id))
      const pulsosFin = Number(r.lectura_final) || 0
      const pulsosInicio = res?.inicio ?? 0
      const faltaInicial = res ? res.esPrimeraLectura && res.inicio === 0 : true
      const dispLaser = res?.dispLaser ?? 0
```

- [ ] **Step 4: Sustituir el cálculo de `faltaFinal`**

Reemplazar la línea 317 por:

```ts
      const faltaFinal = (res?.faltaFinal ?? false) && dispOperador > 0
```

- [ ] **Step 5: Derivar también en la rama legacy**

La rama legacy (bloque `── 2) Fallback LEGACY`) lee hoy el `DiferenciaReal`
guardado en la línea 391 y el `LecturaInicial` guardado en la 417. Como la Tarea 5
deja de escribir esos dos campos al importar, **sin este paso las filas legacy
importadas después del cambio mostrarían Disp. Láser 0**.

Reemplazar la línea 391:

```ts
      const resLec = resolved.get(String(lec.LecturaID))
      const dispLaser = resLec?.dispLaser ?? 0
```

Reemplazar la línea 417:

```ts
        pulsosInicio: resLec?.inicio ?? 0,
```

- [ ] **Step 6: Verificar y commitear**

```bash
cd ~/Projects/csl-app
pnpm lint
git add components/pulsos-auditoria-page.tsx
git commit -m "fix(pulse): Auditoria deriva el inicio del motor, no del valor guardado"
```

Comprobación manual: arrancar `pnpm dev`, abrir *PulseControl → Auditoría / IA*, semana del 20 al 25 de julio. La fila de ROSA (Rafael Vidal, cab. 5, Eq. 4) ya **no** debe mostrar 789,933 como inicio ni salir en Crítico. Revisar también que las filas cuyo origen sea la tabla legacy sigan mostrando su Disp. Láser, no 0.

---

### Task 3: Cuadre Semanal y Lecturas usan el motor

**Files:**
- Modify: `components/pulsos-cuadre-semanal-page.tsx:362-366`
- Modify: `components/pulsos-lecturas-page.tsx:131-149`

**Interfaces:**
- Consumes: `resolveSeries` de la Tarea 1.

- [ ] **Step 1: Cuadre Semanal — cambiar el import**

Línea 27: sustituir `calculateLecturaInicial` por `resolveSeries` en el import de `@/lib/pulse-engine`.

- [ ] **Step 2: Cuadre Semanal — usar el motor**

Reemplazar las líneas 362-366 por:

Primero, **fuera** del `.map(...)` y dentro del `useMemo` que lo envuelve, añadir una sola vez:

```ts
    const resolved = resolveSeries(pulseReadings)
```

Llamarla dentro del `map` la ejecutaría una vez por fila y agruparía el conjunto completo cada vez — O(n²) sin motivo.

Después, reemplazar las líneas 362-366 por:

```ts
      const res = resolved.get(String(row.id))
      const lectura_inicial = res?.inicio ?? 0
      const lectura_inicial_source: LecturaInicialSource =
        res?.esPrimeraLectura ? "primera_lectura" : "historico"
      const disp_laser = res?.dispLaser ?? 0
      return { ...row, lectura_inicial, lectura_inicial_source, disp_laser }
```

- [ ] **Step 3: Lecturas — contar problemas con el motor**

Reemplazar el `useMemo` de `continuityIssues` (líneas 131-149) por:

```ts
  // Problemas de continuidad: filas cuyo lectura_inicial guardado no cuadra con
  // la serie derivada. Antes era una cuarta copia del bucle de encadenado.
  const continuityIssues = useMemo(
    () => recalculateContinuity(pulseReadings).length,
    [pulseReadings],
  )
```

Y en el import de `@/lib/pulse-engine` (línea 25) añadir `recalculateContinuity`.

- [ ] **Step 4: Verificar y commitear**

```bash
cd ~/Projects/csl-app
pnpm lint
pnpm test
git add components/pulsos-cuadre-semanal-page.tsx components/pulsos-lecturas-page.tsx
git commit -m "refactor(pulse): Cuadre Semanal y Lecturas usan el motor unico"
```

Comprobación manual: abrir *Cuadre Semanal* y *Auditoría* con la misma semana y sucursal. El Disp. Láser debe coincidir.

---

### Task 4: El handler del servidor usa el motor

**Files:**
- Modify: `app/api/csl/_handlers.ts:5189-5227`

**Interfaces:**
- Consumes: `recalculateContinuity` de la Tarea 1 (firma nueva: devuelve `{id, lectura_inicial, disp_laser}`).

- [ ] **Step 1: Importar el motor**

Añadir al bloque de imports de `_handlers.ts`:

```ts
import { recalculateContinuity } from "@/lib/pulse-engine"
```

- [ ] **Step 2: Sustituir el cuerpo del handler**

Reemplazar desde `const byEquipo = new Map...` (línea 5204) hasta `return { ok: true, fixed }` (línea 5226) por:

```ts
      // Motor único: antes esto era una copia a mano del bucle de encadenado,
      // agrupada por equipo_id suelto (que se repite entre sucursales) y sin
      // recalcular disp_laser, lo que dejaba la fila a medias.
      const changes = recalculateContinuity(all as unknown as PulseReading[])

      let fixed = 0
      for (const c of changes) {
        const { error } = await sb
          .from("csl_pulse_readings")
          .update({
            lectura_inicial: c.lectura_inicial,
            disp_laser: c.disp_laser,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.id)
          .eq("business_id", bizId)   // guardia de tenant que faltaba
        if (!error) fixed++
      }
      return { ok: true, fixed }
```

- [ ] **Step 3: Ajustar el tipo de la consulta**

La consulta de la línea 5198 declara `PulseRow` con solo cinco campos. Sustituir esa declaración por el tipo del motor:

```ts
      const all = (await fetchAllPages((from, to) =>
        sb.from("csl_pulse_readings").select("*").eq("business_id", bizId)
          .order("period_start", { ascending: true }).range(from, to),
      )) as unknown as PulseReading[]
```

Y añadir `PulseReading` al import del paso 1.

- [ ] **Step 4: Verificar y commitear**

```bash
cd ~/Projects/csl-app
pnpm lint
git add app/api/csl/_handlers.ts
git commit -m "fix(pulse): el handler de continuidad usa el motor, recalcula disp_laser y filtra por business_id"
```

---

### Task 5: El import de Excel deja de poder ensuciar

**Files:**
- Modify: `components/pulsos-auditoria-page.tsx:643,658,660`

**Interfaces:**
- Consumes: `seriesKey` de la Tarea 1.

- [ ] **Step 1: Construir el conjunto de series que ya tienen historial**

Dentro de `handleExcelUpload`, antes del `rows.map(...)` (línea 633), añadir:

```ts
        // Series que ya tienen historial: para ellas el Inicio de la hoja se
        // ignora y se deriva del cierre anterior. Solo la primera lectura de una
        // serie puede traer el valor semilla desde el Excel.
        const seriesConHistorial = new Set(
          (dbPulsos.pulseReadings ?? []).map(r => seriesKey(r.sucursal, r.equipo_id)),
        )
        let ignoradas = 0
```

Añadir `seriesKey` al import de `@/lib/pulse-engine` que la Tarea 2 ya creó.

- [ ] **Step 2: Ignorar el Inicio cuando la serie ya existe**

Reemplazar la línea 643 por:

```ts
          const tieneHistorial = seriesConHistorial.has(seriesKey(sucursal, equipo))
          if (tieneHistorial) ignoradas++
          const lecturaInicial = tieneHistorial
            ? 0
            : excelNumber(rowValue(record, ["PulsosInicio", "Pulsos Inicio", "LecturaInicial", "Lectura Inicial"]))
```

- [ ] **Step 3: Dejar de derivar `DiferenciaReal` del Inicio de la hoja**

Reemplazar la línea 660 por:

```ts
              DiferenciaReal: 0,   // se deriva en pantalla; la hoja no manda
```

- [ ] **Step 4: Avisar al usuario en el resumen**

Justo después del toast de éxito de la línea 696
(`showToast(\`${nuevasLecturas.length} lecturas importadas para Auditoría PULSE\`, "success")`),
añadir:

```ts
        if (ignoradas > 0) {
          showToast(
            `${ignoradas} fila(s): se ignoró Pulsos Inicio, se deriva del cierre anterior`,
            "info",
          )
        }
```

Comprobar que `showToast` acepta `"info"` como variante; si el tipo solo admite
`"success" | "error"`, usar `"success"` y no ampliar el tipo en esta tarea.

- [ ] **Step 5: Verificar y commitear**

```bash
cd ~/Projects/csl-app
pnpm lint
git add components/pulsos-auditoria-page.tsx
git commit -m "fix(pulse): el import de Excel ya no puede pisar el Pulsos Inicio"
```

Comprobación manual: importar un Excel con un `Pulsos Inicio` deliberadamente incorrecto en una semana que ya tenga historial. La pantalla no debe cambiar, y debe salir el aviso de filas ignoradas.

---

### Task 6: Versión, CHANGELOG y despliegue

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump de versión**

En `package.json`, subir la versión de `0.86.2` a `0.87.0` (feature + corrección de comportamiento visible).

- [ ] **Step 2: Entrada en el CHANGELOG**

Añadir al principio de `CHANGELOG.md`:

```markdown
## [0.87.0] — 2026-08-01

### Corregido — PulseControl
- **El Pulsos Inicio se deriva siempre del Pulsos Fin de la semana anterior** de
  la misma máquina (sucursal + equipo). Antes, cualquier valor guardado distinto
  al encadenado ganaba, lo que anulaba el encadenado en toda fila importada y
  producía "Crítico" falsos (p. ej. el cierre de un equipo apareciendo como
  inicio de otro).
- Auditoría encadenaba por `sucursal|operadora`: la serie se partía cuando una
  operadora cambiaba de cabina. Ahora encadena por la máquina.
- `equipo_id` no es único entre sucursales (el equipo 9 existe en Los Jardines y
  en Rafael Vidal). La clave de serie ahora incluye la sucursal normalizada.
- `recalculatePulseContinuity` recalcula también `disp_laser` (antes dejaba la
  fila a medias) y filtra por `business_id`.
- El import de Excel ya no escribe el Pulsos Inicio salvo en la primera lectura
  de una serie, e informa cuántas filas ignoró.

### Añadido
- **vitest** y `lib/pulse-engine.test.ts` (12 pruebas). Primer framework de
  pruebas del proyecto.
```

- [ ] **Step 3: Verificación final completa**

```bash
cd ~/Projects/csl-app
pnpm lint
pnpm test
pnpm build
```

Los tres en verde antes de continuar.

- [ ] **Step 4: Commit y push a ambos remotos**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: v0.87.0 — continuidad del Pulsos Inicio en PulseControl"
git push origin main
git push gitea main
```

- [ ] **Step 5: Desplegar a producción**

```bash
npx vercel --prod --yes --cwd /Users/willianrodriguez/Projects/csl-app
```

Usar **siempre** `--cwd` con ruta absoluta: el directorio del shell persiste entre comandos y sin esto se despliega la carpeta equivocada.

- [ ] **Step 6: Verificar el despliegue**

```bash
npx vercel ls csl-app --yes | grep "●" | head -2
```

Expected: la primera línea debe decir `● Ready` y `Production`.

Comprobación final en producción: abrir *PulseControl → Auditoría / IA*, semana del 20 al 25 de julio, y confirmar que las filas que antes salían en Crítico por el desfase del inicio ahora cuadran.
