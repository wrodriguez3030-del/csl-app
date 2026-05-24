"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store"
import type { TabId } from "@/lib/types"
import { canAccessMenu } from "@/lib/security"
import { useSessionUser } from "@/hooks/use-session-user"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { BusinessLogo } from "@/components/business-logo"
import {
  Activity,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Cog,
  ContactRound,
  Files,
  FileSignature,
  FileText,
  Gift,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"

interface NavItem {
  id: TabId
  label: string
  icon: React.ReactNode
  badge?: "NEW"
  /** Cantidad opcional a mostrar como contador (ej. pendientes de revisión). */
  count?: number
}

const CORE_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Gestion",
    items: [
      { id: "sucursales", label: "Sucursales", icon: <Building2 className="h-4 w-4" /> },
      { id: "credenciales", label: "Credenciales", icon: <KeyRound className="h-4 w-4" /> },
    ],
  },
  {
    label: "Mantenimiento",
    items: [
      { id: "panel", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "reporte", label: "Nuevo reporte", icon: <FileText className="h-4 w-4" /> },
      { id: "reportes", label: "Lista de reportes", icon: <ClipboardList className="h-4 w-4" /> },
      { id: "historial-equipos", label: "Historial por equipo", icon: <BarChart3 className="h-4 w-4" /> },
      { id: "inventario", label: "Inventario", icon: <Package className="h-4 w-4" /> },
      { id: "piezas-poliza", label: "Lista piezas póliza", icon: <ClipboardCheck className="h-4 w-4" /> },
      { id: "equipos", label: "Equipos", icon: <Wrench className="h-4 w-4" /> },
      { id: "tecnicos", label: "Tecnicos", icon: <Users className="h-4 w-4" /> },
      { id: "errores", label: "Errores y piezas", icon: <Cog className="h-4 w-4" /> },
    ],
  },
]

const PULSE_ITEMS: NavItem[] = [
  { id: "pulse-dashboard", label: "Dashboard", icon: <Gauge className="h-3.5 w-3.5" /> },
  { id: "pulse-equipos", label: "Equipos", icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "pulsos-operadoras", label: "Operadoras", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "pulsos-lecturas", label: "Lecturas semanales", icon: <BookOpen className="h-3.5 w-3.5" /> },
  { id: "pulsos-sesiones", label: "Registro de servicios", icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "pulsos-auditoria", label: "Auditoria / IA", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "pulse-mantenimiento", label: "Mantenimiento", icon: <Stethoscope className="h-3.5 w-3.5" /> },
]

