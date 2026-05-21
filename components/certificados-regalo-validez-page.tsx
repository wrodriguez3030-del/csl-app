"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Search, ShieldCheck, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiJsonp, useAppStore } from "@/lib/store"
import type { CertificadoRegaloEmitido, CertificadoRegaloEstado } from "@/lib/certificado-regalo"

const estados: CertificadoRegaloEstado[] = ["Emitido", "Canjeado", "Anulado"]

function estadoClass(estado: string) {
  if (estado === "Canjeado") return "border-green-500/40 bg-green-500/10 text-green-400"
  if (estado === "Anulado") return "border-red-500/40 bg-red-500/10 text-red-400"
  return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
}

export function CertificadosRegaloValidezPage() {
  const apiUrl = useAppStore((state) => state.apiUrl)
  const [records, setRecords] = useState<CertificadoRegaloEmitido[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [selected, setSelected] = useState<CertificadoRegaloEmitido | null>(null)
  const [notas, setNotas] = useState("")
  const [loading, setLoading] = useState(false)

  const loadRecords = async () => {
    setLoading(true)
    try {
      const result = await apiJsonp(apiUrl, { action: "getCertificadosRegalo" })
      const rows = Array.isArray(result.records) ? (result.records as CertificadoRegaloEmitido[]) : []
      setRecords(rows)
      if (selected) {
        const refreshed = rows.find((record) => record.codigo === selected.codigo) || null
        setSelected(refreshed)
        setNotas(refreshed?.notasEstado || "")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecords()
  }, [apiUrl])

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const rows = term
      ? records.filter((record) =>
          [record.codigo, record.otorgadoA, record.cortesiaDe, record.validoPor, record.sucursal, record.estado]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : records
    return [...rows].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))
  }, [records, searchTerm])

  const selectRecord = (record: CertificadoRegaloEmitido) => {
    setSelected(record)
    setNotas(record.notasEstado || "")
  }

  const updateEstado = async (estado: CertificadoRegaloEstado) => {
    if (!selected) return
    const updated: CertificadoRegaloEmitido = {
      ...selected,
      estado,
      canjeadoEn: estado === "Canjeado" ? new Date().toISOString() : selected.canjeadoEn || "",
      notasEstado: notas,
    }
    await apiJsonp(apiUrl, { action: "saveCertificadoRegalo", data: JSON.stringify(updated) })
    setSelected(updated)
    setRecords((current) => current.map((record) => (record.codigo === updated.codigo ? updated : record)))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><ShieldCheck className="h-5 w-5 text-primary" />Validar Certificados</h2>
          <p className="text-sm text-muted-foreground">Consulta si un certificado existe y marca si ya fue canjeado por el cliente.</p>
        </div>
        <Button variant="outline" onClick={() => void loadRecords()} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Buscar certificado</CardTitle></CardHeader>
        <CardContent>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Codigo, cliente, sucursal, servicio..." />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader><CardTitle className="text-base">Resultados</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">Servicio</th>
                  <th className="px-3 py-2 text-left">Codigo</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-right">Accion</th>
                </tr></thead>
                <tbody>
                  {filtered.map((record) => (
                    <tr key={record.codigo} className="border-b">
                      <td className="px-3 py-2">{record.fecha}</td>
                      <td className="px-3 py-2 font-medium">{record.otorgadoA}</td>
                      <td className="px-3 py-2">{record.validoPor}</td>
                      <td className="px-3 py-2 font-mono text-xs">{record.codigo}</td>
                      <td className="px-3 py-2"><span className={`rounded-full border px-2 py-1 text-xs ${estadoClass(record.estado || "Emitido")}`}>{record.estado || "Emitido"}</span></td>
                      <td className="px-3 py-2 text-right"><Button size="sm" variant="outline" onClick={() => selectRecord(record)}>Ver</Button></td>
                    </tr>
                  ))}
                  {!filtered.length ? <tr><td className="px-3 py-10 text-center text-muted-foreground" colSpan={6}>No hay certificados con esa busqueda.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Control de validez</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className={`rounded-xl border p-4 ${estadoClass(selected.estado || "Emitido")}`}>
                  <div className="flex items-center gap-2 font-semibold">
                    {(selected.estado || "Emitido") === "Canjeado" ? <CheckCircle2 className="h-5 w-5" /> : (selected.estado || "Emitido") === "Anulado" ? <XCircle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                    {selected.estado || "Emitido"}
                  </div>
                  <div className="mt-1 text-xs opacity-80">{selected.codigo}</div>
                </div>
                <div className="grid gap-2 text-sm">
                  <div><b>Cliente:</b> {selected.otorgadoA}</div>
                  <div><b>Cortesia de:</b> {selected.cortesiaDe}</div>
                  <div><b>Valido por:</b> {selected.validoPor}</div>
                  <div><b>Sucursal:</b> {selected.sucursal || "-"}</div>
                  <div><b>Emitido:</b> {selected.fecha}</div>
                  <div><b>Canjeado:</b> {selected.canjeadoEn || "-"}</div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notas</Label>
                  <Input value={notas} onChange={(event) => setNotas(event.target.value)} placeholder="Ej: Servicio recibido, autorizado por..." />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {estados.map((estado) => (
                    <Button key={estado} variant={(selected.estado || "Emitido") === estado ? "default" : "outline"} onClick={() => void updateEstado(estado)}>{estado}</Button>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona un certificado para consultar o cambiar estado.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
