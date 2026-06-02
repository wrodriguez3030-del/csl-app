"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Wrench, Pencil } from "lucide-react"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { fmtN } from "@/lib/fmt"

export function PulsosEquiposPage() {
  const { db, dbPulsos, setActiveTab } = useAppStore()
  const business = useCurrentBusiness()

  const handleEdit = (equipoId: string) => {
    // El CRUD completo del equipo vive en Mantenimiento>Equipos.
    setActiveTab("equipos")
    setTimeout(() => {
      const el = document.querySelector(`[data-equipo-id="${equipoId}"]`)
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }, 200)
  }

  const rows = useMemo(() => {
    // Catálogo REAL desde la BD (csl_equipos). El backend ya lo filtra por el
    // business ACTIVO (incluido superadmin scopeado vía activeBusinessId), así
    // que aquí no hace falta volver a filtrar por tenant.
    return db.equipos
      .filter((e) => (e.Estado ?? "Activo") !== "Inactivo")
      .map((e) => {
        // Fuente PRIMARIA de lecturas: csl_pulse_readings (Cuadre Semanal).
        const readings = (dbPulsos.pulseReadings ?? [])
          .filter((r) => String(r.equipo_id) === String(e.EquipoID))
          .sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)))
        if (readings[0]) {
          return {
            equipoId: e.EquipoID,
            modelo: e.Modelo,
            serie: e.Serie || e.Numero || "",
            sucursal: e.Sucursal,
            cabina: e.Cabina || "—",
            operadora: e.Operadora || "—",
            ultimaFecha: readings[0].period_start,
            ultimaDispLaser: Number(readings[0].disp_laser) || 0,
          }
        }
        // Fallback legacy: lecturas semanales.
        const lecturas = dbPulsos.lecturasSemanales
          .filter((item) => String(item.EquipoID) === String(e.EquipoID))
          .sort((a, b) => String(b.FechaSemana).localeCompare(String(a.FechaSemana)))
        const ultima = lecturas[0]
        return {
          equipoId: e.EquipoID,
          modelo: e.Modelo,
          serie: e.Serie || e.Numero || "",
          sucursal: e.Sucursal,
          cabina: e.Cabina || "—",
          operadora: e.Operadora || "—",
          ultimaFecha: ultima?.FechaSemana,
          ultimaDispLaser: Number(ultima?.DiferenciaReal) || 0,
        }
      })
  }, [db.equipos, dbPulsos.pulseReadings, dbPulsos.lecturasSemanales])

  return (
    <div className="csl-page-shell space-y-4">
      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b border-slate-200 bg-slate-50/70 py-5">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Wrench className="h-5 w-5 text-primary" />
            Equipos PulseControl · {business.shortName}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              No hay datos configurados para este negocio.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Serie</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Cabina</TableHead>
                  <TableHead>Operadora base</TableHead>
                  <TableHead className="text-right">Última lectura</TableHead>
                  <TableHead className="text-right">Disp. semana</TableHead>
                  <TableHead className="text-center w-20">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={row.equipoId}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-black">
                      {row.equipoId}
                      {row.modelo ? <span className="ml-1 font-normal text-slate-500">· {row.modelo}</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">{row.serie || "—"}</TableCell>
                    <TableCell>{row.sucursal}</TableCell>
                    <TableCell>{row.cabina}</TableCell>
                    <TableCell><Badge className="border-primary/20 bg-primary/10 text-primary">{row.operadora}</Badge></TableCell>
                    <TableCell className="text-right">{formatDate(row.ultimaFecha)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{fmtN(row.ultimaDispLaser)}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleEdit(row.equipoId)}
                        title="Editar en Mantenimiento>Equipos"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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
