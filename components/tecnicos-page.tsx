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
import { Plus, Pencil, Trash2, Power, PowerOff, Save, X } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import type { Tecnico, Database } from "@/lib/types"

const emptyTecnico: Tecnico = {
  Codigo: "",
  Nombre: "",
  Telefono: "",
  Correo: "",
  Estado: "Activo",
  Notas: "",
}

export function TecnicosPage() {
  const {
    db,
    setDb,
    apiUrl,
    showToast,
    setIsLoading,
    setLoadingMessage,
    editingTecnico,
    setEditingTecnico,
  } = useAppStore()

  const [formData, setFormData] = useState<Tecnico>(emptyTecnico)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<Tecnico | null>(null)
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
    if (editingTecnico) {
      setFormData(editingTecnico)
      setIsFormOpen(true)
    }
  }, [editingTecnico])

  const handleSubmit = async () => {
    if (!formData.Codigo || !formData.Nombre) {
      showToast("Codigo y nombre son obligatorios", "error")
      return
    }

    // Guardar local primero
    const exists = db.tecnicos.find(t => t.Codigo === formData.Codigo)
    const updated = exists
      ? db.tecnicos.map(t => t.Codigo === formData.Codigo ? formData : t)
      : [...db.tecnicos, formData]
    setDb({ ...db, tecnicos: updated })
    setFormData(emptyTecnico)
    setEditingTecnico(null)
    setIsFormOpen(false)
    showToast("Técnico guardado", "success")
    // Sincronizar API en background
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try { await apiJsonp(normalized, { action: "saveTecnico", codigo: formData.Codigo, nombre: formData.Nombre, telefono: formData.Telefono || "", correo: formData.Correo || "", estado: formData.Estado, notas: formData.Notas || "" }) } catch(e) {}
    }
  }

  const handleToggleStatus = async (tecnico: Tecnico) => {
    const newStatus = tecnico.Estado === "Activo" ? "Inactivo" : "Activo"
    // Actualizar local inmediatamente
    setDb({
      ...db,
      tecnicos: db.tecnicos.map(t =>
        t.Codigo === tecnico.Codigo ? { ...t, Estado: newStatus as "Activo" | "Inactivo" } : t
      )
    })
    showToast(`Técnico ${newStatus === "Activo" ? "activado" : "desactivado"}`, "success")
    // Sincronizar API
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try { await apiJsonp(normalized, { action: "setTecnicoEstado", codigo: tecnico.Codigo, estado: newStatus }) } catch(e) {}
    }
  }

  const handleDelete = async () => {
    if (!deleteDialog) return

    setIsLoading(true)
    setLoadingMessage("Eliminando tecnico...")

    const normalized = normalizeApiUrl(apiUrl)

    // Eliminar local primero
    setDb({ ...db, tecnicos: db.tecnicos.filter(t => t.Codigo !== deleteDialog.Codigo) })
    setDeleteDialog(null)
    showToast("Técnico eliminado", "success")
    setIsLoading(false)

    // Sincronizar API
    if (normalized) {
      try { await apiJsonp(normalized, { action: "deleteTecnico", codigo: deleteDialog.Codigo }) } catch(e) {}
    }
  }

  const handleEdit = (tecnico: Tecnico) => {
    setFormData(tecnico)
    setEditingTecnico(tecnico)
    setIsFormOpen(true)
  }

  const handleCancel = () => {
    setFormData(emptyTecnico)
    setEditingTecnico(null)
    setIsFormOpen(false)
  }

  const sortedTecnicos = [...db.tecnicos].sort((a, b) => {
    if (!sortCol) return 0
    let va: any, vb: any
    switch(sortCol) {
      case "Codigo": va = String(a.Codigo || ""); vb = String(b.Codigo || ""); break
      case "Nombre": va = String(a.Nombre || ""); vb = String(b.Nombre || ""); break
      case "Telefono": va = String(a.Telefono || ""); vb = String(b.Telefono || ""); break
      case "Correo": va = String(a.Correo || ""); vb = String(b.Correo || ""); break
      case "Estado": va = String(a.Estado || ""); vb = String(b.Estado || ""); break
      case "Notas": va = String(a.Notas || ""); vb = String(b.Notas || ""); break
      default: return 0
    }
    if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase() }
    if (va < vb) return sortDir === "asc" ? -1 : 1
    if (va > vb) return sortDir === "asc" ? 1 : -1
    return 0
  })

  return (
    <div className="space-y-6">
      {/* Form Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {editingTecnico
              ? `Editar: ${editingTecnico.Nombre}`
              : "Nuevo Tecnico"}
          </CardTitle>
          {!isFormOpen && (
            <Button
              size="sm"
              onClick={() => setIsFormOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          )}
        </CardHeader>
        {isFormOpen && (
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="codigo">Codigo</Label>
                <Input
                  id="codigo"
                  placeholder="TEC-001"
                  value={formData.Codigo}
                  onChange={(e) =>
                    setFormData({ ...formData, Codigo: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre</Label>
                <Input
                  id="nombre"
                  placeholder="Juan Perez"
                  value={formData.Nombre}
                  onChange={(e) =>
                    setFormData({ ...formData, Nombre: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Telefono</Label>
                <Input
                  id="telefono"
                  placeholder="809-555-1234"
                  value={formData.Telefono || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, Telefono: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="correo">Correo</Label>
                <Input
                  id="correo"
                  type="email"
                  placeholder="juan@ejemplo.com"
                  value={formData.Correo || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, Correo: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estado">Estado</Label>
                <Select
                  value={formData.Estado}
                  onValueChange={(value: "Activo" | "Inactivo") =>
                    setFormData({ ...formData, Estado: value })
                  }
                >
                  <SelectTrigger id="estado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Activo">Activo</SelectItem>
                    <SelectItem value="Inactivo">Inactivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notas">Notas</Label>
                <Input
                  id="notas"
                  placeholder="Notas adicionales"
                  value={formData.Notas || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, Notas: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmit} className="gap-2">
                <Save className="h-4 w-4" />
                Guardar
              </Button>
              <Button variant="outline" onClick={handleCancel} className="gap-2">
                <X className="h-4 w-4" />
                Cancelar
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Table Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lista de tecnicos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Codigo")}>Codigo{sortIcon("Codigo")}</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Nombre")}>Nombre{sortIcon("Nombre")}</TableHead>
                  <TableHead className="hidden md:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Telefono")}>Telefono{sortIcon("Telefono")}</TableHead>
                  <TableHead className="hidden lg:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Correo")}>Correo{sortIcon("Correo")}</TableHead>
                  <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Estado")}>Estado{sortIcon("Estado")}</TableHead>
                  <TableHead className="hidden xl:table-cell cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Notas")}>Notas{sortIcon("Notas")}</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {db.tecnicos.length > 0 ? (
                  sortedTecnicos.map((t, i) => (
                    <TableRow key={t.Codigo}>
                      <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                      <TableCell className="font-medium">{t.Codigo}</TableCell>
                      <TableCell>{t.Nombre}</TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {t.Telefono || "-"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">
                        {t.Correo || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            t.Estado === "Activo" ? "default" : "secondary"
                          }
                          className={
                            t.Estado === "Activo"
                              ? "bg-success/20 text-success hover:bg-success/30"
                              : ""
                          }
                        >
                          {t.Estado || "Activo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-muted-foreground">
                        {t.Notas || "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <RecordActions
                            title={`Técnico: ${t.Nombre}`}
                            record={t as unknown as Record<string, unknown>}
                            onEdit={() => handleEdit(t)}
                            onDelete={() => setDeleteDialog(t)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleStatus(t)}
                          >
                            {t.Estado === "Activo" ? (
                              <PowerOff className="h-4 w-4 text-warning" />
                            ) : (
                              <Power className="h-4 w-4 text-success" />
                            )}
                            <span className="sr-only">Cambiar estado</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-muted-foreground py-8"
                    >
                      Sin tecnicos registrados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar tecnico</DialogTitle>
            <DialogDescription>
              {`¿Estas seguro de eliminar al tecnico ${deleteDialog?.Nombre}? Esta accion no se puede deshacer.`}
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
