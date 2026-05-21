"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Stethoscope } from "lucide-react"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"

const pulseIds = new Set(["4", "6", "7", "8", "9", "10", "11", "13", "17", "19", "LV-01"])

export function PulsosMantenimientoPage() {
  const { db } = useAppStore()
  const rows = useMemo(() => {
    return db.reportes
      .filter((reporte) => pulseIds.has(String(reporte.EquipoID)) || String(reporte.Modelo || "").toLowerCase().includes("gentle"))
      .sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)))
      .slice(0, 60)
  }, [db.reportes])

  return (
    <div className="csl-page-shell">
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl"><Stethoscope className="h-5 w-5 text-primary" />Mantenimiento PulseControl</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Técnico</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? rows.map((reporte, i) => (
                <TableRow key={reporte.ID}>
                  <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                  <TableCell>{formatDate(reporte.Fecha)}</TableCell>
                  <TableCell className="font-black">{reporte.EquipoID}</TableCell>
                  <TableCell>{reporte.Sucursal}</TableCell>
                  <TableCell><Badge variant="secondary">{reporte.Tipo}</Badge></TableCell>
                  <TableCell>{reporte.Atendio || "-"}</TableCell>
                  <TableCell><Badge className="border-emerald-300/20 bg-emerald-300/10 text-emerald-200">{reporte.EstadoEquipo}</Badge></TableCell>
                </TableRow>
              )) : (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Sin mantenimientos GentleYAG registrados.</TableCell></TableRow>
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
