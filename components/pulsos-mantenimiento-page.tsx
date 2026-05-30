"use client"

import { useCallback, useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { KpiCard } from "@/components/kpi-card"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Printer,
  Stethoscope,
  TrendingUp,
  Wrench,
  Zap,
} from "lucide-react"

// ── Semáforo ─────────────────────────────────────────────────────────────────
// Umbrales por pulsos acumulados (LecturaFinal más reciente por equipo).
// <1M  = Excelente | 1-3M = Muy Bueno | 3-6M = Vigilancia | >6M = Crítico

type SemaforoLevel = "excelente" | "muy-bueno" | "vigilancia" | "critico"

interface SemaforoConfig {
  label: string
  colorClass: string
  badgeClass: string
  bgClass: string
}

const SEMAFORO: Record<SemaforoLevel, SemaforoConfig> = {
  excelente: {
    label: "Excelente",
    colorClass: "text-emerald-700",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bgClass: "bg-emerald-500",
  },
  "muy-bueno": {
    label: "Muy Bueno",
    colorClass: "text-cyan-700",
    badgeClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
    bgClass: "bg-cyan-500",
  },
  vigilancia: {
    label: "Vigilancia",
    colorClass: "text-amber-700",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    bgClass: "bg-amber-500",
  },
  critico: {
    label: "Crítico",
    colorClass: "text-rose-700",
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
    bgClass: "bg-rose-500",
  },
}

function getSemaforo(pulsos: number): SemaforoLevel {
  if (pulsos < 1_000_000) return "excelente"
  if (pulsos < 3_000_000) return "muy-bueno"
  if (pulsos < 6_000_000) return "vigilancia"
  return "critico"
}

function fmtPulsos(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString("es-DO")
}

