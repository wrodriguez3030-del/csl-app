"use client"

import { useState, useMemo } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Pencil, Trash2, Download, Search, Printer, Eye } from "lucide-react"
import type { Reporte, PiezaIntervenida, Database } from "@/lib/types"

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-"
  try {
    const clean = String(dateStr).trim().split("T")[0]
    // Verificar que tiene formato de fecha (YYYY-MM-DD o similar con números)
    if (!clean || clean.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(clean)) return "-"
    const date = new Date(clean + "T12:00:00")
    if (isNaN(date.getTime())) return "-"
    return date.toLocaleDateString("es-DO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
  } catch {
    return "-"
  }
}

function parsePiezas(json: string | undefined): PiezaIntervenida[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const prioColor: Record<string, string> = {
  Alta: "border-destructive text-destructive",
  Media: "border-warning text-warning",
  Baja: "border-success text-success",
}

const estadoColor: Record<string, string> = {
  Operativo: "bg-success/20 text-success",
  Observacion: "bg-warning/20 text-warning",
  "Fuera de servicio": "bg-destructive/20 text-destructive",
}

export function ReportesPage() {
  const {
    db,
    setDb,
    apiUrl,
    showToast,
    setIsLoading,
    setLoadingMessage,
    setActiveTab,
    setEditingReporte,
    setPiezasReporte,
  } = useAppStore()

  const [searchQuery, setSearchQuery] = useState("")
  const [filterSucursal, setFilterSucursal] = useState("")
  const [filterTipo, setFilterTipo] = useState("")
  const [deleteDialog, setDeleteDialog] = useState<Reporte | null>(null)
  const [sortCol, setSortCol] = useState<string>("Fecha")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("desc") }
  }

  const SortIcon = ({ col }: { col: string }) => {
    if (sortCol !== col) return <span className="ml-1 text-muted-foreground/40">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  // Filter reports
  const filteredReportes = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()

    const filtered = db.reportes.filter((r) => {
      const matchQuery =
        !query ||
        [r.EquipoID, r.Sucursal, r.Atendio, r.Problema, r.Tipo, r.ID].some((v) =>
          String(v ?? "").toLowerCase().includes(query)
        )
      const matchSucursal =
        !filterSucursal ||
        (r.Sucursal || "").toLowerCase() === filterSucursal.toLowerCase()
      const matchTipo =
        !filterTipo || (r.Tipo || "").toLowerCase() === filterTipo.toLowerCase()

      return matchQuery && matchSucursal && matchTipo
    })

    // Ordenar
    return [...filtered].sort((a, b) => {
      let valA = ""
      let valB = ""
      switch (sortCol) {
        case "Fecha": valA = a.Fecha || ""; valB = b.Fecha || ""; break
        case "Equipo": valA = a.EquipoID || ""; valB = b.EquipoID || ""; break
        case "Sucursal": valA = a.Sucursal || ""; valB = b.Sucursal || ""; break
        case "Tipo": valA = a.Tipo || ""; valB = b.Tipo || ""; break
        case "Tecnico": valA = a.Atendio || ""; valB = b.Atendio || ""; break
        case "Estado": valA = a.EstadoEquipo || ""; valB = b.EstadoEquipo || ""; break
        default: valA = a.Fecha || ""; valB = b.Fecha || ""
      }
      return sortDir === "asc"
        ? valA.localeCompare(valB)
        : valB.localeCompare(valA)
    })
  }, [db.reportes, searchQuery, filterSucursal, filterTipo, sortCol, sortDir])

  // Edit report
  const [viewDialog, setViewDialog] = useState<Reporte | null>(null)

  const handlePrint = (reporte: Reporte) => {
    const piezas = parsePiezas(reporte.PiezasJSON)
    const printWindow = window.open("", "_blank")
    if (!printWindow) return

    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Reporte ${reporte.ID}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: black; background: white; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
          td { border: 1px solid #999; padding: 2px 4px; }
          .label { font-weight: bold; background: #f0f0f0; white-space: nowrap; }
          .header { text-align: right; font-size: 16px; font-weight: bold; border: none; background: none; padding-bottom: 6px; }
          .check { font-weight: bold; background: #f0f0f0; }
          .tall { height: 40px; vertical-align: top; }
          .firma-line { border-top: 1px solid black; font-weight: bold; text-align: center; padding-top: 2px; }
          .firma-box { height: 60px; border-bottom: 1px solid black; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body style="padding: 10mm;">
        <table>
          <tr><td colspan="8" class="header" style="border:none;background:none;">REPORTE DE SERVICIO</td></tr>
          <tr>
            <td class="label">NOMBRE DE LA EMPRESA</td>
            <td colspan="4" style="text-align:center">${reporte.Empresa || "CIBAO SPA LASER, CSL, S.R.L."}</td>
            <td class="label">FECHA</td>
            <td colspan="2">${new Date(reporte.Fecha).toLocaleDateString("es-DO", {day:"2-digit",month:"numeric",year:"2-digit"})}</td>
          </tr>
          <tr>
            <td class="label">DOMICILIO</td>
            <td colspan="4" style="text-align:center">${reporte.Domicilio || ""}</td>
            <td class="label">CIUDAD</td>
            <td colspan="2">${reporte.Ciudad || ""}</td>
          </tr>
          <tr>
            <td class="label">CLIENTE</td>
            <td colspan="2" style="text-align:center">${reporte.Cliente || reporte.Empresa || ""}</td>
            <td class="label">MODELO</td>
            <td>${reporte.Modelo || ""}</td>
            <td class="label">NO. SERIE</td>
            <td colspan="2">${reporte.Serie || ""}</td>
          </tr>
          <tr>
            <td class="label">TELEFONO</td>
            <td colspan="2"></td>
            <td class="label">LASER HEAD</td>
            <td></td>
            <td class="label">NUMERO</td>
            <td colspan="2">${reporte.Numero || ""}</td>
          </tr>
        </table>

        <table>
          <tr>
            <td class="label" style="font-weight:bold">TIPO DE SERVICIO:</td>
            <td class="check">PREVENTIVO</td><td style="text-align:center">${reporte.Tipo === "Preventivo" ? "X" : ""}</td>
            <td class="check">CORRECTIVO</td><td style="text-align:center">${reporte.Tipo === "Correctivo" ? "X" : ""}</td>
            <td class="check">GARANTIA</td><td style="text-align:center">${reporte.Tipo === "Garantía" ? "X" : ""}</td>
            <td class="check">PAGO POR SERVICIO</td><td style="text-align:center">${reporte.Tipo === "Pago por servicio" ? "X" : ""}</td>
          </tr>
        </table>

        <table><tr>
          <td class="label" style="width:130px">PROBLEMA OBSERVADO:</td>
          <td class="tall">${reporte.Problema || ""}</td>
        </tr></table>

        <table><tr>
          <td class="label" style="width:130px">CORRECCION:</td>
          <td class="tall">${reporte.Correccion || ""}</td>
        </tr></table>

        <table><tr>
          <td style="width:120px;border:none"></td>
          <td class="label">N/S FUENTE:</td><td style="width:150px"></td>
          <td style="width:20px;border:none"></td>
          <td class="label">N/S FIBRA:</td><td style="width:150px"></td>
        </tr></table>

        <table>
          <tr><td class="label" style="font-weight:bold">PARTES USADAS:</td></tr>
          ${piezas.length > 0 
            ? piezas.map(p => `<tr><td style="width:200px">${p.pieza}</td><td style="width:150px">${p.accion}</td><td style="width:100px">${p.estado}</td><td>${p.reemplazo === "Sí" ? "REEMPLAZADO" : ""}</td></tr>`).join("")
            : `<tr><td>${reporte.PartesTexto || ""}</td></tr>`
          }
          <tr><td style="height:10px;border:none"></td></tr>
          <tr><td style="height:10px;border:none"></td></tr>
        </table>

        <table><tr>
          <td class="label" style="width:130px">OBSERVACIONES:</td>
          <td style="height:35px;vertical-align:top">${reporte.Observaciones || ""}</td>
        </tr></table>

        <table>
          <tr>
            <td class="label">P. TOTALES:</td><td>${(reporte.P_Totales || 0).toLocaleString()}</td>
            <td class="label">P. CABEZA:</td><td>${(reporte.P_Cabeza || 0).toLocaleString()}</td>
            <td class="label">HV@</td><td></td>
            <td class="label">J</td>
            <td class="label">BS:</td><td></td>
            <td class="label">/</td>
            <td class="label">BC:</td><td></td>
          </tr>
          <tr>
            <td class="label">HV REF@</td><td></td>
            <td class="label">VDC-</td><td></td>
            <td class="label">V</td>
            <td class="label">TX:</td><td></td>
            <td class="label">SOFTWARE</td><td colspan="4"></td>
          </tr>
        </table>

        <table style="margin-top:8px">
          <tr>
            <td class="label">CLIENTE:</td>
            <td style="width:200px">${reporte.Cliente || reporte.Empresa || ""}</td>
            <td style="width:20px;border:none"></td>
            <td class="label">ATENDIO:</td>
            <td>${reporte.Atendio || ""}</td>
          </tr>
        </table>

        <table style="margin-top:16px">
          <tr>
            <td style="width:50%;text-align:center;padding-right:10px;border:none">
              <div class="firma-box">${reporte.FirmaCliente ? `<img src="${reporte.FirmaCliente}" style="height:55px;max-width:100%;object-fit:contain;" />` : ''}</div>
              <div class="firma-line">NOMBRE Y FIRMA CLIENTE</div>
            </td>
            <td style="width:50%;text-align:center;padding-left:10px;border:none">
              <div class="firma-box">${reporte.FirmaTecnico ? `<img src="${reporte.FirmaTecnico}" style="height:55px;max-width:100%;object-fit:contain;" />` : ''}</div>
              <div class="firma-line">NOMBRE Y FIRMA TÉCNICO</div>
            </td>
          </tr>
        </table>
        ${(() => {
          try {
            const fotosArr = JSON.parse((reporte as any).Fotos || '[]')
            if (!fotosArr.length) return ''
            return `<div style="margin-top:16px;"><p style="font-weight:bold;font-size:11px;margin-bottom:6px;">FOTOS DE LA INTERVENCIÓN:</p><div style="display:flex;flex-wrap:wrap;gap:8px;">${fotosArr.map((f: any) => `<img src="${f.url}" style="height:120px;width:120px;object-fit:cover;border:1px solid #ccc;border-radius:4px;" />`).join('')}</div></div>`
          } catch { return '' }
        })()}
      </body>
      </html>
    `
    printWindow.document.write(content)
    printWindow.document.close()
    printWindow.onload = () => {
      printWindow.print()
    }
  }

  const handleEdit = (reporte: Reporte) => {
    setEditingReporte(reporte)
    const piezas = parsePiezas(reporte.PiezasJSON)
    setPiezasReporte(piezas)
    setActiveTab("reporte")
  }

  // Delete report
  const handleDelete = async () => {
    if (!deleteDialog) return
    // Eliminar local primero
    setDb({ ...db, reportes: db.reportes.filter(r => r.ID !== deleteDialog.ID) })
    setDeleteDialog(null)
    showToast("Reporte eliminado", "success")
    // Sincronizar API
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try { await apiJsonp(normalized, { action: "deleteReporte", reportId: deleteDialog.ID }) } catch(e) {}
    }
  }

  // Export to CSV
  const handleExportCSV = () => {
    if (!filteredReportes.length) {
      showToast("No hay reportes para exportar", "error")
      return
    }

    const header = [
      "ID",
      "Fecha",
      "Equipo",
      "Sucursal",
      "Tipo",
      "Tecnico",
      "Estado",
      "Prioridad",
      "Problema",
      "Correccion",
      "Observaciones",
    ]

    const rows = filteredReportes.map((r) =>
      [
        r.ID,
        formatDate(r.Fecha),
        r.EquipoID,
        r.Sucursal,
        r.Tipo,
        r.Atendio,
        r.EstadoEquipo,
        r.Prioridad,
        r.Problema,
        r.Correccion,
        r.Observaciones,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    )

    const csv = [header.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `reportes_cibao_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast("CSV exportado", "success")
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros y busqueda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="search">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Equipo, tecnico, problema..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filterSucursal">Sucursal</Label>
              <Select value={filterSucursal} onValueChange={setFilterSucursal}>
                <SelectTrigger id="filterSucursal">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {db.sucursales.map((s, i) => (
                    <SelectItem key={s.Codigo || i} value={s.Nombre}>
                      {s.Nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filterTipo">Tipo</Label>
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger id="filterTipo">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los tipos</SelectItem>
                  <SelectItem value="Preventivo">Preventivo</SelectItem>
                  <SelectItem value="Correctivo">Correctivo</SelectItem>
                  <SelectItem value="Garantia">Garantia</SelectItem>
                  <SelectItem value="Pago por servicio">Pago por servicio</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
            <span className="text-sm text-muted-foreground">
              {filteredReportes.length} registros
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista de reportes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Fecha")}>Fecha<SortIcon col="Fecha" /></TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Equipo")}>Equipo<SortIcon col="Equipo" /></TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Sucursal")}>Sucursal<SortIcon col="Sucursal" /></TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Tipo")}>Tipo<SortIcon col="Tipo" /></TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Tecnico")}>Tecnico<SortIcon col="Tecnico" /></TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Estado")}>Estado<SortIcon col="Estado" /></TableHead>
                  <TableHead>Piezas</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReportes.length > 0 ? (
                  filteredReportes.map((r, i) => {
                    const piezas = parsePiezas(r.PiezasJSON)
                    const resumen = piezas.length
                      ? `${piezas[0].pieza}${piezas.length > 1 ? ` +${piezas.length - 1}` : ""}`
                      : r.PartesTexto || "-"

                    return (
                      <TableRow key={r.ID || r._rowNum || i}>
                        <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(r.Fecha)}
                        </TableCell>
                        <TableCell className="font-medium">{r.EquipoID}</TableCell>
                        <TableCell>{r.Sucursal}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{r.Tipo}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.Atendio || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge
                              variant="secondary"
                              className={estadoColor[r.EstadoEquipo || ""] || ""}
                            >
                              {r.EstadoEquipo || "-"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={prioColor[r.Prioridad || ""] || ""}
                            >
                              {r.Prioridad || "-"}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {resumen}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewDialog(r)}
                              title="Ver reporte"
                            >
                              <Eye className="h-4 w-4 text-muted-foreground" />
                              <span className="sr-only">Ver</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handlePrint(r)}
                              title="Imprimir PDF"
                            >
                              <Printer className="h-4 w-4 text-primary" />
                              <span className="sr-only">Imprimir</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(r)}
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="sr-only">Editar</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteDialog(r)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                              <span className="sr-only">Eliminar</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground py-8"
                    >
                      Sin reportes que coincidan con los filtros.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* View Dialog */}
      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reporte {viewDialog?.ID}</DialogTitle>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div><span className="font-semibold text-muted-foreground">Fecha:</span> {formatDate(viewDialog.Fecha)}</div>
                <div><span className="font-semibold text-muted-foreground">Equipo:</span> {viewDialog.EquipoID}</div>
                <div><span className="font-semibold text-muted-foreground">Sucursal:</span> {viewDialog.Sucursal}</div>
                <div><span className="font-semibold text-muted-foreground">Técnico:</span> {viewDialog.Atendio}</div>
                <div><span className="font-semibold text-muted-foreground">Modelo:</span> {viewDialog.Modelo}</div>
                <div><span className="font-semibold text-muted-foreground">Serie:</span> {viewDialog.Serie}</div>
                <div><span className="font-semibold text-muted-foreground">Tipo:</span> {viewDialog.Tipo}</div>
                <div><span className="font-semibold text-muted-foreground">Estado equipo:</span> {viewDialog.EstadoEquipo}</div>
                <div><span className="font-semibold text-muted-foreground">Pulsos cabeza:</span> {viewDialog.P_Cabeza?.toLocaleString()}</div>
                <div><span className="font-semibold text-muted-foreground">Pulsos totales:</span> {viewDialog.P_Totales?.toLocaleString()}</div>
              </div>
              {viewDialog.Problema && <div><span className="font-semibold text-muted-foreground">Problema:</span><p className="mt-1">{viewDialog.Problema}</p></div>}
              {viewDialog.Correccion && <div><span className="font-semibold text-muted-foreground">Corrección:</span><p className="mt-1">{viewDialog.Correccion}</p></div>}
              {viewDialog.Observaciones && <div><span className="font-semibold text-muted-foreground">Observaciones:</span><p className="mt-1">{viewDialog.Observaciones}</p></div>}
              {parsePiezas(viewDialog.PiezasJSON).length > 0 && (
                <div>
                  <span className="font-semibold text-muted-foreground">Piezas intervenidas:</span>
                  <div className="mt-2 space-y-1">
                    {parsePiezas(viewDialog.PiezasJSON).map((p, i) => (
                      <div key={i} className="flex gap-2 text-xs bg-secondary/30 rounded px-3 py-2">
                        <span className="font-medium">{p.pieza}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{p.accion}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{p.estado}</span>
                        {p.reemplazo === "Sí" && <Badge variant="secondary" className="ml-auto text-xs">Reemplazado</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button onClick={() => { handlePrint(viewDialog); setViewDialog(null) }} className="gap-2">
                  <Printer className="h-4 w-4" /> Imprimir PDF
                </Button>
                <Button variant="outline" onClick={() => { handleEdit(viewDialog); setViewDialog(null) }} className="gap-2">
                  <Pencil className="h-4 w-4" /> Editar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar reporte</DialogTitle>
            <DialogDescription>
              {`¿Estas seguro de eliminar el reporte ${deleteDialog?.ID}? Esta accion no se puede deshacer.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
