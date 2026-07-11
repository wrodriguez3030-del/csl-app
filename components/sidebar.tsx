"use client"

import { useEffect, useMemo } from "react"
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
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Cog,
  ContactRound,
  Files,
  FileSignature,
  FileText,
  Gift,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Users,
  Wallet,
  Wrench,
  X,
  Zap,
  Monitor,
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
      { id: "panel", label: "Dashboard reportes y piezas", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "pulse-mantenimiento", label: "Dashboard Mantenimiento", icon: <Stethoscope className="h-4 w-4" /> },
      { id: "reporte", label: "Nuevo reporte", icon: <FileText className="h-4 w-4" /> },
      { id: "reportes", label: "Lista de reportes", icon: <ClipboardList className="h-4 w-4" /> },
      { id: "historial-equipos", label: "Historial por equipo", icon: <BarChart3 className="h-4 w-4" /> },
      { id: "inventario", label: "Inventario y piezas", icon: <Package className="h-4 w-4" /> },
      { id: "piezas-poliza", label: "Lista piezas póliza", icon: <ClipboardCheck className="h-4 w-4" /> },
      { id: "equipos", label: "Equipos", icon: <Wrench className="h-4 w-4" /> },
      { id: "tecnicos", label: "Tecnicos", icon: <Users className="h-4 w-4" /> },
      { id: "errores", label: "Consulta código errores", icon: <Cog className="h-4 w-4" /> },
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
  { id: "pulsos-cuadre", label: "Cuadre semanal", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
]

