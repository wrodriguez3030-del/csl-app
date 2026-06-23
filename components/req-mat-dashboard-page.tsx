"use client"

import { useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { KpiCard } from "@/components/kpi-card"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, LineChart, Line,
} from "recharts"
import { ClipboardList, Clock, CheckCircle2, ShoppingCart, PackageCheck, PackageX, XCircle, RefreshCcw } from "lucide-react"

interface Dash {
  kpis: {
    totalRequisiciones: number; pendientesAprobacion: number; aprobadas: number; compradas: number
    recibidasCompletas: number; recibidasParciales: number; rechazadas: number
    totalMateriales: number; totalComprado: number
    sucursalTop: string; materialTop: string; proveedorTop: string
  }
  charts: {
    porSucursal: { name: string; value: number }[]
    materialesTop: { name: string; value: number }[]
    gastoPorProveedor: { name: string; value: number }[]
    estados: { name: string; value: number }[]
    tendencia: { name: string; value: number }[]
  }
}

const PIE_COLORS = ["#0891b2", "#f59e0b", "#10b981", "#6366f1", "#ef4444", "#ec4899", "#14b8a6", "#a855f7"]

export function ReqMatDashboardPage() {
  const { apiUrl, showToast } = useAppStore()
  const [data, setData] = useState<Dash | null>(null)
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getMaterialDashboard", desde, hasta })
      if (res?.ok) setData(res as unknown as Dash)
      else showToast((res as { error?: string })?.error || "Error", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl])

  const k = data?.kpis
  const c = data?.charts

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:max-w-md">
            <div><Label className="text-xs">Desde</Label><Input type="date" className="mt-1 h-9" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><Label className="text-xs">Hasta</Label><Input type="date" className="mt-1 h-9" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </div>
          <Button className="h-9" onClick={load}><RefreshCcw className="mr-1.5 h-4 w-4" />Aplicar</Button>
        </CardContent>
      </Card>

      {loading || !k || !c ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Cargando dashboard...</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Requisiciones" value={k.totalRequisiciones} icon={ClipboardList} variant="primary" description="en el período" />
            <KpiCard title="Pendientes aprobación" value={k.pendientesAprobacion} icon={Clock} variant="warning" />
            <KpiCard title="Aprobadas" value={k.aprobadas} icon={CheckCircle2} variant="success" />
            <KpiCard title="Compradas" value={k.compradas} icon={ShoppingCart} variant="primary" />
            <KpiCard title="Recibidas completas" value={k.recibidasCompletas} icon={PackageCheck} variant="success" />
            <KpiCard title="Recibidas parciales" value={k.recibidasParciales} icon={PackageCheck} variant="warning" />
            <KpiCard title="Rechazadas" value={k.rechazadas} icon={XCircle} variant="destructive" />
            <KpiCard title="Total materiales solicitados" value={k.totalMateriales} icon={PackageX} variant="primary" />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Sucursal que más solicita</p><p className="mt-1 text-xl font-bold">{k.sucursalTop}</p></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Material más solicitado</p><p className="mt-1 text-xl font-bold">{k.materialTop}</p></CardContent></Card>
            <Card className="border-[color:var(--brand-border)]"><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Proveedor más usado</p><p className="mt-1 text-xl font-bold">{k.proveedorTop}</p></CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-[color:var(--brand-border)]">
              <CardHeader className="pb-2"><CardTitle className="text-base">Solicitudes por sucursal</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={c.porSucursal}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="Requisiciones" fill="#0891b2" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--brand-border)]">
              <CardHeader className="pb-2"><CardTitle className="text-base">Estado de requisiciones</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={c.estados} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                        {c.estados.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--brand-border)]">
              <CardHeader className="pb-2"><CardTitle className="text-base">Materiales más solicitados</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: "100%", height: Math.max(260, c.materialesTop.length * 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={c.materialesTop} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="Cantidad" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--brand-border)]">
              <CardHeader className="pb-2"><CardTitle className="text-base">Tendencia mensual</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={c.tendencia}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="value" name="Requisiciones" stroke="#6366f1" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[color:var(--brand-border)] lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base">Gasto por proveedor (RD$)</CardTitle></CardHeader>
              <CardContent>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={c.gastoPorProveedor}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="Gasto" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
