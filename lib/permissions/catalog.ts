/**
 * Catálogo central de permisos granulares (csl_user_profiles.permissions text[]).
 * Sin dependencias de runtime — importable por cliente y servidor, igual que
 * `lib/menus.ts`.
 *
 * MODELO: cierre por defecto. Toda acción del despachador declara el permiso
 * que exige en `action-map.ts`; una acción sin declarar se RECHAZA. Los menús
 * siguen decidiendo la VISIBILIDAD; los permisos deciden lo que se puede HACER.
 *
 * Granularidad: `<modulo>.ver` / `<modulo>.gestionar` para lo corriente, más
 * permisos con nombre propio para lo delicado.
 *
 * CAJA FUERTE: los permisos de `CAJA_FUERTE` NO se heredan del menú en el
 * arranque — nacen cerrados y los concede el superadministrador a mano. Además,
 * un `is_admin` corriente NO los bypassa (ver `hasPermission` en el servidor):
 * si cualquiera con `is_admin` pudiera abrirla, no sería una caja fuerte.
 */
export interface PermissionOption {
  id: string
  label: string
  section: string
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  // ── Compras y gastos ──────────────────────────────────────────────────────
  { id: "compras.ver", label: "Ver compras y gastos", section: "Compras" },
  { id: "compras.crear", label: "Crear facturas/gastos", section: "Compras" },
  { id: "compras.editar", label: "Editar compras/gastos", section: "Compras" },
  { id: "compras.pagar", label: "Registrar pagos", section: "Compras" },
  { id: "compras.aprobar", label: "Aprobar gastos menores", section: "Compras" },
  { id: "compras.anular", label: "Anular facturas/pagos", section: "Compras" },
  { id: "compras.eliminar", label: "Eliminar (borrador, soft delete)", section: "Compras" },
  { id: "compras.exportar", label: "Exportar PDF/Excel", section: "Compras" },

  // ── Requisición de materiales ─────────────────────────────────────────────
  { id: "material_requisitions.ver", label: "Ver requisiciones", section: "Requisición de materiales" },
  { id: "material_requisitions.gestionar", label: "Crear/aprobar/recibir requisiciones", section: "Requisición de materiales" },
  { id: "material_requisitions.delete", label: "Eliminar requisiciones", section: "Requisición de materiales" },
  { id: "materials.ver", label: "Ver catálogo de materiales", section: "Requisición de materiales" },
  { id: "materials.gestionar", label: "Gestionar catálogo de materiales", section: "Requisición de materiales" },
  { id: "materials.inventory.view", label: "Ver detalle de inventarios", section: "Requisición de materiales" },
  { id: "materials.inventory.print", label: "Imprimir inventarios", section: "Requisición de materiales" },
  { id: "materials.inventory.export_excel", label: "Exportar inventarios a Excel", section: "Requisición de materiales" },
  { id: "materials.inventory.export_pdf", label: "Generar PDF de inventarios", section: "Requisición de materiales" },
  // Un inventario finalizado es inmutable salvo por estas dos vías, ambas
  // auditadas y con motivo obligatorio.
  { id: "materials.inventory.correct", label: "Corregir inventarios finalizados", section: "Requisición de materiales" },
  { id: "materials.inventory.delete", label: "Eliminar inventarios finalizados", section: "Requisición de materiales" },

  // ── Inventario de Productos ───────────────────────────────────────────────
  { id: "productos.ver", label: "Ver inventario de productos", section: "Inventario de Productos" },
  { id: "productos.gestionar", label: "Importar y ajustar productos", section: "Inventario de Productos" },
  { id: "productos.aprobar_conteo", label: "Aprobar/rechazar conteos físicos", section: "Inventario de Productos" },

