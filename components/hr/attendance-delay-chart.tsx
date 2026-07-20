"use client"

import { useMemo } from "react"
import { Users, AlarmClock, BarChart3, RefreshCw, CalendarClock } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Colores del módulo (teal/petróleo + rojo/coral) ────────────────────────────
const TEAL = "#0d9488" // asistencias
const TEAL_DARK = "#0f766e"
const CORAL = "#ef4444" // tardanzas
const CORAL_DARK = "#dc2626"
const ALERTA_TARDANZAS = 3 // umbral para resaltar fila

// Geometría (px) del área de barras — compartida por filas, gridlines y eje.
const NAME_COL = 172
const PAD_X = 10 // px-2.5 de cada fila
const GAP = 0 // el grid no lleva gap horizontal; las barras arrancan pegadas a la col nombre

export interface EmployeeAttendance {
  employee_id: string
  nombre: string
  asistencias: number
  tardanzas: number
}

// ─── Nombres: abreviado profesional (sin cortar feo con "…") ─────────────────────
// "Angélica María Jiménez" → "Angélica María J."  (avatar "AJ")
// "María Xaviera Almonte"  → "María Xaviera A."    (avatar "MA")
// "Sahomy López"           → "Sahomy L."           (avatar "SL")
export function abbreviateEmployeeName(raw: string): { display: string; initials: string } {
  const name = (raw || "").trim().replace(/\s+/g, " ")
  if (!name) return { display: "—", initials: "?" }
  const words = name.split(" ")
  if (words.length === 1) {
    return { display: words[0], initials: words[0].slice(0, 2).toUpperCase() }
  }
  const givenCount = Math.min(2, words.length - 1)
  const given = words.slice(0, givenCount)
  const surname = words[givenCount]
  const display = `${given.join(" ")} ${surname.charAt(0).toUpperCase()}.`
  const initials = `${given[0].charAt(0)}${surname.charAt(0)}`.toUpperCase()
  return { display, initials }
}

// ─── Avatar circular con iniciales ──────────────────────────────────────────────
export function EmployeeAvatarInitials({ nombre, className }: { nombre: string; className?: string }) {
  const { initials } = abbreviateEmployeeName(nombre)
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-bold text-teal-700 ring-1 ring-teal-200/70",
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  )
}

