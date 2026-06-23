"use client"

import { useEffect, useMemo, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Package, Plus, Search, Pencil, Save, X, Eye, EyeOff } from "lucide-react"
import type { Material } from "@/lib/materials-client"

const emptyForm = { id: "", name: "", supplierGroup: "BRAVO", unit: "unidad" }

export function ReqMatMaterialesPage() {
  const { apiUrl, showToast } = useAppStore()
  const [items, setItems] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterSupplier, setFilterSupplier] = useState("todos")
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const res = await apiCallCached(normalizeApiUrl(apiUrl), { action: "getMaterialCatalog" })
      if (res?.ok) setItems((res.records as Material[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar materiales", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [apiUrl])

  const suppliers = useMemo(
    () => Array.from(new Set(items.map((i) => i.supplierGroup).filter(Boolean))) as string[],
    [items],
  )
  const filtered = useMemo(
    () =>
      items.filter((i) => {
        if (!showInactive && !i.active) return false
        if (filterSupplier !== "todos" && i.supplierGroup !== filterSupplier) return false
        if (search && !`${i.name} ${i.supplierGroup}`.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [items, search, filterSupplier, showInactive],
  )

  const openNew = () => { setForm(emptyForm); setModal(true) }
  const openEdit = (m: Material) => {
    setForm({ id: m.id, name: m.name, supplierGroup: m.supplierGroup || "", unit: m.unit || "unidad" })
    setModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) return showToast("El nombre es obligatorio", "error")
    setSaving(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveMaterial",
        id: form.id,
        name: form.name,
        supplierGroup: form.supplierGroup,
        category: form.supplierGroup,
        unit: form.unit,
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error al guardar")
      invalidateReadCache("getMaterialCatalog")
      await load()
      showToast(form.id ? "Material actualizado" : "Material agregado", "success")
      setModal(false)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al guardar", "error")
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (m: Material) => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "setMaterialActive", id: m.id, active: String(!m.active) })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error")
      invalidateReadCache("getMaterialCatalog")
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, active: !m.active } : x)))
      showToast(m.active ? "Material inactivado" : "Material activado", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    }
  }

  const grouped = useMemo(() => {
    const g: Record<string, Material[]> = {}
    filtered.forEach((m) => { (g[m.supplierGroup || "—"] = g[m.supplierGroup || "—"] || []).push(m) })
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="h-9 pl-8" placeholder="Buscar material..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={filterSupplier} onValueChange={setFilterSupplier}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Proveedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los proveedores</SelectItem>
                {suppliers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" className="h-9" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? <EyeOff className="mr-1.5 h-4 w-4" /> : <Eye className="mr-1.5 h-4 w-4" />}
              {showInactive ? "Ocultar inactivos" : "Ver inactivos"}
            </Button>
          </div>
          <Button className="h-9 shrink-0" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />Agregar material</Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Cargando catálogo...</div>
      ) : grouped.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Sin materiales.</div>
      ) : (
        grouped.map(([supplier, mats]) => (
          <Card key={supplier} className="border-[color:var(--brand-border)]">
            <CardContent className="p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Package className="h-4 w-4 text-[color:var(--brand-primary)]" /> {supplier}
                <Badge variant="secondary" className="ml-1">{mats.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {mats.map((m) => (
                  <div key={m.id} className={`flex items-center justify-between rounded-md border px-3 py-1.5 text-sm ${m.active ? "bg-white" : "bg-slate-50 opacity-60"}`}>
                    <span className="truncate"><b>{m.name}</b> <span className="text-xs text-muted-foreground">· {m.unit}</span></span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(m)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(m)} title={m.active ? "Inactivar" : "Activar"}>
                        {m.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={modal} onOpenChange={(o) => !o && setModal(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form.id ? "Editar material" : "Nuevo material"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Nombre *</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. CLORO" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Proveedor / Categoría</Label>
                <Input className="mt-1" value={form.supplierGroup} onChange={(e) => setForm({ ...form, supplierGroup: e.target.value })} placeholder="BRAVO" />
              </div>
              <div>
                <Label className="text-xs">Unidad</Label>
                <Input className="mt-1" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="unidad" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(false)} disabled={saving}><X className="mr-1 h-4 w-4" />Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}><Save className="mr-1 h-4 w-4" />{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