  // ── Incentivos de Ventas ──────────────────────────────────────────────────
  { id: "sales_commission.view", label: "Ver incentivos de ventas", section: "Incentivos de Ventas" },
  { id: "sales_commission.import", label: "Importar (general)", section: "Incentivos de Ventas" },
  { id: "sales_commission.import.sales", label: "Importar archivo de ventas", section: "Incentivos de Ventas" },
  { id: "sales_commission.import.reservations", label: "Importar archivo de reservas", section: "Incentivos de Ventas" },
  { id: "sales_commission.import.expenses", label: "Importar libro de gastos", section: "Incentivos de Ventas" },
  { id: "sales_commission.calculate", label: "Calcular comisiones", section: "Incentivos de Ventas" },
  { id: "sales_commission.rules.manage", label: "Gestionar reglas de comisión", section: "Incentivos de Ventas" },
  { id: "sales_commission.adjust", label: "Ajustes manuales", section: "Incentivos de Ventas" },
  { id: "sales_commission.bonus.manage", label: "Gestionar bono extra", section: "Incentivos de Ventas" },
  { id: "sales_commission.cleaning.manage", label: "Gestionar aporte de limpieza", section: "Incentivos de Ventas" },
  { id: "sales_commission.review", label: "Revisar liquidaciones", section: "Incentivos de Ventas" },
  { id: "sales_commission.approve", label: "Aprobar liquidaciones", section: "Incentivos de Ventas" },
  { id: "sales_commission.pay", label: "Marcar pagos", section: "Incentivos de Ventas" },
  { id: "sales_commission.close", label: "Cerrar período", section: "Incentivos de Ventas" },
  { id: "sales_commission.export", label: "Exportar Excel/PDF", section: "Incentivos de Ventas" },
  { id: "sales_commission.audit.view", label: "Ver auditoría de comisiones", section: "Incentivos de Ventas" },
  { id: "sales_commission.finance.manage", label: "Gestionar inversiones y retiros de socios", section: "Incentivos de Ventas" },

  // ── Certificados de Regalo ────────────────────────────────────────────────
  { id: "gift_certificates.ver", label: "Ver certificados de regalo", section: "Certificados de Regalo" },
  { id: "gift_certificates.gestionar", label: "Emitir y editar certificados", section: "Certificados de Regalo" },
  { id: "gift_certificates.void", label: "Anular certificados de regalo", section: "Certificados de Regalo" },

  // ── Credenciales ──────────────────────────────────────────────────────────
  // Además del permiso, el acceso exige verificación TOTP server-side.
  { id: "credenciales.view", label: "🔒 Ver credenciales (bóveda)", section: "Caja fuerte · Llaves y configuración" },
  { id: "credenciales.manage", label: "🔒 Crear/editar/borrar credenciales", section: "Caja fuerte · Llaves y configuración" },

  // ── BI Financiero IA ──────────────────────────────────────────────────────
  { id: "bi_finance.view", label: "Ver BI Financiero IA", section: "BI Financiero IA" },
  { id: "bi_finance.dashboard", label: "Ver dashboard financiero", section: "BI Financiero IA" },
  { id: "bi_finance.ai_chat", label: "Consultar al asistente IA", section: "BI Financiero IA" },
  { id: "bi_finance.sales", label: "Ver ventas e ingresos", section: "BI Financiero IA" },
  { id: "bi_finance.expenses", label: "Ver gastos y egresos", section: "BI Financiero IA" },
  { id: "bi_finance.profitability", label: "Ver rentabilidad por sucursal", section: "BI Financiero IA" },
  { id: "bi_finance.forecasts", label: "Ver / generar proyecciones", section: "BI Financiero IA" },
  { id: "bi_finance.investments", label: "Gestionar inversiones y ROI", section: "BI Financiero IA" },
  { id: "bi_finance.alerts", label: "Gestionar alertas financieras", section: "BI Financiero IA" },
  { id: "bi_finance.reports", label: "Generar reportes ejecutivos", section: "BI Financiero IA" },
  { id: "bi_finance.config", label: "Configurar el asistente IA", section: "BI Financiero IA" },
  { id: "bi_finance.ai_secrets.manage", label: "Gestionar credenciales OpenAI (API key)", section: "BI Financiero IA" },
  { id: "bi_finance.export", label: "Exportar PDF/Excel financiero", section: "BI Financiero IA" },

