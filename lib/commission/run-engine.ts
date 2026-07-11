/**
 * MOTOR PURO del CÁLCULO MENSUAL DE INCENTIVOS por sucursal (runs).
 * Sin I/O: recibe ventas persistidas, roster de colaboradores, pacientes y
 * reglas; devuelve el run completo (bases, fondo láser, ítems por colaborador,
 * totales y alertas). Reglas de negocio:
 *
 *  - TARJETA descuenta el % configurable (default 27%) ANTES de calcular
 *    incentivo: tarjeta_neta = bruta × (1 − cardPct). Efectivo/transferencia
 *    NO descuentan. El descuento NO se paga como incentivo.
 *  - Base láser POR SUCURSAL = efectivo + transferencia + tarjeta_neta (+ otros
 *    métodos sin descuento) de las ventas DEPILACION_LASER.
 *  - Fondo láser = base × % del MAYOR tramo alcanzado (escala configurable).
 *  - El fondo se divide en parte por PACIENTES (fracción configurable
 *    laser_split) y parte LINEAL (el resto, en partes iguales entre
 *    colaboradores lineales del roster con servicio láser).
 *  - Sin pacientes cargados NUNCA se calcula en silencio: el fondo por
 *    pacientes pasa a lineal (si hay lineales) con alerta, o queda sin
 *    repartir con alerta.
 *  - Incentivo por servicio = base neta ATRIBUIBLE al prestador × % de su
 *    categoría (masajes/faciales 20%, hollywood/tatuajes/HIFU 10%, editables).
 *  - Productos = unidades × monto fijo (default RD$100).
 *  - Evaluación cualitativa (default 100%) ajusta SOLO el incentivo de
 *    servicios: ajustado = servicios × evaluación%.
 *  - bruto = productos + servicios_ajustado + láser + bono
 *    neto  = bruto − aporte_limpieza (default RD$400, configurable, puede ser 0)
 */
import { round2 } from "./money"
import { canonicalCollaborator } from "./normalize"
import { classifyProvider } from "./classification"

export interface RunSaleRow {
  branch: string
  category: string
  payment: string
  amount: number
  quantity: number
  providerOriginal: string | null
  provider: string | null // normalizado
}

export interface RunCollaborator {
  id: string
  name: string
  branch: string
  services: string[]
  linearParticipation: boolean
  patientParticipation: boolean
  fixedPercentage: number | null
  active: boolean
  cleaningContribution: number
  bonusExtra: number
  evaluationPct: number
}

export interface RunPatientCount {
  collaborator: string
  patients: number
}

export interface RunRules {
  cardPct: number
  productUnitAmount: number
  categoryPct: Record<string, number>
  laserScale: { threshold: number; percentage: number }[]
  /** Fracción del fondo láser repartida por pacientes (0..1); el resto por
   *  cantidad de personas (parte fija). Deriva de los pesos configurables
   *  (peso_pacientes / (peso_personas + peso_pacientes)). */
  laserSplitPatientsFraction: number
  /** Si false, el empleado con 0 pacientes NO recibe la parte fija por persona
   *  (queda fuera del reparto lineal). Default true. */
  zeroPatientsGetsFixed?: boolean
}

export interface PaymentBase {
  efectivo: number
  transferencia: number
  tarjetaBruta: number
  tarjetaDescuento: number
  tarjetaNeta: number
  otros: number
  totalBruto: number
  totalNeto: number
}

export interface RunItem {
  collaboratorId: string | null
  name: string
  inRoster: boolean
  patients: number
  patientsPct: number
  productUnits: number
  productIncentive: number
  serviceBreakdown: Record<string, { base: number; pct: number; amount: number }>
  serviceIncentive: number
  evaluationPct: number
  serviceIncentiveAdjusted: number
  laserLinear: number
  laserPatients: number
  laserTotal: number
  bonusExtra: number
  cleaningContribution: number
  grossTotal: number
  netTotal: number
}

