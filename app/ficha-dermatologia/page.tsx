"use client"

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { FichaDermatologiaForm } from "@/components/ficha-dermatologia-form"
import type { FichaDermoCosmiatrica } from "@/lib/dermo-cosmiatria"
import type { ClienteCosmiatria } from "@/lib/types"

export default function FichaDermatologiaPublicPage() {
  const [successId, setSuccessId] = useState("")
  const [operadoras, setOperadoras] = useState<string[]>([])
  const [clientes, setClientes] = useState<ClienteCosmiatria[]>([])

  useEffect(() => {
    const loadOperadoras = async () => {
      const response = await fetch(`/api/public/ficha-dermatologia?t=${Date.now()}`, { method: "GET", cache: "no-store" })
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; operadoras?: string[]; clientes?: ClienteCosmiatria[] }
      if (response.ok && result.ok) {
        setOperadoras(result.operadoras || [])
        setClientes(result.clientes || [])
      }
    }
    void loadOperadoras()
  }, [])

  const submit = async (value: FichaDermoCosmiatrica) => {
    const response = await fetch("/api/public/ficha-dermatologia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    })
    const raw = await response.text()
    let result: { ok?: boolean; error?: string; fichaId?: string } = {}
    try {
      result = raw ? JSON.parse(raw) : {}
    } catch {
      result = { error: raw }
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "No se pudo enviar la ficha")
    setSuccessId(String(result.fichaId || value.id))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  if (successId) {
    return (
      <main className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-green-500" />
          <h1 className="text-2xl font-bold">Ficha enviada correctamente</h1>
          <p className="mt-2 text-muted-foreground">Gracias. Cibao Spa Laser recibió tu ficha dermo-cosmiátrica.</p>
          <p className="mt-4 text-sm text-muted-foreground">Código: {successId}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-5xl">
        <FichaDermatologiaForm operadoras={operadoras} clientes={clientes} onSubmit={submit} />
      </div>
    </main>
  )
}