// ─── Card de indicador superior (KPI) ───────────────────────────────────────────
export function AttendanceSummaryCard({
  icon, label, value, sub, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone: "teal" | "coral" | "blue"
}) {
  const ring = tone === "teal" ? "bg-teal-50 text-teal-600" : tone === "coral" ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", ring)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-lg font-black leading-none tracking-tight text-slate-800">{value}</div>
        <div className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          {label}{sub && <span className="normal-case font-normal"> · {sub}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Leyenda ────────────────────────────────────────────────────────────────────
export function AttendanceLegend() {
  return (
    <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px]" style={{ background: TEAL }} />Asistencias</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px]" style={{ background: CORAL }} />Tardanzas</span>
    </div>
  )
}

// ─── Una barra: track sutil + relleno + número al final del relleno ──────────────
// El número entra DENTRO del relleno cuando la barra es larga (evita desbordar) y
// queda justo al final cuando es corta. Todo en % del mismo ancho → alinea con eje.
function Bar({ value, max, color, textColor, muted }: { value: number; max: number; color: string; textColor: string; muted?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const inside = pct > 84
  return (
    <div className="relative h-4 w-full">
      <div className="absolute inset-0 rounded-full bg-slate-100/80" />
      <div
        className="absolute left-0 top-0 h-4 rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, minWidth: value > 0 ? 6 : 0, background: color }}
      />
      <span
        className={cn("absolute top-1/2 text-[11px] font-bold tabular-nums", muted && "font-semibold")}
        style={{
          left: `${pct}%`,
          transform: inside ? "translate(calc(-100% - 6px), -50%)" : "translate(6px, -50%)",
          color: muted ? "#cbd5e1" : inside ? "#ffffff" : textColor,
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Fila de empleado ───────────────────────────────────────────────────────────
export function EmployeeAttendanceRow({
  emp, max, desde, hasta,
}: {
  emp: EmployeeAttendance
  max: number
  desde: string
  hasta: string
}) {
  const { display } = abbreviateEmployeeName(emp.nombre)
  const alerta = emp.tardanzas >= ALERTA_TARDANZAS
  const tasa = emp.asistencias > 0 ? Math.round((emp.tardanzas / emp.asistencias) * 100) : 0

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "grid grid-cols-1 gap-2 rounded-lg px-2.5 py-2 transition-colors sm:items-center sm:gap-0",
            "sm:grid-cols-[172px_1fr]",
            alerta ? "bg-red-50/70 hover:bg-red-50" : "hover:bg-slate-50",
          )}
        >
          {/* Columna izquierda: avatar + nombre */}
          <div className="flex items-center gap-2.5 overflow-hidden pr-2">
            <EmployeeAvatarInitials nombre={emp.nombre} />
            <span className="truncate text-[13px] font-semibold text-slate-700" title={emp.nombre}>{display}</span>
          </div>
          {/* Barras: asistencias (teal) y tardanzas (coral) */}
          <div className="w-full space-y-1.5">
            <Bar value={emp.asistencias} max={max} color={TEAL} textColor={TEAL_DARK} />
            <Bar value={emp.tardanzas} max={max} color={CORAL} textColor={CORAL_DARK} muted={emp.tardanzas === 0} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        <div className="space-y-0.5 text-xs">
          <div className="font-bold text-slate-100">{emp.nombre}</div>
          <div className="flex items-center justify-between gap-4"><span className="text-slate-300">Asistencias</span><span className="font-semibold text-teal-300">{emp.asistencias}</span></div>
          <div className="flex items-center justify-between gap-4"><span className="text-slate-300">Tardanzas</span><span className="font-semibold text-red-300">{emp.tardanzas}</span></div>
          {emp.tardanzas > 0 && (
            <div className="flex items-center justify-between gap-4"><span className="text-slate-300">Tasa tardanza</span><span className={cn("font-semibold", tasa >= 50 ? "text-red-300" : "text-amber-300")}>{tasa}%</span></div>
          )}
          <div className="pt-0.5 text-[10px] text-slate-400">Período: {desde} a {hasta}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Gráfica principal ──────────────────────────────────────────────────────────
export function AttendanceDelayChart({
  data, desde, hasta, sucursalLabel, onReload, loading,
}: {
  data: EmployeeAttendance[]
  desde: string
  hasta: string
  sucursalLabel?: string
  onReload?: () => void
  loading?: boolean
}) {
  // Orden: asistencias desc → tardanzas desc → nombre asc
  const sorted = useMemo(
    () => [...data].sort(
      (a, b) => b.asistencias - a.asistencias || b.tardanzas - a.tardanzas || a.nombre.localeCompare(b.nombre, "es"),
    ),
    [data],
  )

  const totales = useMemo(() => {
    const asist = data.reduce((s, e) => s + (Number(e.asistencias) || 0), 0)
    const tard = data.reduce((s, e) => s + (Number(e.tardanzas) || 0), 0)
    const empleados = data.length
    const promedio = empleados > 0 ? asist / empleados : 0
    return { asist, tard, empleados, promedio }
  }, [data])

  const max = useMemo(
    () => Math.max(1, ...sorted.map(e => Math.max(Number(e.asistencias) || 0, Number(e.tardanzas) || 0))),
    [sorted],
  )

  // Marcas del eje (enteras, ~6 pasos) — compartidas por barras y gridlines.
  const ticks = useMemo(() => {
    const step = Math.max(1, Math.ceil(max / 6))
    const out: number[] = []
    for (let t = 0; t <= max; t += step) out.push(t)
    if (out[out.length - 1] !== max) out.push(max)
    return out
  }, [max])

  const barLeft = NAME_COL + PAD_X + GAP // borde izquierdo del área de barras (desktop)

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      {/* Encabezado: título + rango a la izquierda, KPIs a la derecha */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="rounded-xl bg-teal-50 p-2 text-teal-600"><BarChart3 className="h-5 w-5" /></div>
          <div>
            <h3 className="text-base font-black tracking-tight text-slate-800">Asistencia y tardanza por empleado</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {desde} a {hasta}{sucursalLabel && sucursalLabel !== "all" ? ` · ${sucursalLabel}` : ""}
            </p>
          </div>
        </div>
        {/* Indicadores superiores */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <AttendanceSummaryCard tone="teal" icon={<Users className="h-4 w-4" />} label="Total asistencias" value={String(totales.asist)} />
          <AttendanceSummaryCard tone="coral" icon={<AlarmClock className="h-4 w-4" />} label="Total tardanzas" value={String(totales.tard)} />
          <AttendanceSummaryCard tone="blue" icon={<BarChart3 className="h-4 w-4" />} label="Promedio / empleado" value={totales.promedio.toFixed(2)} sub="asistencias" />
        </div>
      </div>

      {/* Leyenda a la derecha */}
      <div className="mt-4 flex justify-end">
        <AttendanceLegend />
      </div>

      {/* Cuerpo: filas de empleados con gridlines de fondo */}
      <TooltipProvider delayDuration={120}>
        <div className="relative mt-2">
          {/* Gridlines verticales punteadas alineadas al área de barras (solo desktop) */}
          <div className="pointer-events-none absolute top-0 hidden sm:block" style={{ left: barLeft, right: PAD_X, bottom: 46 }} aria-hidden>
            {ticks.map((t, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-l border-dashed border-slate-200" style={{ left: `${(t / max) * 100}%` }} />
            ))}
          </div>

          <div className="relative space-y-0.5">
            {sorted.map(emp => (
              <EmployeeAttendanceRow key={emp.employee_id} emp={emp} max={max} desde={desde} hasta={hasta} />
            ))}
          </div>

          {/* Eje inferior: marcas numéricas (desktop) */}
          <div className="relative mt-1.5 hidden h-4 sm:block" style={{ marginLeft: barLeft, marginRight: PAD_X }}>
            {ticks.map((t, i) => (
              <span key={i} className="absolute top-0 -translate-x-1/2 text-[10px] font-medium tabular-nums text-slate-400" style={{ left: `${(t / max) * 100}%` }}>{t}</span>
            ))}
          </div>
          {/* Etiqueta del eje */}
          <div className="mt-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:text-left" style={{ marginLeft: barLeft, marginRight: PAD_X }}>
            Número de días
          </div>
        </div>
      </TooltipProvider>

      {onReload && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-500" onClick={onReload} disabled={loading}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", loading && "animate-spin")} />Actualizar
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Estado vacío profesional ───────────────────────────────────────────────────
export function AttendanceDelayEmpty({ desde, hasta, onReload, loading }: { desde: string; hasta: string; onReload?: () => void; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-2.5">
        <div className="rounded-xl bg-teal-50 p-2 text-teal-600"><BarChart3 className="h-5 w-5" /></div>
        <div>
          <h3 className="text-base font-black tracking-tight text-slate-800">Asistencia y tardanza por empleado</h3>
          <p className="mt-0.5 text-xs text-slate-400">{desde} a {hasta}</p>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400"><CalendarClock className="h-7 w-7" /></div>
        <p className="text-sm font-medium text-slate-500">No hay datos de asistencia para este período.</p>
        {onReload && (
          <Button variant="outline" size="sm" onClick={onReload} disabled={loading}>
            <RefreshCw className={cn("mr-1.5 h-4 w-4", loading && "animate-spin")} />Actualizar
          </Button>
        )}
      </div>
    </div>
  )
}
