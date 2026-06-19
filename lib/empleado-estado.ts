/**
 * Estados oficiales de empleados / solicitudes de empleo (RR.HH.).
 *
 * Fuente única para selects, badges, filtros y la regla "activo vs no activo".
 * El valor se guarda en `csl_solicitudes_empleo.estado` y `csl_empleados.estado`
 * (columnas `text`, sin constraint → no requiere migración para agregar valores).
 *
 * Un empleado se considera ACTIVO solo si su estado es "Aprobado" (solicitud) o
 * "Activo" (empleado sincronizado). Renuncia / Desvinculado / Rechazado y los
 * estados en proceso NO cuentan como activos para nómina, asistencia, ponche,
 * horarios ni dashboard. No se borra el registro: solo cambia el estado.
 */

export const ESTADOS_EMPLEADO = [
  "Pendiente",
  "En revisión",
  "Entrevista",
  "Aprobado",
  "Rechazado",
  "Renuncia",
  "Desvinculado",
] as const

export type EstadoEmpleado = (typeof ESTADOS_EMPLEADO)[number]

/** Emoji por estado para los <SelectItem> del editor (consistente con la UI). */
export const ESTADO_EMOJI: Record<string, string> = {
  Pendiente: "🟡",
  "En revisión": "🔵",
  Entrevista: "🟣",
  Aprobado: "🟢",
  Rechazado: "🔴",
  Renuncia: "🟠",
  Desvinculado: "⚫",
}

/** Estados que dejan al empleado fuera de la empresa (no activo, pero NO se borra). */
const ESTADOS_NO_ACTIVOS = new Set(["rechazado", "renuncia", "desvinculado", "inactivo", "terminado", "suspendido"])
/** Estados que cuentan como empleado vigente. */
const ESTADOS_ACTIVOS = new Set(["aprobado", "activo"])

export function isEmpleadoActivo(estado: string | undefined | null): boolean {
  return ESTADOS_ACTIVOS.has(String(estado ?? "").trim().toLowerCase())
}

export function isEmpleadoNoActivo(estado: string | undefined | null): boolean {
  return ESTADOS_NO_ACTIVOS.has(String(estado ?? "").trim().toLowerCase())
}

/** Clases Tailwind para el badge de estado (claro y consistente). */
export function estadoBadgeClasses(estado: string): string {
  switch (estado) {
    case "Pendiente":
      return "border-yellow-500/40 bg-yellow-500/15 text-yellow-700 dark:text-yellow-300"
    case "En revisión":
      return "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300"
    case "Entrevista":
      return "border-purple-500/40 bg-purple-500/15 text-purple-700 dark:text-purple-300"
    case "Aprobado":
    case "Activo":
      return "border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-300"
    case "Rechazado":
      return "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300"
    case "Renuncia":
      return "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-300"
    case "Desvinculado":
      return "border-slate-500/40 bg-slate-500/20 text-slate-700 dark:text-slate-300"
    default:
      return "border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300"
  }
}
