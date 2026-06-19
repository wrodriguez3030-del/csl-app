"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCard } from "@/components/kpi-card"
import { Users, UserCheck, UserMinus, Clock, AlertTriangle, Calendar, Wallet, FileWarning } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { isEmpleadoActivo } from "@/lib/empleado-estado"

/**
 * Dashboard RR.HH. — vista principal del módulo de Recursos Humanos.
 *
 * Por ahora muestra KPIs derivados de las tablas existentes (empleados,
 * solicitudes). Conforme las fases 2-6 vayan llenando hr_attendance_*,
 * hr_payroll_*, hr_leave_requests, etc., los KPIs correspondientes se
 * conectarán automáticamente.
 */
export function RrhhDashboardPage() {
  const { db } = useAppStore()
  const business = useCurrentBusiness()

  const stats = useMemo(() => {
    const empleadosArr = (db as unknown as { empleados?: Array<{ Estado?: string; Sucursal?: string }> }).empleados || []
    const solicitudesArr = (db as unknown as { solicitudesEmpleo?: Array<{ Estado?: string }> }).solicitudesEmpleo || []
    // Activo = Aprobado/Activo. Renuncia, Desvinculado, Rechazado e inactivos
    // NO cuentan como activos (no se borran, solo quedan fuera del conteo).
    const activos = empleadosArr.filter(e => isEmpleadoActivo(e?.Estado)).length
    const inactivos = empleadosArr.filter(e => String(e?.Estado || "").trim() !== "" && !isEmpleadoActivo(e?.Estado)).length
    const porSucursal = empleadosArr.reduce<Record<string, number>>((acc, e) => {
      const k = String(e?.Sucursal || "Sin sucursal")
      acc[k] = (acc[k] || 0) + 1
      return acc
    }, {})
    const solicitudesPendientes = solicitudesArr.filter(s => String(s?.Estado).toLowerCase().includes("pendiente")).length
    return {
      total: empleadosArr.length,
      activos,
      inactivos,
      porSucursal,
      solicitudesPendientes,
    }
  }, [db])

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Recursos Humanos · {business.shortName}
        </p>
        <h2 className="mt-1 text-2xl font-black tracking-tight">Dashboard RR.HH.</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Resumen ejecutivo del personal, asistencia y pagos. Multi-tenant: solo se muestran datos de {business.displayName}.
        </p>
      </div>

      {/* KPIs Personal — Fase 1 conectada */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Empleados activos" value={stats.activos} icon={UserCheck} variant="success" description="Estado: Activo" />
        <KpiCard title="Empleados inactivos" value={stats.inactivos} icon={UserMinus} variant="destructive" description="Inactivos + Terminados + Suspendidos" />
        <KpiCard title="Total registros" value={stats.total} icon={Users} variant="primary" description="Activos + inactivos" />
        <KpiCard title="Solicitudes pendientes" value={stats.solicitudesPendientes} icon={FileWarning} variant="warning" description="Solicitudes de empleo por revisar" />
      </div>

      {/* KPIs pendientes — Fase 2-3 (placeholders informativos) */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Asistencias hoy" value="—" icon={Clock} variant="primary" description="Fase 2 · Ponche" />
        <KpiCard title="Tardanzas hoy" value="—" icon={AlertTriangle} variant="warning" description="Fase 2 · Asistencia" />
        <KpiCard title="Vacaciones pendientes" value="—" icon={Calendar} variant="primary" description="Fase 3 · Vacaciones" />
        <KpiCard title="Nómina del período" value="—" icon={Wallet} variant="success" description="Fase 3 · Nómina" />
      </div>

      {/* Distribución por sucursal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribución por sucursal</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(stats.porSucursal).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin empleados registrados.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(stats.porSucursal)
                .sort((a, b) => b[1] - a[1])
                .map(([suc, n]) => (
                  <div key={suc} className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                    <span className="font-medium">{suc}</span>
                    <span className="font-mono font-bold text-primary">{n}</span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
