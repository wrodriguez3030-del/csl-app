"use client"

import { useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileCheck, ArrowRight } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

export function RrhhPdfPrestacionesPage() {
  const business = useCurrentBusiness()
  const { setActiveTab } = useAppStore()
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><FileCheck className="h-6 w-6" /></div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Prestaciones · {business.shortName}</p>
          <h2 className="mt-0.5 text-xl font-black tracking-tight">PDF de prestaciones</h2>
          <p className="mt-1 text-sm text-muted-foreground">El PDF profesional de prestaciones (con logo, conceptos, nota legal y firmas) se genera por registro.</p>
        </div>
      </div>
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Ve a <b>Liquidaciones y prestaciones RD</b>, abre el registro que quieras y usa el botón de impresión (<span className="font-mono">PDF</span>) para generar el documento con branding del tenant, nota legal y bloques de firma.
          </p>
          <Button onClick={() => setActiveTab("rrhh-liquidaciones")}>Ir a Liquidaciones <ArrowRight className="w-4 h-4 ml-1" /></Button>
        </CardContent>
      </Card>
    </div>
  )
}
