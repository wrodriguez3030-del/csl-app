"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCard } from "@/components/kpi-card"
import { Badge } from "@/components/ui/badge"
import { Activity, AlertTriangle, BarChart3, Users, Wrench, Zap } from "lucide-react"
import { fmtN } from "@/lib/fmt"
import { signedColorClassDark, getAlerta } from "@/lib/pulse-colors"

export function PulseControlDashboardPage() {
  const { dbPulsos } = useAppStore()
  const stats = useMemo(() => {
    // Fuente PRIMARIA: csl_pulse_readings (alimentada por Cuadre Semanal).
    // Fallback: lecturasSemanales legacy + sesionesCliente para datos viejos.
    const readings = dbPulsos.pulseReadings ?? []
    const laserFromReadings = readings.reduce((s, r) => s + (Number(r.disp_laser) || 0), 0)
    const opFromReadings = readings.reduce((s, r) => s + (Number(r.disp_operador) || 0), 0)

    const laserLegacy = dbPulsos.lecturasSemanales.reduce((s, l) => s + (Number(l.DiferenciaReal) || 0), 0)
    const opLegacy = dbPulsos.sesionesCliente.reduce((s, s2) => s + (Number(s2.DisparosReportados) || 0), 0)

    const disparosLaser = laserFromReadings || laserLegacy
    const disparosOperador = opFromReadings || opLegacy
    const diferencia = disparosOperador - disparosLaser

    const semanasFromReadings = readings.map(r => String(r.period_start || "").split("T")[0]).filter(Boolean)
    const semanasLegacy = dbPulsos.lecturasSemanales.map(l => String(l.FechaSemana || "").split("T")[0]).filter(Boolean)
    const semanas = Array.from(new Set([...semanasFromReadings, ...semanasLegacy])).sort().reverse()

    // Críticas: usa getAlerta() (fuente única) — Crítico = |pct| > 15
    const criticasFromReadings = readings.filter(r => getAlerta(Number(r.diferencia_pct) || 0) === "Critico").length
    const criticasLegacy = dbPulsos.auditoriasSemanales.filter(a => a.Alerta === "Critico").length
    const criticas = criticasFromReadings || criticasLegacy

    return { disparosLaser, disparosOperador, diferencia, semanas, criticas }
  }, [dbPulsos])

  return (
    <div className="csl-page-shell">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_rgba(15,45,68,.09)]">
        <div className="absolute right-8 top-8 hidden h-24 w-24 rounded-full border border-cyan-300/20 bg-cyan-300/10 blur-sm md:block" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="csl-kicker">Módulo láser</span>
            <span className="csl-new-badge">NEW</span>
          </div>
          <h2 className="mt-2 font-heading text-3xl font-black tracking-tight md:text-5xl">PulseControl CSL</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Control semanal de pantallas, operadoras, disparos reportados y auditoría automática para los equipos GentleYAG.
          </p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Equipos GentleYAG" value={11} icon={Wrench} variant="primary" description="Equipos dentro del control láser" />
        <KpiCard title="Operadoras" value={dbPulsos.operadoras.length} icon={Users} variant="success" description="Activas e históricas" />
        <KpiCard title="Disp. láser" value={stats.disparosLaser} icon={Zap} variant="warning" description="Según lectura de pantalla" />
        <KpiCard title="Críticos" value={stats.criticas} icon={AlertTriangle} variant="destructive" description="Desviaciones relevantes" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl"><BarChart3 className="h-5 w-5 text-primary" />Balance de disparos</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-4">
              <MetricLine label="Disp. láser" value={stats.disparosLaser} />
              <MetricLine label="Disp. operador" value={stats.disparosOperador} />
              <MetricLine label="Diferencia" value={stats.diferencia} highlight />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl"><Activity className="h-5 w-5 text-primary" />Últimas semanas registradas</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex flex-wrap gap-2">
              {stats.semanas.length ? stats.semanas.slice(0, 10).map((semana) => (
                <Badge key={semana} className="border-primary/20 bg-primary/10 px-3 py-1.5 text-primary">{formatDate(semana)}</Badge>
              )) : <span className="text-sm text-muted-foreground">Sin lecturas semanales registradas.</span>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricLine({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white shadow-sm px-4 py-3">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <span className={`font-heading text-2xl font-black ${highlight ? signedColorClassDark(value) : "text-slate-950"}`}>
        {fmtN(value)}
      </span>
    </div>
  )
}

function formatDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}
