"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Wrench } from "lucide-react"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { fmtN } from "@/lib/fmt"

const equiposGentleYag = [
  ["4", "Rafael Vidal", "Cabina 5", "Rosa"],
  ["6", "Rafael Vidal", "Cabina 4", "Madelin"],
  ["7", "Rafael Vidal", "Cabina 1", "Diana"],
  ["8", "Rafael Vidal", "Cabina 2", "Emely"],
  ["9", "Los Jardines", "Cabina 4", "YAMILKA"],
  ["10", "Los Jardines", "Cabina 1", "Katherine"],
  ["11", "Los Jardines", "Cabina 3", "NAYELI"],
  ["13", "Los Jardines", "Cabina 2", "Lilian"],
  ["17", "Villa Olga", "Cabina 1", "Yessica"],
  ["19", "Villa Olga", "Cabina 2", "Eidylee"],
  ["LV-01", "La Vega", "Cabina 1", "Equipo La Vega"],
]

export function PulsosEquiposPage() {
  const { dbPulsos } = useAppStore()
  const rows = useMemo(() => {
    return equiposGentleYag.map(([equipo, sucursal, cabina, operadora]) => {
      const lecturas = dbPulsos.lecturasSemanales
        .filter((item) => String(item.EquipoID) === String(equipo))
        .sort((a, b) => String(b.FechaSemana).localeCompare(String(a.FechaSemana)))
      const ultima = lecturas[0]
      return { equipo, sucursal, cabina, operadora, ultima }
    })
  }, [dbPulsos.lecturasSemanales])

  return (
    <div className="csl-page-shell">
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl"><Wrench className="h-5 w-5 text-primary" />Equipos GentleYAG PulseControl</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Sucursal</TableHead>
                <TableHead>Cabina</TableHead>
                <TableHead>Operadora base</TableHead>
                <TableHead className="text-right">Última lectura</TableHead>
                <TableHead className="text-right">Disp. semana</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.equipo}>
                  <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                  <TableCell className="font-black">GentleYAG {row.equipo}</TableCell>
                  <TableCell>{row.sucursal}</TableCell>
                  <TableCell>{row.cabina}</TableCell>
                  <TableCell><Badge className="border-primary/20 bg-primary/10 text-primary">{row.operadora}</Badge></TableCell>
                  <TableCell className="text-right">{formatDate(row.ultima?.FechaSemana)}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{fmtN(row.ultima?.DiferenciaReal)}</TableCell>
                </TableRow>
              ))}
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
