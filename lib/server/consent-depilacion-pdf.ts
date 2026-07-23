/**
 * PDF server-side del Consentimiento de Depilación Láser (para adjuntar al correo
 * al firmar). Reproduce el mismo documento legal que genera el navegador con
 * `buildPrintHtml` (componente público), usando `pdf-lib` — no requiere un
 * navegador headless. El cuerpo legal es FIJO; solo cambian los datos del cliente
 * y la firma.
 *
 * SOLO servidor. La marca "Cibao Spa Laser" del texto se reemplaza por el nombre
 * del negocio (Cibao/Depicenter).
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

type Row = Record<string, unknown>

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 42
const CONTENT_W = PAGE_W - MARGIN * 2
const TEAL = rgb(0x00 / 255, 0x89 / 255, 0x7b / 255)
const TEXT = rgb(0.07, 0.09, 0.11)
const MUTED = rgb(0.4, 0.45, 0.5)
const WHITE = rgb(1, 1, 1)

export type Run = { s: string; b?: boolean }
/** Item con introducción en negrita opcional (`<b>Label:</b> resto`). */
export function lead(bold: string, rest: string): Run[] {
  return [{ s: bold, b: true }, { s: rest }]
}
export function plain(s: string): Run[] {
  return [{ s }]
}
/** Lista de items de texto plano (para portar `<ul>` de texto legal). */
export function bullets(items: string[]): Run[][] {
  return items.map((s) => [{ s }])
}

export interface Section {
  title: string
  blocks: Array<{ kind: "p"; runs: Run[] } | { kind: "list"; ordered?: boolean; items: Run[][] }>
}

/** Config de un documento de consentimiento para el motor de PDF. */
export interface ConsentPdfConfig {
  /** Título grande (h1). */
  title: string
  /** Subtítulo teal opcional (una línea). */
  subtitle?: string
  /** Etiqueta del especialista en los datos del cliente. */
  especialistaLabel?: string
  /** Nombre corto del documento para el pie de página. */
  footerLabel: string
  sections: Section[]
  /** Caja de aceptación opcional (p.ej. depilación láser). */
  acceptBox?: string
}

// ── Texto (WinAnsi-safe): normaliza tipografía y descarta lo no codificable ──
// Escrito con escapes \uXXXX para evitar cualquier problema de codificación en
// el propio archivo fuente. Conserva ASCII + Latin-1 (acentos á é í ó ú ñ ü).
function keepEncodable(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const c = s.charCodeAt(i)
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out += ch
    else if (/\s/.test(ch)) out += " " // espacios exóticos (nbsp fina, etc.) -> espacio normal
  }
  return out
}
function makeSafe(businessName: string) {
  return (value: unknown): string =>
    keepEncodable(
      String(value ?? "")
        .replace(/Cibao Spa L[aá]ser/g, businessName)
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/[•·]/g, "-")
        .replace(/…/g, "...")
        .replace(/[☑✓✔]/g, "[X]")
    )
}

class ConsentPdf {
  doc!: PDFDocument
  font!: PDFFont
  bold!: PDFFont
  page!: PDFPage
  y = 0
  safe: (v: unknown) => string
  footerText = ""

  constructor(safe: (v: unknown) => string) {
    this.safe = safe
  }

