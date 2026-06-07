"use client"

/**
 * Page Kit — componentes base reutilizables para un look SaaS premium consistente
 * en todo el sistema (RR.HH., PulseControl, Mantenimiento, Clientes).
 * Identidad: turquesa/teal (primary), fondo suave, cards blancas, bordes
 * redondeados, sombras suaves. Aditivo: no reemplaza nada existente.
 */
import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Cabecera de página estándar: ícono, sección, título, descripción y acciones. */
export function PageHeader({ icon: Icon, title, section, description, actions, badge }: {
  icon?: LucideIcon; title: string; section?: string; description?: string
  actions?: React.ReactNode; badge?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        {Icon && <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0"><Icon className="h-6 w-6" /></div>}
        <div className="min-w-0">
          {section && <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{section}</p>}
          <div className="flex items-center gap-2"><h2 className="mt-0.5 text-xl font-black tracking-tight truncate">{title}</h2>{badge}</div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Tarjeta de sección con título, ícono y descripción opcional. */
export function SectionCard({ icon: Icon, title, description, actions, children, className }: {
  icon?: LucideIcon; title?: string; description?: string; actions?: React.ReactNode
  children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="h-4 w-4 text-primary shrink-0" />}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-bold truncate">{title}</h3>}
              {description && <p className="text-xs text-muted-foreground truncate">{description}</p>}
            </div>
          </div>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

const STAT_TONE: Record<string, string> = {
  default: "text-foreground", primary: "text-primary", green: "text-emerald-600",
  amber: "text-amber-600", red: "text-red-600", blue: "text-blue-600", indigo: "text-indigo-600",
}
/** Tarjeta KPI compacta. */
export function StatCard({ label, value, tone = "default", icon: Icon }: {
  label: string; value: React.ReactNode; tone?: keyof typeof STAT_TONE; icon?: LucideIcon
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/60" />}
      </div>
      <div className={cn("mt-1 text-2xl font-black tabular-nums", STAT_TONE[tone] || STAT_TONE.default)}>{value}</div>
    </div>
  )
}

/** Badge de estado con mapa de colores. */
export function StatusBadge({ status, map, className }: {
  status: string; map?: Record<string, string>; className?: string
}) {
  const cls = (map && map[status]) || "bg-slate-100 text-slate-700 border-slate-200"
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", cls, className)}>{status}</span>
}

/** Chip del tenant/negocio activo. */
export function TenantBadge({ name, className }: { name: string; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary", className)}>{name}</span>
}

/** Estado vacío profesional. */
export function EmptyState({ icon: Icon, title, description, action }: {
  icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
      {Icon && <div className="rounded-full bg-muted p-3 text-muted-foreground mb-3"><Icon className="h-6 w-6" /></div>}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Sección de formulario dentro de un modal: título, ícono, grid responsive. */
export function FormSection({ icon: Icon, title, description, cols = 2, children, className }: {
  icon?: LucideIcon; title: string; description?: string; cols?: 1 | 2 | 3; children: React.ReactNode; className?: string
}) {
  const grid = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"
  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <div><h4 className="text-sm font-semibold">{title}</h4>{description && <p className="text-[11px] text-muted-foreground">{description}</p>}</div>
      </div>
      <div className={cn("grid gap-3 p-3", grid)}>{children}</div>
    </div>
  )
}

/** Footer de acciones fijo (sticky) para modales/formularios largos. */
export function ActionFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("sticky bottom-0 z-10 -mx-6 mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-6 py-3 backdrop-blur", className)}>
      {children}
    </div>
  )
}

/** Indicador de progreso por pasos (con íconos). */
export function StepProgress({ steps, current }: {
  steps: { label: string; icon?: LucideIcon }[]; current: number
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {steps.map((s, i) => {
        const done = i < current, active = i === current
        return (
          <React.Fragment key={s.label}>
            <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs whitespace-nowrap",
              active ? "bg-primary text-primary-foreground font-semibold" : done ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
              {s.icon && <s.icon className="h-3.5 w-3.5" />}{s.label}
            </div>
            {i < steps.length - 1 && <div className={cn("h-px w-3 shrink-0", done ? "bg-primary" : "bg-border")} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}
