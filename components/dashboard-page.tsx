"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCard } from "@/components/kpi-card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Activity, AlertTriangle, BarChart3, ClipboardList, Cog, ShieldCheck, Wrench, Zap } from "lucide-react"
import type { PiezaIntervenida } from "@/lib/types"

function parsePiezas(json: string | undefined): PiezaIntervenida[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-"
  const raw = String(dateStr).split("T")[0]
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  try {
    return new Date(dateStr).toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" })
  } catch {
    return dateStr
  }
}

export function DashboardPage() {
  const { db, dbPulsos } = useAppStore()

  const stats = useMemo(() => {
    const nowMonth = new Date().toISOString().slice(0, 7)
    const reportesMes = db.reportes.filter((r) => String(r.Fecha || "").slice(0, 7) === nowMonth)
    const preventivos = db.reportes.filter((r) => String(r.Tipo || "").toLowerCase().includes("prevent")).length
    const correctivos = db.reportes.filter((r) => String(r.Tipo || "").toLowerCase().includes("correct")).length
    const activos = db.equipos.filter((e) => String(e.Estado || "Activo").toLowerCase() === "activo").length
    const alertas = db.equipos.filter((e) => Number(e.P_Cabeza || 0) >= Number(e.Max_Cabeza || 6000000) * 0.8)

    const countEq: Record<string, number> = {}
    const lastEq: Record<string, string> = {}
    const piezasCount: Record<string, { usos: number; reemplazos: number }> = {}

    db.reportes.forEach((reporte) => {
      const equipo = reporte.EquipoID || "Sin equipo"
      countEq[equipo] = (countEq[equipo] || 0) + 1
      if (!lastEq[equipo] || String(reporte.Fecha) > String(lastEq[equipo])) lastEq[equipo] = reporte.Fecha

      parsePiezas(reporte.PiezasJSON).forEach((pieza) => {
        const key = pieza.pieza || "Sin pieza"
        if (!piezasCount[key]) piezasCount[key] = { usos: 0, reemplazos: 0 }
        piezasCount[key].usos++
        if (String(pieza.reemplazo || "").toLowerCase().startsWith("s")) piezasCount[key].reemplazos++
      })
    })

    const topEquipos = Object.entries(countEq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([equipoId, count]) => ({ equipoId, count, lastDate: lastEq[equipoId] }))

    const topPiezas = Object.entries(piezasCount)
      .sort((a, b) => b[1].usos - a[1].usos)
      .slice(0, 6)
      .map(([pieza, item]) => ({ pieza, ...item }))

    const pulseReal = dbPulsos.lecturasSemanales.reduce((sum, item) => sum + Number(item.DiferenciaReal || 0), 0)
    const pulseReportado = dbPulsos.sesionesCliente.reduce((sum, item) => sum + Number(item.DisparosReportados || 0), 0)

    return { reportesMes, preventivos, correctivos, activos, alertas, topEquipos, topPiezas, pulseReal, pulseReportado }
  }, [db, dbPulsos])

  return (
    <div className="csl-page-shell">
      <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_22px_70px_rgba(15,45,68,.09)]">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-100 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[1.35fr_.65fr] lg:items-end">
          <div>
            <p className="csl-kicker">Panel ejecutivo</p>
            <h2 className="mt-2 font-heading text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
              Control operativo Cibao Spa Laser
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Mantenimiento, inventario técnico y PulseControl en una vista limpia para gerencia, administración y técnicos.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniMetric label="Disp. láser" value={stats.pulseReal} icon={<Zap className="h-4 w-4" />} />
            <MiniMetric label="Disp. operador" value={stats.pulseReportado} icon={<Activity className="h-4 w-4" />} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Equipos activos" value={stats.activos} icon={Wrench} variant="primary" description={`${db.equipos.length.toLocaleString("es-DO")} equipos registrados`} />
        <KpiCard title="Reportes este mes" value={stats.reportesMes.length} icon={ClipboardList} variant="success" description="Mantenimientos del mes actual" />
        <KpiCard title="Preventivos" value={stats.preventivos} icon={ShieldCheck} variant="warning" description="Rutinas registradas" />
        <KpiCard title="Correctivos" value={stats.correctivos} icon={AlertTriangle} variant="destructive" description="Incidencias técnicas" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <div>
              <p className="csl-kicker">Tendencia operativa</p>
              <CardTitle className="mt-2 flex items-center gap-2 text-xl">
                <BarChart3 className="h-5 w-5 text-primary" />
                Resumen de mantenimiento
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <ProgressBlock label="Preventivos" value={stats.preventivos} total={db.reportes.length || 1} color="bg-cyan-300" />
              <ProgressBlock label="Correctivos" value={stats.correctivos} total={db.reportes.length || 1} color="bg-rose-300" />
              <ProgressBlock label="Alertas críticas" value={stats.alertas.length} total={db.equipos.length || 1} color="bg-amber-300" />
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
            <CardTitle className="flex items-center gap-2 text-xl">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Alertas críticas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {stats.alertas.length ? (
              <div className="divide-y divide-slate-100">
                {stats.alertas.slice(0, 5).map((equipo) => (
                  <div key={equipo.EquipoID} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div>
                      <div className="font-bold">Equipo {equipo.EquipoID}</div>
                      <div className="text-xs text-muted-foreground">{equipo.Sucursal} · {equipo.Modelo}</div>
                    </div>
                    <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                      {Number(equipo.P_Cabeza || 0).toLocaleString("es-DO")} pulsos
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-muted-foreground">Sin alertas críticas por pulsos.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <ExecutiveTable
          title="Equipos con más mantenimientos"
          headers={["Equipo", "Reportes", "Última fecha"]}
          rows={stats.topEquipos.map((eq) => [<b key="e">{eq.equipoId}</b>, <Badge key="b" variant="secondary">{eq.count.toLocaleString("es-DO")}</Badge>, formatDate(eq.lastDate)])}
          empty="Sin reportes disponibles"
        />
        <ExecutiveTable
          title="Piezas más usadas"
          headers={["Pieza", "Usos", "Reemplazos"]}
          rows={stats.topPiezas.map((pieza) => [<b key="p">{pieza.pieza}</b>, pieza.usos.toLocaleString("es-DO"), pieza.reemplazos ? <Badge key="r" className="border-primary/25 bg-primary/10 text-primary">{pieza.reemplazos.toLocaleString("es-DO")}</Badge> : "0"])}
          empty="Sin piezas registradas"
        />
      </div>
    </div>
  )
}

function MiniMetric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 shadow-sm p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/12 text-primary">{icon}</div>
      <div className="font-heading text-2xl font-black tracking-tight">{value.toLocaleString("es-DO")}</div>
      <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</div>
    </div>
  )
}

function ProgressBlock({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = Math.min(100, Math.round((value / total) * 100))
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between text-sm font-bold">
        <span>{label}</span>
        <span>{value.toLocaleString("es-DO")}</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{pct}% del total</div>
    </div>
  )
}

function ExecutiveTable({ title, headers, rows, empty }: { title: string; headers: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="border-b border-slate-100 bg-slate-50/70 py-5">
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>{headers.map((header) => <TableHead key={header}>{header}</TableHead>)}</TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? rows.map((row, index) => (
              <TableRow key={index}>{row.map((cell, cellIndex) => <TableCell key={cellIndex}>{cell}</TableCell>)}</TableRow>
            )) : (
              <TableRow><TableCell colSpan={headers.length} className="py-10 text-center text-muted-foreground">{empty}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