  async init() {
    this.doc = await PDFDocument.create()
    this.font = await this.doc.embedFont(StandardFonts.Helvetica)
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold)
    this.addPage()
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
    if (this.footerText) {
      this.page.drawText(this.footerText, { x: MARGIN, y: 26, size: 7, font: this.font, color: MUTED })
    }
  }

  ensure(space: number) {
    if (this.y - space < MARGIN + 24) this.addPage()
  }

  wWidth(tok: Run, size: number) {
    return (tok.b ? this.bold : this.font).widthOfTextAtSize(this.safe(tok.s), size)
  }

  /** Dibuja runs con word-wrap y salto de página. Viñeta opcional. */
  paragraph(runs: Run[], opts: { x?: number; width?: number; size?: number; leading?: number; bullet?: string; gap?: number } = {}) {
    const x = opts.x ?? MARGIN
    const width = opts.width ?? CONTENT_W
    const size = opts.size ?? 9.5
    const leading = opts.leading ?? 13
    const bullet = opts.bullet
    const words: Run[] = []
    for (const r of runs) {
      const parts = this.safe(r.s).split(/\s+/).filter(Boolean)
      for (const w of parts) words.push({ s: w, b: r.b })
    }
    if (!words.length) return
    const spaceW = (b?: boolean) => (b ? this.bold : this.font).widthOfTextAtSize(" ", size)
    let i = 0
    let first = true
    while (i < words.length) {
      const line: Run[] = []
      let lineW = 0
      while (i < words.length) {
        const tok = words[i]
        const add = (line.length ? spaceW(tok.b) : 0) + this.wWidth(tok, size)
        if (lineW + add > width && line.length) break
        line.push(tok)
        lineW += add
        i++
      }
      this.ensure(leading)
      let cx = x
      if (first && bullet) {
        this.page.drawText(this.safe(bullet), { x: x - 12, y: this.y, size, font: this.bold, color: TEAL })
      }
      // Agrupa la línea en segmentos del mismo peso y dibuja cada uno como UN
      // solo string (los espacios van dentro del texto -> siempre se renderizan).
      let segStart = 0
      while (segStart < line.length) {
        let segEnd = segStart + 1
        while (segEnd < line.length && Boolean(line[segEnd].b) === Boolean(line[segStart].b)) segEnd++
        const text = (segStart > 0 ? " " : "") + line.slice(segStart, segEnd).map((t) => this.safe(t.s)).join(" ")
        const f = line[segStart].b ? this.bold : this.font
        this.page.drawText(text, { x: cx, y: this.y, size, font: f, color: TEXT })
        cx += f.widthOfTextAtSize(text, size)
        segStart = segEnd
      }
      this.y -= leading
      first = false
    }
    if (opts.gap) this.y -= opts.gap
  }

  h2(title: string) {
    this.ensure(30)
    this.y -= 4
    this.page.drawRectangle({ x: MARGIN, y: this.y - 12, width: CONTENT_W, height: 16, color: TEAL })
    this.page.drawText(this.safe(title).toUpperCase(), { x: MARGIN + 6, y: this.y - 8, size: 9, font: this.bold, color: WHITE })
    this.y -= 20
  }

  centered(text: string, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
    const t = this.safe(text)
    this.page.drawText(t, { x: (PAGE_W - font.widthOfTextAtSize(t, size)) / 2, y: this.y, size, font, color })
  }

  async signature(dataUrl: string | undefined, nombre: string) {
    this.ensure(90)
    const boxH = 70
    const boxW = CONTENT_W
    const x = MARGIN
    const y = this.y - boxH
    this.page.drawRectangle({ x, y, width: boxW, height: boxH, borderColor: rgb(0.84, 0.87, 0.91), borderWidth: 0.8 })
    if (dataUrl && dataUrl.startsWith("data:image/")) {
      try {
        const [, base64 = ""] = dataUrl.split(",", 2)
        const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
        const img = dataUrl.includes("image/jpeg") ? await this.doc.embedJpg(bytes) : await this.doc.embedPng(bytes)
        const scaled = img.scale(Math.min((boxW - 40) / img.width, (boxH - 24) / img.height, 1))
        this.page.drawImage(img, { x: x + (boxW - scaled.width) / 2, y: y + 14 + (boxH - 20 - scaled.height) / 2, width: scaled.width, height: scaled.height })
      } catch {
        // sin firma dibujable
      }
    }
    const cap = this.safe(`Firma del cliente - ${nombre || "Cliente"}`)
    this.page.drawText(cap, { x: x + (boxW - this.bold.widthOfTextAtSize(cap, 8)) / 2, y: y + 5, size: 8, font: this.bold, color: rgb(0.2, 0.25, 0.32) })
    this.y = y - 10
  }
}

