/**
 * HERENCIA: menú → permisos. Se usa UNA vez, en el arranque del modelo.
 *
 * Regla del dueño: «heredar del menú, salvo la caja fuerte». Así nadie se queda
 * bloqueado el lunes por un permiso que nunca se pudo conceder.
 *
 * DOS EXCLUSIONES, y las dos importan:
 *
 *  1. La CAJA FUERTE no se hereda nunca. Ningún menú aparece aquí concediendo
 *     préstamos, prestaciones, doble sueldo, PIN/dispositivos/anulación de
 *     ponche, borrados de RR.HH., borrado o fusión de clientes, llaves ni
 *     administración de usuarios.
 *
 *  2. Los permisos que YA EXISTÍAN antes de este modelo tampoco se heredan
 *     (`PERMISOS_PREEXISTENTES`). Compras, Incentivos, BI, Credenciales,
 *     Certificados e Integraciones ya estaban cerrados con `requirePermission`:
 *     derivarlos del menú REGALARÍA accesos que hoy nadie tiene. Cada usuario
 *     conserva exactamente los que ya tenía.
 *
 * Resultado: la herencia solo reparte los permisos NUEVOS, los de los módulos
 * que hasta ahora no tenían ninguno.
 */

/**
 * Permisos que ya existían en el catálogo antes del cierre por defecto. No se
 * derivan del menú: se conserva lo que cada usuario tuviera.
 */
export const PERMISOS_PREEXISTENTES: ReadonlySet<string> = new Set([
  "compras.ver", "compras.crear", "compras.editar", "compras.pagar", "compras.aprobar",
  "compras.anular", "compras.eliminar", "compras.exportar",
  "material_requisitions.delete",
  "materials.inventory.view", "materials.inventory.print", "materials.inventory.export_excel",
  "materials.inventory.export_pdf", "materials.inventory.correct", "materials.inventory.delete",
  "productos.aprobar_conteo",
  "sales_commission.view", "sales_commission.import", "sales_commission.import.sales",
  "sales_commission.import.reservations", "sales_commission.import.expenses",
  "sales_commission.calculate", "sales_commission.rules.manage", "sales_commission.adjust",
  "sales_commission.bonus.manage", "sales_commission.cleaning.manage", "sales_commission.review",
  "sales_commission.approve", "sales_commission.pay", "sales_commission.close",
  "sales_commission.export", "sales_commission.audit.view", "sales_commission.finance.manage",
  "gift_certificates.void",
  "credenciales.view", "credenciales.manage",
  "bi_finance.view", "bi_finance.dashboard", "bi_finance.ai_chat", "bi_finance.sales",
  "bi_finance.expenses", "bi_finance.profitability", "bi_finance.forecasts",
  "bi_finance.investments", "bi_finance.alerts", "bi_finance.reports", "bi_finance.config",
  "bi_finance.ai_secrets.manage", "bi_finance.export",
  "integrations.agendapro.view", "integrations.agendapro.configure", "integrations.agendapro.sync",
])

const MANTENIMIENTO = ["mantenimiento.ver", "mantenimiento.gestionar", "mantenimiento.borrar"]
const RRHH_ASISTENCIA = ["rrhh_asistencia.ver", "rrhh_asistencia.gestionar"]
const RRHH_PERSONAL = ["rrhh_personal.ver", "rrhh_personal.gestionar"]
const RRHH_PAGOS = ["rrhh_pagos.ver", "rrhh_pagos.gestionar"]
const RRHH_DESARROLLO = ["rrhh_desarrollo.ver", "rrhh_desarrollo.gestionar"]
const CONSENTIMIENTOS = ["consentimientos.ver", "consentimientos.gestionar", "consentimientos.borrar"]
const CLIENTES = ["clientes.ver", "clientes.gestionar"]
const CERTIFICADOS = ["gift_certificates.ver", "gift_certificates.gestionar"]
const PRODUCTOS = ["productos.ver", "productos.gestionar"]
const REQUISICION = ["material_requisitions.ver", "material_requisitions.gestionar"]
const MATERIALES = ["materials.ver", "materials.gestionar"]

