"use client"

import { useEffect, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BarChart3, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface Summary {
  empleados: number; contratos: number; documentos: number
  permisosPend: number; prestamosActivos: number; prestamosBalance: number
  incentivosPend: number; corridas: number; vacacionesPend: number
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function RrhhReportesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [s, setS] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const res = await apiCall(normalizeApiUrl(apiUrl), { action: "getHrReportSummary" }) as { ok?: boolean; summary?: Summary }
      setS(res?.summary ?? null)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cards: Array<{ label: string; value: string; tone: string }> = s ? [
    { label: "Empleados", value: String(s.empleados), tone: "text-primary" },
    { label: "Contratos", value: String(s.contratos), tone: "text-slate-700" },
    { label: "Documentos", value: String(s.documentos), tone: "text-slate-700" },
    { label: "Permisos pendientes", value: String(s.permisosPend), tone: "text-amber-600" },
    { label: "Préstamos activos", value: String(s.prestamosActivos), tone: "text-blue-600" },
    { label: "Balance préstamos", value: rd(s.prestamosBalance), tone: "text-amber-700" },
    { label: "Incentivos pendientes", value: String(s.incentivosPend), tone: "text-amber-600" },
    { label: "Corridas de nómina", value: String(s.corridas), tone: "text-emerald-600" },
    { label: "Vacaciones solicitadas", value: String(s.vacacionesPend), tone: "text-amber-600" },
  ] : []

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><BarChart3 className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Reportes · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Reportes RR.HH.</h2>
            <p className="mt-1 text-sm text-muted-foreground">Resumen consolidado del módulo de Recursos Humanos para el negocio activo.</p>
          </div>
        </div>
        <Button variant="outline" onClick={reload} disabled={loading} className="shrink-0"><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Actualizar</Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Calculando...</div>
      ) : !s ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>No se pudo calcular el resumen.</div>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
          {cards.map(c => (
            <Card key={c.label}><CardContent className="pt-5 pb-4">
              <div className={`text-2xl font-black ${c.tone}`}>{c.value}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{c.label}</div>
            </CardContent></Card>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Los reportes detallados con exportación a Excel/PDF por módulo se irán ampliando. Para trazabilidad de acciones, ver <b>Auditoría RR.HH.</b></p>
    </div>
  )
}
