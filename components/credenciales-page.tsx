"use client"

import { useEffect, useMemo, useState } from "react"
import { Search, Plus, Trash2, Edit, Eye, Download, Upload, RefreshCw, Printer } from "lucide-react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SeqBadge } from "@/components/seq-badge"

type CredencialRecord = {
  id: string
  sucursal: string
  area: string
  equipo: string
  sistema: string
  usuario: string
  contrasena: string
  pin: string
  url: string
  correo: string
}
type CredencialSortKey = keyof Pick<CredencialRecord, "sucursal" | "area" | "equipo" | "sistema" | "usuario" | "contrasena" | "pin" | "url" | "correo">

const initialBranches = ["Rafael Vidal", "Los Jardines", "Villa Olga", "Depicenter"]

const emptyForm: CredencialRecord = {
  id: "",
  sucursal: "Rafael Vidal",
  area: "",
  equipo: "",
  sistema: "",
  usuario: "",
  contrasena: "",
  pin: "",
  url: "",
  correo: "",
}

function mask(value: string) {
  if (!value) return ""
  return "•".repeat(Math.max(4, Math.min(8, value.length)))
}

function normalizeUrl(url: string) {
  if (!url) return ""
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  return `https://${url}`
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let cell = ""
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      index++
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      row.push(cell)
      cell = ""
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index++
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ""
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function getCsvValue(record: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[alias.toLowerCase()]
    if (value !== undefined) return value.trim()
  }
  return ""
}

function hostFromUrl(url: string) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, "")
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "")
  }
}

function parseGooglePasswordsCsv(text: string, fallbackSucursal: string): CredencialRecord[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  return rows.slice(1).map((cells, index) => {
    const record = headers.reduce<Record<string, string>>((acc, header, headerIndex) => {
      acc[header] = cells[headerIndex] || ""
      return acc
    }, {})
    const name = getCsvValue(record, ["name", "nombre", "title", "titulo", "título"])
    const url = getCsvValue(record, ["url", "website", "sitio web", "sitio", "origin"])
    const username = getCsvValue(record, ["username", "user", "usuario", "nombre de usuario", "login"])
    const password = getCsvValue(record, ["password", "contrasena", "contraseña", "clave"])
    const note = getCsvValue(record, ["note", "notes", "nota", "notas"])
    const host = hostFromUrl(url)

    return {
      id: `GOOGLE-${Date.now()}-${index}`,
      sucursal: fallbackSucursal,
      area: "Google Password Manager",
      equipo: host || "Google",
      sistema: name || host || "Credencial Google",
      usuario: username,
      contrasena: password,
      pin: "",
      url,
      correo: username.includes("@") ? username : note,
    }
  }).filter((record) => record.sistema || record.usuario || record.contrasena || record.url)
}

function normalizeCredencial(raw: Record<string, unknown>): CredencialRecord {
  return {
    id: String(raw.CredencialID ?? raw.id ?? ""),
    sucursal: String(raw.Sucursal ?? raw.sucursal ?? ""),
    area: String(raw.Area ?? raw.area ?? ""),
    equipo: String(raw.Equipo ?? raw.equipo ?? ""),
    sistema: String(raw.Sistema ?? raw.sistema ?? ""),
    usuario: String(raw.Usuario ?? raw.usuario ?? ""),
    contrasena: String(raw.Contrasena ?? raw.contrasena ?? ""),
    pin: String(raw.PIN ?? raw.pin ?? ""),
    url: String(raw.URL ?? raw.url ?? ""),
    correo: String(raw.Correo ?? raw.correo ?? ""),
  }
}