// ── Contenido legal FIJO del consentimiento de depilación láser ──────────────
const SECTIONS: Section[] = [
  {
    title: "Descripción del procedimiento",
    blocks: [{ kind: "p", runs: plain("La depilación láser es un método efectivo y duradero para eliminar el vello no deseado en diferentes áreas del cuerpo. En Cibao Spa Laser, ofrecemos una experiencia segura y profesional, utilizando tecnología de vanguardia.") }],
  },
  {
    title: "Confirmación del cliente",
    blocks: [{
      kind: "list", ordered: true, items: [
        lead("CONFIRMO", " que Cibao Spa Laser me ha explicado detalladamente, en palabras comprensibles para mí, el efecto y la naturaleza del (los) procedimientos a efectuar; incluyendo los posibles riesgos, otras soluciones alternativas de procedimientos (cuando existan), así como las molestias que se pueden sentir, aun teniendo un periodo post-tratamiento normal. Han sido contestadas a satisfacción todas las preguntas que libremente he formulado acerca de todo el procedimiento."),
        lead("ACEPTO y CONSIENTO", ", que al firmar cada sesión recibida, estaré firmando además el consentimiento informado del tratamiento."),
      ],
    }],
  },
  {
    title: "Instrucciones antes del procedimiento",
    blocks: [{
      kind: "list", items: [
        lead("Evitar la Exposición al Sol:", " No expongas el área a tratar al sol durante al menos 2 semanas antes del procedimiento. La piel bronceada puede aumentar el riesgo de efectos secundarios."),
        lead("No Utilizar Autobronceadores:", " Abstente de usar cremas bronceadoras o autobronceadores en la zona afectada al menos 2 semanas antes del tratamiento."),
        lead("Informar sobre Medicación:", " Informa a tu médico o especialista sobre cualquier medicamento que estés tomando, especialmente anticoagulantes, o si tienes algún tratamiento de piel en curso."),
        lead("Evitar Antiinflamatorios y Alcohol:", " Evita el uso de antiinflamatorios (como aspirina o ibuprofeno) y alcohol 48 horas antes del procedimiento para reducir el riesgo de sangrado y hematomas."),
        lead("No Usar Crema en la Zona a Tratar:", " El día del procedimiento, no apliques cremas, lociones o maquillaje en el área que será tratada."),
        lead("Hidratar la Piel:", " Mantén la piel bien hidratada días antes del procedimiento, aplicando crema hidratante en las áreas a tratar, salvo indicación contraria."),
        lead("Consultar sobre Alergias:", " Asegúrate de informar al profesional sobre cualquier alergia, especialmente a anestésicos locales o productos similares que puedan usarse durante el procedimiento."),
        lead("Preparar Preguntas:", " Haz una lista de preguntas que quieras hacerle al profesional antes del procedimiento. Asegúrate de entender completamente el proceso y los cuidados posteriores."),
      ],
    }],
  },
  {
    title: "Cuidados después del tratamiento",
    blocks: [{
      kind: "list", items: [
        lead("Evitar la exposición solar prolongada:", " Después de la sesión, evita la exposición al sol en el área tratada durante al menos 1 semana. Usa bloqueador solar con un alto factor de protección (SPF) para proteger la piel y prevenir manchas."),
        lead("Cuidado de la Piel:", " Mantén la piel limpia e hidratada. Utiliza cremas o lociones suaves recomendadas por nuestro especialista."),
        lead("No Rasurarse ni Depilar:", " No uses cera, pinzas ni otros métodos de depilación durante el tratamiento. Es normal que el vello caiga en las semanas siguientes."),
        lead("Evitar Actividades Intensas:", " Evita ejercicios físicos intensos, saunas o jacuzzis durante los primeros días después del tratamiento, ya que el sudor puede causar irritación en la piel."),
        plain("Si experimentas enrojecimiento o hinchazón, aplica compresas frías y, si es necesario, puedes tomar un analgésico suave. Si los síntomas persisten, contacta a nuestro equipo."),
      ],
    }],
  },
  {
    title: "Consideraciones generales",
    blocks: [{
      kind: "list", items: [
        lead("Modo de acción del tratamiento.", " La luz láser penetra la piel y luego es absorbida por la melanina o pigmento del vello, causando un calentamiento rápido del tallo y raíz del mismo. Este proceso debilita el folículo completo del vello."),
        plain("La reducción del vello mediante el láser es un procedimiento común que es practicado de forma segura y efectiva en miles de pacientes cada año. Las complicaciones son extremadamente raras, y normalmente menores; sin embargo, algunas complicaciones pueden ocurrir."),
        lead("Las sesiones.", " Las sesiones láser se realizan cada 5 semanas las primeras 5 sesiones, luego va aumentando el tiempo según los resultados, las citas se van colocando cada 7 u 8 semanas."),
        lead("Información.", " El láser no penetra más allá de las capas de la piel (epidermis y la dermis), lo que quiere decir que no afecta ninguna glándula, ni vasos, ni músculos."),
        lead("Exposición de los ojos.", " Lentes protectores serán puestos durante el proceso. Es muy importante mantener puestos estos lentes durante todo el tratamiento con láser para proteger los ojos, ya que no deben ser expuestos accidentalmente a la luz del láser."),
        lead("Herpes.", " Los pacientes que en alguna ocasión han presentado herpes labial, deben usar Aciclovir tres días antes de cada sesión del tratamiento como prevención."),
        lead("Advertencia.", " Los vellos muy rubios, muy finos y blancos (canas) no se eliminan con el láser."),
      ],
    }],
  },
  {
    title: "Beneficios",
    blocks: [{ kind: "p", runs: plain("Los beneficios del tratamiento mediante láser: para la mayoría de los pacientes este proceso causará la reducción considerable del vello. Esto supone una reducción estable y a largo plazo del número o cantidad de vello que volverá a crecer después del tratamiento.") }],
  },
  {
    title: "Probabilidad de éxito",
    blocks: [
      { kind: "p", runs: plain("El láser destruye el folículo del vello en crecimiento, pero no el de los folículos latente o inactivo. El resultado de cada tratamiento es la destrucción de un porcentaje de los folículos del vello. Varios tratamientos serán necesarios para la reducción del vello. La reducción del vello será prolongada e incluso permanente. No obstante, algunos pacientes pueden no experimentar una total eliminación de su vello hasta después de varios procesos con láser. Los resultados dependen del tipo de piel y vello, así como de la asociación de la producción de vello a alguna entidad médica; ejemplo: ovario poliquístico.") },
      { kind: "p", runs: plain("Luego de examinar su tipo de piel y vello, el o la especialista le recomendará un número determinado de sesiones para lograr la eliminación o reducción máxima del vello. Al finalizar las sesiones recomendadas, el paciente debe darse mantenimiento cada dos meses; dependiendo cada caso en particular, de ser necesario.") },
    ],
  },
  {
    title: "Riesgos y posibles complicaciones",
    blocks: [
      { kind: "p", runs: lead("COMPRENDO", " que los procesos estéticos no son una ciencia exacta y que nadie puede garantizar la perfección absoluta, por lo que se me han informado los riesgos y posibles complicaciones. A pesar de que se tomen precauciones, la depilación láser puede conllevar ciertos riesgos y complicaciones.") },
      {
        kind: "list", items: [
          lead("Malestar o incomodidad.", " Algún dolor ligero puede sentirse durante el tratamiento con láser, aunque la mayoría de las personas toleran bien el proceso."),
          lead("Cicatrización.", " El tratamiento láser puede provocar hinchazón, llagas o sequedad del área tratada, que requerirán para su total desaparición de un período de entre 1 a 3 semanas. Una vez recuperada la superficie de la piel, puede quedar rosada y sensible a los rayos del sol durante 2 a 4 semanas adicionales. Solo un porcentaje muy reducido de pacientes experimentan este problema."),
          lead("Hematomas / Hinchazón / Infección.", " Hematomas podrán verse en el área tratada durante un período de 2 a 3 días. Hinchazón: puede ocurrir después del procedimiento y durar varias horas, especialmente si han sido tratadas las áreas de la nariz o los pómulos. Una infección cutánea de la piel es una complicación rara pero posible."),
          lead("Cambios en la pigmentación (cambios en el color de la piel).", " El área tratada puede volverse más clara o bien más oscura que la piel a su alrededor; este efecto se resuelve normalmente de manera espontánea en un período de varios meses, pero puede durar bastante más. Para disminuir este riesgo le explicamos al paciente que debe usar filtro solar tres veces al día y evitar la exposición al sol durante el tratamiento."),
          lead("Cicatrices.", " La formación de una cicatriz es algo poco probable; sin embargo, es una posibilidad siempre y cuando sea intervenida la superficie de la piel. Para minimizar las posibilidades de tal complicación es extremadamente importante seguir todas las instrucciones que le serán dadas antes y después de su tratamiento con láser."),
        ],
      },
    ],
  },
  {
    title: "Contraindicaciones",
    blocks: [{
      kind: "list", items: [
        lead("Embarazo y Lactancia:", " Aunque no hay estudios concluyentes sobre la seguridad del láser en mujeres embarazadas, se suele recomendar evitar el procedimiento durante este periodo. La lactancia tampoco es un momento ideal para realizarlo."),
        lead("Piel Bronceada:", " La exposición solar o el uso de camas de bronceado antes del tratamiento pueden aumentar el riesgo de quemaduras y cambios en la pigmentación de la piel. Se recomienda no haber estado expuesto al sol al menos 4-6 semanas antes de la sesión."),
        lead("Trastornos de la Piel:", " Condiciones como eczema, psoriasis, dermatitis o infecciones cutáneas en el área a tratar pueden contraindicar el uso de láser hasta que la piel esté completamente sana."),
        lead("Uso de Medicamentos:", " Algunos medicamentos, como los que sensibilizan la piel (por ejemplo, retinoides o ciertos antibióticos), pueden aumentar el riesgo de efectos secundarios. Es importante informar al especialista sobre cualquier medicación."),
        lead("Historial de Cicatrices Queloides:", " Las personas con tendencia a formar cicatrices queloides pueden tener un mayor riesgo de desarrollar cicatrices anormales después del tratamiento."),
        lead("Diabetes No Controlada:", " Las personas con diabetes mal controlada pueden tener un mayor riesgo de infecciones o complicaciones en la piel."),
        lead("Síndromes de Hipersensibilidad:", " Algunas condiciones que implican hipersensibilidad de la piel o trastornos de coagulación pueden impedir la realización del tratamiento."),
        lead("Tatuajes en el Área:", " La depilación láser no se debe realizar sobre tatuajes, ya que el láser puede afectar la tinta y causar quemaduras o reacciones adversas."),
        lead("Ciertas Condiciones Médicas:", " Enfermedades o condiciones como lupus eritematoso, enfermedades autoinmunitarias o enfermedades que afectan la piel pueden ser contraindicaciones."),
        lead("Uso de Productos Irritantes:", " El uso reciente de productos químicos o tratamientos estéticos que irritan la piel, como peelings químicos o microdermoabrasión, puede requerir un periodo de espera antes de la depilación láser."),
      ],
    }],
  },
  {
    title: "Declaraciones finales del cliente",
    blocks: [
      { kind: "p", runs: plain("El fin del procedimiento que he solicitado tiene como objetivo mejorar mi apariencia física.") },
      { kind: "p", runs: lead("COMPRENDO", " que los resultados están en relación directamente proporcional a la capacidad que tiene mi organismo de eliminación de los materiales que se hayan aplicado.") },
      { kind: "p", runs: lead("CONSIENTO", " en aportar datos personales antes y después del tratamiento, siendo este material de diagnóstico y de registro para mi historia clínica, propiedad de Cibao Spa Laser.") },
      { kind: "p", runs: lead("Acepto", " que Cibao Spa Laser retrase o suspenda el procedimiento si lo cree preciso.") },
      { kind: "p", runs: lead("ME COMPROMETO", " a seguir fielmente, en la mejor medida de mis posibilidades, las instrucciones impartidas por Cibao Spa Laser para antes, durante y después de la intervención arriba mencionada.") },
      { kind: "p", runs: plain("Yo entiendo que el personal médico y otros asistentes se basarán en declaraciones hechas por mí con el fin de determinar si el proceso puede ser seguro y efectivo para mi persona. Yo entiendo que la reducción del vello mediante tratamiento con láser no es una ciencia exacta, y que no se me pueden ofrecer garantías o seguridad total en cuanto a los resultados de este procedimiento.") },
    ],
  },
  {
    title: "Políticas y procedimientos",
    blocks: [{
      kind: "list", items: [
        plain("Reservas y cancelaciones con 48 h de antelación."),
        plain("Horario de lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 8:00 a.m. a 4:00 p.m. Si la cancelación de la cita o reprogramación no es comunicada, se dará por realizada la sesión."),
        plain("Validez: 2 años desde la fecha de compra."),
        plain("Los pagos se podrán realizar en efectivo, transferencias o con tarjeta de crédito. Los precios en Cibao Spa Laser no incluyen el ITBIS."),
        plain("El tiempo de la cita no puede extenderse bajo ningún motivo porque perjudicará nuestro itinerario programado."),
        plain("Si atendemos alguna cita con retraso por responsabilidad nuestra, los tiempos serán repuestos por el Centro. Si los retrasos son ocasionados por el cliente, lo atenderemos solo el tiempo restante hasta completar la hora del término de cita."),
      ],
    }],
  },
  {
    title: "Protección de datos",
    blocks: [{ kind: "p", runs: plain("Cibao Spa Laser enviará información, respuesta a consultas y contactos genéricos, mientras dure nuestra relación y tengamos su consentimiento de destinatario. No se cederán datos a terceros salvo obligación legal.") }],
  },
  {
    title: "Autorización",
    blocks: [
      { kind: "p", runs: plain("He sido informado sobre el procedimiento de eliminación del vello no deseado, incluidos los riesgos, complicaciones y beneficios. He tenido la oportunidad de hacer preguntas y he recibido respuestas satisfactorias. Entiendo que los resultados pueden variar de una persona a otra y que no se garantiza la eliminación completa del vello no deseado.") },
      { kind: "p", runs: plain("Doy mi consentimiento para realizar el procedimiento en Cibao Spa Laser y libero a Cibao Spa Laser y su personal de cualquier responsabilidad Legal en lo Penal y Civil en caso de complicaciones que puedan surgir durante o después del tratamiento.") },
    ],
  },
]

