"use client"

/**
 * Barra de filtros COMPARTIDA de Incentivos de Ventas.
 * Un solo período global (zustand, persistido) para TODO el módulo: al navegar
 * entre pantallas se mantiene (p.ej. Mayo 2026 en Dashboard → sigue en
 * Liquidación/Reportes). Solo consulta/visualiza — nunca recalcula períodos.
 *
 * Uso en cada pantalla:
 *   const { filters, params, label } = useCommissionFilters()
 *   useEffect(() => { void load() }, [filters])   // recargar al aplicar
 *   apiJsonp(url, { action: "...", ...params })
 *   <CommissionFilterBar branches={...} providers={...} />
 */
import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SlidersHorizontal, Eraser, ChevronDown, ChevronUp } from "lucide-react"
import { QUICK_OPTIONS, quickRange, monthBounds, type QuickPeriod } from "@/lib/commission/period"

export const FILTER_MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export interface CommissionFilters {
  quick: string; year: number; month: number; from: string; to: string
  branch: string; provider: string
}

export function defaultCommissionFilters(): CommissionFilters {
  const r = quickRange("mes_actual")
  return { quick: "mes_actual", year: r.year, month: r.month, from: r.from, to: r.to, branch: "", provider: "" }
}

/** Filtros activos + params listos para apiJsonp + etiqueta legible. */
export function useCommissionFilters(): {
  filters: CommissionFilters
  params: Record<string, string>
  label: string
} {
  const stored = useAppStore((s) => s.commissionFilters)
  // MEMOIZADO: sin esto, cuando el store está en null, `defaultCommissionFilters()`
  // devuelve un OBJETO NUEVO en cada render → params/label/load cambian de
  // identidad → el useEffect([load]) de las pantallas re-dispara las consultas en
  // BUCLE INFINITO (machaca el servidor, parpadeo y falsos "sesión inválida").
  const filters = useMemo(() => (stored as CommissionFilters | null) || defaultCommissionFilters(), [stored])
  const params = useMemo(() => {
    const p: Record<string, string> = {}
    // "Todo" = sin filtro de período (el backend consulta todos los meses).
    if (filters.quick !== "todo" && filters.from && filters.to) {
      p.year = String(filters.year)
      p.month = String(filters.month)
      p.from = filters.from
      p.to = filters.to
    }
    if (filters.branch) p.branch = filters.branch
    if (filters.provider) p.provider = filters.provider
    return p
  }, [filters])
  const label = useMemo(() => {
    if (filters.quick === "todo") return "Todo el historial"
    if (filters.quick === "año") return `Todos los meses · ${filters.year}`
    if (filters.quick === "mes_actual" || filters.quick === "mes_anterior" || filters.quick === "mes")
      return `${FILTER_MONTHS[filters.month]} ${filters.year}`
    const q = QUICK_OPTIONS.find((o) => o.id === filters.quick)
    if (filters.quick === "personalizado") return `${filters.from} → ${filters.to}`
    return q ? `${q.label} (${filters.from} → ${filters.to})` : `${filters.from} → ${filters.to}`
  }, [filters])
  return { filters, params, label }
}