const EXTRA_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Requisición de materiales",
    items: [
      { id: "req-mat-nueva", label: "Nueva requisición", icon: <FileText className="h-4 w-4" /> },
      { id: "req-mat-mis", label: "Mis requisiciones", icon: <ClipboardList className="h-4 w-4" /> },
      { id: "req-mat-consolidado", label: "Consolidado de compras", icon: <BarChart3 className="h-4 w-4" /> },
      { id: "req-mat-aprobaciones", label: "Aprobaciones", icon: <ShieldCheck className="h-4 w-4" /> },
      { id: "req-mat-materiales", label: "Materiales", icon: <Package className="h-4 w-4" /> },
      { id: "req-mat-inventario", label: "Inventario de materiales", icon: <Boxes className="h-4 w-4" /> },
      { id: "req-mat-inventario-historico", label: "Histórico de inventarios", icon: <History className="h-4 w-4" /> },
      { id: "req-mat-dashboard", label: "Dashboard materiales", icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: "Compras",
    items: [
      { id: "compras-dashboard", label: "Dashboard compras", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "compras-facturas", label: "Facturas de proveedores", icon: <FileText className="h-4 w-4" /> },
      { id: "compras-pagos", label: "Pagos / gastos", icon: <Coins className="h-4 w-4" /> },
      { id: "compras-gastos-menores", label: "Gastos menores", icon: <Wallet className="h-4 w-4" /> },
      { id: "compras-recurrentes", label: "Pagos recurrentes", icon: <CalendarClock className="h-4 w-4" /> },
    ],
  },
  {
    label: "Incentivos de Ventas",
    items: [
      { id: "comision-dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "comision-importar", label: "Importador", icon: <FileText className="h-4 w-4" /> },
      { id: "comision-sucursales", label: "Ventas por sucursal", icon: <Building2 className="h-4 w-4" /> },
      { id: "comision-prestadores", label: "Comisiones por prestador", icon: <Users className="h-4 w-4" /> },
      { id: "comision-productos", label: "Incentivos de productos", icon: <Package className="h-4 w-4" /> },
      { id: "comision-laser", label: "Comisión depilación láser", icon: <Zap className="h-4 w-4" /> },
      { id: "comision-clientes", label: "Clientes atendidos", icon: <Users className="h-4 w-4" /> },
      { id: "comision-calculo", label: "Cálculo mensual", icon: <Calculator className="h-4 w-4" /> },
      { id: "comision-liquidacion", label: "Liquidación de incentivos", icon: <Coins className="h-4 w-4" /> },
      { id: "comision-reglas", label: "Reglas de comisión", icon: <Cog className="h-4 w-4" /> },
      { id: "comision-historial", label: "Historial mensual", icon: <History className="h-4 w-4" /> },
      { id: "comision-reportes", label: "Reportes", icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Personal",
    items: [
      { id: "rrhh-dashboard", label: "Dashboard RR.HH.", icon: <LayoutDashboard className="h-4 w-4" /> },
      { id: "rrhh-solicitudes", label: "Solicitudes de empleo", icon: <Users className="h-4 w-4" /> },
      { id: "rrhh-empleados", label: "Empleados", icon: <Users className="h-4 w-4" /> },
      { id: "rrhh-contratos", label: "Contratos laborales", icon: <FileSignature className="h-4 w-4" /> },
      { id: "rrhh-documentos", label: "Documentos empleados", icon: <Files className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Asistencia",
    items: [
      { id: "rrhh-ponche", label: "Ponche / Reloj checador", icon: <ClipboardCheck className="h-4 w-4" /> },
      { id: "rrhh-kiosko-ponche", label: "Kiosko Ponche", icon: <Monitor className="h-4 w-4" /> },
      { id: "rrhh-asistencia", label: "Asistencia", icon: <ClipboardList className="h-4 w-4" /> },
      { id: "rrhh-horarios", label: "Horarios y turnos", icon: <BookOpen className="h-4 w-4" /> },
      { id: "rrhh-permisos", label: "Permisos y licencias", icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Pagos",
    items: [
      { id: "rrhh-nomina", label: "Nómina", icon: <FileText className="h-4 w-4" /> },
      { id: "rrhh-dias-laborados", label: "Días laborados", icon: <FileText className="h-4 w-4" /> },
      { id: "rrhh-incentivos", label: "Incentivos y comisiones", icon: <Sparkles className="h-4 w-4" /> },
      { id: "rrhh-vacaciones", label: "Vacaciones", icon: <FileText className="h-4 w-4" /> },
      { id: "rrhh-doble-sueldo", label: "Doble sueldo", icon: <Gift className="h-4 w-4" /> },
      { id: "rrhh-prestamos", label: "Préstamos y avances", icon: <FileText className="h-4 w-4" /> },
      { id: "rrhh-txt-bancarios", label: "Archivos TXT bancarios", icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Prestaciones",
    items: [
      { id: "rrhh-liquidaciones", label: "Liquidaciones y prestaciones RD", icon: <FileSignature className="h-4 w-4" /> },
      { id: "rrhh-pdf-prestaciones", label: "PDF de prestaciones", icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Desarrollo",
    items: [
      { id: "rrhh-reclutamiento", label: "Reclutamiento", icon: <Users className="h-4 w-4" /> },
      { id: "rrhh-onboarding", label: "Onboarding", icon: <ClipboardCheck className="h-4 w-4" /> },
      { id: "rrhh-evaluacion", label: "Evaluación de desempeño", icon: <Sparkles className="h-4 w-4" /> },
      { id: "rrhh-disciplina", label: "Disciplina", icon: <ShieldCheck className="h-4 w-4" /> },
      { id: "rrhh-capacitacion", label: "Capacitación", icon: <BookOpen className="h-4 w-4" /> },
      { id: "rrhh-comunicacion", label: "Comunicación interna", icon: <FileText className="h-4 w-4" /> },
    ],
  },
  {
    label: "RR.HH. · Reportes",
    items: [
      { id: "rrhh-reportes", label: "Reportes RR.HH.", icon: <BarChart3 className="h-4 w-4" /> },
      { id: "rrhh-auditoria", label: "Auditoría RR.HH.", icon: <ShieldCheck className="h-4 w-4" /> },
    ],
  },
  {
    label: "Clientes y Consentimientos",
    items: [
      { id: "cosmiatria-clientes", label: "Clientes", icon: <ContactRound className="h-4 w-4" /> },
      { id: "cosmiatria-ficha", label: "Ficha Dermatologia", icon: <Sparkles className="h-4 w-4" /> },
      { id: "consent-masajes", label: "Consentimiento Masajes", icon: <FileSignature className="h-4 w-4" /> },
      { id: "consent-peeling", label: "Consentimiento Peeling", icon: <FileSignature className="h-4 w-4" /> },
      { id: "consent-tatuajes-cejas", label: "Eliminacion Tatuajes y Cejas", icon: <FileSignature className="h-4 w-4" /> },
      { id: "consent-depilacion-laser", label: "Consentimiento Depilacion Laser", icon: <Zap className="h-4 w-4" /> },
      { id: "reportes-firmados", label: "Historial Fichas y Consentimientos", icon: <Files className="h-4 w-4" /> },
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

const PULSE_LABEL = "PulseControl"

/** Grupo (label) al que pertenece un tab — para auto-abrir el acordeón. */
function groupLabelOf(tab: TabId): string | null {
  for (const g of CORE_GROUPS) if (g.items.some((i) => i.id === tab)) return g.label
  if (PULSE_ITEMS.some((i) => i.id === tab)) return PULSE_LABEL
  for (const g of EXTRA_GROUPS) if (g.items.some((i) => i.id === tab)) return g.label
  return null
}

export function Sidebar() {
  const {
    activeTab, setActiveTab, sidebarOpen, setSidebarOpen,
    sidebarCollapsed, setSidebarCollapsed, expandedGroup, setExpandedGroup, db,
  } = useAppStore()
  const user = useSessionUser()
  // Multi-tenant: branding dinámico según el business del usuario logueado.
  // Pre-migración (user sin businessSlug) cae a CSL → comportamiento idéntico.
  const business = useCurrentBusiness()

  const visiblePulse = useMemo(() => PULSE_ITEMS.filter((item) => canAccessMenu(user, item.id)), [user])
  const isPulseActive = visiblePulse.some((item) => item.id === activeTab)
  const isPulseOpen = expandedGroup === PULSE_LABEL

  // Acordeón: alternar un grupo (abrir uno cierra el resto). Preferencia visual.
  const toggleGroup = (label: string) => setExpandedGroup(expandedGroup === label ? null : label)

  // Auto-abrir el grupo del tab activo (al montar y al navegar).
  useEffect(() => {
    const g = groupLabelOf(activeTab)
    if (g) setExpandedGroup(g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  // Preferencia visual desktop → atributo en <body> que consume globals.css
  // (display:none del sidebar + padding-left:0 del contenido).
  useEffect(() => {
    document.body.setAttribute("data-sidebar-collapsed", sidebarCollapsed ? "true" : "false")
  }, [sidebarCollapsed])

  // Drawer móvil: cerrar con Escape + bloquear scroll del fondo mientras abierto.
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false) }
    window.addEventListener("keydown", onKey)
    const isMobile = window.matchMedia("(max-width: 1179.98px)").matches
    const prevOverflow = document.body.style.overflow
    if (isMobile) document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [sidebarOpen, setSidebarOpen])

  // "Ocultar menú": en desktop colapsa (display:none via body attr);
  // en móvil/tablet simplemente cierra el drawer.
  const handleHide = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1180px)").matches) {
      setSidebarCollapsed(true)
    } else {
      setSidebarOpen(false)
    }
  }

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
  const pendientesConsentsPeeling = useMemo(() => {
    const arr = (db as unknown as { consentPeeling?: Array<{ estado?: string }> }).consentPeeling || []
    return arr.filter((r) => String(r?.estado) === "Pendiente de revisión").length
  }, [db])
  const pendientesConsentsDepilacionLaser = useMemo(() => {
    const arr = (db as unknown as { consentDepilacionLaser?: Array<{ estado?: string }> }).consentDepilacionLaser || []
    return arr.filter((r) => String(r?.estado) === "Pendiente de revisión").length
  }, [db])

  const handleNavClick = (id: TabId) => {
    setActiveTab(id)
    setSidebarOpen(false)
  }

  // Auto-cerrar el sidebar al cargar / cambiar viewport a tablet (< 1180px).
  // El usuario reportó que la tableta lo veía abierto encima del formulario;
  // este efecto lo cierra en cualquier viewport menor al breakpoint de
  // desktop, sin afectar al usuario desktop que controla el sidebar por
  // su cuenta. Listener de resize para cubrir rotación tablet (vertical→horizontal).
  useEffect(() => {
    if (typeof window === "undefined") return
    const mql = window.matchMedia("(max-width: 1179px)")
    const closeIfMobile = () => { if (mql.matches) setSidebarOpen(false) }
    closeIfMobile()
    mql.addEventListener("change", closeIfMobile)
    return () => mql.removeEventListener("change", closeIfMobile)
  }, [setSidebarOpen])

  return (
    <>
      {/* Breakpoint custom 1180px (no xl:=1280px de Tailwind por defecto)
          porque el usuario reportó tabletas de 1180×820 donde xl: aún no
          activaba el sidebar fijo. Tailwind v4 acepta arbitrary variants
          tipo `min-[1180px]:`. */}
      {sidebarOpen ? <div data-csl-overlay className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} /> : null}
      {/* data-csl-sidebar + data-open consumidos por app/globals.css media
          queries (< 1180px = drawer; ≥ 1180px = fijo). El CSS explícito
          garantiza el comportamiento sin depender de Tailwind v4 variants. */}
      <aside
        data-csl-sidebar
        data-open={sidebarOpen ? "true" : "false"}
        className="fixed left-0 top-0 z-50 flex h-full max-h-dvh w-72 max-w-[82vw] flex-col overflow-hidden border-r border-[color:var(--brand-border)] bg-white shadow-[1px_0_0_rgba(15,45,68,.04)] transition-transform duration-300"
        style={{ transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)" }}
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
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ocultar menú"
              title="Ocultar menú"
              onClick={handleHide}
            >
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
            <NavGroup
              key={group.label}
              label={group.label}
              items={group.items.filter((item) => canAccessMenu(user, item.id))}
              activeTab={activeTab}
              onSelect={handleNavClick}
              open={expandedGroup === group.label}
              onToggle={() => toggleGroup(group.label)}
            />
          ))}

          {visiblePulse.length ? (
            <div className="rounded-xl bg-[color:var(--brand-primary-soft)] p-1.5 ring-1 ring-[color:var(--brand-primary)]/10">
              <button
                onClick={() => toggleGroup(PULSE_LABEL)}
                aria-expanded={isPulseOpen}
                aria-controls="nav-group-pulsecontrol"
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
                <div id="nav-group-pulsecontrol" className="mt-1 space-y-0.5 border-l-2 border-[color:var(--brand-primary)]/15 pl-2">
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
                  if (item.id === "consent-peeling" && pendientesConsentsPeeling > 0) {
                    return { ...item, count: pendientesConsentsPeeling }
                  }
                  if (item.id === "consent-tatuajes-cejas" && pendientesConsentsTatuajes > 0) {
                    return { ...item, count: pendientesConsentsTatuajes }
                  }
                  if (item.id === "consent-depilacion-laser" && pendientesConsentsDepilacionLaser > 0) {
                    return { ...item, count: pendientesConsentsDepilacionLaser }
                  }
                  return item
                })}
              activeTab={activeTab}
              onSelect={handleNavClick}
              open={expandedGroup === group.label}
              onToggle={() => toggleGroup(group.label)}
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

      {/* Botón "Mostrar menú": visible SOLO en desktop cuando el sidebar está
          oculto (globals.css lo controla vía body[data-sidebar-collapsed]). */}
      <button
        data-csl-sidebar-show
        aria-label="Mostrar menú"
        title="Mostrar menú"
        onClick={() => setSidebarCollapsed(false)}
        className="fixed left-3 top-3 z-40 items-center gap-2 rounded-xl border border-[color:var(--brand-border)] bg-white px-3 py-2 text-[13px] font-bold text-[color:var(--brand-primary-dark)] shadow-md transition-colors hover:bg-[color:var(--brand-bg-subtle)]"
      >
        <Menu className="h-4 w-4" /> Mostrar menú
      </button>
    </>
  )
}

function NavGroup({
  label,
  items,
  activeTab,
  onSelect,
  open,
  onToggle,
}: {
  label: string
  items: NavItem[]
  activeTab: TabId
  onSelect: (id: TabId) => void
  open: boolean
  onToggle: () => void
}) {
  if (!items.length) return null
  const hasActive = items.some((item) => item.id === activeTab)
  const panelId = `nav-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  const pendingCount = items.reduce((sum, item) => sum + (item.count || 0), 0)
  return (
    <section>
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-[color:var(--brand-bg-subtle)]",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.2em]",
            hasActive ? "text-[color:var(--brand-primary-dark)]" : "text-slate-400",
          )}
        >
          {label}
        </span>
        {!open && pendingCount > 0 ? (
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">{pendingCount}</span>
        ) : null}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
      </button>
      {open ? (
        <div id={panelId} className="mt-0.5 space-y-0.5">
          {items.map((item) => (
            <NavBtn key={item.id} item={item} active={activeTab === item.id} onClick={() => onSelect(item.id)} />
          ))}
        </div>
      ) : null}
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