export function CredencialesPage() {
  const { apiUrl, showToast, setIsLoading, setLoadingMessage } = useAppStore()
  const [records, setRecords] = useState<CredencialRecord[]>([])
  const [query, setQuery] = useState("")
  const [selectedBranch, setSelectedBranch] = useState("Todas")
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [viewRecord, setViewRecord] = useState<CredencialRecord | null>(null)
  const [form, setForm] = useState<CredencialRecord>(emptyForm)
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({})
  const [sortKey, setSortKey] = useState<CredencialSortKey>("sucursal")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const loadCredenciales = async () => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      setRecords([])
      return
    }

    try {
      setIsLoading(true)
      setLoadingMessage("Cargando credenciales...")
      const result = await apiJsonp(normalized, { action: "getCredenciales" })
      const rows = Array.isArray((result as { records?: unknown[] }).records)
        ? ((result as { records?: Record<string, unknown>[] }).records || [])
        : []
      setRecords(rows.map((r) => normalizeCredencial(r)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error cargando credenciales", "error")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadCredenciales()
  }, [apiUrl])

  const filtered = useMemo(() => {
    return records
      .filter((r) => {
        const matchesBranch = selectedBranch === "Todas" || r.sucursal === selectedBranch
        const haystack = [r.sucursal, r.area, r.equipo, r.sistema, r.usuario, r.url, r.correo].join(" ").toLowerCase()
        return matchesBranch && haystack.includes(query.toLowerCase())
      })
      .sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""), "es", { numeric: true }) * (sortDir === "asc" ? 1 : -1))
  }, [records, selectedBranch, query, sortKey, sortDir])

  function handleSort(key: CredencialSortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  function SortIcon({ col }: { col: CredencialSortKey }) {
    if (sortKey !== col) return <span className="ml-1 text-slate-500">⇅</span>
    return <span className="ml-1 text-cyan-400">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  function resetForm() {
    setForm(emptyForm)
    setEditing(null)
  }

  function openCreate() {
    resetForm()
    setOpen(true)
  }

  function openEdit(record: CredencialRecord) {
    setEditing(record.id)
    setForm(record)
    setOpen(true)
  }

  function printCredencial(record: CredencialRecord) {
    const rows: Array<[string, string]> = [
      ["Sucursal", record.sucursal],
      ["Área", record.area],
      ["Equipo", record.equipo],
      ["Sistema", record.sistema],
      ["Usuario", record.usuario],
      ["Contraseña", record.contrasena],
      ["PIN", record.pin],
      ["URL", record.url],
      ["Correo", record.correo],
    ]
    const escapeHtml = (value: string) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
    const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Credencial</title><style>
      body{font-family:Arial,sans-serif;padding:32px;color:#111} h1{color:#008c7a;margin:0 0 20px;text-align:center}
      table{width:100%;border-collapse:collapse} td{border-bottom:1px dotted #999;padding:10px 8px;font-size:13px}
      td:first-child{width:180px;font-weight:700;color:#006b5c}
    </style></head><body><h1>CIBAO SPA LASER</h1><h2>Sistema de Credenciales</h2><table>${rows
      .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
      .join("")}</table></body></html>`
    const printWindow = window.open("", "_blank")
    printWindow?.document.write(html)
    printWindow?.document.close()
    setTimeout(() => printWindow?.print(), 300)
  }

  async function saveRecord() {
    if (!form.sucursal || !form.area || !form.equipo || !form.sistema || !form.usuario) {
      showToast("Completa los campos obligatorios", "error")
      return
    }

    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      showToast("Configura la URL en Configuración", "error")
      return
    }

    const payload = {
      CredencialID: String(form.id || "").trim() || `CRD-${Date.now()}`,
      Sucursal: form.sucursal,
      Area: form.area,
      Equipo: form.equipo,
      Sistema: form.sistema,
      Usuario: form.usuario,
      Contrasena: form.contrasena,
      PIN: form.pin,
      URL: normalizeUrl(form.url),
      Correo: form.correo,
    }

    try {
      setIsLoading(true)
      setLoadingMessage("Guardando credencial...")
      const result = await apiJsonp(normalized, {
        action: "saveCredencial",
        data: JSON.stringify(payload),
      })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string }).error || "No se pudo guardar"))
      }
      await loadCredenciales()
      showToast(editing ? "Credencial actualizada" : "Credencial guardada", "success")
      setOpen(false)
      resetForm()
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error guardando", "error")
    } finally {
      setIsLoading(false)
    }
  }

  async function removeRecord(id: string) {
    if (!confirm("¿Eliminar credencial?")) return
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      showToast("Configura la URL en Configuración", "error")
      return
    }

    try {
      setIsLoading(true)
      setLoadingMessage("Eliminando credencial...")
      const result = await apiJsonp(normalized, { action: "deleteCredencial", id })
      if (!(result as { ok?: boolean }).ok) {
        throw new Error(String((result as { error?: string }).error || "No se pudo eliminar"))
      }
      await loadCredenciales()
      showToast("Credencial eliminada", "success")
      if (viewRecord?.id === id) setViewRecord(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Error eliminando", "error")
    } finally {
      setIsLoading(false)
    }
  }

  function toggleField(key: string) {
    setVisibleFields((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function importCredentialsFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) {
      showToast("Configura la URL en Configuración", "error")
      return
    }

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const text = String(e.target?.result || "")
        const firstLine = text.trim().split(/\r?\n/, 1)[0] || ""
        const defaultSucursal = selectedBranch !== "Todas" ? selectedBranch : "Rafael Vidal"
        const parsed = file.name.toLowerCase().endsWith(".csv") || firstLine.includes(",")
          ? parseGooglePasswordsCsv(text, defaultSucursal)
          : (JSON.parse(text) as CredencialRecord[])
        if (!Array.isArray(parsed)) throw new Error("Archivo no válido")

        setIsLoading(true)
        setLoadingMessage("Importando credenciales de Google...")
        for (const row of parsed) {
          await apiJsonp(normalized, {
            action: "saveCredencial",
            data: JSON.stringify({
              CredencialID: String(row.id || "").trim() || `CRD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              Sucursal: row.sucursal || defaultSucursal,
              Area: row.area || "Google Password Manager",
              Equipo: row.equipo || "Google",
              Sistema: row.sistema || "Credencial Google",
              Usuario: row.usuario || "",
              Contrasena: row.contrasena || "",
              PIN: row.pin || "",
              URL: normalizeUrl(row.url || ""),
              Correo: row.correo || "",
            }),
          })
        }
        await loadCredenciales()
        showToast(`${parsed.length} credenciales importadas`, "success")
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Archivo no válido", "error")
      } finally {
        setIsLoading(false)
      }
    }
    reader.readAsText(file)
  }

  function exportCSV() {
    const headers = ["Sucursal", "Área", "Equipo", "Sistema", "Usuario", "Contraseña", "PIN", "URL", "Correo"]
    const rows = filtered.map((r) => [r.sucursal, r.area, r.equipo, r.sistema, r.usuario, r.contrasena, r.pin, r.url, r.correo])
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "credenciales.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-2xl border-cyan-500/20 bg-cyan-50">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-cyan-700">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{records.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-blue-500/20 bg-blue-50">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-blue-700">Mostrando</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-purple-500/20 bg-purple-50">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-purple-700">Sucursal</p>
            <p className="mt-1 truncate text-lg font-bold text-slate-950">{selectedBranch}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-emerald-500/20 bg-emerald-50">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Importados Google</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{records.filter((record) => record.area === "Google Password Manager").length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="outline" className="h-11 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-cyan-50" onClick={() => void loadCredenciales()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualizar
        </Button>

        <Button onClick={openCreate} className="h-11 rounded-xl bg-cyan-500 px-5 text-slate-950 hover:bg-cyan-400">
          <Plus className="mr-2 h-4 w-4" />
          Agregar
        </Button>
      </div>

      <Card className="rounded-[28px] border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,45,68,.08)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl text-slate-950">Filtros y búsqueda</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
            <div>
              <Label className="mb-2 block text-sm text-slate-950">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-500" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Equipo, sistema, usuario, correo..." className="h-12 rounded-xl border-slate-200 bg-slate-50 pl-10 text-slate-950 placeholder:text-slate-500" />
              </div>
            </div>

            <div>
              <Label className="mb-2 block text-sm text-slate-950">Sucursal</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-slate-50 text-slate-950">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todas">Todas</SelectItem>
                  {initialBranches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={exportCSV} className="h-11 rounded-xl border-slate-200 bg-slate-50 text-slate-950 hover:bg-slate-50">
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>

            <label>
              <input type="file" accept=".csv,text/csv,application/json" className="hidden" onChange={importCredentialsFile} />
              <Button variant="outline" className="h-11 rounded-xl border-slate-200 bg-slate-50 text-slate-950 hover:bg-slate-50" asChild>
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  Importar Google CSV
                </span>
              </Button>
            </label>
            <div className="basis-full text-xs text-slate-500">
              Acepta el CSV exportado desde Google Password Manager. Se procesa en tu navegador y se guarda en Supabase.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[28px] border-slate-200 bg-white shadow-[0_18px_55px_rgba(15,45,68,.08)]">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
          <CardTitle className="text-2xl text-slate-950">Lista de registros</CardTitle>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
            {filtered.length} de {records.length}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!filtered.length ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No hay registros para mostrar.</div>
          ) : (
            <>
              {/* Mobile/tablet: cards */}
              <div className="space-y-3 p-4 lg:hidden">
                {filtered.map((record, index) => {
                  const passKey = `${record.id}-pass`
                  const pinKey = `${record.id}-pin`
                  const rowKey = `${record.id || "sinid"}-${record.usuario || "sinusuario"}-${index}-card`
                  return (
                    <div key={rowKey} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <SeqBadge n={index + 1} />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-950 break-words">{record.equipo || "—"}</div>
                            <div className="text-xs text-muted-foreground break-words">{record.sucursal || "—"} · {record.area || "—"}</div>
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 gap-0.5">
                          <button type="button" title="Ver" onClick={() => setViewRecord(record)} className="rounded-lg border border-cyan-500/30 p-1.5 text-cyan-600 hover:bg-cyan-50"><Eye className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Imprimir" onClick={() => printCredencial(record)} className="rounded-lg border border-cyan-500/30 p-1.5 text-cyan-600 hover:bg-cyan-50"><Printer className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Editar" onClick={() => openEdit(record)} className="rounded-lg border border-blue-500/30 p-1.5 text-blue-600 hover:bg-blue-50"><Edit className="h-3.5 w-3.5" /></button>
                          <button type="button" title="Eliminar" onClick={() => void removeRecord(record.id)} className="rounded-lg border border-red-500/30 p-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sistema</span>
                          <span className="break-words">{record.sistema || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Usuario</span>
                          <span className="font-mono text-cyan-700 break-all">{record.usuario || "—"}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Contraseña</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono break-all">{visibleFields[passKey] ? record.contrasena || "—" : mask(record.contrasena || "") || "—"}</span>
                            <button type="button" onClick={() => toggleField(passKey)} className="rounded p-0.5 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 flex-shrink-0"><Eye className="h-3 w-3" /></button>
                          </div>
                        </div>
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">PIN</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono break-all">{visibleFields[pinKey] ? record.pin || "—" : mask(record.pin || "") || "—"}</span>
                            <button type="button" onClick={() => toggleField(pinKey)} className="rounded p-0.5 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 flex-shrink-0"><Eye className="h-3 w-3" /></button>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">URL</span>
                          {record.url ? <a href={normalizeUrl(record.url)} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline break-all">{record.url}</a> : <span>—</span>}
                        </div>
                        <div className="col-span-2">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Correo</span>
                          <span className="break-all">{record.correo || "—"}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Desktop (lg+): tabla compacta con texto wrap, sin min-w forzado */}
              <div className="hidden max-h-[calc(100vh-360px)] overflow-auto lg:block">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-white text-slate-600 shadow-[0_1px_0_rgba(255,255,255,0.1)]">
                    <tr className="border-b border-slate-200 text-left">
                      <th className="px-2 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">#</th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("sucursal")}>Sucursal<SortIcon col="sucursal" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("area")}>Área<SortIcon col="area" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("equipo")}>Equipo<SortIcon col="equipo" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("sistema")}>Sistema<SortIcon col="sistema" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("usuario")}>Usuario<SortIcon col="usuario" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("contrasena")}>Contraseña<SortIcon col="contrasena" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("pin")}>PIN<SortIcon col="pin" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("url")}>URL<SortIcon col="url" /></button></th>
                      <th className="px-2 py-3 font-medium"><button type="button" onClick={() => handleSort("correo")}>Correo<SortIcon col="correo" /></button></th>
                      <th className="px-2 py-3 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((record, index) => {
                      const passKey = `${record.id}-pass`
                      const pinKey = `${record.id}-pin`
                      const rowKey = `${record.id || "sinid"}-${record.usuario || "sinusuario"}-${index}`
                      return (
                        <tr key={rowKey} className="group border-b border-slate-200 align-top text-slate-700 hover:bg-cyan-50/60">
                          <td className="px-2 py-2.5 text-center"><SeqBadge n={index + 1} /></td>
                          <td className="px-2 py-2.5 break-words" title={record.sucursal}>{record.sucursal || "—"}</td>
                          <td className="px-2 py-2.5 break-words" title={record.area}>{record.area || "—"}</td>
                          <td className="px-2 py-2.5 break-words font-medium text-slate-950" title={record.equipo}>{record.equipo || "—"}</td>
                          <td className="px-2 py-2.5 break-words" title={record.sistema}>{record.sistema || "—"}</td>
                          <td className="px-2 py-2.5 break-all font-mono text-[11px] text-cyan-700" title={record.usuario}>{record.usuario || "—"}</td>
                          <td className="px-2 py-2.5"><div className="flex items-center gap-1"><span className="break-all font-mono text-[11px]">{visibleFields[passKey] ? record.contrasena || "—" : mask(record.contrasena || "") || "—"}</span><button type="button" onClick={() => toggleField(passKey)} className="rounded p-0.5 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 flex-shrink-0"><Eye className="h-3 w-3" /></button></div></td>
                          <td className="px-2 py-2.5"><div className="flex items-center gap-1"><span className="break-all font-mono text-[11px]">{visibleFields[pinKey] ? record.pin || "—" : mask(record.pin || "") || "—"}</span><button type="button" onClick={() => toggleField(pinKey)} className="rounded p-0.5 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 flex-shrink-0"><Eye className="h-3 w-3" /></button></div></td>
                          <td className="px-2 py-2.5 break-all" title={record.url}>{record.url ? <a href={normalizeUrl(record.url)} target="_blank" rel="noreferrer" className="text-cyan-700 hover:underline">{record.url}</a> : "—"}</td>
                          <td className="px-2 py-2.5 break-all" title={record.correo}>{record.correo || "—"}</td>
                          <td className="px-2 py-2.5"><div className="flex gap-0.5"><button type="button" title="Ver" onClick={() => setViewRecord(record)} className="rounded border border-cyan-500/30 p-1 text-cyan-600 hover:bg-cyan-50"><Eye className="h-3.5 w-3.5" /></button><button type="button" title="Imprimir" onClick={() => printCredencial(record)} className="rounded border border-cyan-500/30 p-1 text-cyan-600 hover:bg-cyan-50"><Printer className="h-3.5 w-3.5" /></button><button type="button" title="Editar" onClick={() => openEdit(record)} className="rounded border border-blue-500/30 p-1 text-blue-600 hover:bg-blue-50"><Edit className="h-3.5 w-3.5" /></button><button type="button" title="Eliminar" onClick={() => void removeRecord(record.id)} className="rounded border border-red-500/30 p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1280px] overflow-y-auto rounded-[28px] border-slate-200 bg-white text-slate-950">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar registro" : "Nuevo registro"}</DialogTitle>
          </DialogHeader>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-50 p-4 text-sm text-cyan-700">
            Completa o edita la credencial. Los campos quedan organizados para trabajar más cómodo en pantalla amplia.
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Sucursal</Label>
              <Select value={form.sucursal} onValueChange={(v) => setForm({ ...form, sucursal: v })}>
                <SelectTrigger className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {initialBranches.map((branch) => (
                    <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Área</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></div>
            <div><Label>Equipo</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.equipo} onChange={(e) => setForm({ ...form, equipo: e.target.value })} /></div>
            <div><Label>Sistema</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.sistema} onChange={(e) => setForm({ ...form, sistema: e.target.value })} /></div>
            <div><Label>Usuario</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} /></div>
            <div><Label>Contraseña</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.contrasena} onChange={(e) => setForm({ ...form, contrasena: e.target.value })} /></div>
            <div><Label>PIN</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} /></div>
            <div className="xl:col-span-2"><Label>URL</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
            <div><Label>Correo</Label><Input className="mt-2 rounded-xl border-slate-200 bg-slate-50 text-slate-950" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></div>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <Button variant="outline" className="rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-cyan-50" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => void saveRecord()} className="rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400">Guardar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewRecord} onOpenChange={(v) => !v && setViewRecord(null)}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1100px] overflow-y-auto rounded-[28px] border-slate-200 bg-white text-slate-950">
          <DialogHeader><DialogTitle>Ver registro</DialogTitle></DialogHeader>
          {viewRecord && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 text-sm">
              {[
                ["Sucursal", viewRecord.sucursal],
                ["Área", viewRecord.area],
                ["Equipo", viewRecord.equipo],
                ["Sistema", viewRecord.sistema],
                ["Usuario", viewRecord.usuario],
                ["Contraseña", viewRecord.contrasena],
                ["PIN", viewRecord.pin],
                ["URL", viewRecord.url],
                ["Correo", viewRecord.correo],
              ].map(([label, value], index) => (
                <Card key={`${label}-${index}`} className="rounded-2xl border-slate-200 bg-slate-50">
                  <CardContent className="p-4">
                    <div className="mb-2 text-slate-500">{label}</div>
                    <div className="break-all text-slate-950">{value || "—"}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CredencialesPage