export function CommissionFilterBar({
  branches = [],
  providers = [],
  children,
}: {
  branches?: string[]
  providers?: string[]
  /** Filtros extra específicos de la pantalla (selects propios). */
  children?: React.ReactNode
}) {
  const { commissionFilters, setCommissionFilters } = useAppStore()
  const applied = (commissionFilters as CommissionFilters | null) || defaultCommissionFilters()
  const [draft, setDraft] = useState<CommissionFilters>(applied)
  const [openMobile, setOpenMobile] = useState(false)

  // AUTO-APLICAR: seleccionar un valor procesa al instante (sin botón Buscar).
  const apply = (f: CommissionFilters) => setCommissionFilters({ ...f })
  const update = (patch: Partial<CommissionFilters>) => {
    const f = { ...draft, ...patch }
    setDraft(f)
    apply(f)
  }
  // Modelo estándar: Mes (0 = todos los meses del año) + Año ("todos" = historial).
  const setMes = (m: number) => {
    const y = draft.year || new Date().getFullYear()
    if (m === 0) update({ quick: "año", month: 0, year: y, from: `${y}-01-01`, to: `${y}-12-31` })
    else { const r = monthBounds(y, m); update({ quick: "mes", year: y, month: m, from: r.from, to: r.to }) }
  }
  const setAño = (v: string) => {
    if (v === "todos") { update({ quick: "todo", from: "", to: "" }); return }
    const y = Number(v)
    if (draft.quick === "todo" || draft.quick === "año" || !draft.month) {
      update({ quick: "año", month: 0, year: y, from: `${y}-01-01`, to: `${y}-12-31` })
    } else {
      const r = monthBounds(y, draft.month)
      update({ quick: "mes", year: y, month: draft.month, from: r.from, to: r.to })
    }
  }
  // Desde/Hasta (Personalizado): aplica solo cuando ambos son válidos y coherentes.
  const setRange = (patch: { from?: string; to?: string }) => {
    const f = { ...draft, ...patch, quick: "personalizado" }
    setDraft(f)
    if (f.from && f.to && f.from <= f.to) apply(f)
  }
  const clear = () => { const f = defaultCommissionFilters(); setDraft(f); apply(f) }

  const activeCount = (applied.branch ? 1 : 0) + (applied.provider ? 1 : 0) + 1
  const yearNow = new Date().getFullYear()
  const { label } = useCommissionFilters()

  return (
    <Card className="border-[color:var(--brand-border)]">
      <CardContent className="space-y-2 p-3">
        {/* Encabezado + chips de filtros activos (siempre visibles) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className="flex items-center gap-1.5 text-sm font-semibold sm:cursor-default"
            onClick={() => setOpenMobile((o) => !o)}
          >
            <SlidersHorizontal className="h-4 w-4 text-[color:var(--brand-primary)]" />
            Filtros ({activeCount})
            <span className="sm:hidden">{openMobile ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
          </button>
          <Badge variant="outline" className="bg-cyan-50 text-cyan-800 border-cyan-200">{label}</Badge>
          {applied.branch ? <Badge variant="outline" className="bg-slate-50">{applied.branch}</Badge> : null}
          {applied.provider ? <Badge variant="outline" className="bg-slate-50">{applied.provider}</Badge> : null}
          <button onClick={clear} className="ml-auto text-[11px] font-medium text-slate-500 underline-offset-2 hover:underline">Limpiar todo</button>
        </div>

        {/* Controles (modelo estándar del módulo: Mes + Año [+ Sucursal/Prestador]) */}
        <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6", openMobile ? "" : "hidden sm:grid")}>
          <div>
            <Label className="text-[11px]">Mes</Label>
            <Select
              value={draft.quick === "todo" || draft.quick === "año" || draft.quick === "personalizado" ? "0" : String(draft.month)}
              onValueChange={(v) => setMes(Number(v))}
            >
              <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Todos los meses</SelectItem>
                {FILTER_MONTHS.slice(1).map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Año</Label>
            <Select value={draft.quick === "todo" ? "todos" : String(draft.year)} onValueChange={setAño}>
              <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos (historial)</SelectItem>
                {[yearNow + 1, yearNow, yearNow - 1, yearNow - 2].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Desde <span className="text-muted-foreground">(rango)</span></Label>
            <Input type="date" className="mt-0.5 h-9" value={draft.from} onChange={(e) => setRange({ from: e.target.value })} />
          </div>
          <div>
            <Label className="text-[11px]">Hasta <span className="text-muted-foreground">(rango)</span></Label>
            <Input type="date" className="mt-0.5 h-9" value={draft.to} onChange={(e) => setRange({ to: e.target.value })} />
          </div>
          {branches.length ? (
            <div>
              <Label className="text-[11px]">Sucursal</Label>
              <Select value={draft.branch || "todas"} onValueChange={(v) => update({ branch: v === "todas" ? "" : v })}>
                <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {providers.length ? (
            <div>
              <Label className="text-[11px]">Prestador</Label>
              <Select value={draft.provider || "todos"} onValueChange={(v) => update({ provider: v === "todos" ? "" : v })}>
                <SelectTrigger className="mt-0.5 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {providers.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {children}
          <div className="flex items-end">
            <Button variant="outline" className="h-9 w-full" onClick={clear}><Eraser className="mr-1.5 h-4 w-4" />Limpiar</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