  // ── Integraciones · AgendaPro ─────────────────────────────────────────────
  { id: "integrations.agendapro.view", label: "Ver estado de AgendaPro", section: "Integraciones · AgendaPro" },
  { id: "integrations.agendapro.configure", label: "Configurar credenciales de AgendaPro", section: "Integraciones · AgendaPro" },
  { id: "integrations.agendapro.sync", label: "Sincronizar clientes de AgendaPro", section: "Integraciones · AgendaPro" },

  // ── RR.HH. · Personal ─────────────────────────────────────────────────────
  { id: "rrhh_personal.ver", label: "Ver empleados, contratos y documentos", section: "RR.HH. · Personal" },
  { id: "rrhh_personal.gestionar", label: "Crear/editar empleados, contratos y documentos", section: "RR.HH. · Personal" },

  // ── RR.HH. · Asistencia ───────────────────────────────────────────────────
  { id: "rrhh_asistencia.ver", label: "Ver ponches, asistencia y horarios", section: "RR.HH. · Asistencia" },
  { id: "rrhh_asistencia.gestionar", label: "Registrar ponches, horarios, permisos y geocercas", section: "RR.HH. · Asistencia" },

  // ── RR.HH. · Pagos ────────────────────────────────────────────────────────
  { id: "rrhh_pagos.ver", label: "Ver pagos, días laborados e incentivos", section: "RR.HH. · Pagos" },
  { id: "rrhh_pagos.gestionar", label: "Gestionar días laborados, incentivos y vacaciones", section: "RR.HH. · Pagos" },
  { id: "rrhh.nomina", label: "Correr y aprobar la nómina", section: "RR.HH. · Pagos" },
  { id: "rrhh.banco_txt", label: "Generar archivos TXT bancarios", section: "RR.HH. · Pagos" },
  { id: "rrhh.cuentas_bancarias", label: "Ver y editar cuentas bancarias de empleados", section: "RR.HH. · Pagos" },

  // ── RR.HH. · Desarrollo ───────────────────────────────────────────────────
  { id: "rrhh_desarrollo.ver", label: "Ver reclutamiento, evaluaciones y capacitación", section: "RR.HH. · Desarrollo" },
  { id: "rrhh_desarrollo.gestionar", label: "Gestionar reclutamiento, disciplina y capacitación", section: "RR.HH. · Desarrollo" },

  // ── RR.HH. · Reportes ─────────────────────────────────────────────────────
  { id: "rrhh_reportes.ver", label: "Ver reportes y auditoría de RR.HH.", section: "RR.HH. · Reportes" },

  // ── Clientes ──────────────────────────────────────────────────────────────
  { id: "clientes.ver", label: "Ver clientes y fichas", section: "Clientes" },
  { id: "clientes.gestionar", label: "Crear y editar clientes y fichas", section: "Clientes" },
  { id: "consentimientos.ver", label: "Ver consentimientos firmados", section: "Clientes" },
  { id: "consentimientos.gestionar", label: "Registrar consentimientos", section: "Clientes" },

  // ── Mantenimiento ─────────────────────────────────────────────────────────
  { id: "mantenimiento.ver", label: "Ver equipos, piezas, lecturas y reportes", section: "Mantenimiento" },
  { id: "mantenimiento.gestionar", label: "Registrar equipos, piezas, lecturas y reportes", section: "Mantenimiento" },
  { id: "mantenimiento.borrar", label: "Borrar registros de mantenimiento", section: "Mantenimiento" },

  // ── Configuración ─────────────────────────────────────────────────────────
  { id: "config.ver", label: "Ver sucursales y ajustes", section: "Configuración" },
  { id: "config.gestionar", label: "Editar sucursales", section: "Configuración" },

  // ══ CAJA FUERTE ══════════════════════════════════════════════════════════
  // Nacen CERRADOS: no se heredan del menú y un `is_admin` corriente no los
  // bypassa. Solo el superadministrador los concede.