/** Datos del cliente a partir de la fila del consentimiento. */
function clientFields(row: Row, especialistaLabel = "Especialista"): Array<[string, string]> {
  const g = (k: string) => String(row[k] ?? "").trim()
  return [
    ["Nombre", g("cliente_nombre") || g("nombre_cliente")],
    ["Teléfono", g("telefono")],
    ["Cédula / Doc", g("documento")],
    ["Correo", g("correo")],
    ["Dirección", g("direccion")],
    ["Sucursal", g("sucursal")],
    [especialistaLabel, g("especialista_nombre") || g("especialista")],
  ]
}

/** Motor genérico: arma el PDF de cualquier consentimiento a partir de su config. */
export async function buildConsentPdf(row: Row, businessName: string, cfg: ConsentPdfConfig): Promise<Buffer> {
  const safe = makeSafe(businessName)
  const pdf = new ConsentPdf(safe)
  const ref = String(row.consent_id ?? "").trim()
  const fechaFirma = String(row.fecha_registro || row.fecha || "").trim()
  pdf.footerText = safe(`${businessName} - ${cfg.footerLabel}${ref ? ` - Ref ${ref}` : ""}`)
  await pdf.init()

  // Encabezado
  pdf.centered(businessName.toUpperCase(), 16, pdf.bold, TEAL)
  pdf.y -= 18
  pdf.centered(cfg.title, 12, pdf.bold, TEXT)
  pdf.y -= 13
  if (cfg.subtitle) {
    pdf.centered(cfg.subtitle, 9, pdf.bold, TEAL)
    pdf.y -= 12
  }
  pdf.centered(`Fecha de firma: ${fechaFirma || "-"}${ref ? ` - Ref: ${ref}` : ""}`, 8, pdf.font, MUTED)
  pdf.y -= 6
  pdf.page.drawRectangle({ x: MARGIN, y: pdf.y, width: CONTENT_W, height: 2, color: TEAL })
  pdf.y -= 12

  // Datos del cliente (2 columnas; Dirección ocupa fila completa)
  pdf.h2("Datos del cliente")
  const fields = clientFields(row, cfg.especialistaLabel)
  const colW = CONTENT_W / 2
  const drawField = (pair: [string, string], x: number) => {
    const [label, value] = pair
    const lab = `${safe(label)}: `
    pdf.page.drawText(lab, { x, y: pdf.y, size: 9, font: pdf.bold, color: rgb(0.06, 0.09, 0.14) })
    const lw = pdf.bold.widthOfTextAtSize(lab, 9)
    pdf.page.drawText(safe(value || "-"), { x: x + lw, y: pdf.y, size: 9, font: pdf.font, color: TEXT })
  }
  let idx = 0
  while (idx < fields.length) {
    pdf.ensure(13)
    if (fields[idx][0] === "Dirección") {
      drawField(fields[idx], MARGIN)
      pdf.y -= 13
      idx += 1
      continue
    }
    drawField(fields[idx], MARGIN)
    if (fields[idx + 1] && fields[idx + 1][0] !== "Dirección") {
      drawField(fields[idx + 1], MARGIN + colW)
      idx += 2
    } else {
      idx += 1
    }
    pdf.y -= 13
  }
  pdf.y -= 4

  // Secciones legales
  for (const sec of cfg.sections) {
    pdf.h2(sec.title)
    for (const block of sec.blocks) {
      if (block.kind === "p") {
        pdf.paragraph(block.runs, { size: 9.5, leading: 13, gap: 4 })
      } else {
        block.items.forEach((item, i) => {
          const bullet = block.ordered ? `${i + 1}.` : "-"
          pdf.paragraph(item, { x: MARGIN + 14, width: CONTENT_W - 14, size: 9.5, leading: 13, bullet, gap: 2 })
        })
        pdf.y -= 3
      }
    }
  }

  // Caja de aceptación opcional
  if (cfg.acceptBox) {
    pdf.ensure(24)
    pdf.y -= 2
    pdf.page.drawRectangle({ x: MARGIN, y: pdf.y - 14, width: CONTENT_W, height: 20, color: rgb(0.94, 0.99, 0.98), borderColor: rgb(0.6, 0.96, 0.9), borderWidth: 1 })
    pdf.page.drawText(safe(cfg.acceptBox), { x: MARGIN + 8, y: pdf.y - 8, size: 9.5, font: pdf.bold, color: rgb(0.06, 0.46, 0.43) })
    pdf.y -= 26
  }

  // Firma
  await pdf.signature(String(row.firma_cliente || ""), String(row.cliente_nombre || row.nombre_cliente || ""))

  const bytes = await pdf.doc.save()
  return Buffer.from(bytes)
}

export async function buildConsentDepilacionLaserPdf(row: Row, businessName = "Cibao Spa Laser"): Promise<Buffer> {
  return buildConsentPdf(row, businessName, {
    title: "CONSENTIMIENTO INFORMADO",
    subtitle: "PROCEDIMIENTO: ELIMINACIÓN DEL VELLO NO DESEADO",
    footerLabel: "Consentimiento Depilación Láser",
    acceptBox: "[X] ACEPTO LAS POLÍTICAS DE LA EMPRESA",
    sections: SECTIONS,
  })
}
