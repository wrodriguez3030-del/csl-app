"use client"

import { useState, useEffect } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Power, PowerOff, Save, X } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import type { Equipo } from "@/lib/types"

const emptyEquipo: Equipo = {
  EquipoID: "", Sucursal: "", Empresa: "CIBAO SPA LASER, CSL, S.R.L.",
  Domicilio: "", Modelo: "", Serie: "", Numero: "",
  P_Cabeza: 0, P_Totales: 0, Max_Cabeza: 6000000,
  Estado: "Activo", Observaciones: "",
}

export function EquiposPage() {
  const { db, setDb, apiUrl, showToast, editingEquipo, setEditingEquipo } = useAppStore()

  const [formData, setFormData] = useState<Equipo>(emptyEquipo)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Equipo | null>(null)
  const [sortCol, setSortCol] = useState<string>("EquipoID")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")

  const activeSucursales = db.sucursales.filter(s => s.Estado === "Activa")

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 ml-1">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  const sortedEquipos = [...db.equipos].sort((a, b) => {
    let va: any, vb: any
    switch(sortCol) {
      case "EquipoID": va = Number(a.EquipoID) || 0; vb = Number(b.EquipoID) || 0; break
      case "Sucursal": va = a.Sucursal; vb = b.Sucursal; break
      case "Observaciones": va = a.Observaciones; vb = b.Observaciones; break
      case "Modelo": va = a.Modelo; vb = b.Modelo; break
      case "Serie": va = a.Serie; vb = b.Serie; break
      case "P_Cabeza": va = Number(a.P_Cabeza) || 0; vb = Number(b.P_Cabeza) || 0; break
      case "P_Totales": va = Number(a.P_Totales) || 0; vb = Number(b.P_Totales) || 0; break
      case "Estado": va = a.Estado; vb = b.Estado; break
      default: va = a.EquipoID; vb = b.EquipoID
    }
    if (typeof va === "string") { va = va.toLowerCase(); vb = (vb as string).toLowerCase() }
    if (va < vb) return sortDir === "asc" ? -1 : 1
    if (va > vb) return sortDir === "asc" ? 1 : -1
    return 0
  })

  useEffect(() => {
    if (editingEquipo) {
      setFormData(editingEquipo)
      setIsFormOpen(true)
    }
  }, [editingEquipo])

  const syncApi = async (params: Record<string, string>) => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    try { await apiJsonp(normalized, params) } catch (e) { console.warn("API:", e) }
  }

  const handleSubmit = async () => {
    if (!formData.EquipoID) { showToast("El ID del equipo es obligatorio", "error"); return }
    const exists = db.equipos.find(e => e.EquipoID === formData.EquipoID)
    setDb({
      ...db,
      equipos: exists
        ? db.equipos.map(e => e.EquipoID === formData.EquipoID ? formData : e)
        : [...db.equipos, formData]
    })
    setFormData(emptyEquipo); setEditingEquipo(null); setIsFormOpen(false)
    showToast("Equipo guardado", "success")
    syncApi({
      action: "saveEquipo",
      equipoId: formData.EquipoID,
      sucursal: formData.Sucursal,
      empresa: formData.Empresa || "CIBAO SPA LASER",
      domicilio: formData.Domicilio || "",
      modelo: formData.Modelo,
      serie: formData.Serie || "",
      numero: formData.Numero || "",
      pcabeza: String(formData.P_Cabeza || 0),
      ptotales: String(formData.P_Totales || 0),
      maxCabeza: String(formData.Max_Cabeza || 6000000),
      estado: formData.Estado,
      observaciones: formData.Observaciones || "",
    })
  }

  const handleToggleStatus = (equipo: Equipo) => {
    const newStatus = equipo.Estado === "Activo" ? "Inactivo" : "Activo"
    setDb({ ...db, equipos: db.equipos.map(e => e.EquipoID === equipo.EquipoID ? { ...e, Estado: newStatus as "Activo" | "Inactivo" } : e) })
    showToast(`Equipo ${newStatus === "Activo" ? "activado" : "desactivado"}`, "success")
    syncApi({ action: "setEquipoEstado", equipoId: equipo.EquipoID, estado: newStatus })
  }

  const handleDelete = async () => {
    if (!deleteDialog) return
    setDb({ ...db, equipos: db.equipos.filter(e => e.EquipoID !== deleteDialog.EquipoID) })
    setDeleteDialog(null)
    showToast("Equipo eliminado", "success")
    syncApi({ action: "deleteEquipo", equipoId: deleteDialog.EquipoID })
  }

  const pct = (eq: Equipo) => {
    const max = Number(eq.Max_Cabeza) || 6000000
    const used = Number(eq.P_Cabeza) || 0
    return Math.min(Math.round((used / max) * 100), 100)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Nuevo Equipo</CardTitle>
          <Button size="sm" onClick={() => { setFormData(emptyEquipo); setEditingEquipo(null); setIsFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" /> Agregar
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lista de equipos</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {/* Secuencial visual: refleja el orden actual de la tabla. No es el ID real del equipo. */}
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("EquipoID")}>No. Equipo{sortIcon("EquipoID")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Sucursal")}>Sucursal{sortIcon("Sucursal")}</TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Observaciones")}>Cabina / Operadora{sortIcon("Observaciones")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Modelo")}>Modelo{sortIcon("Modelo")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Serie")}>Serie{sortIcon("Serie")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("P_Cabeza")}>Pulsos cabeza{sortIcon("P_Cabeza")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("P_Totales")}>Pulsos totales{sortIcon("P_Totales")}</TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => handleSort("Estado")}>Estado{sortIcon("Estado")}</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {db.equipos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No hay equipos registrados
                  </TableCell>
                </TableRow>
              ) : (
                sortedEquipos.map((eq, i) => (
                  <TableRow key={eq.EquipoID || i}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-medium">{eq.EquipoID}</TableCell>
                    <TableCell>{eq.Sucursal}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{eq.Observaciones || "-"}</TableCell>
                    <TableCell>{eq.Modelo}</TableCell>
                    <TableCell className="text-muted-foreground">{eq.Serie || "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={pct(eq)} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground w-8">{pct(eq)}%</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {Number(eq.P_Cabeza || 0).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {Number(eq.P_Totales || 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={eq.Estado === "Activo" ? "default" : "secondary"}
                        className={eq.Estado === "Activo" ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}>
                        {eq.Estado || "Activo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <RecordActions
                          title={`Equipo: ${eq.EquipoID}`}
                          record={eq as unknown as Record<string, unknown>}
                          onEdit={() => { setFormData(eq); setEditingEquipo(eq); setIsFormOpen(true) }}
                          onDelete={() => setDeleteDialog(eq)}
                        />
                        <Button size="icon" variant="ghost" onClick={() => handleToggleStatus(eq)}>
                          {eq.Estado === "Activo"
                            ? <PowerOff className="h-3.5 w-3.5 text-orange-500" />
                            : <Power className="h-3.5 w-3.5 text-green-500" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(o) => { if (!o) { setIsFormOpen(false); setEditingEquipo(null) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEquipo ? `Editar: ${editingEquipo.EquipoID}` : "Nuevo Equipo"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5">
              <Label>ID Equipo / Serie *</Label>
              <Input value={formData.EquipoID} onChange={e => setFormData({ ...formData, EquipoID: e.target.value })}
                placeholder="Ej: 133" disabled={!!editingEquipo} />
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal</Label>
              <Select value={formData.Sucursal} onValueChange={v => setFormData({ ...formData, Sucursal: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {activeSucursales.length > 0
                    ? activeSucursales.map(s => <SelectItem key={s.Codigo} value={s.Nombre}>{s.Nombre}</SelectItem>)
                    : <>
                        <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                        <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                        <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                        <SelectItem value="La Vega">La Vega</SelectItem>
                      </>
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Modelo</Label>
              <Input value={formData.Modelo} onChange={e => setFormData({ ...formData, Modelo: e.target.value })}
                placeholder="Ej: CANDELA GENTLEYAG" />
            </div>
            <div className="space-y-1.5">
              <Label>Serie</Label>
              <Input value={formData.Serie} onChange={e => setFormData({ ...formData, Serie: e.target.value })} placeholder="Serie" />
            </div>
            <div className="space-y-1.5">
              <Label>Número</Label>
              <Input value={formData.Numero} onChange={e => setFormData({ ...formData, Numero: e.target.value })} placeholder="Número" />
            </div>
            <div className="space-y-1.5">
              <Label>Pulsos cabeza</Label>
              <Input type="number" value={formData.P_Cabeza}
                onChange={e => setFormData({ ...formData, P_Cabeza: Number(e.target.value) })} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label>Pulsos totales</Label>
              <Input type="number" value={formData.P_Totales}
                onChange={e => setFormData({ ...formData, P_Totales: Number(e.target.value) })} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label>Máx. cabeza</Label>
              <Input type="number" value={formData.Max_Cabeza}
                onChange={e => setFormData({ ...formData, Max_Cabeza: Number(e.target.value) })} min={0} />
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={formData.Estado} onValueChange={v => setFormData({ ...formData, Estado: v as "Activo" | "Inactivo" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activo">Activo</SelectItem>
                  <SelectItem value="Inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Empresa</Label>
              <Input value={formData.Empresa} onChange={e => setFormData({ ...formData, Empresa: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Observaciones</Label>
              <Input value={formData.Observaciones} onChange={e => setFormData({ ...formData, Observaciones: e.target.value })}
                placeholder="Notas opcionales" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsFormOpen(false); setEditingEquipo(null) }}>
              <X className="h-4 w-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              <Save className="h-4 w-4 mr-2" /> Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar equipo?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará el equipo <strong>{deleteDialog?.EquipoID}</strong> — {deleteDialog?.Modelo}. Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