const EXTRA_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Recursos humanos",
    items: [
      { id: "rrhh-solicitudes", label: "Solicitudes de empleo", icon: <Users className="h-4 w-4" /> },
      { id: "rrhh-empleados", label: "Empleados", icon: <Users className="h-4 w-4" /> },
    ],
  },
  {
    label: "Clientes y Consentimientos",
    items: [
      { id: "cosmiatria-clientes", label: "Clientes", icon: <ContactRound className="h-4 w-4" /> },
      { id: "cosmiatria-ficha", label: "Ficha Dermatologia", icon: <Sparkles className="h-4 w-4" /> },
      { id: "consent-masajes", label: "Consentimiento Masajes", icon: <FileSignature className="h-4 w-4" /> },
      { id: "consent-tatuajes-cejas", label: "Eliminacion Tatuajes y Cejas", icon: <FileSignature className="h-4 w-4" /> },
      { id: "reportes-firmados", label: "Reportes Consentimientos y Fichas", icon: <Files className="h-4 w-4" /> },
    ],
  },
  {
    label: "Atencion a cliente",
    items: [
      { id: "cliente-certificados", label: "CF Regalo Digital", icon: <Gift className="h-4 w-4" /> },
      { id: "cliente-certificados-depicenter", label: "Certificado Digital Depicenter", icon: <Gift className="h-4 w-4" /> },
      { id: "cliente-certificados-imprimir", label: "CF para imprimir", icon: <Gift className="h-4 w-4" /> },
      { id: "cliente-certificados-talonario", label: "CF Talonario pre-impreso", icon: <Gift className="h-4 w-4" /> },
      { id: "cliente-certificados-validez", label: "Validar certificados", icon: <Gift className="h-4 w-4" /> },
    ],
  },
  {
    label: "Administración",
    items: [
      { id: "admin-users", label: "Usuarios", icon: <ShieldCheck className="h-4 w-4" /> },
    ],
  },
  { label: "Sistema", items: [{ id: "config", label: "Configuracion", icon: <Settings className="h-4 w-4" /> }] },
]

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, pulsosSectionOpen, setPulsosSectionOpen, db } = useAppStore()
  const user = useSessionUser()
  // Multi-tenant: branding dinámico según el business del usuario logueado.
  // Pre-migración (user sin businessSlug) cae a CSL → comportamiento idéntico.
  const business = useCurrentBusiness()

  const visiblePulse = useMemo(() => PULSE_ITEMS.filter((item) => canAccessMenu(user, item.id)), [user])
  const isPulseActive = visiblePulse.some((item) => item.id === activeTab)
  const isPulseOpen = pulsosSectionOpen || isPulseActive

  // Contadores de "Pendiente de revisión" para badges del menú —
  // consents vienen ya cargados en el db global (getAllData los incluye).
  // Para Ficha Dermatológica no hay snapshot global, así que su badge se
  // omite acá (sigue mostrándose dentro del módulo cuando se entra).
  const pendientesConsentsMasajes = useMemo(() => {
    const arr = (db as unknown as { consentMasajes?: Array<{ estado?: string }> }).consentMasajes || []
    return arr.filter((r) => String(r?.estado) === "Pendiente de revisión").length
  }, [db])
  const pendientesConsentsTatuajes = useMemo(() => {
    const arr = (db as unknown as { consentTatuajesCejas?: Array<{ estado?: string }> }).consentTatuajesCejas || []
    return arr.filter((r) => String(r?.estado) === "Pendiente de revisión").length
  }, [db])

  const handleNavClick = (id: TabId) => {
    setActiveTab(id)
    setSidebarOpen(false)
  }

  return (
    <>
      {sidebarOpen ? <div className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} /> : null}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-72 flex-col overflow-hidden border-r border-[color:var(--brand-border)] bg-white shadow-[1px_0_0_rgba(15,45,68,.04)] transition-transform duration-300 lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="relative border-b border-[color:var(--brand-border)] px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {/* Logo: respetamos el área limpia que pide el manual de identidad. */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 ring-1 ring-[color:var(--brand-border)]">
                <BusinessLogo business={business} className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0">
                <h1 className="font-heading text-[15px] font-black leading-tight text-[color:var(--brand-primary-dark)]">{business.name}</h1>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">Sistema Integral {business.shortName}</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-[color:var(--brand-primary-soft)] px-3 py-2 ring-1 ring-[color:var(--brand-primary)]/15">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/70 text-[color:var(--brand-primary)] ring-1 ring-[color:var(--brand-primary)]/20">
              <Activity className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[color:var(--brand-primary-dark)]">Operación premium</div>
              <div className="text-[10px] leading-tight text-slate-500">Spa · Láser · Cosmiatría</div>
            </div>
          </div>
        </div>

        <nav className="relative flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {CORE_GROUPS.map((group) => (
            <NavGroup key={group.label} label={group.label} items={group.items.filter((item) => canAccessMenu(user, item.id))} activeTab={activeTab} onSelect={handleNavClick} />
          ))}

          {visiblePulse.length ? (
            <div className="rounded-xl bg-[color:var(--brand-primary-soft)] p-1.5 ring-1 ring-[color:var(--brand-primary)]/10">
              <button
                onClick={() => setPulsosSectionOpen(!isPulseOpen)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13px] font-bold transition-colors",
                  isPulseActive ? "bg-white text-[color:var(--brand-primary-dark)] ring-1 ring-[color:var(--brand-primary)]/20 shadow-sm" : "text-[color:var(--brand-primary-dark)] hover:bg-white/70"
                )}
              >
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[color:var(--brand-primary)] ring-1 ring-[color:var(--brand-primary)]/20">
                  <Zap className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    PulseControl {business.shortName} <span className="csl-new-badge">NEW</span>
                  </span>
                  <span className="block text-[11px] font-medium text-slate-500">Control de pulsos GentleYAG</span>
                </span>
                {isPulseOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </button>
              {isPulseOpen ? (
                <div className="mt-1 space-y-0.5 border-l-2 border-[color:var(--brand-primary)]/15 pl-2">
                  {visiblePulse.map((item) => (
                    <NavSubBtn key={item.id} item={item} active={activeTab === item.id} onClick={() => handleNavClick(item.id)} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {EXTRA_GROUPS.map((group) => (
            <NavGroup
              key={group.label}
              label={group.label}
              items={group.items
                .filter((item) => canAccessMenu(user, item.id))
                .map((item) => {
                  if (item.id === "consent-masajes" && pendientesConsentsMasajes > 0) {
                    return { ...item, count: pendientesConsentsMasajes }
                  }
                  if (item.id === "consent-tatuajes-cejas" && pendientesConsentsTatuajes > 0) {
                    return { ...item, count: pendientesConsentsTatuajes }
                  }
                  return item
                })}
              activeTab={activeTab}
              onSelect={handleNavClick}
            />
          ))}
        </nav>

        <div className="relative border-t border-[color:var(--brand-border)] p-4">
          <div className="rounded-xl bg-[color:var(--brand-bg-subtle)] px-3 py-2 ring-1 ring-[color:var(--brand-border)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{business.shortName} App</p>
            <p className="mt-0.5 text-xs text-slate-500">v24.0 · Seguridad por usuario</p>
          </div>
        </div>
      </aside>
    </>
  )
}

function NavGroup({
  label,
  items,
  activeTab,
  onSelect,
}: {
  label: string
  items: NavItem[]
  activeTab: TabId
  onSelect: (id: TabId) => void
}) {
  if (!items.length) return null
  return (
    <section>
      <div className="px-3 pb-1 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{label}</span>
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavBtn key={item.id} item={item} active={activeTab === item.id} onClick={() => onSelect(item.id)} />
        ))}
      </div>
    </section>
  )
}

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors",
        active
          ? "bg-[color:var(--brand-primary-soft)] text-[color:var(--brand-primary-dark)] ring-1 ring-[color:var(--brand-primary)]/15"
          : "text-slate-600 hover:bg-[color:var(--brand-bg-subtle)] hover:text-[color:var(--brand-primary-dark)]"
      )}
    >
      <span className={cn(
        "grid h-7 w-7 place-items-center rounded-lg transition-colors",
        active
          ? "bg-[color:var(--brand-primary)] text-white"
          : "bg-[color:var(--brand-bg-subtle)] text-[color:var(--brand-primary)] group-hover:bg-white group-hover:ring-1 group-hover:ring-[color:var(--brand-primary)]/15"
      )}>
        {item.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.count && item.count > 0 ? (
        <span
          className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm"
          title={`${item.count} pendiente(s) de revisión`}
        >
          {item.count}
        </span>
      ) : null}
      {item.badge ? <span className="csl-new-badge">{item.badge}</span> : null}
    </button>
  )
}

function NavSubBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold transition-colors",
        active
          ? "bg-white text-[color:var(--brand-primary)] ring-1 ring-[color:var(--brand-primary)]/20 shadow-sm"
          : "text-slate-500 hover:bg-white/80 hover:text-[color:var(--brand-primary-dark)]"
      )}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
    </button>
  )
}
