/**
 * Plantilla oficial del Contrato Individual de Trabajo de Cibao Spa Láser
 * (basada en Contrato_Trabajo_Cibao_Spa_Laser_CSL_SRL.docx). Genera HTML
 * listo para imprimir/descargar como PDF (window.print). template_version "v1".
 */

export interface ContractData {
  businessSlug?: string
  empresaNombre?: string
  rnc?: string
  representante?: string
  cedulaRep?: string
  domicilioEmpresa?: string
  // Trabajador
  empleadoNombre: string
  cedula: string
  estadoCivil: string
  direccion: string
  telefono: string
  email?: string
  cargo: string
  branch: string
  contractType: string
  startDate: string // YYYY-MM-DD
  salary: number
  paymentFrequency: string
  paymentMethod: string
  bank: string
  accountType: string
  accountNumber: string
  accountHolder: string
  workDays: string
  breakTime: string
  weeklyRest: string
  incentiveApplies: boolean
  incentiveDetail: string
  observaciones?: string
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

const BRANCH_ADDR: Record<string, string> = {
  "RAFAEL VIDAL": "Avenida Rafael Vidal, Plaza Mediterránea, Módulo H-1, Santiago de los Caballeros, República Dominicana",
  "LOS JARDINES": "Calle Aquiles Ramírez No. 7, Los Jardines Metropolitanos, Santiago de los Caballeros, República Dominicana",
  "VILLA OLGA": "Julio García Esq., Villa Olga, Santiago de los Caballeros, República Dominicana",
}

const money = (n: number) => new Intl.NumberFormat("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function contractFileName(c: ContractData): string {
  const nom = (c.empleadoNombre || "empleado").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")
  const ced = String(c.cedula || "").replace(/\D/g, "")
  return `Contrato_Trabajo_${nom}${ced ? "_" + ced : ""}.pdf`
}

export function buildContractHtml(c: ContractData): string {
  const empresa = c.empresaNombre || "CIBAO SPA LASER CSL, S.R.L."
  const rnc = c.rnc || "1-31-56198-5"
  const rep = c.representante || "CARLOS MIGUEL ARIAS DELANCE"
  const cedRep = c.cedulaRep || "031-0285828-3"
  const domicilio = c.domicilioEmpresa || "Avenida Rafael Vidal, Plaza Mediterránea, Módulo H-1, Santiago de los Caballeros, República Dominicana"
  const marca = "CIBAO SPA LÁSER"
  const d = c.startDate ? new Date(c.startDate + "T00:00:00") : null
  const dia = d ? String(d.getDate()) : "____"
  const mes = d ? MESES[d.getMonth()] : "____"
  const anio = d ? String(d.getFullYear()) : "____"
  const branchNorm = (c.branch || "").toUpperCase().trim()
  const sucDir = BRANCH_ADDR[branchNorm] || c.branch || ""
  const incentivo = c.incentiveApplies ? "SÍ" : "NO"

  const cl = (titulo: string, ...parrafos: string[]) =>
    `<h3>${esc(titulo)}</h3>${parrafos.map(p => `<p>${p}</p>`).join("")}`

  const body = `
${cl("PRIMERA: NATURALEZA DEL CONTRATO",
    `EL EMPLEADOR contrata a EL TRABAJADOR bajo la modalidad de contrato de trabajo por ${esc(c.contractType || "tiempo indefinido").toLowerCase()}, para prestar servicios personales bajo la dependencia, dirección, supervisión y organización de ${marca}.`,
    `El presente contrato inicia en fecha <b>${esc(dia)}</b> de <b>${esc(mes)}</b> de <b>${esc(anio)}</b> y permanecerá vigente hasta que una de las partes decida ponerle término conforme a las causas, formas y procedimientos establecidos por el Código de Trabajo de la República Dominicana.`)}
${cl("SEGUNDA: CARGO Y FUNCIONES",
    `EL TRABAJADOR desempeñará el cargo de <b>${esc(c.cargo)}</b> en ${marca}.`,
    `Sus funciones principales serán las propias del cargo: atender clientes profesionalmente, cumplir los procedimientos internos de servicio, higiene, bioseguridad, agenda y atención; utilizar correctamente equipos, herramientas, sistemas y uniformes; reportar oportunamente novedades; cumplir instrucciones razonables y mantener conducta profesional, ética y respetuosa cuidando la imagen y estándares de ${marca}. Las funciones son enunciativas y no limitativas.`)}
${cl("TERCERA: LUGAR DE TRABAJO",
    `EL TRABAJADOR prestará sus servicios principalmente en la sucursal <b>${esc(c.branch)}</b>${sucDir ? `: ${esc(sucDir)}` : ""}.`,
    `EL EMPLEADOR podrá requerir que EL TRABAJADOR preste servicios temporal o permanentemente en otra sucursal de ${marca}, siempre que responda a necesidades operativas razonables y no afecte de forma ilegal o abusiva sus derechos laborales.`)}
${cl("CUARTA: JORNADA Y HORARIO DE TRABAJO",
    `Días de trabajo: <b>${esc(c.workDays || "—")}</b>. Descanso intermedio: <b>${esc(c.breakTime || "—")}</b>. Día libre o descanso semanal: <b>${esc(c.weeklyRest || "—")}</b>.`,
    `El horario general de ${marca} es de lunes a viernes de 9:00 a.m. a 8:00 p.m.; sábados de 9:00 a.m. a 4:00 p.m.; domingos cerrado. Las horas extraordinarias, feriados o días no laborables se reconocerán y pagarán conforme a la ley, previa autorización.`)}
${cl("QUINTA: SALARIO Y FORMA DE PAGO",
    `EL EMPLEADOR pagará a EL TRABAJADOR un salario de <b>RD$${esc(money(c.salary))}</b> ${esc(c.paymentFrequency || "MENSUAL").toUpperCase()}.`,
    `El pago será realizado mediante <b>${esc(c.paymentMethod || "Transferencia bancaria")}</b>, los días 15 y 30 de cada mes. Cuenta bancaria del trabajador — Banco: <b>${esc(c.bank || "—")}</b>; Tipo de cuenta: <b>${esc(c.accountType || "—")}</b>; Número de cuenta: <b>${esc(c.accountNumber || "—")}</b>; Titular: <b>${esc(c.accountHolder || c.empleadoNombre)}</b>.`,
    `Del salario podrán realizarse únicamente las deducciones autorizadas por la ley (Seguridad Social, impuestos, avances o préstamos consentidos por escrito).`)}
${cl("SEXTA: COMISIONES, INCENTIVOS O BONIFICACIONES",
    `Aplica incentivo: <b>${esc(incentivo)}</b>.${c.incentiveApplies && c.incentiveDetail ? ` Detalle del incentivo: <b>${esc(c.incentiveDetail)}</b>.` : ""}`,
    `Las comisiones o incentivos no se entenderán adquiridos automáticamente si no cumplen las condiciones establecidas por ${marca} (metas, pagos confirmados, servicios completados, registros correctos, cumplimiento de protocolos u otras condiciones comunicadas).`)}
${cl("SÉPTIMA: SEGURIDAD SOCIAL Y OBLIGACIONES LEGALES",
    `EL EMPLEADOR cumplirá las obligaciones legales en materia laboral, incluyendo registro del trabajador, aportes ante la Tesorería de la Seguridad Social, pagos salariales y derechos adquiridos. EL TRABAJADOR suministrará los documentos necesarios para nómina, Seguridad Social y registro laboral.`)}
${cl("OCTAVA: VACACIONES, DÍAS FERIADOS Y SALARIO DE NAVIDAD",
    `EL TRABAJADOR tendrá derecho a vacaciones, descanso semanal, días feriados, salario de Navidad y demás derechos conforme al Código de Trabajo. Las vacaciones se coordinarán entre las partes según las necesidades operativas y el derecho adquirido.`)}
${cl("NOVENA: PERÍODO DE ADAPTACIÓN Y EVALUACIÓN",
    `Durante los primeros tres meses EL EMPLEADOR podrá evaluar el desempeño, puntualidad, disciplina, capacidad técnica, trato al cliente y adaptación. Este período no constituye renuncia de derechos; cualquier terminación se realizará conforme a la ley.`)}
${cl("DÉCIMA: OBLIGACIONES DE EL TRABAJADOR",
    `EL TRABAJADOR se obliga a prestar sus servicios con diligencia y buena fe; cumplir el horario; respetar a clientes y compañeros; cumplir protocolos de higiene y bioseguridad; usar correctamente uniforme y equipos; cuidar bienes de la empresa; no manipular equipos sin autorización; mantener confidencialidad; no tomar fotos/videos ni publicar información interna sin autorización; no usar para fines personales los recursos de ${marca}; e informar de inmediato cualquier incidencia.`)}
${cl("DÉCIMA PRIMERA: OBLIGACIONES DE EL EMPLEADOR",
    `EL EMPLEADOR se obliga a pagar el salario en la forma y fecha acordadas; proveer herramientas y condiciones razonables; respetar la dignidad y derechos del trabajador; cumplir obligaciones de Seguridad Social; adoptar medidas de higiene y seguridad; capacitar en los procesos internos; y reconocer descansos, vacaciones, salario de Navidad y horas extraordinarias conforme a la ley.`)}
${cl("DÉCIMA SEGUNDA: CONFIDENCIALIDAD Y PROTECCIÓN DE INFORMACIÓN",
    `EL TRABAJADOR reconoce que tendrá acceso a información confidencial (datos de clientes, historiales, contactos, bases de datos, ventas, precios, información técnica de equipos, fotografías y documentos). Se compromete a no copiar, divulgar, transferir, publicar o utilizar indebidamente dicha información sin autorización escrita. Esta obligación se mantiene aun después de terminado el contrato.`)}
${cl("DÉCIMA TERCERA: MANEJO DE CLIENTES Y BASE DE DATOS",
    `Los clientes atendidos o registrados a través de ${marca} forman parte de la cartera comercial de la empresa. EL TRABAJADOR no podrá usar la base de datos, teléfonos, agendas, historiales o datos de clientes para fines personales, terceros o competencia, ni desviar clientes o realizar cobros personales.`)}
${cl("DÉCIMA CUARTA: USO DE SISTEMAS, WHATSAPP, AGENDA Y REDES SOCIALES",
    `Los accesos a sistemas internos, WhatsApp, AgendaPro, redes sociales, correos y plataformas son propiedad o están bajo control de EL EMPLEADOR y se usarán exclusivamente para fines laborales. EL TRABAJADOR no compartirá credenciales, no alterará información sin autorización, no descargará datos sin permiso ni usará las cuentas para fines personales.`)}
${cl("DÉCIMA QUINTA: EQUIPOS, HERRAMIENTAS, UNIFORMES Y MATERIALES",
    `Los equipos, herramientas, uniformes, documentos, claves, productos y materiales seguirán siendo propiedad de ${marca}, salvo pacto escrito en contrario. EL TRABAJADOR los conservará en buen estado, los usará solo para fines laborales y los devolverá al término del contrato o cuando se le requiera. En caso de daño, pérdida o uso indebido se procederá conforme a las reglas internas y la ley.`)}
${cl("DÉCIMA SEXTA: BIOSEGURIDAD, HIGIENE Y SERVICIOS ESTÉTICOS",
    `EL TRABAJADOR cumplirá estrictamente las normas de higiene, bioseguridad, limpieza, esterilización, preparación de cabinas y protocolos internos, e informará cualquier riesgo. Los servicios estéticos (depilación láser, masajes, faciales, eliminación de tatuajes, cosmiatría u otros) se realizarán únicamente dentro de sus competencias, entrenamientos y autorizaciones.`)}
${cl("DÉCIMA SÉPTIMA: POLÍTICAS INTERNAS Y DISCIPLINA",
    `EL TRABAJADOR cumplirá los reglamentos internos, manuales y políticas de ${marca}. Las medidas disciplinarias se aplicarán respetando sus derechos y el Código de Trabajo.`)}
${cl("DÉCIMA OCTAVA: AUSENCIAS, TARDANZAS Y PERMISOS",
    `EL TRABAJADOR informará con anticipación cualquier ausencia, tardanza, enfermedad o emergencia; las ausencias se justificarán con documentos válidos. Los permisos se solicitarán y autorizarán previamente, salvo emergencias comprobadas. Las tardanzas o ausencias injustificadas podrán generar consecuencias disciplinarias conforme a la ley.`)}
${cl("DÉCIMA NOVENA: PAGOS, COBROS Y MANEJO DE DINERO",
    `Si EL TRABAJADOR tiene autorización para manejar pagos, caja, transferencias o recibos, lo hará exclusivamente conforme a los procedimientos de ${marca}. No podrá recibir pagos personales, desviar pagos, usar cuentas personales, otorgar descuentos no autorizados ni alterar recibos. Cualquier irregularidad se reportará de inmediato.`)}
${cl("VIGÉSIMA: IMAGEN, REPUTACIÓN Y TRATO AL CLIENTE",
    `Por prestar servicios al público, la calidad del trato, imagen personal, higiene, lenguaje y conducta profesional son esenciales. Queda prohibido discutir con clientes, divulgar su información, realizar comentarios ofensivos o afectar la reputación de ${marca}.`)}
${cl("VIGÉSIMA PRIMERA: TERMINACIÓN DEL CONTRATO",
    `El contrato podrá terminar por cualquiera de las causas del Código de Trabajo (mutuo consentimiento, desahucio, despido, dimisión u otra causa legal), cumpliendo los avisos, pagos, prestaciones y procedimientos de ley. La terminación no libera al trabajador de devolver bienes, documentos, claves y accesos de ${marca}.`)}
${cl("VIGÉSIMA SEGUNDA: DEVOLUCIÓN DE BIENES Y ACCESOS",
    `Al finalizar la relación laboral, EL TRABAJADOR entregará uniformes, carnets, llaves, equipos, documentos, usuarios y contraseñas, accesos a sistemas, materiales y archivos bajo su control, sin conservar copias de información interna o datos de clientes.`)}
${cl("VIGÉSIMA TERCERA: MODIFICACIONES DEL CONTRATO",
    `Cualquier modificación a las condiciones esenciales se hará por escrito con aceptación de ambas partes, salvo los cambios permitidos por la ley dentro del poder de dirección razonable. Ninguna modificación implicará renuncia o disminución de los derechos mínimos del trabajador.`)}
${cl("VIGÉSIMA CUARTA: LEY APLICABLE Y JURISDICCIÓN",
    `El contrato se rige por las leyes de la República Dominicana, especialmente el Código de Trabajo, Ley No. 16-92. Cualquier diferencia será conocida por las autoridades competentes en materia laboral.`)}
${cl("VIGÉSIMA QUINTA: ACEPTACIÓN",
    `Ambas partes declaran haber leído íntegramente el contrato, entender su contenido y firmarlo libre y voluntariamente. Se firman cuatro originales de un mismo tenor y efecto.`)}
${c.observaciones ? cl("OBSERVACIONES", esc(c.observaciones)) : ""}
<p style="margin-top:14px">Hecho y firmado en Santiago de los Caballeros, República Dominicana, a los <b>${esc(dia)}</b> días del mes de <b>${esc(mes)}</b> del año <b>${esc(anio)}</b>.</p>
`

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(contractFileName(c).replace(/\.pdf$/, ""))}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Georgia, serif; color: #111; font-size: 11.5pt; line-height: 1.5; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 2px; }
  .sub { text-align:center; font-size: 10.5pt; color:#333; margin-bottom: 14px; }
  h3 { font-size: 11.5pt; margin: 14px 0 4px; }
  p { margin: 5px 0; text-align: justify; }
  .empresa { border:1px solid #999; border-radius:6px; padding:8px 12px; font-size:10.5pt; margin-bottom:12px; }
  .empresa b { display:inline-block; min-width:130px; }
  .firmas { margin-top:36px; display:flex; gap:40px; justify-content:space-between; }
  .firma { flex:1; text-align:center; }
  .firma .linea { margin-top:42px; border-top:1px solid #111; padding-top:4px; }
  @media print { .noprint { display:none } }
</style></head><body>
<div class="noprint" style="text-align:right;margin-bottom:8px"><button onclick="window.print()" style="padding:8px 14px;font-size:13px;cursor:pointer">🖨 Imprimir / Guardar PDF</button></div>
<h1>CONTRATO INDIVIDUAL DE TRABAJO POR ${esc((c.contractType || "TIEMPO INDEFINIDO").toUpperCase())}</h1>
<div class="sub">${esc(empresa)} — República Dominicana</div>
<div class="empresa">
  <div><b>Empresa:</b> ${esc(empresa)}</div>
  <div><b>RNC:</b> ${esc(rnc)}</div>
  <div><b>Representante legal:</b> ${esc(rep)}</div>
  <div><b>Cédula representante:</b> ${esc(cedRep)}</div>
  <div><b>Domicilio social:</b> ${esc(domicilio)}</div>
</div>
<p><b>ENTRE:</b> De una parte, ${esc(empresa)}, sociedad comercial existente conforme a las leyes de la República Dominicana, RNC No. ${esc(rnc)}, con domicilio social en ${esc(domicilio)}, debidamente representada por ${esc(rep)}, portador de la cédula de identidad y electoral No. ${esc(cedRep)}, quien en lo adelante se denominará <b>EL EMPLEADOR</b> o ${marca}.</p>
<p>Y de la otra parte, <b>${esc(c.empleadoNombre)}</b>, dominicano(a), mayor de edad, estado civil ${esc(c.estadoCivil || "____")}, portador(a) de la cédula de identidad y electoral No. ${esc(c.cedula || "____")}, domiciliado(a) y residente en ${esc(c.direccion || "____")}, teléfono No. ${esc(c.telefono || "____")}, quien en lo adelante se denominará <b>EL TRABAJADOR</b>.</p>
<p>Ambas partes, libre y voluntariamente, han convenido celebrar el presente Contrato Individual de Trabajo, sujeto a las disposiciones del Código de Trabajo de la República Dominicana, Ley No. 16-92, sus reglamentos y demás disposiciones aplicables.</p>
${body}
<div class="firmas">
  <div class="firma"><div class="linea">POR EL EMPLEADOR / ${marca}<br>Nombre: ${esc(rep)}<br>Cédula: ${esc(cedRep)}<br>Cargo: Representante Legal</div></div>
  <div class="firma"><div class="linea">EL TRABAJADOR<br>Nombre: ${esc(c.empleadoNombre)}<br>Cédula: ${esc(c.cedula || "____")}<br>Cargo: ${esc(c.cargo || "____")}</div></div>
</div>
</body></html>`
}
