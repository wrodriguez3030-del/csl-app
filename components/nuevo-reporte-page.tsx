"use client"

import { useState, useEffect, useCallback } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus, Save, X, Pencil, Trash2, Search } from "lucide-react"
import { SignaturePad } from "@/components/signature-pad"
import { SiNoButtons } from "@/components/si-no-buttons"
import type { PiezaIntervenida, Reporte, Database } from "@/lib/types"

const emptyReporte: Partial<Reporte> = {
  ID: "",
  Fecha: new Date().toISOString().slice(0, 10),
  EquipoID: "",
  Sucursal: "",
  Empresa: "",
  Cliente: "",
  Domicilio: "",
  Ciudad: "Santiago",
  Modelo: "",
  Serie: "",
  Numero: "",
  Tipo: "Preventivo",
  EstadoEquipo: "Operativo",
  Prioridad: "Baja",
  Problema: "",
  Correccion: "",
  Observaciones: "",
  Checklist: "",
  P_Cabeza: 0,
  P_Totales: 0,
  Atendio: "",
}

const emptyPieza: PiezaIntervenida = {
  pieza: "",
  categoria: "",
  accion: "Inspeccion",
  estado: "Buena",
  desgaste: 0,
  reemplazo: "No",
  costo: 0,
  pulsos: 0,
  observaciones: "",
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "-"
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

export function NuevoReportePage() {
  const {
    db,
    setDb,
    apiUrl,
    showToast,
    setIsLoading,
    setLoadingMessage,
    setActiveTab,
    piezasReporte,
    setPiezasReporte,
    addPiezaReporte,
    removePiezaReporte,
    clearPiezasReporte,
    editingReporte,
    setEditingReporte,
  } = useAppStore()

  const [formData, setFormData] = useState<Partial<Reporte>>(emptyReporte)
  const [piezaForm, setPiezaForm] = useState<PiezaIntervenida>(emptyPieza)
  const [editingPiezaIndex, setEditingPiezaIndex] = useState<number | null>(null)
  const [piezaSearch, setPiezaSearch] = useState("")
  const [firmaCliente, setFirmaCliente] = useState("")
  const [firmaTecnico, setFirmaTecnico] = useState("")
  const [fotos, setFotos] = useState<{ name: string; url: string }[]>(() => {
    // Recuperar fotos guardadas en sessionStorage
    try { return JSON.parse(sessionStorage.getItem('csl-fotos-reporte') || '[]') } catch { return [] }
  })

  const updateFotos = (newFotos: { name: string; url: string }[]) => {
    setFotos(newFotos)
    try { sessionStorage.setItem('csl-fotos-reporte', JSON.stringify(newFotos)) } catch {}
  }

  const handleFotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setFotos(prev => {
          const next = [...prev, { name: file.name, url: ev.target?.result as string }]
          try { sessionStorage.setItem('csl-fotos-reporte', JSON.stringify(next)) } catch {}
          return next
        })
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ""
  }

  const handleRemoveFoto = (index: number) => {
    updateFotos(fotos.filter((_, i) => i !== index))
  }

  const activeSucursales = db.sucursales
    .filter((s) => s.Estado?.toLowerCase() !== "inactiva")
    .sort((a, b) => (a.Nombre || "").localeCompare(b.Nombre || ""))
  const activeEquipos = db.equipos
    .filter((e) => e.Estado?.toLowerCase() !== "inactivo")
    .filter((e) => !formData.Sucursal || e.Sucursal === formData.Sucursal)
    .sort((a, b) => String(a.EquipoID || "").localeCompare(String(b.EquipoID || ""), undefined, { numeric: true }))
  const activeTecnicos = db.tecnicos.filter(
    (t) => t.Estado?.toLowerCase() !== "inactivo"
  )
  const activePiezas = db.piezas
    .filter((p) => p.Activa?.toLowerCase() !== "no")
    .filter((p) => !piezaSearch || (p.Pieza || "").toLowerCase().includes(piezaSearch.toLowerCase()) || (p.Categoria || "").toLowerCase().includes(piezaSearch.toLowerCase()))
    .sort((a, b) => (a.Pieza || "").localeCompare(b.Pieza || ""))

  // Parse piezas from JSON
  const parsePiezas = useCallback((json: string | undefined): PiezaIntervenida[] => {
    if (!json) return []
    try {
      const parsed = JSON.parse(json)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [])

  const getEquipoFields = (equipoId: string) => {
    const equipo = db.equipos.find((e) => e.EquipoID === equipoId)
    if (!equipo) return null

    return {
      EquipoID: equipoId,
      Sucursal: equipo.Sucursal || "",
      Empresa: equipo.Empresa || "",
      Domicilio: equipo.Domicilio || "",
      Modelo: equipo.Modelo || "",
      Serie: equipo.Serie || "",
      Numero: equipo.Numero || "",
      P_Cabeza: Number(String(equipo.P_Cabeza || 0).replace(/,/g, "")),
      P_Totales: Number(String(equipo.P_Totales || 0).replace(/,/g, "")),
    }
  }

  // Load editing reporte if exists
  useEffect(() => {
    if (editingReporte) {
      setFormData({
        ...editingReporte,
        Fecha: editingReporte.Fecha
          ? new Date(editingReporte.Fecha).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
      })
      const piezas = parsePiezas(editingReporte.PiezasJSON)
      setPiezasReporte(piezas)
      // Restaurar firmas si existen en el reporte
      if (editingReporte.FirmaCliente) setFirmaCliente(editingReporte.FirmaCliente)
      if (editingReporte.FirmaTecnico) setFirmaTecnico(editingReporte.FirmaTecnico)
      // Restaurar fotos si existen
      if ((editingReporte as any).Fotos) {
        try {
          const fotosGuardadas = JSON.parse((editingReporte as any).Fotos)
          updateFotos(fotosGuardadas)
        } catch {}
      }
    }
  }, [editingReporte, setPiezasReporte, parsePiezas])

  // Autofill equipment data
  const autofillEquipo = (equipoId: string) => {
    const equipoFields = getEquipoFields(equipoId)
    if (!equipoFields) return

    setFormData((prev) => ({
      ...prev,
      ...equipoFields,
    }))
  }

  const handleSucursalChange = (sucursalNombre: string) => {
    const sucursal = db.sucursales.find((s) => s.Nombre === sucursalNombre)
    const selectedEquipo = db.equipos.find((e) => e.EquipoID === formData.EquipoID)
    const keepEquipo = selectedEquipo?.Sucursal === sucursalNombre
    const firstEquipo = [...db.equipos]
      .filter((e) => e.Estado?.toLowerCase() !== "inactivo")
      .filter((e) => e.Sucursal === sucursalNombre)
      .sort((a, b) => String(a.EquipoID || "").localeCompare(String(b.EquipoID || ""), undefined, { numeric: true }))[0]
    const equipoFields = keepEquipo
      ? getEquipoFields(formData.EquipoID || "")
      : firstEquipo
        ? getEquipoFields(firstEquipo.EquipoID)
        : null

    setFormData((prev) => ({
      ...prev,
      Sucursal: sucursalNombre,
      Ciudad: sucursal?.Ciudad || prev.Ciudad || "Santiago",
      Domicilio: equipoFields?.Domicilio || sucursal?.Direccion || "",
      EquipoID: equipoFields?.EquipoID || "",
      Empresa: equipoFields?.Empresa || "",
      Modelo: equipoFields?.Modelo || "",
      Serie: equipoFields?.Serie || "",
      Numero: equipoFields?.Numero || "",
      P_Cabeza: equipoFields?.P_Cabeza || 0,
      P_Totales: equipoFields?.P_Totales || 0,
    }))
  }

  // Autofill category for piece
  const autofillPiezaCategoria = (piezaNombre: string) => {
    const pieza = db.piezas.find((p) => p.Pieza === piezaNombre)
    setPiezaForm((prev) => ({
      ...prev,
      pieza: piezaNombre,
      categoria: pieza?.Categoria || "",
    }))
  }

  // Add/update piece
  const handleAddPieza = () => {
    if (!piezaForm.pieza) {
      showToast("Selecciona una pieza", "error")
      return
    }

    if (editingPiezaIndex !== null) {
      const updated = [...piezasReporte]
      updated[editingPiezaIndex] = piezaForm
      setPiezasReporte(updated)
      setEditingPiezaIndex(null)
    } else {
      addPiezaReporte(piezaForm)
    }

    setPiezaForm(emptyPieza)
    showToast("Pieza agregada", "success")
  }

  // Edit piece
  const handleEditPieza = (index: number) => {
    setPiezaForm(piezasReporte[index])
    setEditingPiezaIndex(index)
  }

  // Save report
  const handleSubmit = async () => {
    if (!formData.EquipoID) { showToast("Selecciona un equipo", "error"); return }
    if (!formData.Atendio) { showToast("Ingresa el nombre del tecnico", "error"); return }

    const id = formData.ID || `RPT-${Date.now()}`
    const newReporte = {
      ...formData,
      ID: id,
      Fecha: formData.Fecha || new Date().toISOString().slice(0, 10),
      EquipoID: formData.EquipoID || "",
      Sucursal: formData.Sucursal || "",
      Tipo: formData.Tipo || "Preventivo",
      EstadoEquipo: formData.EstadoEquipo || "Operativo",
      Prioridad: formData.Prioridad || "Baja",
      Atendio: formData.Atendio || "",
      PiezasJSON: JSON.stringify(piezasReporte),
      FirmaCliente: firmaCliente || "",
      FirmaTecnico: firmaTecnico || "",
      Fotos: JSON.stringify(fotos),
    } as Reporte

    // Guardar local primero
    const exists = db.reportes.find(r => r.ID === id)
    setDb({
      ...db,
      reportes: exists
        ? db.reportes.map(r => r.ID === id ? newReporte : r)
        : [...db.reportes, newReporte]
    })
    setFormData(emptyReporte)
    clearPiezasReporte()
    setEditingReporte(null)
    updateFotos([])
    setFirmaCliente("")
    setFirmaTecnico("")
    showToast("Reporte guardado exitosamente", "success")
    setActiveTab("reportes")

    // Sincronizar API en background
    const normalized = normalizeApiUrl(apiUrl)
    if (normalized) {
      try {
        if (exists) {
          // UPDATE PARCIAL — solo envía los campos con valor real para
          // preservar firmas/fotos/piezas si el usuario solo cambió un texto.
          // El backend usa updateRowFields, no upsert full-row.
          const params: Record<string, string> = {
            action: "updateReporteCampos",
            reportId: id,
          }
          const put = (key: string, val: string | number | null | undefined) => {
            if (val === null || val === undefined) return
            const s = String(val).trim()
            if (s) params[key] = s
          }
          put("fecha", newReporte.Fecha)
          put("equipoId", formData.EquipoID)
          put("sucursal", formData.Sucursal)
          put("empresa", formData.Empresa)
          put("cliente", formData.Cliente)
          put("domicilio", formData.Domicilio)
          put("ciudad", formData.Ciudad)
          put("modelo", formData.Modelo)
          put("serie", formData.Serie)
          put("numero", formData.Numero)
          put("tipo", formData.Tipo)
          put("estadoEquipo", formData.EstadoEquipo)
          put("prioridad", formData.Prioridad)
          put("problema", formData.Problema)
          put("correccion", formData.Correccion)
          put("observaciones", formData.Observaciones)
          put("checklist", formData.Checklist)
          put("pcabeza", formData.P_Cabeza)
          put("ptotales", formData.P_Totales)
          put("atendio", formData.Atendio)
          put("partesTexto", formData.PartesTexto)
          // Estos se mandan SIEMPRE si tienen contenido (firmas, fotos,
          // piezas) — son listas/imagenes que el usuario puede haber
          // editado en este flujo.
          if (firmaCliente) params.firmaCliente = firmaCliente
          if (firmaTecnico) params.firmaTecnico = firmaTecnico
          if (fotos && fotos.length > 0) params.fotos = JSON.stringify(fotos)
          if (piezasReporte && piezasReporte.length > 0) params.piezasJson = JSON.stringify(piezasReporte)
          await apiJsonp(normalized, params)
        } else {
          // CREATE — saveReporte full-row es correcto al crear.
          const result = await apiJsonp(normalized, {
            action: "saveReporte", reportId: id,
            fecha: newReporte.Fecha, equipoId: formData.EquipoID || "",
            sucursal: formData.Sucursal || "", empresa: formData.Empresa || "",
            cliente: formData.Cliente || "", domicilio: formData.Domicilio || "",
            ciudad: formData.Ciudad || "Santiago", modelo: formData.Modelo || "",
            serie: formData.Serie || "", numero: formData.Numero || "",
            tipo: formData.Tipo || "Preventivo", estadoEquipo: formData.EstadoEquipo || "Operativo",
            prioridad: formData.Prioridad || "Baja", problema: formData.Problema || "",
            correccion: formData.Correccion || "", observaciones: formData.Observaciones || "",
            checklist: formData.Checklist || "", pcabeza: String(formData.P_Cabeza || 0),
            ptotales: String(formData.P_Totales || 0), atendio: formData.Atendio || "",
            piezasJson: JSON.stringify(piezasReporte), partesTexto: formData.PartesTexto || "",
            firmaCliente: firmaCliente || "", firmaTecnico: firmaTecnico || "",
            fotos: JSON.stringify(fotos),
          })
          const email = (result as { email?: { sent?: boolean; warning?: string } }).email
          if (email?.sent) showToast("Reporte enviado por correo con PDF", "success")
          else if (email?.warning) showToast(`Reporte guardado. Correo pendiente: ${email.warning}`, "error")
        }
      } catch(e) { console.warn("API sync reporte:", e) }
    }
  }

  // Clear form
  const handleClear = () => {
    setFormData(emptyReporte)
    clearPiezasReporte()
    setEditingReporte(null)
    setPiezaForm(emptyPieza)
    setEditingPiezaIndex(null)
    updateFotos([])
  }

  return (
    <div className="space-y-6">
      {/* General Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos generales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="fecha">Fecha</Label>
              <Input
                id="fecha"
                type="date"
                value={formData.Fecha || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Fecha: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="equipo">Equipo ID</Label>
              <Select
                value={formData.EquipoID || ""}
                onValueChange={(value) => autofillEquipo(value)}
              >
                <SelectTrigger id="equipo" className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {activeEquipos.map((eq) => (
                    <SelectItem key={eq.EquipoID} value={eq.EquipoID}>
                      {eq.EquipoID} - {eq.Modelo || "Equipo"}{eq.Observaciones ? ` (${eq.Observaciones})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sucursal">Sucursal</Label>
              <Select
                value={formData.Sucursal || ""}
                onValueChange={handleSucursalChange}
              >
                <SelectTrigger id="sucursal" className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {activeSucursales.length === 0 ? (
                    <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                      Carga datos o crea sucursales activas
                    </div>
                  ) : (
                    activeSucursales.map((sucursal) => (
                      <SelectItem key={sucursal.Codigo} value={sucursal.Nombre}>
                        {sucursal.Nombre}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tecnico">Tecnico</Label>
              <Select
                value={formData.Atendio || ""}
                onValueChange={(value) =>
                  setFormData({ ...formData, Atendio: value })
                }
              >
                <SelectTrigger id="tecnico" className="w-full">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {activeTecnicos.map((t) => (
                    <SelectItem key={t.Codigo} value={t.Nombre}>
                      {t.Nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="empresa">Empresa</Label>
              <Input
                id="empresa"
                value={formData.Empresa || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Empresa: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domicilio">Domicilio</Label>
              <Input
                id="domicilio"
                value={formData.Domicilio || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Domicilio: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ciudad">Ciudad</Label>
              <Input
                id="ciudad"
                value={formData.Ciudad || "Santiago"}
                onChange={(e) =>
                  setFormData({ ...formData, Ciudad: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente">Cliente / Responsable</Label>
              <Input
                id="cliente"
                value={formData.Cliente || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Cliente: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modelo">Modelo</Label>
              <Input
                id="modelo"
                value={formData.Modelo || ""}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serie">Serie</Label>
              <Input
                id="serie"
                value={formData.Serie || ""}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="numero">Numero</Label>
              <Input
                id="numero"
                value={formData.Numero || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Numero: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de servicio</Label>
              <Select
                value={formData.Tipo || "Preventivo"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    Tipo: value as Reporte["Tipo"],
                  })
                }
              >
                <SelectTrigger id="tipo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Preventivo">Preventivo</SelectItem>
                  <SelectItem value="Correctivo">Correctivo</SelectItem>
                  <SelectItem value="Garantia">Garantia</SelectItem>
                  <SelectItem value="Pago por servicio">Pago por servicio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="estadoEquipo">Estado equipo</Label>
              <Select
                value={formData.EstadoEquipo || "Operativo"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    EstadoEquipo: value as Reporte["EstadoEquipo"],
                  })
                }
              >
                <SelectTrigger id="estadoEquipo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Operativo">Operativo</SelectItem>
                  <SelectItem value="Observacion">Observacion</SelectItem>
                  <SelectItem value="Fuera de servicio">Fuera de servicio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prioridad">Prioridad</Label>
              <Select
                value={formData.Prioridad || "Baja"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    Prioridad: value as Reporte["Prioridad"],
                  })
                }
              >
                <SelectTrigger id="prioridad" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Baja">Baja</SelectItem>
                  <SelectItem value="Media">Media</SelectItem>
                  <SelectItem value="Alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pcabeza">Pulsos cabeza</Label>
              <Input
                id="pcabeza"
                type="number"
                value={formData.P_Cabeza || 0}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    P_Cabeza: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ptotales">Pulsos totales</Label>
              <Input
                id="ptotales"
                type="number"
                value={formData.P_Totales || 0}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    P_Totales: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="problema">Problema observado</Label>
              <Textarea
                id="problema"
                placeholder="Describe el problema detectado..."
                value={formData.Problema || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Problema: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="correccion">Correccion realizada</Label>
              <Textarea
                id="correccion"
                placeholder="Describe las correcciones aplicadas..."
                value={formData.Correccion || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Correccion: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="observaciones">Observaciones generales</Label>
              <Textarea
                id="observaciones"
                value={formData.Observaciones || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Observaciones: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="checklist">Checklist / Pruebas realizadas</Label>
              <Textarea
                id="checklist"
                value={formData.Checklist || ""}
                onChange={(e) =>
                  setFormData({ ...formData, Checklist: e.target.value })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Parts Intervention Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Intervencion de piezas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="pieza">Pieza intervenida</Label>
              <Select
                value={piezaForm.pieza}
                onValueChange={(value) => autofillPiezaCategoria(value)}
              >
                <SelectTrigger id="pieza">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 pb-2 pt-1 sticky top-0 bg-popover z-10">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className="w-full pl-7 pr-2 py-1 text-sm bg-background border border-border rounded focus:outline-none"
                        placeholder="Buscar pieza..."
                        value={piezaSearch}
                        onChange={(e) => setPiezaSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  {activePiezas.length === 0 && (
                    <div className="px-2 py-4 text-sm text-center text-muted-foreground">Sin coincidencias</div>
                  )}
                  {activePiezas.map((p) => (
                    <SelectItem key={p.Pieza} value={p.Pieza}>
                      {p.Pieza}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Input
                id="categoria"
                value={piezaForm.categoria}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accion">Accion realizada</Label>
              <Select
                value={piezaForm.accion}
                onValueChange={(value) =>
                  setPiezaForm({ ...piezaForm, accion: value })
                }
              >
                <SelectTrigger id="accion">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Inspeccion">Inspeccion</SelectItem>
                  <SelectItem value="Limpieza">Limpieza</SelectItem>
                  <SelectItem value="Ajuste">Ajuste</SelectItem>
                  <SelectItem value="Reparacion">Reparacion</SelectItem>
                  <SelectItem value="Reemplazo">Reemplazo</SelectItem>
                  <SelectItem value="Calibracion">Calibracion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="estadoPieza">Estado pieza</Label>
              <Select
                value={piezaForm.estado}
                onValueChange={(value) =>
                  setPiezaForm({ ...piezaForm, estado: value })
                }
              >
                <SelectTrigger id="estadoPieza">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Buena">Buena</SelectItem>
                  <SelectItem value="Desgaste leve">Desgaste leve</SelectItem>
                  <SelectItem value="Desgaste medio">Desgaste medio</SelectItem>
                  <SelectItem value="Desgaste alto">Desgaste alto</SelectItem>
                  <SelectItem value="Critica">Critica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="desgaste">% Desgaste</Label>
              <Input
                id="desgaste"
                type="number"
                min="0"
                max="100"
                value={piezaForm.desgaste || 0}
                onChange={(e) =>
                  setPiezaForm({
                    ...piezaForm,
                    desgaste: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <SiNoButtons
                label="¿Se reemplazó?"
                value={piezaForm.reemplazo}
                onChange={(value) => setPiezaForm({ ...piezaForm, reemplazo: value as "Sí" | "No" })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="costo">Costo (RD$)</Label>
              <Input
                id="costo"
                type="number"
                value={piezaForm.costo || 0}
                onChange={(e) =>
                  setPiezaForm({
                    ...piezaForm,
                    costo: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pulsosPieza">Pulsos al cambio</Label>
              <Input
                id="pulsosPieza"
                type="number"
                value={piezaForm.pulsos || 0}
                onChange={(e) =>
                  setPiezaForm({
                    ...piezaForm,
                    pulsos: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obsPieza">Observaciones tecnicas de pieza</Label>
            <Textarea
              id="obsPieza"
              placeholder="Detalles tecnicos de la pieza intervenida..."
              value={piezaForm.observaciones || ""}
              onChange={(e) =>
                setPiezaForm({ ...piezaForm, observaciones: e.target.value })
              }
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddPieza} className="gap-2">
              <Plus className="h-4 w-4" />
              {editingPiezaIndex !== null ? "Actualizar" : "Agregar"} pieza
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPiezaForm(emptyPieza)
                setEditingPiezaIndex(null)
              }}
              className="gap-2"
            >
              <X className="h-4 w-4" />
              Limpiar
            </Button>
          </div>

          {/* List of added parts */}
          {piezasReporte.length > 0 && (
            <div className="space-y-2 mt-4">
              <Label>Piezas agregadas</Label>
              <div className="space-y-2">
                {piezasReporte.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between p-3 rounded-lg border bg-secondary/30"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.pieza}</span>
                        <Badge variant="outline" className="text-xs">
                          {p.categoria}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {p.accion} - {p.estado} - Desgaste: {p.desgaste || 0}% -
                        Reemplazo: {p.reemplazo}
                        {p.costo ? ` - RD$${p.costo}` : ""}
                      </p>
                      {p.observaciones && (
                        <p className="text-sm">{p.observaciones}</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditPieza(i)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removePiezaReporte(i)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fotos */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Fotos del equipo / intervención</h3>
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFotoUpload}
              />
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Agregar fotos
              </span>
            </label>
          </div>
          {fotos.length === 0 ? (
            <div className="border-2 border-dashed border-border rounded-lg py-10 text-center text-muted-foreground text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Sin fotos. Haz clic en "Agregar fotos" para subir imágenes.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {fotos.map((foto, i) => (
                <div key={i} className="relative group rounded-lg overflow-hidden border border-border aspect-square bg-muted">
                  <img src={foto.url} alt={foto.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={() => handleRemoveFoto(i)}
                      className="bg-destructive text-white rounded-full p-1.5 hover:bg-destructive/80"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">{foto.name}</p>
                </div>
              ))}
              <label className="cursor-pointer aspect-square border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleFotoUpload} />
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Firmas */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="text-sm font-semibold mb-4">Firmas</h3>
          <div className="grid gap-6 sm:grid-cols-2">
            <SignaturePad
              label="Firma del Cliente"
              value={firmaCliente}
              onChange={setFirmaCliente}
            />
            <SignaturePad
              label="Firma del Técnico"
              value={firmaTecnico}
              onChange={setFirmaTecnico}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Button onClick={handleSubmit} size="lg" className="gap-2">
              <Save className="h-4 w-4" />
              Guardar reporte
            </Button>
            <Button variant="outline" onClick={handleClear} className="gap-2">
              <X className="h-4 w-4" />
              Nuevo reporte
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
