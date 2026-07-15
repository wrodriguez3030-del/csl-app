"use client"

import { useState, useEffect } from "react"
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
import { Badge } from "@/components/ui/badge"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Power, PowerOff, Save, X } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import { RecordViewDialog } from "@/components/record-view-dialog"
import type { Sucursal, Database } from "@/lib/types"

const emptySucursal: Sucursal = {
  Codigo: "",
  Nombre: "",
  Ciudad: "",
  Direccion: "",
  Telefono: "",
  Estado: "Activa",
  Notas: "",
  Correo: "",
}

export function SucursalesPage() {
  const {
    db, setDb, apiUrl, showToast, setIsLoading, setLoadingMessage,
    editingSucursal, setEditingSucursal,
  } = useAppStore()

  const [formData, setFormData] = useState<Sucursal>(emptySucursal)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Sucursal | null>(null)
  const [viewSucursal, setViewSucursal] = useState<Sucursal | null>(null)
  const [sortCol, setSortCol] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }
  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 ml-1">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }


  useEffect(() => {
    if (editingSucursal) {
      setFormData(editingSucursal)
      setIsFormOpen(true)
    }
  }, [editingSucursal])

  const syncToApi = async (normalized: string, params: Record<string, string>) => {
    try {
      await apiJsonp(normalized, params)
    } catch (e) {
      console.warn("API sync failed:", e)
    }
  }

  const handleSubmit = async () => {
    if (!formData.Codigo || !formData.Nombre) {
      showToast("Codigo y nombre son obligatorios", "error")
      return
    }

    // 1. Guardar localmente primero (inmediato)
    const exists = db.sucursales.find(s => s.Codigo === formData.Codigo)
    let updatedSucursales: Sucursal[]
    if (exists) {
      updatedSucursales = db.sucursales.map(s => s.Codigo === formData.Codigo ? formData : s)
    } else {
      updatedSucursales = [...db.sucursales, formData]
    }
    setDb({ ...db, sucursales: updatedSucursales })
    setFormData(emptySucursal)
    setEditingSucursal(null)
    setIsFormOpen(false)
    showToast("Sucursal guardada", "success")

    // 2. Sincronizar con API en segundo plano
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      await syncToApi(normalized, {
        action: "saveSucursal",
        codigo: formData.Codigo,
        nombre: formData.Nombre,
        ciudad: formData.Ciudad || "",
        direccion: formData.Direccion || "",
        telefono: formData.Telefono || "",
        estado: formData.Estado,
        notas: formData.Notas || "",
        correo: formData.Correo || "",
      })
    }
  }

  const handleToggleStatus = async (sucursal: Sucursal) => {
    const newStatus = sucursal.Estado === "Activa" ? "Inactiva" : "Activa"
    
    // Actualizar localmente primero
    const updatedSucursales = db.sucursales.map(s =>
      s.Codigo === sucursal.Codigo ? { ...s, Estado: newStatus as "Activa" | "Inactiva" } : s
    )
    setDb({ ...db, sucursales: updatedSucursales })
    showToast(`Sucursal ${newStatus.toLowerCase()}`, "success")

    // Sincronizar con API
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      await syncToApi(normalized, {
        action: "setSucursalEstado",
        codigo: sucursal.Codigo,
        estado: newStatus,
      })
    }
  }

  const handleDelete = async () => {
    if (!deleteDialog) return

    // Eliminar localmente primero
    const updatedSucursales = db.sucursales.filter(s => s.Codigo !== deleteDialog.Codigo)
    setDb({ ...db, sucursales: updatedSucursales })
    setDeleteDialog(null)
    showToast("Sucursal eliminada", "success")

    // Sincronizar con API
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      await syncToApi(normalized, {
        action: "deleteSucursal",
        codigo: deleteDialog.Codigo,
      })
    }
  }

  const handleEdit = (sucursal: Sucursal) => {
    setFormData(sucursal)
    setEditingSucursal(sucursal)
    setIsFormOpen(true)
  }

  const sortedSucursales = [...db.sucursales].sort((a, b) => {
    if (!sortCol) return 0
    let va: any, vb: any
    switch(sortCol) {
      case "Codigo": va = String(a.Codigo || ""); vb = String(b.Codigo || ""); break
      case "Nombre": va = String(a.Nombre || ""); vb = String(b.Nombre || ""); break
      case "Ciudad": va = String(a.Ciudad || ""); vb = String(b.Ciudad || ""); break
      case "Direccion": va = String(a.Direccion || ""); vb = String(b.Direccion || ""); break
      case "Estado": va = String(a.Estado || ""); vb = String(b.Estado || ""); break
      case "Notas": va = String(a.Notas || ""); vb = String(b.Notas || ""); break
      case "Correo": va = String(a.Correo || ""); vb = String(b.Correo || ""); break
      default: return 0
    }
    if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase() }
    if (va < vb) return sortDir === "asc" ? -1 : 1
    if (va > vb) return sortDir === "asc" ? 1 : -1
    return 0
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Nueva Sucursal</CardTitle>
          <Button size="sm" onClick={() => { setFormData(emptySucursal); setEditingSucursal(null); setIsFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-2" /> Agregar
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lista de sucursales</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Codigo")}>Codigo{sortIcon("Codigo")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Nombre")}>Nombre{sortIcon("Nombre")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Ciudad")}>Ciudad{sortIcon("Ciudad")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Direccion")}>Direccion{sortIcon("Direccion")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Estado")}>Estado{sortIcon("Estado")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Notas")}>Notas{sortIcon("Notas")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Correo")}>Correo{sortIcon("Correo")}</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {db.sucursales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No hay sucursales registradas
                  </TableCell>
                </TableRow>
              ) : (
                sortedSucursales.map((s, i) => (
                  <TableRow
                    key={s.Codigo || i}
                    className="cursor-pointer"
                    onClick={() => setViewSucursal(s)}
                  >
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-medium">{s.Codigo}</TableCell>
                    <TableCell>{s.Nombre}</TableCell>
                    <TableCell>{s.Ciudad || "-"}</TableCell>
                    <TableCell>{s.Direccion || "-"}</TableCell>
                    <TableCell>
                      <Badge variant={s.Estado === "Activa" ? "default" : "secondary"}>
                        {s.Estado}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.Notas || "-"}</TableCell>
                    <TableCell>{s.Correo || "-"}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <RecordActions
                          title={`Sucursal: ${s.Nombre}`}
                          record={s as unknown as Record<string, unknown>}
                          onEdit={() => handleEdit(s)}
                          onDelete={() => setDeleteDialog(s)}
                        />
                        <Button size="icon" variant="ghost" onClick={() => handleToggleStatus(s)}>
                          {s.Estado === "Activa"
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
      <Dialog open={isFormOpen} onOpenChange={(open) => { if (!open) { setIsFormOpen(false); setEditingSucursal(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSucursal ? `Editar: ${editingSucursal.Nombre}` : "Nueva Sucursal"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Código *</Label>
                <Input value={formData.Codigo} onChange={(e) => setFormData({ ...formData, Codigo: e.target.value })} placeholder="Ej: RV" disabled={!!editingSucursal} />
              </div>
              <div className="space-y-1.5">
                <Label>Ciudad</Label>
                <Input value={formData.Ciudad} onChange={(e) => setFormData({ ...formData, Ciudad: e.target.value })} placeholder="Santiago" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={formData.Nombre} onChange={(e) => setFormData({ ...formData, Nombre: e.target.value })} placeholder="Nombre de la sucursal" />
            </div>
            <div className="space-y-1.5">
              <Label>Dirección</Label>
              <Input value={formData.Direccion} onChange={(e) => setFormData({ ...formData, Direccion: e.target.value })} placeholder="Dirección" />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={formData.Telefono || ""} onChange={(e) => setFormData({ ...formData, Telefono: e.target.value })} placeholder="809-000-0000 (aparece en el pie del certificado)" />
            </div>
            <div className="space-y-1.5">
              <Label>Correo</Label>
              <Input value={formData.Correo} onChange={(e) => setFormData({ ...formData, Correo: e.target.value })} placeholder="correo@ejemplo.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input value={formData.Notas} onChange={(e) => setFormData({ ...formData, Notas: e.target.value })} placeholder="Observaciones" />
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={formData.Estado} onValueChange={(v) => setFormData({ ...formData, Estado: v as "Activa" | "Inactiva" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activa">Activa</SelectItem>
                  <SelectItem value="Inactiva">Inactiva</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsFormOpen(false); setEditingSucursal(null) }}>
              <X className="h-4 w-4 mr-2" /> Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              <Save className="h-4 w-4 mr-2" /> Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordViewDialog
        record={viewSucursal as unknown as Record<string, unknown> | null}
        title={viewSucursal ? `Sucursal: ${viewSucursal.Nombre}` : ""}
        onClose={() => setViewSucursal(null)}
      />

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>¿Eliminar sucursal?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminará <strong>{deleteDialog?.Nombre}</strong>. Esta acción no se puede deshacer.
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