/** Qué permisos NUEVOS concede cada menú. Un menú ausente concede nada. */
export const MENU_PERMISOS: Readonly<Record<string, readonly string[]>> = {
  // Gestión y sistema
  sucursales: ["config.ver", "config.gestionar"],
  config: ["config.ver"],

  // Mantenimiento y Pulsos
  panel: MANTENIMIENTO,
  "pulse-mantenimiento": MANTENIMIENTO,
  reporte: MANTENIMIENTO,
  reportes: MANTENIMIENTO,
  "historial-equipos": ["mantenimiento.ver"],
  inventario: MANTENIMIENTO,
  "piezas-poliza": MANTENIMIENTO,
  equipos: MANTENIMIENTO,
  tecnicos: MANTENIMIENTO,
  errores: ["mantenimiento.ver"],
  "pulse-dashboard": ["mantenimiento.ver"],
  "pulse-equipos": MANTENIMIENTO,
  "pulsos-operadoras": MANTENIMIENTO,
  "pulsos-lecturas": MANTENIMIENTO,
  "pulsos-sesiones": MANTENIMIENTO,
  "pulsos-auditoria": MANTENIMIENTO,
  "pulsos-cuadre": MANTENIMIENTO,

  // Requisición de materiales
  "req-mat-nueva": REQUISICION,
  "req-mat-mis": ["material_requisitions.ver"],
  "req-mat-consolidado": REQUISICION,
  "req-mat-aprobaciones": REQUISICION,
  "req-mat-materiales": MATERIALES,
  "req-mat-inventario": [...MATERIALES],
  "req-mat-inventario-historico": [],
  "req-mat-dashboard": ["material_requisitions.ver"],

  // Inventario de Productos
  "prod-catalogo": PRODUCTOS,
  "prod-importar": PRODUCTOS,
  "prod-reporte": ["productos.ver"],
  "prod-conteo": PRODUCTOS,
  "prod-conteo-historico": ["productos.ver"],

  // RR.HH. · Personal
  "rrhh-dashboard": ["rrhh_personal.ver"],
  "rrhh-solicitudes": RRHH_PERSONAL,
  "rrhh-empleados": RRHH_PERSONAL,
  "rrhh-contratos": RRHH_PERSONAL,
  "rrhh-documentos": RRHH_PERSONAL,

  // RR.HH. · Asistencia. El kiosko NO concede nada: la tableta marca por
  // /api/public/punch con device_token, no necesita permiso de nadie.
  "rrhh-dashboard-ponche": ["rrhh_asistencia.ver"],
  "rrhh-ponche": RRHH_ASISTENCIA,
  "rrhh-kiosko-ponche": [],
  "rrhh-config-modalidades": RRHH_ASISTENCIA,
  "rrhh-asistencia": RRHH_ASISTENCIA,
  "rrhh-horarios": RRHH_ASISTENCIA,
  "rrhh-permisos": RRHH_ASISTENCIA,

  // RR.HH. · Pagos
  "rrhh-nomina": ["rrhh_pagos.ver", "rrhh.nomina", "rrhh.cuentas_bancarias"],
  "rrhh-dias-laborados": RRHH_PAGOS,
  "rrhh-incentivos": RRHH_PAGOS,
  "rrhh-vacaciones": RRHH_PAGOS,
  "rrhh-txt-bancarios": ["rrhh.banco_txt", "rrhh.cuentas_bancarias"],
  // Caja fuerte: no conceden nada.
  "rrhh-doble-sueldo": [],
  "rrhh-prestamos": [],
  "rrhh-liquidaciones": [],
  "rrhh-pdf-prestaciones": [],

  // RR.HH. · Desarrollo
  "rrhh-reclutamiento": RRHH_DESARROLLO,
  "rrhh-onboarding": RRHH_DESARROLLO,
  "rrhh-evaluacion": RRHH_DESARROLLO,
  "rrhh-disciplina": RRHH_DESARROLLO,
  "rrhh-capacitacion": RRHH_DESARROLLO,
  "rrhh-comunicacion": RRHH_DESARROLLO,

  // RR.HH. · Reportes
  "rrhh-reportes": ["rrhh_reportes.ver"],
  "rrhh-auditoria": ["rrhh_reportes.ver"],

  // Clientes y Consentimientos
  "control-tratamientos": CLIENTES,
  "cosmiatria-clientes": CLIENTES,
  "cosmiatria-ficha": CLIENTES,
  "consent-masajes": CONSENTIMIENTOS,
  "consent-peeling": CONSENTIMIENTOS,
  "consent-tatuajes-cejas": CONSENTIMIENTOS,
  "consent-depilacion-laser": CONSENTIMIENTOS,
  "reportes-firmados": ["clientes.ver", "consentimientos.ver"],

  // Atención a cliente · certificados
  "cliente-certificados": CERTIFICADOS,
  "cliente-certificados-depicenter": CERTIFICADOS,
  "cliente-certificados-imprimir": CERTIFICADOS,
  "cliente-certificados-talonario": CERTIFICADOS,
  "cliente-certificados-validez": ["gift_certificates.ver"],
}

/**
 * Permisos que le tocan a un usuario por sus menús, conservando los que ya
 * tenía. Devuelve una lista nueva y ordenada; no muta la entrada.
 */
export function permisosHeredados(menus: readonly string[], actuales: readonly string[] = []): string[] {
  const salida = new Set<string>(actuales)
  for (const menu of menus) {
    for (const perm of MENU_PERMISOS[menu] ?? []) {
      if (!PERMISOS_PREEXISTENTES.has(perm)) salida.add(perm)
    }
  }
  return Array.from(salida).sort()
}
