"use client"

import { type ReactNode, type ComponentType } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Construction, Sparkles, type LucideIcon } from "lucide-react"

/**
 * Shell visual compartido para los módulos de Recursos Humanos que aún
 * están en construcción. Mantiene la misma estética del sistema (cards
 * blancas, borde redondeado, color corporativo) sin requerir lógica
 * funcional todavía.
 *
 * Cada página individual del menú RR.HH. importa este shell y le pasa:
 *   - icon: Lucide icon component
 *   - title: nombre del módulo
 *   - section: a qué grupo pertenece (Personal/Asistencia/...)
 *   - phase: número de fase (Fase 1-6)
 *   - description: 1-2 líneas
 *   - features: lista de capacidades planeadas
 *   - children: contenido custom si el módulo ya tiene CRUD
 */

export type HrPhase = 1 | 2 | 3 | 4 | 5 | 6

const PHASE_LABELS: Record<HrPhase, string> = {
  1: "Fase 1 · Base RR.HH.",
  2: "Fase 2 · Ponche y asistencia",
  3: "Fase 3 · Nómina y pagos",
  4: "Fase 4 · Liquidaciones RD",
  5: "Fase 5 · Gestión avanzada",
  6: "Fase 6 · Analítica",
}

const PHASE_BADGE_CLASS: Record<HrPhase, string> = {
  1: "bg-emerald-100 text-emerald-700 border-emerald-200",
  2: "bg-blue-100 text-blue-700 border-blue-200",
  3: "bg-violet-100 text-violet-700 border-violet-200",
  4: "bg-amber-100 text-amber-700 border-amber-200",
  5: "bg-rose-100 text-rose-700 border-rose-200",
  6: "bg-slate-100 text-slate-700 border-slate-200",
}

export interface HrPageShellProps {
  icon: LucideIcon | ComponentType<{ className?: string }>
  title: string
  section: string
  phase: HrPhase
  description: string
  features?: string[]
  children?: ReactNode
}

export function HrPageShell({
  icon: Icon,
  title,
  section,
  phase,
  description,
  features,
  children,
}: HrPageShellProps) {
  return (
    <div className="space-y-4">
      {/* Header del módulo */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{section}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">{description}</p>
          </div>
        </div>
        <Badge variant="outline" className={`${PHASE_BADGE_CLASS[phase]} font-semibold`}>
          {PHASE_LABELS[phase]}
        </Badge>
      </div>

      {/* Contenido custom o lista de funcionalidades planeadas */}
      {children ?? <HrPhasePlaceholder phase={phase} features={features} />}
    </div>
  )
}

function HrPhasePlaceholder({ phase, features }: { phase: HrPhase; features?: string[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Construction className="h-4 w-4 text-amber-600" />
            En implementación
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Este módulo forma parte de <strong>{PHASE_LABELS[phase]}</strong> del plan de Recursos Humanos.
          </p>
          <p>
            La estructura, ruta, permisos y modelo de datos están listos. La interfaz funcional se
            entregará en la fase correspondiente sin requerir migración adicional al menú.
          </p>
        </CardContent>
      </Card>

      {features && features.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              Funcionalidades planeadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
