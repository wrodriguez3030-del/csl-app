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
import { canPerm } from "@/lib/permissions"
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

  const [tab, setTab] = useState<Tab>("talonario")
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

  const canView = canPerm(user, "gift_certificates.view")

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
          <Gift className="h-5 w-5 text-primary" />CF PARA IMPRIMIR
        </h2>
        <p className="text-sm text-muted-foreground">Creación, personalización e impresión de certificados de regalo</p>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b">
        <TabButton active={tab === "talonario"} onClick={() => setTab("talonario")} icon={<Stamp className="h-4 w-4" />}>
          Talonario pre-impreso
        </TabButton>
        <TabButton active={tab === "digital"} onClick={() => setTab("digital")} icon={<LayoutList className="h-4 w-4" />}>
          Certificados digitales
        </TabButton>
      </div>

      {tab === "talonario" ? (
        <TalonarioPage />
      ) : !canView ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          No tienes permiso para ver los certificados de regalo. Solicita el permiso <b>gift_certificates.view</b> a un administrador.
        </div>
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

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  )
}