  // Deudas y salidas
  { id: "rrhh.prestamos", label: "🔒 Préstamos y avances a empleados", section: "Caja fuerte · Deudas y salidas" },
  { id: "rrhh.prestaciones", label: "🔒 Liquidaciones y prestaciones", section: "Caja fuerte · Deudas y salidas" },
  { id: "rrhh.doble_sueldo", label: "🔒 Doble sueldo / regalía", section: "Caja fuerte · Deudas y salidas" },

  // Identidad y asistencia
  { id: "rrhh.ponche.pin", label: "🔒 Cambiar el PIN de ponche de un empleado", section: "Caja fuerte · Identidad y asistencia" },
  { id: "rrhh.ponche.dispositivos", label: "🔒 Autorizar tabletas de ponche", section: "Caja fuerte · Identidad y asistencia" },
  { id: "rrhh.ponche.anular", label: "🔒 Anular o borrar ponches", section: "Caja fuerte · Identidad y asistencia" },

  // Borrar registros
  { id: "rrhh.borrar", label: "🔒 Borrar registros de RR.HH.", section: "Caja fuerte · Borrar registros" },
  { id: "clientes.borrar", label: "🔒 Borrar clientes y fichas", section: "Caja fuerte · Borrar registros" },
  { id: "clientes.fusionar", label: "🔒 Fusionar clientes duplicados", section: "Caja fuerte · Borrar registros" },
  { id: "consentimientos.borrar", label: "🔒 Borrar consentimientos firmados", section: "Caja fuerte · Borrar registros" },

  // Llaves y configuración
  { id: "config.llaves", label: "🔒 Correo del sistema y claves de servicios", section: "Caja fuerte · Llaves y configuración" },
  { id: "usuarios.gestionar", label: "🔒 Administrar usuarios y permisos", section: "Caja fuerte · Llaves y configuración" },
]

/**
 * Permisos que NO se heredan del menú y que un `is_admin` corriente no bypassa.
 * Cambiar esta lista cambia quién puede hacer lo más delicado del sistema:
 * revísala con el dueño antes de tocarla.
 */
export const CAJA_FUERTE: ReadonlySet<string> = new Set([
  "rrhh.prestamos",
  "rrhh.prestaciones",
  "rrhh.doble_sueldo",
  "rrhh.ponche.pin",
  "rrhh.ponche.dispositivos",
  "rrhh.ponche.anular",
  "rrhh.borrar",
  "clientes.borrar",
  "clientes.fusionar",
  // Borrar un consentimiento firmado es destruir la defensa legal ante una
  // reclamación por un procedimiento láser. Borrar la ficha del mismo cliente
  // ya exigía la llave del dueño; esto no, y es igual de definitivo.
  "consentimientos.borrar",
  "config.llaves",
  // La bóveda exige TOTP además del permiso, pero el permiso lo bypassaba
  // cualquier `is_admin`: tres personas que no son el dueño entraban a los
  // secretos de equipos y sistemas. El segundo factor no sustituye al primero.
  "credenciales.view",
  "credenciales.manage",
  "usuarios.gestionar",
])

export const ALL_PERMISSION_IDS: string[] = PERMISSION_OPTIONS.map((p) => p.id)
export const PERMISSION_ID_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_IDS)

/** ¿Este permiso vive en la caja fuerte? */
export function esCajaFuerte(perm: string): boolean {
  return CAJA_FUERTE.has(perm)
}

/** Filtra una lista arbitraria a solo permisos válidos del catálogo. */
export function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const p of input) {
    if (typeof p === "string" && PERMISSION_ID_SET.has(p)) seen.add(p)
  }
  return Array.from(seen)
}

/**
 * Check de permiso para UI. `user` es el SystemUser de useSessionUser().
 * Espejo exacto de `hasPermission` del servidor: un `is_admin` bypassa los
 * permisos corrientes pero NO la caja fuerte; el superadministrador bypassa todo.
 */
export function canPerm(
  user: { isAdmin?: boolean; isSuperadmin?: boolean; permissions?: string[] } | null | undefined,
  perm: string,
): boolean {
  if (!user) return false
  if (user.isSuperadmin) return true
  if (user.permissions?.includes(perm)) return true
  return Boolean(user.isAdmin) && !CAJA_FUERTE.has(perm)
}
