"use client"

/**
 * KPI card compartida — estilo EJECUTIVO (el del dashboard de Comisión de
 * Ventas): tarjeta blanca redondeada con chip de ícono a la izquierda, label
 * en mayúsculas pequeñas, valor grande tabular y nota opcional. La usan todos
 * los dashboards (panel, materiales, compras, pulse, RR.HH., comisión).
 */
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "lucide-react"
import { fmtN } from "@/lib/fmt"

interface KpiCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  variant?: "primary" | "success" | "warning" | "destructive"
  description?: string
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  variant = "primary",
  description,
}: KpiCardProps) {
  // El chip lleva el tono (estado); el texto SIEMPRE usa tinta neutra.
  const chipStyles = {
    primary: "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary)]",
    success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600",
    destructive: "bg-rose-50 text-rose-600",
  }

  return (
    <Card className="rounded-2xl border-[color:var(--brand-border)] py-0 shadow-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <div className={cn("shrink-0 rounded-xl p-2.5", chipStyles[variant])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="truncate text-lg font-black tabular-nums text-[color:var(--brand-primary-dark)]">
            {typeof value === "number" ? fmtN(value) : value}
          </div>
          {description ? <div className="mt-1 text-[11px] text-muted-foreground">{description}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}
