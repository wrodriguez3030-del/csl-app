"use client"

import { useEffect, useMemo, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ClipboardList, Send, Eraser, CheckSquare, Save } from "lucide-react"
import type { Material } from "@/lib/materials-client"

type Line = { checked: boolean; qty: number; note: string }

export function ReqMatNuevaPage() {
  const { apiUrl, showToast } = useAppStore()
  const [catalog, setCatalog] = useState<Material[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const endpoint = normalizeApiUrl(apiUrl)
        const [cat, br] = await Promise.all([
          apiCallCached(endpoint, { action: "getMaterialCatalog" }),
          apiCallCached(endpoint, { action: "getMaterialBranches" }),
        ])
        if (cat?.ok) setCatalog(((cat.records as Material[]) || []).filter((m) => m.active))
        if (br?.ok) {
          const list = (br.records as string[]) || []
          setBranches(list)
          if (list.length === 1) setBranch(list[0])
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al cargar", "error")
      } finally {
        setLoading(false)
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  const grouped = useMemo(() => {
    const g: Record<string, Material[]> = {}
    catalog.forEach((m) => { (g[m.supplierGroup || "—"] = g[m.supplierGroup || "—"] || []).push(m) })
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [catalog])

  const get = (id: string): Line => lines[id] || { checked: false, qty: 1, note: "" }
  const setLine = (id: string, patch: Partial<Line>) =>
    setLines((prev) => ({ ...prev, [id]: { ...get(id), ...patch } }))

  const selectedCount = Object.values(lines).filter((l) => l.checked).length

  const selectAllGroup = (mats: Material[]) => {
    const allChecked = mats.every((m) => get(m.id).checked)
    setLines((prev) => {
      const next = { ...prev }
      mats.forEach((m) => { next[m.id] = { ...get(m.id), checked: !allChecked } })
      return next
    })
  }
  const clearAll = () => setLines({})

  const buildItems = () =>
    catalog
      .filter((m) => get(m.id).checked && get(m.id).qty >= 1)
      .map((m) => ({
        materialId: m.id,
        materialName: m.name,
        supplierGroup: m.supplierGroup,
        unit: m.unit || "unidad",
        requestedQty: get(m.id).qty,
        note: get(m.id).note || "",
      }))

  const submit = async (status: "borrador" | "enviada") => {
    if (!branch) return showToast("Selecciona una sucursal", "error")
    const items = buildItems()
    if (status === "enviada" && items.length === 0) return showToast("Marca al menos un material con cantidad", "error")
    setSending(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveRequisition",
        branch,
        notes,
        status,
        items: JSON.stringify(items),
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error al guardar")
      invalidateReadCache("getMyRequisitions")
      showToast(status === "enviada" ? "Requisición enviada" : "Borrador guardado", "success")
      clearAll()
      setNotes("")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al enviar", "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between sm:p-4">
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Sucursal *</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nota general (opcional)</Label>
              <Input className="mt-1 h-9" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observación..." />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">{selectedCount} marcados</Badge>
            <Button variant="outline" className="h-9" onClick={clearAll}><Eraser className="mr-1.5 h-4 w-4" />Limpiar</Button>
            <Button variant="outline" className="h-9" onClick={() => submit("borrador")} disabled={sending}><Save className="mr-1.5 h-4 w-4" />Borrador</Button>
            <Button className="h-9" onClick={() => submit("enviada")} disabled={sending || !branch}><Send className="mr-1.5 h-4 w-4" />Enviar requisición</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Cargando materiales...</div>
      ) : (
        grouped.map(([supplier, mats]) => (
          <Card key={supplier} className="border-[color:var(--brand-border)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-[color:var(--brand-primary)]" /> {supplier}
                <Badge variant="secondary" className="ml-1">{mats.length}</Badge>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => selectAllGroup(mats)}>
                  <CheckSquare className="mr-1.5 h-4 w-4" /> Seleccionar todo
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="w-10 py-1.5"></th>
                      <th className="py-1.5">Material</th>
                      <th className="w-24 py-1.5">Cantidad</th>
                      <th className="w-20 py-1.5">Unidad</th>
                      <th className="py-1.5">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mats.map((m) => {
                      const l = get(m.id)
                      return (
                        <tr key={m.id} className={`border-b last:border-0 ${l.checked ? "bg-cyan-50/50" : ""}`}>
                          <td className="py-1.5">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-[color:var(--brand-primary)]"
                              checked={l.checked}
                              onChange={(e) => setLine(m.id, { checked: e.target.checked })}
                            />
                          </td>
                          <td className="py-1.5 font-medium">{m.name}</td>
                          <td className="py-1.5">
                            <Input
                              type="number"
                              min={1}
                              disabled={!l.checked}
                              value={l.qty}
                              onChange={(e) => setLine(m.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                              className="h-8 w-20"
                            />
                          </td>
                          <td className="py-1.5 text-xs text-muted-foreground">{m.unit}</td>
                          <td className="py-1.5">
                            <Input
                              disabled={!l.checked}
                              value={l.note}
                              onChange={(e) => setLine(m.id, { note: e.target.value })}
                              placeholder="Opcional"
                              className="h-8"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}
