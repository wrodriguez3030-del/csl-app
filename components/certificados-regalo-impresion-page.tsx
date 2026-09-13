"use client"

/**
 * CF PARA IMPRIMIR — módulo profesional de Certificados de Regalo de Cibao Spa
 * Láser. Contenedor: encabezado + pestañas (Certificados digitales / Pre-impreso
 * físico) y orquestación listado ↔ editor. La lógica vive en components/cf-imprimir.
 *
 * El id de menú (`cliente-certificados-imprimir`) y la ruta se conservan; no se
 * crea un menú nuevo ni se duplica ninguno.
 */
import { useMemo, useState, type ReactNode } from "react"
import { Gift, LayoutList, Stamp } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { useGiftCertificates, type GiftCertRecord } from "./cf-imprimir/use-gift-certificates"
import { GiftCertList } from "./cf-imprimir/gift-cert-list"
import { GiftCertEditor } from "./cf-imprimir/gift-cert-editor"
import { TalonarioPage } from "./cf-imprimir/talonario-page"

type Tab = "talonario" | "digital"
type View = "list" | "editor"

export function CertificadosRegaloImpresionPage() {
  const sucursalesDb = useAppStore((state) => state.db.sucursales)
  const user = useSessionUser()
  const gc = useGiftCertificates()

  const [tab, setTab] = useState<Tab>("digital")
  const [view, setView] = useState<View>("list")
  const [editing, setEditing] = useState<GiftCertRecord | null>(null)

  // Solo sucursales ACTIVAS, con su dirección oficial (fuente del sistema, §11).
  const sucursales = useMemo(
    () =>
      (sucursalesDb || [])
        .filter((s) => s.Estado !== "Inactiva")
        .map((s) => ({ nombre: s.Nombre, direccion: s.Direccion || "", telefono: s.Telefono || "" }))
        .filter((s) => s.nombre),
    [sucursalesDb],
  )

  const openNew = () => {
    setEditing(null)
    setView("editor")
  }
  const openRecord = (rec: GiftCertRecord) => {
    setEditing(rec)
    setView("editor")
  }
  const backToList = () => {
    setView("list")
    void gc.refresh()
  }
  const onChanged = (rec: GiftCertRecord) => {
    setEditing(rec)
    void gc.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Gift className="h-5 w-5 text-primary" />CERTIFICADO DE REGALOS
        </h2>
        <p className="text-sm text-muted-foreground">Creación, personalización e impresión de certificados de regalo</p>
      </div>

      {/* Pestañas */}
      <div className="grid gap-3 sm:grid-cols-2">
        <TabCard
          active={tab === "digital"}
          onClick={() => {
            setTab("digital")
            openNew()
          }}
          icon={<LayoutList className="h-6 w-6" />}
          title="Certificados digitales"
          description="Crear, emitir, canjear e imprimir"
        />
        <TabCard
          active={tab === "talonario"}
          onClick={() => setTab("talonario")}
          icon={<Stamp className="h-6 w-6" />}
          title="Talonario pre-impreso"
          description="Completar campos sobre certificado físico"
        />
      </div>

      {tab === "talonario" ? (
        <TalonarioPage />
      ) : view === "list" ? (
        <GiftCertList gc={gc} user={user} onNew={openNew} onOpen={openRecord} />
      ) : (
        <GiftCertEditor
          initial={editing}
          sucursales={sucursales}
          user={user}
          gc={gc}
          onBack={backToList}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function TabCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-4 rounded-2xl border-2 p-5 text-left transition ${
        active
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-background hover:border-primary/40 hover:bg-muted/40"
      }`}
    >
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        {icon}
      </span>
      <span>
        <span className={`block text-lg font-bold ${active ? "text-primary" : "text-foreground"}`}>{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
