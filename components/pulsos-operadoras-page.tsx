"use client"

import { useState } from "react"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Plus, Pencil, Trash2, Save, X } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import type { Operadora } from "@/lib/types"

const empty: Operadora = {
  OperadoraID: "",
  Nombre: "",
  Sucursal: "",
  Estado: "Activa",
  Notas: "",
}

export function PulsosOperadorasPage() {
  const {
    db,
    dbPulsos,
    setDbPulsos,
    apiUrl,
    showToast,
    setIsLoading,
    setLoadingMessage,
  } = useAppStore()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Operadora>(empty)
  const [isEditing, setIsEditing] = useState(false)
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

  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setForm({ ...empty })
    setIsEditing(false)
    setOpen(true)
  }

  const openEdit = (op: Operadora) => {
    setForm({ ...op })
    setIsEditing(true)
    setOpen(true)
  }

  const handleSave = async () => {
    if (!form.Nombre.trim() || !form.Sucursal) {
      showToast("Nombre y sucursal son obligatorios", "error")
      return
    }
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      // Guardar local sin API
      const newOp: Operadora = {
        ...form,
        OperadoraID: form.OperadoraID || `op_${Date.now()}`,
      }
      if (isEditing) {
        setDbPulsos({
          ...dbPulsos,
          operadoras: dbPulsos.operadoras.map((o) =>
            o.OperadoraID === form.OperadoraID ? newOp : o
          ),
        })
      } else {
        setDbPulsos({
          ...dbPulsos,
          operadoras: [...dbPulsos.operadoras, newOp],
        })
      }
      showToast("Guardado localmente (sin API)", "info")
      setOpen(false)
      return
    }

    setSaving(true)
    try {
      const newOp: Operadora = {
        ...form,
        OperadoraID: form.OperadoraID || `op_${Date.now()}`,
      }
      const action = isEditing ? "updateOperadora" : "addOperadora"
      await apiJsonp(normalized, { action, data: JSON.stringify(newOp) })
      if (isEditing) {
        setDbPulsos({
          ...dbPulsos,
          operadoras: dbPulsos.operadoras.map((o) =>
            o.OperadoraID === newOp.OperadoraID ? newOp : o
          ),
        })
      } else {
        setDbPulsos({ ...dbPulsos, operadoras: [...dbPulsos.operadoras, newOp] })
      }
      showToast(isEditing ? "Operadora actualizada" : "Operadora agregada", "success")
      setOpen(false)
    } catch (e) {
      showToast("Error al guardar", "error")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (op: Operadora) => {
    if (!confirm(`¿Eliminar a ${op.Nombre}?`)) return
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try {
        await apiJsonp(normalized, { action: "deleteOperadora", id: op.OperadoraID })
      } catch {}
    }
    setDbPulsos({
      ...dbPulsos,
      operadoras: dbPulsos.operadoras.filter((o) => o.OperadoraID !== op.OperadoraID),
    })
    showToast("Operadora eliminada", "success")
  }

  const sortedOperadoras = [...dbPulsos.operadoras].sort((a, b) => {
    if (!sortCol) return 0
    let va: any, vb: any
    switch(sortCol) {
      case "Nombre": va = String(a.Nombre || ""); vb = String(b.Nombre || ""); break
      case "Sucursal": va = String(a.Sucursal || ""); vb = String(b.Sucursal || ""); break
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Operadoras</h2>
          <p className="text-sm text-muted-foreground">Personal que opera los equipos por sucursal</p>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Nueva Operadora
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                {/* El id técnico (OperadoraID: "op_...", alias legacy) NO se muestra:
                    el dato principal para el usuario es el NOMBRE. El id se conserva
                    internamente como key/relación para editar, eliminar y sesiones. */}
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Nombre")}>Operadora{sortIcon("Nombre")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Sucursal")}>Sucursal{sortIcon("Sucursal")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Estado")}>Estado{sortIcon("Estado")}</TableHead>
                <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("Notas")}>Notas{sortIcon("Notas")}</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dbPulsos.operadoras.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No hay operadoras registradas. Agrega la primera.
                  </TableCell>
                </TableRow>
              ) : (
                sortedOperadoras.map((op, i) => (
                  <TableRow key={op.OperadoraID}>
                    <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                    <TableCell className="font-medium">{op.Nombre}</TableCell>
                    <TableCell>{op.Sucursal}</TableCell>
                    <TableCell>
                      <Badge variant={op.Estado === "Activa" ? "default" : "secondary"}>
                        {op.Estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{op.Notas || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <RecordActions
                          title={`Operadora: ${op.Nombre}`}
                          // Ver/Imprimir sin el id técnico: solo campos legibles.
                          record={{
                            Nombre: op.Nombre,
                            Sucursal: op.Sucursal,
                            Estado: op.Estado,
                            Notas: op.Notas || "-",
                          }}
                          onEdit={() => openEdit(op)}
                          onDelete={() => handleDelete(op)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Editar Operadora" : "Nueva Operadora"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={form.Nombre}
                onChange={(e) => setForm({ ...form, Nombre: e.target.value })}
                placeholder="Nombre completo"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal *</Label>
              <Select value={form.Sucursal} onValueChange={(v) => setForm({ ...form, Sucursal: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar sucursal" />
                </SelectTrigger>
                <SelectContent>
                  {db.sucursales.length > 0 ? (
                    db.sucursales.map((s) => (
                      <SelectItem key={s.Codigo} value={s.Nombre}>
                        {s.Nombre}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                      <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                      <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                      <SelectItem value="La Vega">La Vega (Depicenter)</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={form.Estado}
                onValueChange={(v) => setForm({ ...form, Estado: v as Operadora["Estado"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activa">Activa</SelectItem>
                  <SelectItem value="Inactiva">Inactiva</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notas</Label>
              <Input
                value={form.Notas}
                onChange={(e) => setForm({ ...form, Notas: e.target.value })}
                placeholder="Observaciones opcionales"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