export interface RunResult {
  branch: string
  cardPct: number
  baseByCategory: Record<string, PaymentBase>
  baseTotal: PaymentBase
  laser: {
    base: number
    threshold: number
    pct: number
    fund: number
    fundLinear: number
    fundPatients: number
    patientsTotal: number
    patientsSource: string
  }
  items: RunItem[]
  totals: {
    productIncentive: number
    serviceIncentive: number
    serviceIncentiveAdjusted: number
    laserTotal: number
    bonusExtra: number
    cleaningContribution: number
    grossTotal: number
    netTotal: number
  }
  alerts: string[]
}

const emptyBase = (): PaymentBase => ({
  efectivo: 0, transferencia: 0, tarjetaBruta: 0, tarjetaDescuento: 0,
  tarjetaNeta: 0, otros: 0, totalBruto: 0, totalNeto: 0,
})

/** Neto para incentivo de un monto según método de pago (solo TARJETA descuenta). */
export function netAmount(amount: number, payment: string, cardPct: number): number {
  const a = Number(amount) || 0
  return payment === "TARJETA" ? round2(a * (1 - cardPct)) : a
}

function addToBase(b: PaymentBase, payment: string, amount: number, cardPct: number): void {
  const a = Number(amount) || 0
  if (payment === "TARJETA") {
    b.tarjetaBruta = round2(b.tarjetaBruta + a)
    const desc = round2(a * cardPct)
    b.tarjetaDescuento = round2(b.tarjetaDescuento + desc)
    b.tarjetaNeta = round2(b.tarjetaNeta + (a - desc))
  } else if (payment === "EFECTIVO") b.efectivo = round2(b.efectivo + a)
  else if (payment === "TRANSFERENCIA") b.transferencia = round2(b.transferencia + a)
  else b.otros = round2(b.otros + a)
  b.totalBruto = round2(b.totalBruto + a)
  b.totalNeto = round2(b.efectivo + b.transferencia + b.tarjetaNeta + b.otros)
}

/** Tramo del MAYOR umbral alcanzado. */
function scaleTramo(base: number, scale: RunRules["laserScale"]): { threshold: number; percentage: number } | null {
  return scale.filter((t) => base >= t.threshold).sort((a, b) => b.threshold - a.threshold)[0] ?? null
}

/**
 * Reparte `total` (RD$) entre los `weights` de forma que la suma sea EXACTA al
 * centavo (método del mayor resto): los centavos sobrantes por redondeo se
 * asignan a los mayores restos fraccionarios. Garantiza el CUADRE completo
 * (Σ resultado = total) que exige la liquidación del incentivo láser.
 */
export function allocateExact(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const totalCents = Math.round((Number(total) || 0) * 100)
  const wsum = weights.reduce((s, w) => s + (Number(w) || 0), 0)
  if (wsum <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (totalCents * (Number(w) || 0)) / wsum)
  const cents = raw.map((x) => Math.floor(x))
  // rem = centavos sobrantes por el piso; siempre 0 ≤ rem < weights.length.
  const rem = totalCents - cents.reduce((s, x) => s + x, 0)
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < rem; k++) cents[order[k].i]++
  return cents.map((c) => c / 100)
}

export interface ComputeRunInput {
  branch: string
  sales: RunSaleRow[]
  collaborators: RunCollaborator[]
  patients: RunPatientCount[]
  patientsSource: string // "manual" | "reservas" | "ninguna"
  rules: RunRules
}

