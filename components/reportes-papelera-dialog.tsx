"use client"

/**
 * Papelera de reportes de mantenimiento.
 *
 * Un reporte eliminado desde el módulo ya no sale de la base: queda marcado y
 * se puede devolver desde aquí. Solo para administradores — el servidor vuelve
 * a comprobarlo, la pantalla no es la guardia.
 */
import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Loader2, RotateCcw, Trash2 } from "lucide-react"

interface ReporteEliminado {
  ID?: string
  Fecha?: string
  Equipo?: string
  Sucursal?: string
  Tipo?: string
  Atendio?: string
  deletedAt?: string
  deleted_at?: string
  deletedByName?: string
  deleted_by_name?: string
  deletedReason?: string
  deleted_reason?: string
}

const fecha = (v: unknown) => {
  const s = String(v ?? "")
  if (!s) return "—"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : d.toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" })
}

export function ReportesPapeleraDialog({
  open,
  onClose,
  onRestored,
}: {
  open: boolean
  onClose: () => void
  onRestored: () => void
}) {
  const { apiUrl, showToast } = useAppStore()
  const [records, setRecords] = useState<ReporteEliminado[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getReportesEliminados" })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo cargar la papelera"))
      setRecords((res.records as ReporteEliminado[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar la papelera", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, showToast])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const restaurar = async (id: string) => {
    setRestoring(id)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "restoreReporte", reportId: id })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo restaurar"))
      invalidateReadCache()
      showToast(`Reporte ${id} restaurado`, "success")
      setRecords((prev) => prev.filter((r) => r.ID !== id))
      onRestored()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al restaurar", "error")
    } finally {
      setRestoring(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-[color:var(--brand-primary)]" /> Reportes eliminados
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : records.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No hay reportes eliminados. Todo lo que se borre desde el módulo aparecerá aquí y se podrá devolver.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-[color:var(--brand-border)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left">Reporte</th>
                  <th className="px-3 py-2 text-left">Equipo · Sucursal</th>
                  <th className="px-3 py-2 text-left">Eliminado</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const id = String(r.ID || "")
                  const eliminadoEn = r.deletedAt || r.deleted_at
                  const porQuien = r.deletedByName || r.deleted_by_name
                  const motivo = r.deletedReason || r.deleted_reason
                  return (
                    <tr key={id} className="border-t border-[color:var(--brand-border)]">
                      <td className="px-3 py-2">
                        <div className="font-medium">{id}</div>
                        <div className="text-[11px] text-muted-foreground">{fecha(r.Fecha)}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>{r.Equipo || "—"}</div>
                        <div className="text-muted-foreground">{r.Sucursal || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>{fecha(eliminadoEn)}</div>
                        <div className="text-muted-foreground">{porQuien || "—"}</div>
                        {motivo ? <Badge variant="outline" className="mt-1">{motivo}</Badge> : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => void restaurar(id)} disabled={restoring === id}>
                          {restoring === id
                            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                          Restaurar
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
