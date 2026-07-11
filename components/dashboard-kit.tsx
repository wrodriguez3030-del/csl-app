"use client"

/**
 * KIT compartido de dashboards — el estilo EJECUTIVO del dashboard de Comisión
 * de Ventas, extraído para reutilizarlo en todos los dashboards del sistema
 * (compras, materiales, mantenimiento, pulse, RR.HH.).
 *
 * Paleta categórica VALIDADA (dataviz · validate_palette.js, todas PASS):
 *   teal #0D9488 · ámbar #D97706 · violeta #7C3AED · rosa #DB2777
 * Reglas: hues en orden fijo (nunca ciclar); texto SIEMPRE en tinta neutra;
 * estados (bien/alerta/crítico) usan la paleta de STATUS, no la categórica.
 */
import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"

export const CHART_COLORS = ["#0D9488", "#D97706", "#7C3AED", "#DB2777"] as const
export const CHART_TEAL = CHART_COLORS[0]

/** Colores de ESTADO (reservados; nunca usarlos como "serie 5"). */
export const STATUS_COLORS: Record<string, string> = {
  good: "#059669",     // emerald-600
  warning: "#D97706",  // amber-600
  serious: "#EA580C",  // orange-600
  critical: "#E11D48", // rose-600
  neutral: "#64748B",  // slate-500
}

/** Props recesivos para ejes/grid de recharts (grid punteado, sin axis line). */
export const AXIS_TICK = { fontSize: 10, fill: "#64748B" }
export const AXIS_TICK_MUTED = { fontSize: 10, fill: "#94A3B8" }
export const GRID_STROKE = "#E2E8F0"
export const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8 } as const

export const fmtCompactRD = (n: number) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e6) return `RD$${(v / 1e6).toFixed(2)}M`
  if (Math.abs(v) >= 1e3) return `RD$${Math.round(v / 1e3)}K`
  return `RD$${Math.round(v)}`
}

/** Encabezado de página de dashboard (título + subtítulo). */
export function DashHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-xl font-black text-[color:var(--brand-primary-dark)]">{title}</h1>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  )
}

/** Panel con título + acción "Ver detalle →" (contenedor de charts/tablas/listas). */
export function DashPanel({ title, action, onAction, children, className = "" }: {
  title: string; action?: string; onAction?: () => void; children: ReactNode; className?: string
}) {
  return (
    <Card className={`rounded-2xl border-[color:var(--brand-border)] py-0 shadow-sm ${className}`}>
      <CardContent className="flex h-full flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[color:var(--brand-primary-dark)]">{title}</h3>
          {action && onAction ? (
            <button onClick={onAction} className="whitespace-nowrap text-xs font-semibold text-[color:var(--brand-primary)] underline-offset-2 hover:underline">{action} →</button>
          ) : null}
        </div>
        <div className="flex-1">{children}</div>
      </CardContent>
    </Card>
  )
}

export const EmptyChart = ({ text = "Sin datos en el período seleccionado." }: { text?: string }) => (
  <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">{text}</div>
)

/** Ítem de insight (chip de estado + título + detalle) — nunca color solo. */
export function InsightItem({ tone, title, detail, icon }: {
  tone: "success" | "info" | "warning"; title: string; detail?: string; icon: ReactNode
}) {
  const cls = tone === "success" ? "bg-emerald-50 text-emerald-600"
    : tone === "warning" ? "bg-amber-50 text-amber-600"
    : "bg-sky-50 text-sky-600"
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 shrink-0 rounded-full p-1.5 ${cls}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-snug">{title}</div>
        {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  )
}

/** Fila de skeleton para carga (mismas proporciones que las KPI cards). */
export function DashSkeletonRow({ n, h = "h-[92px]", cols = "sm:grid-cols-2 lg:grid-cols-4" }: { n: number; h?: string; cols?: string }) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${cols}`}>
      {Array.from({ length: n }).map((_, i) => <div key={i} className={`${h} animate-pulse rounded-2xl bg-slate-100`} />)}
    </div>
  )
}