export function computeRun(input: ComputeRunInput): RunResult {
  const { branch, rules } = input
  const alerts: string[] = []
  const sales = input.sales.filter((s) => s.branch === branch)
  if (sales.length === 0) alerts.push("Sin ventas registradas para la sucursal en el período.")

  // ── Bases por categoría y total (tarjeta neteada) ──────────────────────────
  const baseByCategory: Record<string, PaymentBase> = {}
  const baseTotal = emptyBase()
  for (const s of sales) {
    const cat = s.category || "OTROS"
    const b = (baseByCategory[cat] ||= emptyBase())
    addToBase(b, s.payment, s.amount, rules.cardPct)
    addToBase(baseTotal, s.payment, s.amount, rules.cardPct)
  }

  // ── Fondo láser por sucursal ───────────────────────────────────────────────
  const laserBase = baseByCategory["DEPILACION_LASER"]?.totalNeto || 0
  const tramo = scaleTramo(laserBase, rules.laserScale)
  const fund = tramo ? round2(laserBase * tramo.percentage) : 0
  if (laserBase > 0 && !tramo) alerts.push(`La base láser (${laserBase.toFixed(2)}) no alcanza el primer tramo de la escala: fondo 0.`)

  const roster = input.collaborators.filter((c) => c.active && c.branch === branch)
  const rosterByName = new Map(roster.map((c) => [canonicalCollaborator(c.name), c]))

  // ── Ítems por colaborador (arranca del roster; se agregan externos) ───────
  const items = new Map<string, RunItem>()
  const itemFor = (name: string): RunItem => {
    const canon = canonicalCollaborator(name)
    let it = items.get(canon)
    if (!it) {
      const c = rosterByName.get(canon) || null
      it = {
        collaboratorId: c?.id ?? null, name: canon, inRoster: Boolean(c),
        patients: 0, patientsPct: 0, productUnits: 0, productIncentive: 0,
        serviceBreakdown: {}, serviceIncentive: 0,
        evaluationPct: c?.evaluationPct ?? 100, serviceIncentiveAdjusted: 0,
        laserLinear: 0, laserPatients: 0, laserTotal: 0,
        bonusExtra: c?.bonusExtra ?? 0,
        cleaningContribution: c?.cleaningContribution ?? 0,
        grossTotal: 0, netTotal: 0,
      }
      items.set(canon, it)
    }
    return it
  }
  for (const c of roster) itemFor(c.name)

  // ── Incentivos por servicio y productos (atribución por prestador) ────────
  for (const s of sales) {
    const info = classifyProvider(s.providerOriginal ?? s.provider)
    if (!info.commissionable) continue
    const name = canonicalCollaborator(s.provider || info.name)
    if (!name) continue
    const it = itemFor(name)
    if (s.category === "PRODUCTO") {
      it.productUnits += Number(s.quantity) || 0
      continue
    }
    const pct = rules.categoryPct[s.category] || 0
    if (pct <= 0) continue
    const net = netAmount(s.amount, s.payment, rules.cardPct)
    const e = (it.serviceBreakdown[s.category] ||= { base: 0, pct, amount: 0 })
    e.base = round2(e.base + net)
    e.amount = round2(e.base * pct)
  }
  for (const it of items.values()) {
    it.productIncentive = round2(it.productUnits * rules.productUnitAmount)
    it.serviceIncentive = round2(Object.values(it.serviceBreakdown).reduce((s, e) => s + e.amount, 0))
    if (!it.inRoster && (it.serviceIncentive > 0 || it.productIncentive > 0)) {
      alerts.push(`Prestador "${it.name}" tiene incentivos pero no está configurado como colaborador de ${branch}.`)
    }
  }

  // ── Reparto del fondo láser (SOLO personal ELEGIBLE del roster) ────────────
  // Elegible para la parte por pacientes = en el roster activo, con servicio
  // DEPILACIÓN LÁSER y participación por pacientes. Los pacientes de quien NO
  // aplica NO diluyen ni reciben el fondo (spec §15): solo generan alerta.
  const allPat = input.patients
    .map((p) => ({ name: canonicalCollaborator(p.collaborator), patients: Number(p.patients) || 0 }))
    .filter((p) => p.name && p.patients > 0)
  const eligiblePat = (name: string) => {
    const c = rosterByName.get(name)
    return c && c.services.includes("DEPILACION_LASER") && c.patientParticipation !== false ? c : null
  }
  const patCounts = allPat.filter((p) => eligiblePat(p.name))
  for (const p of allPat) {
    if (!eligiblePat(p.name)) alerts.push(`Pacientes cargados para "${p.name}" pero no aplica al incentivo láser en ${branch}: NO participa del reparto.`)
  }
  const patientsTotal = patCounts.reduce((s, p) => s + p.patients, 0)

  let fracPatients = Math.min(1, Math.max(0, rules.laserSplitPatientsFraction))
  let fundPatients = round2(fund * fracPatients)
  let fundLinear = round2(fund - fundPatients)

  const linears = roster.filter((c) => c.linearParticipation && c.services.includes("DEPILACION_LASER"))
  if (fund > 0 && fundPatients > 0 && patientsTotal === 0) {
    if (linears.length > 0) {
      alerts.push("Sin pacientes cargados para el período: la parte por pacientes del fondo láser se repartió LINEAL entre los colaboradores lineales.")
      fundLinear = round2(fundLinear + fundPatients)
      fundPatients = 0
      fracPatients = 0
    } else {
      alerts.push("Sin pacientes cargados y sin colaboradores lineales: el fondo láser por pacientes quedó SIN repartir. Carga pacientes atendidos o configura colaboradores lineales.")
      fundPatients = 0
    }
  }

  if (fundPatients > 0 && patientsTotal > 0) {
    for (const p of patCounts) itemFor(p.name).patients += p.patients
    // Reparto EXACTO por pacientes (Σ = fundPatients al centavo).
    const shares = allocateExact(fundPatients, patCounts.map((p) => p.patients))
    patCounts.forEach((p, i) => {
      const it = itemFor(p.name)
      it.patientsPct = Math.round((it.patients / patientsTotal) * 10000) / 10000
      it.laserPatients = shares[i]
    })
  } else if (patientsTotal > 0) {
    // Solo informativo (participación) aunque el split sea 100% lineal.
    for (const p of patCounts) {
      const it = itemFor(p.name)
      it.patients += p.patients
      it.patientsPct = Math.round((p.patients / patientsTotal) * 10000) / 10000
    }
  }

  if (fundLinear > 0) {
    // "Empleado con 0 pacientes recibe parte fija": si el flag está en false, el
    // colaborador sin pacientes cargados queda fuera del reparto por personas.
    const zeroGetsFixed = rules.zeroPatientsGetsFixed !== false
    const patByName = new Map(patCounts.map((p) => [p.name, p.patients]))
    const linearPool = zeroGetsFixed
      ? linears
      : linears.filter((c) => (patByName.get(canonicalCollaborator(c.name)) || 0) > 0)
    if (linearPool.length === 0) {
      alerts.push(zeroGetsFixed
        ? "Hay parte lineal del fondo láser pero ningún colaborador está configurado como lineal: quedó SIN repartir."
        : "Parte por personas SIN repartir: la regla de 0 pacientes excluye a los lineales sin pacientes y no quedó ninguno elegible.")
    } else {
      // Reparto EXACTO por personas (partes iguales, Σ = fundLinear al centavo).
      const shares = allocateExact(fundLinear, linearPool.map(() => 1))
      linearPool.forEach((c, i) => { itemFor(c.name).laserLinear = shares[i] })
    }
  }

  // ── Totales por colaborador ────────────────────────────────────────────────
  for (const it of items.values()) {
    it.laserTotal = round2(it.laserLinear + it.laserPatients)
    it.serviceIncentiveAdjusted = round2(it.serviceIncentive * ((Number(it.evaluationPct) || 100) / 100))
    it.grossTotal = round2(it.productIncentive + it.serviceIncentiveAdjusted + it.laserTotal + it.bonusExtra)
    // Limpieza solo aplica a quien tiene algo que cobrar (no genera netos negativos fantasma).
    if (it.grossTotal <= 0) it.cleaningContribution = 0
    it.netTotal = round2(it.grossTotal - it.cleaningContribution)
  }

  const list = [...items.values()].sort((a, b) => b.netTotal - a.netTotal)
  const T = (f: (i: RunItem) => number) => round2(list.reduce((s, i) => s + f(i), 0))
  return {
    branch,
    cardPct: rules.cardPct,
    baseByCategory,
    baseTotal,
    laser: {
      base: laserBase, threshold: tramo?.threshold || 0, pct: tramo?.percentage || 0,
      fund, fundLinear, fundPatients, patientsTotal, patientsSource: input.patientsSource,
    },
    items: list,
    totals: {
      productIncentive: T((i) => i.productIncentive),
      serviceIncentive: T((i) => i.serviceIncentive),
      serviceIncentiveAdjusted: T((i) => i.serviceIncentiveAdjusted),
      laserTotal: T((i) => i.laserTotal),
      bonusExtra: T((i) => i.bonusExtra),
      cleaningContribution: T((i) => i.cleaningContribution),
      grossTotal: T((i) => i.grossTotal),
      netTotal: T((i) => i.netTotal),
    },
    alerts,
  }
}