function fmtFecha(value?: string) {
  if (!value) return "—"
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PulsosMantenimientoPage() {
  const { db, dbPulsos } = useAppStore()
  const [showAllAlertas, setShowAllAlertas] = useState(false)
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  // Filas de equipos activos enriquecidas con semáforo.
  // Fuente: P_Cabeza del equipo (pulsos acumulados en cabeza registrados manualmente).
  const equipoRows = useMemo(() => {
    const rows = db.equipos
      .filter((e) => e.Estado === "Activo")
      .map((e) => {
        const pulsos = Number(e.P_Cabeza || 0)
        return { ...e, pulsos, semaforo: getSemaforo(pulsos) }
      })
    return rows.sort((a, b) =>
      sortDir === "desc" ? b.pulsos - a.pulsos : a.pulsos - b.pulsos,
    )
  }, [db.equipos, sortDir])

  // KPIs agregados
  const stats = useMemo(() => {
    const total = equipoRows.length
    const conLecturas = equipoRows.filter((e) => e.pulsos > 0)
    const evaluados = conLecturas.length
    const criticos = equipoRows.filter((e) => e.semaforo === "critico").length
    const vigilancia = equipoRows.filter((e) => e.semaforo === "vigilancia").length
    const promedio =
      evaluados > 0
        ? Math.round(conLecturas.reduce((s, e) => s + e.pulsos, 0) / evaluados)
        : 0
    return { total, evaluados, criticos, vigilancia, promedio }
  }, [equipoRows])

  // Resumen por sucursal
  const porSucursal = useMemo(() => {
    const map = new Map<string, { total: number; criticos: number; vigilancia: number }>()
    for (const e of equipoRows) {
      const s = e.Sucursal || "Sin sucursal"
      const cur = map.get(s) ?? { total: 0, criticos: 0, vigilancia: 0 }
      cur.total++
      if (e.semaforo === "critico") cur.criticos++
      if (e.semaforo === "vigilancia") cur.vigilancia++
      map.set(s, cur)
    }
    return Array.from(map.entries())
      .map(([nombre, data]) => ({ nombre, ...data }))
      .sort((a, b) => b.criticos - a.criticos || b.vigilancia - a.vigilancia)
  }, [equipoRows])

  // Alertas de auditoría (Advertencia + Crítico), más recientes primero
  const alertas = useMemo(
    () =>
      dbPulsos.auditoriasSemanales
        .filter((a) => a.Alerta === "Critico" || a.Alerta === "Advertencia")
        .sort((a, b) => String(b.FechaSemana).localeCompare(String(a.FechaSemana))),
    [dbPulsos.auditoriasSemanales],
  )

  const alertasVisible = showAllAlertas ? alertas : alertas.slice(0, 6)

  // Plan de acción automático basado en semáforo
  const planAccion = useMemo(() => {
    return equipoRows
      .filter((e) => e.semaforo === "critico" || e.semaforo === "vigilancia")
      .map((e) => ({
        equipo: e.EquipoID,
        sucursal: e.Sucursal,
        nivel: e.semaforo as "critico" | "vigilancia",
        accion:
          e.semaforo === "critico"
            ? `Revisión inmediata de cabezal y componentes de alta exposición. ${fmtPulsos(e.pulsos)} pulsos acumulados superan el umbral crítico (6M).`
            : `Programar mantenimiento preventivo en las próximas 2 semanas. ${fmtPulsos(e.pulsos)} pulsos en zona de vigilancia (3M–6M).`,
      }))
  }, [equipoRows])

  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  if (equipoRows.length === 0) {
    return (
      <div className="csl-page-shell">
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Wrench className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p>Sin datos de equipos. Conecta y recarga para ver el dashboard.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="csl-page-shell print:p-0">
      {/* Hero (oculto en impresión) */}
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_rgba(15,45,68,.09)] print:hidden">
        <div className="absolute right-8 top-8 hidden h-24 w-24 rounded-full border border-cyan-300/20 bg-cyan-300/10 blur-sm md:block" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <span className="csl-kicker">Módulo mantenimiento</span>
            <h2 className="mt-2 font-heading text-3xl font-black tracking-tight md:text-5xl">Dashboard Mantenimiento</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Semáforo de equipos por pulsos acumulados, ranking de uso, alertas de auditoría y plan de acción automático para los equipos GentleYAG.
            </p>
          </div>
          <Button variant="outline" className="shrink-0 gap-2" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar PDF</span>
          </Button>
        </div>
      </section>

      {/* Cabecera de impresión (solo visible al imprimir) */}
      <div className="hidden print:block mb-6">
        <div className="flex items-center gap-3 border-b pb-4">
          <Stethoscope className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-black">Dashboard Mantenimiento — GentleYAG</h1>
            <p className="text-xs text-slate-500">
              Generado el{" "}
              {new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })}
            </p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Equipos activos"
          value={stats.total}
          icon={Wrench}
          variant="primary"
          description={`${stats.evaluados} con lecturas registradas`}
        />
        <KpiCard
          title="Promedio pulsos"
          value={fmtPulsos(stats.promedio)}
          icon={Zap}
          variant="success"
          description="Promedio acumulado por equipo"
        />
        <KpiCard
          title="En vigilancia"
          value={stats.vigilancia}
          icon={Activity}
          variant="warning"
          description="3M – 6M pulsos acumulados"
        />
        <KpiCard
          title="Críticos"
          value={stats.criticos}
          icon={AlertTriangle}
          variant="destructive"
          description="> 6M pulsos acumulados"
        />
      </div>

      {/* Distribución + resumen por sucursal */}
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Distribución semáforo */}
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <TrendingUp className="h-5 w-5 text-primary" />
              Distribución por estado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {(["excelente", "muy-bueno", "vigilancia", "critico"] as SemaforoLevel[]).map((level) => {
              const count = equipoRows.filter((e) => e.semaforo === level).length
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
              const cfg = SEMAFORO[level]
              return (
                <div key={level} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className={`font-bold ${cfg.colorClass}`}>{cfg.label}</span>
                    <span className="text-muted-foreground">
                      {count} equipo{count !== 1 ? "s" : ""} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all ${cfg.bgClass}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Resumen por sucursal */}
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Resumen por sucursal
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">Vigilancia</TableHead>
                  <TableHead className="text-center">Críticos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {porSucursal.map((s) => (
                  <TableRow key={s.nombre}>
                    <TableCell className="font-bold">{s.nombre}</TableCell>
                    <TableCell className="text-center">{s.total}</TableCell>
                    <TableCell className="text-center">
                      {s.vigilancia > 0 ? (
                        <Badge className={SEMAFORO.vigilancia.badgeClass}>{s.vigilancia}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {s.criticos > 0 ? (
                        <Badge className={SEMAFORO.critico.badgeClass}>{s.criticos}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Ranking de equipos */}
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Stethoscope className="h-5 w-5 text-primary" />
              Ranking — pulsos acumulados
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs text-muted-foreground print:hidden"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              {sortDir === "desc" ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              {sortDir === "desc" ? "Mayor → Menor" : "Menor → Mayor"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Cabina</TableHead>
                <TableHead className="text-right">Pulsos acum.</TableHead>
                <TableHead className="text-center">Semáforo</TableHead>
                <TableHead className="text-right">P. Totales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipoRows.map((e, i) => {
                const cfg = SEMAFORO[e.semaforo]
                return (
                  <TableRow key={e.EquipoID}>
                    <TableCell className="text-center">
                      <SeqBadge n={i + 1} />
                    </TableCell>
                    <TableCell className="font-black">{e.EquipoID}</TableCell>
                    <TableCell>{e.Sucursal}</TableCell>
                    <TableCell className="text-muted-foreground">{e.Modelo}</TableCell>
                    <TableCell className="text-muted-foreground">{e.Cabina || "—"}</TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {e.pulsos > 0 ? fmtPulsos(e.pulsos) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={cfg.badgeClass}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">
                      {e.P_Totales ? fmtPulsos(Number(e.P_Totales)) : "—"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Alertas de auditoría */}
      {alertas.length > 0 && (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Alertas de auditoría
              <Badge className="ml-2 border-amber-200 bg-amber-50 text-amber-700">
                {alertas.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Semana</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead className="text-right">Pulsos láser</TableHead>
                  <TableHead className="text-right">Pulsos operador</TableHead>
                  <TableHead className="text-right">Desv. %</TableHead>
                  <TableHead className="text-center">Alerta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertasVisible.map((a, i) => (
                  <TableRow key={a.AuditoriaID}>
                    <TableCell className="text-center">
                      <SeqBadge n={i + 1} />
                    </TableCell>
                    <TableCell>{fmtFecha(a.FechaSemana)}</TableCell>
                    <TableCell className="font-black">{a.EquipoID}</TableCell>
                    <TableCell>{a.Sucursal}</TableCell>
                    <TableCell className="text-right font-mono">
                      {a.PulsosReales.toLocaleString("es-DO")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {a.PulsosReportados.toLocaleString("es-DO")}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span
                        className={
                          a.PorcentajeDesviacion > 20
                            ? "font-bold text-rose-600"
                            : "text-amber-600"
                        }
                      >
                        {a.PorcentajeDesviacion.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={
                          a.Alerta === "Critico"
                            ? SEMAFORO.critico.badgeClass
                            : SEMAFORO.vigilancia.badgeClass
                        }
                      >
                        {a.Alerta}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {alertas.length > 6 && (
              <div className="p-3 text-center print:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => setShowAllAlertas((v) => !v)}
                >
                  {showAllAlertas ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  {showAllAlertas ? "Ver menos" : `Ver ${alertas.length - 6} más`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan de acción automático */}
      {planAccion.length > 0 && (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Wrench className="h-5 w-5 text-primary" />
              Plan de acción automático
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {planAccion.map((p, i) => (
              <div
                key={i}
                className={`flex gap-3 rounded-xl border p-4 ${
                  p.nivel === "critico"
                    ? "border-rose-200 bg-rose-50/60"
                    : "border-amber-200 bg-amber-50/60"
                }`}
              >
                <Badge className={`${SEMAFORO[p.nivel].badgeClass} mt-0.5 shrink-0 self-start`}>
                  {p.nivel === "critico" ? "URGENTE" : "PREVENTIVO"}
                </Badge>
                <div>
                  <p className="text-sm font-black">
                    {p.equipo} · {p.sucursal}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.accion}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
