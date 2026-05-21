"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { BarChart3 } from "lucide-react"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"

export function HistorialEquiposPage() {
  const { db } = useAppStore()
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
              {rows.length ? rows.map((row, i) => (
                <TableRow key={row.equipo}>
                  <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
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
        </CardContent>
      </Card>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return "-"
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}
