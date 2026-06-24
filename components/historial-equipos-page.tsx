"use client"

import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BarChart3 } from "lucide-react"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"

export function HistorialEquiposPage() {
  const { db } = useAppStore()
  const [viewEquipoId, setViewEquipoId] = useState<string | null>(null)

  // Reportes filtrados por equipo seleccionado (para el dialog de detalle).
  const reportesViewEquipo = viewEquipoId
    ? db.reportes
        .filter((r) => (r.EquipoID || "Sin equipo") === viewEquipoId)
        .sort((a, b) => String(b.Fecha || "").localeCompare(String(a.Fecha || "")))
    : []
  const rows = useMemo(() => {
    const map = new Map<string, { equipo: string; sucursal: string; modelo: string; reportes: number; ultimo: string; piezas: number }>()
    db.reportes.forEach((reporte) => {
      const key = reporte.EquipoID || "Sin equipo"
      const current = map.get(key) || { equipo: key, sucursal: reporte.Sucursal || "-", modelo: reporte.Modelo || "-", reportes: 0, ultimo: "", piezas: 0 }
      current.reportes += 1
      current.ultimo = !current.ultimo || String(reporte.Fecha) > String(current.ultimo) ? reporte.Fecha : current.ultimo
      try {
        const piezas = JSON.parse(reporte.PiezasJSON || "[]")
        current.piezas += Array.isArray(piezas) ? piezas.length : 0
      } catch {}
      map.set(key, current)
    })
    return Array.from(map.values()).sort((a, b) => b.reportes - a.reportes)
  }, [db.reportes])

  const pag = usePagination(rows, { initialPageSize: 50, resetKey: `${rows.length}` })

  return (
    <div className="csl-page-shell">
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl"><BarChart3 className="h-5 w-5 text-primary" />Historial por equipo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead className="text-right">Reportes</TableHead>
                <TableHead className="text-right">Piezas</TableHead>
                <TableHead className="text-right">Último mantenimiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? pag.pageItems.map((row, i) => (
                <TableRow
                  key={row.equipo}
                  className="cursor-pointer"
                  onClick={() => setViewEquipoId(row.equipo)}
                >
                  <TableCell className="text-center"><SeqBadge n={pag.from + i} /></TableCell>
                  <TableCell className="font-black">{row.equipo}</TableCell>
                  <TableCell>{row.sucursal}</TableCell>
                  <TableCell>{row.modelo}</TableCell>
                  <TableCell className="text-right"><Badge variant="secondary">{row.reportes.toLocaleString("es-DO")}</Badge></TableCell>
                  <TableCell className="text-right">{row.piezas.toLocaleString("es-DO")}</TableCell>
                  <TableCell className="text-right">{formatDate(row.ultimo)}</TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Sin historial registrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="equipos" />
        </CardContent>
      </Card>

      {/* Dialog de detalle: lista completa de reportes para el equipo seleccionado. */}
      <Dialog open={Boolean(viewEquipoId)} onOpenChange={(open) => !open && setViewEquipoId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historial del equipo {viewEquipoId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{reportesViewEquipo.length} reportes</span>
              {reportesViewEquipo[0]?.Sucursal ? <span>{reportesViewEquipo[0].Sucursal}</span> : null}
            </div>
            {reportesViewEquipo.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Sin reportes registrados para este equipo.
              </p>
            ) : (
              <div className="space-y-1.5">
                {reportesViewEquipo.map((r) => (
                  <div
                    key={r.ID}
                    className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {String(r.Fecha || "").slice(0, 10)}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">{r.Tipo || "-"}</Badge>
                        {r.Atendio ? <span className="text-[10px] text-muted-foreground">{r.Atendio}</span> : null}
                      </div>
                      {r.Problema ? (
                        <p className="mt-1 break-words text-[11px] text-foreground">{r.Problema}</p>
                      ) : null}
                    </div>
                    {r.EstadoEquipo ? (
                      <Badge variant="outline" className="flex-shrink-0 text-[10px]">{r.EstadoEquipo}</Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return "-"
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}
