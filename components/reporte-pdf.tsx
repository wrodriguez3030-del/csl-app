"use client"

import type { Reporte, PiezaIntervenida } from "@/lib/types"

interface ReportePDFProps {
  reporte: Reporte
  piezas: PiezaIntervenida[]
  firmaCliente?: string
  firmaTecnico?: string
}

export function ReportePDF({ reporte, piezas, firmaCliente, firmaTecnico }: ReportePDFProps) {
  const formatDate = (d: string) => {
    if (!d) return ""
    const date = new Date(d)
    return `${date.getDate()}/${date.getMonth() + 1}/${String(date.getFullYear()).slice(2)}`
  }

  const tipoMap: Record<string, string> = {
    Preventivo: "PREVENTIVO",
    Correctivo: "CORRECTIVO",
    "Garantía": "GARANTIA",
    "Pago por servicio": "PAGO POR SERVICIO",
  }

  return (
    <div
      id="reporte-pdf"
      style={{
        fontFamily: "Arial, sans-serif",
        fontSize: "11px",
        width: "210mm",
        minHeight: "297mm",
        padding: "10mm",
        background: "white",
        color: "black",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td colSpan={8} style={{ textAlign: "right", fontWeight: "bold", fontSize: "16px", paddingBottom: "6px" }}>
              REPORTE DE SERVICIO
            </td>
          </tr>
          <tr>
            <td style={labelStyle}>NOMBRE DE LA EMPRESA</td>
            <td colSpan={4} style={{ ...valueStyle, textAlign: "center" }}>{reporte.Empresa || "CIBAO SPA LASER, CSL, S.R.L."}</td>
            <td style={labelStyle}>FECHA</td>
            <td colSpan={2} style={valueStyle}>{formatDate(reporte.Fecha)}</td>
          </tr>
          <tr>
            <td style={labelStyle}>DOMICILIO</td>
            <td colSpan={4} style={{ ...valueStyle, textAlign: "center" }}>{reporte.Domicilio}</td>
            <td style={labelStyle}>CIUDAD</td>
            <td colSpan={2} style={valueStyle}>{reporte.Ciudad}</td>
          </tr>
          <tr>
            <td style={labelStyle}>CLIENTE</td>
            <td colSpan={2} style={{ ...valueStyle, textAlign: "center" }}>{reporte.Cliente || reporte.Empresa}</td>
            <td style={labelStyle}>MODELO</td>
            <td style={valueStyle}>{reporte.Modelo}</td>
            <td style={labelStyle}>NO. SERIE</td>
            <td colSpan={2} style={valueStyle}>{reporte.Serie}</td>
          </tr>
          <tr>
            <td style={labelStyle}>TELEFONO</td>
            <td colSpan={2} style={valueStyle}></td>
            <td style={labelStyle}>LASER HEAD</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>NUMERO</td>
            <td colSpan={2} style={valueStyle}>{reporte.Numero}</td>
          </tr>
        </tbody>
      </table>

      {/* Tipo de servicio */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ ...labelStyle, fontWeight: "bold" }}>TIPO DE SERVICIO:</td>
            <td style={checkStyle}>PREVENTIVO</td>
            <td style={checkBox}>{reporte.Tipo === "Preventivo" ? "X" : ""}</td>
            <td style={checkStyle}>CORRECTIVO</td>
            <td style={checkBox}>{reporte.Tipo === "Correctivo" ? "X" : ""}</td>
            <td style={checkStyle}>GARANTIA</td>
            <td style={checkBox}>{reporte.Tipo === "Garantía" ? "X" : ""}</td>
            <td style={checkStyle}>PAGO POR SERVICIO</td>
            <td style={checkBox}>{reporte.Tipo === "Pago por servicio" ? "X" : ""}</td>
          </tr>
        </tbody>
      </table>

      {/* Problema */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ ...labelStyle, fontWeight: "bold", width: "130px" }}>PROBLEMA OBSERVADO:</td>
            <td style={{ ...valueStyle, height: "40px", verticalAlign: "top" }}>{reporte.Problema}</td>
          </tr>
        </tbody>
      </table>

      {/* Correccion */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ ...labelStyle, fontWeight: "bold", width: "130px" }}>CORRECCION:</td>
            <td style={{ ...valueStyle, height: "40px", verticalAlign: "top" }}>{reporte.Correccion}</td>
          </tr>
        </tbody>
      </table>

      {/* N/S */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ width: "120px" }}></td>
            <td style={labelStyle}>N/S FUENTE:</td>
            <td style={{ ...valueStyle, width: "150px" }}></td>
            <td style={{ width: "20px" }}></td>
            <td style={labelStyle}>N/S FIBRA:</td>
            <td style={{ ...valueStyle, width: "150px" }}></td>
          </tr>
        </tbody>
      </table>

      {/* Partes usadas */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ ...labelStyle, fontWeight: "bold" }}>PARTES USADAS:</td>
          </tr>
          {piezas.length > 0 ? piezas.map((p, i) => (
            <tr key={i}>
              <td style={{ ...valueStyle, width: "200px" }}>{p.pieza}</td>
              <td style={{ ...valueStyle, width: "150px" }}>{p.accion}</td>
              <td style={{ ...valueStyle, width: "100px" }}>{p.estado}</td>
              <td style={valueStyle}>{p.reemplazo === "Sí" ? "REEMPLAZADO" : ""}</td>
            </tr>
          )) : (
            <tr><td style={{ ...valueStyle, height: "20px" }}>{reporte.PartesTexto || ""}</td></tr>
          )}
          <tr><td style={{ height: "10px" }}></td></tr>
          <tr><td style={{ height: "10px" }}></td></tr>
        </tbody>
      </table>

      {/* Observaciones */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={{ ...labelStyle, fontWeight: "bold", width: "130px" }}>OBSERVACIONES:</td>
            <td style={{ ...valueStyle, height: "35px", verticalAlign: "top" }}>{reporte.Observaciones}</td>
          </tr>
        </tbody>
      </table>

      {/* Checklist */}
      {reporte.Checklist && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
          <tbody>
            <tr>
              <td style={{ ...labelStyle, fontWeight: "bold", width: "130px" }}>CHECKLIST:</td>
              <td style={{ ...valueStyle, verticalAlign: "top" }}>{reporte.Checklist}</td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Pulsos */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
        <tbody>
          <tr>
            <td style={labelStyle}>P. TOTALES:</td>
            <td style={valueStyle}>{reporte.P_Totales?.toLocaleString()}</td>
            <td style={labelStyle}>P. CABEZA:</td>
            <td style={valueStyle}>{reporte.P_Cabeza?.toLocaleString()}</td>
            <td style={labelStyle}>HV@</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>J</td>
            <td style={labelStyle}>BS:</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>/</td>
            <td style={labelStyle}>BC:</td>
            <td style={valueStyle}></td>
          </tr>
          <tr>
            <td style={labelStyle}>HV REF@</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>VDC-</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>V</td>
            <td style={labelStyle}>TX:</td>
            <td style={valueStyle}></td>
            <td style={labelStyle}>SOFTWARE</td>
            <td colSpan={4} style={valueStyle}></td>
          </tr>
        </tbody>
      </table>

      {/* Firmas */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px" }}>
        <tbody>
          <tr>
            <td style={labelStyle}>CLIENTE:</td>
            <td style={{ ...valueStyle, width: "200px" }}>{reporte.Cliente || reporte.Empresa}</td>
            <td style={{ width: "20px" }}></td>
            <td style={labelStyle}>ATENDIO:</td>
            <td style={valueStyle}>{reporte.Atendio}</td>
          </tr>
        </tbody>
      </table>

      {/* Firma images */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px" }}>
        <tbody>
          <tr>
            <td style={{ width: "50%", textAlign: "center", paddingRight: "10px" }}>
              {firmaCliente ? (
                <img src={firmaCliente} style={{ height: "60px", border: "1px solid #ccc" }} alt="Firma cliente" />
              ) : (
                <div style={{ height: "60px", borderBottom: "1px solid black" }}></div>
              )}
              <div style={{ borderTop: "1px solid black", paddingTop: "2px", fontWeight: "bold" }}>NOMBRE Y FIRMA CLIENTE</div>
            </td>
            <td style={{ width: "50%", textAlign: "center", paddingLeft: "10px" }}>
              {firmaTecnico ? (
                <img src={firmaTecnico} style={{ height: "60px", border: "1px solid #ccc" }} alt="Firma técnico" />
              ) : (
                <div style={{ height: "60px", borderBottom: "1px solid black" }}></div>
              )}
              <div style={{ borderTop: "1px solid black", paddingTop: "2px", fontWeight: "bold" }}>NOMBRE Y FIRMA TÉCNICO</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Styles
const labelStyle: React.CSSProperties = {
  border: "1px solid #999",
  padding: "2px 4px",
  fontWeight: "bold",
  background: "#f0f0f0",
  whiteSpace: "nowrap",
}

const valueStyle: React.CSSProperties = {
  border: "1px solid #999",
  padding: "2px 6px",
  minWidth: "60px",
}

const checkStyle: React.CSSProperties = {
  border: "1px solid #999",
  padding: "2px 4px",
  fontWeight: "bold",
  background: "#f0f0f0",
}

const checkBox: React.CSSProperties = {
  border: "1px solid #999",
  padding: "2px 8px",
  textAlign: "center",
  fontWeight: "bold",
}
