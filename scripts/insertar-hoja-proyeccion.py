"""Inserta la PROYECCIÓN como una hoja más en el libro de incentivos.

Cirugía sobre el XML dentro del ZIP: el libro lleva 18 gráficos, 17 tablas
dinámicas y 13 dibujos, y cualquier librería que lo reescriba los destruye. Aquí
solo se AÑADE una hoja y se tocan las cuatro piezas que la registran.

    python3 scripts/insertar-hoja-proyeccion.py <libro.xlsx> <datos.json> <salida.xlsx>
"""
import json, re, sys, zipfile

NSMAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
HOJA = "PROYECCIÓN"

def esc(t):
    return (str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

class Hoja:
    """Acumula celdas y las escribe como XML de worksheet."""
    def __init__(self): self.filas, self.merges, self.anchos = {}, [], []
    def _set(self, col, fila, cuerpo, estilo, tipo=""):
        self.filas.setdefault(fila, {})[col] = (cuerpo, estilo, tipo)
    def texto(self, col, fila, t, estilo=0):
        self._set(col, fila, f"<is><t>{esc(t)}</t></is>", estilo, ' t="inlineStr"')
    def numero(self, col, fila, n, estilo=0):
        self._set(col, fila, f"<v>{n}</v>", estilo)
    def formula(self, col, fila, f, estilo=0):
        self._set(col, fila, f"<f>{esc(f)}</f>", estilo)
    def merge(self, a, b): self.merges.append(f"{a}:{b}")
    def xml(self):
        def letras(n):
            s = ""
            while n: n, r = divmod(n - 1, 26); s = chr(65 + r) + s
            return s
        filas = []
        for nf in sorted(self.filas):
            celdas = "".join(
                f'<c r="{letras(c)}{nf}" s="{est}"{tp}>{cuerpo}</c>'
                for c in sorted(self.filas[nf])
                for cuerpo, est, tp in [self.filas[nf][c]])
            filas.append(f'<row r="{nf}">{celdas}</row>')
        cols = "".join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>'
                       for i, w in enumerate(self.anchos))
        mc = (f'<mergeCells count="{len(self.merges)}">'
              + "".join(f'<mergeCell ref="{m}"/>' for m in self.merges) + "</mergeCells>") if self.merges else ""
        return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<worksheet xmlns="{NSMAIN}">'
                f'<sheetFormatPr defaultRowHeight="15"/>'
                f'{f"<cols>{cols}</cols>" if cols else ""}'
                f'<sheetData>{"".join(filas)}</sheetData>{mc}</worksheet>')

def ampliar_estilos(xml):
    """Añade formatos al final de styles.xml; los índices existentes no se mueven."""
    def bloque(tag, nuevos):
        """Añade al final del bloque y actualiza el contador. `fonts` trae
        atributos extra (`x14ac:knownFonts`), así que la apertura se conserva."""
        nonlocal xml
        m = re.search(r"<%s([^>]*)>(.*?)</%s>" % (tag, tag), xml, re.S)
        attrs, cuerpo = m.group(1), m.group(2)
        base = int(re.search(r'count="(\d+)"', attrs).group(1))
        attrs = re.sub(r'count="\d+"', 'count="%d"' % (base + len(nuevos)), attrs, count=1)
        xml = xml[:m.start()] + "<%s%s>%s%s</%s>" % (tag, attrs, cuerpo, "".join(nuevos), tag) + xml[m.end():]
        return base
    bloque("numFmts", ['<numFmt numFmtId="300" formatCode="&quot;RD$&quot;#,##0"/>',
                       '<numFmt numFmtId="301" formatCode="0.0%"/>'])
    f0 = bloque("fonts", [
        '<font><b/><sz val="14"/><color rgb="FF1F3864"/><name val="Calibri"/></font>',   # +0 título
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',   # +1 cabecera
        '<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/></font>',   # +2 nota
        '<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font>',   # +3 negrita
        '<font><b/><sz val="12"/><color rgb="FF1F3864"/><name val="Calibri"/></font>',   # +4 subtítulo
        '<font><sz val="11"/><color rgb="FF808080"/><name val="Calibri"/></font>',       # +5 gris
    ])
    fi0 = bloque("fills", [
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>',  # +0 azul
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>',  # +1 amarillo
    ])
    x0 = bloque("cellXfs", [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',                                                     # 0 normal
        f'<xf numFmtId="0" fontId="{f0}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                                   # 1 título
        f'<xf numFmtId="0" fontId="{f0+4}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                                 # 2 subtítulo
        f'<xf numFmtId="0" fontId="{f0+1}" fillId="{fi0}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',               # 3 cabecera
        '<xf numFmtId="300" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',                             # 4 dinero
        '<xf numFmtId="301" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',                             # 5 %
        f'<xf numFmtId="301" fontId="0" fillId="{fi0+1}" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>',        # 6 % editable
        f'<xf numFmtId="300" fontId="0" fillId="{fi0+1}" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>',        # 7 dinero editable
        f'<xf numFmtId="300" fontId="{f0+3}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>',         # 8 dinero negrita
        f'<xf numFmtId="0" fontId="{f0+2}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                                 # 9 nota
        f'<xf numFmtId="0" fontId="{f0+3}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                                 # 10 negrita
        f'<xf numFmtId="300" fontId="{f0+5}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>',         # 11 dinero gris
        f'<xf numFmtId="0" fontId="{f0+5}" fillId="0" borderId="0" xfId="0" applyFont="1"/>',                                 # 12 gris
        f'<xf numFmtId="301" fontId="{f0+3}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>',         # 13 % negrita
    ])
    return xml, {k: x0 + i for i, k in enumerate(
        ["normal", "titulo", "subtitulo", "cabecera", "dinero", "pct", "pctEdit",
         "dineroEdit", "dineroBold", "nota", "bold", "dineroGris", "gris", "pctBold"])}

def construir(d, E):
    h = Hoja()
    h.anchos = [22, 17, 17, 17, 17, 17, 15, 46]
    A = d["anio"]; SUCS = [r["suc"] for r in d["enCurso"]]
    cuota = d["cuotaTranscurrida"]; peso = d["pesoMes"]
    L = lambda n: chr(64 + n)

    h.texto(1, 1, f"PROYECCIÓN DE VENTAS {A} – {A+4}", E["titulo"]); h.merge("A1", "H1")
    h.texto(1, 2, "Generada desde las ventas reales del sistema. Todo lo proyectado son fórmulas: cambia las celdas amarillas y se recalcula solo.", E["nota"]); h.merge("A2", "H2")

    # ── SUPUESTOS ──
    h.texto(1, 4, "SUPUESTOS", E["subtitulo"])
    h.texto(1, 5, "Parte del año que va de enero a agosto", E["normal"])
    h.numero(2, 5, round(d["cuotaEneAgo"], 6), E["pct"])
    h.texto(3, 5, "Media de los 3 últimos años completos. Sirve para estimar el cierre.", E["nota"]); h.merge("C5", "H5")
    h.texto(1, 6, "Peso de NOVIEMBRE en el año", E["normal"])
    h.numero(2, 6, round(peso[10], 6), E["pct"])
    h.texto(3, 6, "Black Friday. Es el mes que decide el año: si falla, falla la proyección entera.", E["nota"]); h.merge("C6", "H6")

    nueva = next((r for r in d["enCurso"] if r["mesesConVenta"] <= 2), None)
    if nueva:
        h.texto(1, 7, f"{nueva['suc']} — cierre {A} (ponlo tú)", E["normal"])
        h.numero(2, 7, round(nueva["real"] * 6, 2), E["dineroEdit"])
        h.texto(3, 7, f"Solo {nueva['mesesConVenta']} mes de ventas. Supone ese mismo ritmo hasta diciembre, SIN campaña de noviembre.", E["nota"]); h.merge("C7", "H7")

    for i, t in enumerate(["Crecimiento anual esperado", *[str(A+k) for k in (1,2,3,4)], "", "", "Por qué"]):
        h.texto(i + 1, 9, t, E["cabecera"])
    fCrec = {}
    for j, s in enumerate(SUCS):
        f = 10 + j; fCrec[s] = f
        h.texto(1, f, s, E["normal"])
        for k in range(4): h.numero(2 + k, f, d["crecimiento"][s][k], E["pctEdit"])
        h.texto(8, f, d["razon"][s], E["nota"])

    # ── PROYECCIÓN ──
    f0 = 10 + len(SUCS) + 2
    h.texto(1, f0, "PROYECCIÓN", E["subtitulo"])
    for i, t in enumerate(["Sucursal", f"{A} (cierre)", *[str(A+k) for k in (1,2,3,4)], "", "Aviso"]):
        h.texto(i + 1, f0 + 1, t, E["cabecera"])
    fPro = {}
    for j, s in enumerate(SUCS):
        f = f0 + 2 + j; fPro[s] = f
        r = next(x for x in d["enCurso"] if x["suc"] == s)
        h.texto(1, f, s, E["normal"])
        if r["mesesConVenta"] <= 2:
            h.formula(2, f, "$B$7", E["dinero"])
            h.texto(8, f, f"⚠ Solo {r['mesesConVenta']} mes de ventas: el cierre lo fijas tú arriba.", E["nota"])
        else:
            h.formula(2, f, f"{r['real']}/{cuota:.6f}", E["dinero"])
        for k in range(4):
            h.formula(3 + k, f, f"{L(2+k)}{f}*(1+${L(2+k)}${fCrec[s]})", E["dinero"])
    fTot = f0 + 2 + len(SUCS)
    h.texto(1, fTot, "TOTAL", E["bold"])
    for k in range(5):
        h.formula(2 + k, fTot, f"SUM({L(2+k)}{f0+2}:{L(2+k)}{fTot-1})", E["dineroBold"])
    ultReal = max(x["anio"] for x in d["historico"] if x["meses"] == 12)
    h.texto(1, fTot + 1, "Crecimiento sobre el año anterior", E["normal"])

    # ── HISTÓRICO ──
    fH = fTot + 3
    h.texto(1, fH, "VENTAS REALES", E["subtitulo"])
    for i, t in enumerate(["Año", "Ventas", "Crecimiento", "Meses", *SUCS[:4]]):
        h.texto(i + 1, fH + 1, t, E["cabecera"])
    filaAnio = {}
    for j, r in enumerate(d["historico"]):
        f = fH + 2 + j; filaAnio[r["anio"]] = f
        completo = r["meses"] == 12
        h.numero(1, f, r["anio"], E["normal"] if completo else E["gris"])
        h.numero(2, f, r["total"], E["dinero"] if completo else E["dineroGris"])
        if j: h.formula(3, f, f"IF(B{f-1}=0,\"\",B{f}/B{f-1}-1)", E["pct"])
        h.texto(4, f, str(r["meses"]) if r["meses"] else "ref.", E["normal"] if completo else E["gris"])
        for k, s in enumerate(SUCS[:4]):
            v = r["porSucursal"].get(s, 0)
            if v: h.numero(5 + k, f, v, E["dinero"] if completo else E["dineroGris"])
    for k in range(5):
        h.formula(2 + k, fTot + 1,
                  f"{L(2+k)}{fTot}/{'B'+str(filaAnio[ultReal]) if k == 0 else L(1+k)+str(fTot)}-1", E["pctBold"])

    # ── MES A MES ──
    fM = fH + 2 + len(d["historico"]) + 2
    h.texto(1, fM, f"{A} MES A MES", E["subtitulo"])
    for i, t in enumerate(["Mes", "Real", "Proyectado", "% del año", "", "", "", ""]):
        h.texto(i + 1, fM + 1, t, E["cabecera"])
    acum = sum(d["mesReal"]); pend = sum(p for i, p in enumerate(peso) if not d["mesReal"][i])
    for i, mes in enumerate(d["meses"]):
        f = fM + 2 + i
        h.texto(1, f, mes, E["normal"])
        if d["mesReal"][i]: h.numero(2, f, d["mesReal"][i], E["dinero"])
        else: h.formula(3, f, f"($B${fTot}-{round(acum,2)})*{peso[i]/pend:.6f}", E["dinero"])
        h.numero(4, f, round(peso[i], 6), E["pct"])
        if i == 10: h.texto(5, f, "Black Friday: el mes que decide el año", E["nota"]); h.merge(f"E{f}", f"H{f}")
    fMT = fM + 14
    h.texto(1, fMT, "TOTAL", E["bold"])
    h.formula(2, fMT, f"SUM(B{fM+2}:B{fMT-1})", E["dineroBold"])
    h.formula(3, fMT, f"SUM(C{fM+2}:C{fMT-1})", E["dineroBold"])
    h.texto(1, fMT + 1, "AÑO COMPLETO", E["bold"])
    h.formula(2, fMT + 1, f"B{fMT}+C{fMT}", E["dineroBold"])
    h.texto(1, fMT + 3, "En gris, los años incompletos. Lo que falta del año en curso se reparte entre los meses pendientes según su peso, así que la suma cuadra siempre con el cierre proyectado.", E["nota"])
    h.merge(f"A{fMT+3}", f"H{fMT+3}")
    return h

def main(libro, datos, salida):
    d = json.load(open(datos, encoding="utf-8"))
    z = zipfile.ZipFile(libro)
    partes = {n: z.read(n) for n in z.namelist()}
    infos = {i.filename: i for i in z.infolist()}
    orden = z.namelist(); z.close()

    usados = [int(m.group(1)) for n in orden if (m := re.match(r"xl/worksheets/sheet(\d+)\.xml$", n))]
    nuevo = f"xl/worksheets/sheet{max(usados)+1}.xml"

    wbxml = partes["xl/workbook.xml"].decode("utf-8")
    if f'name="{HOJA}"' in wbxml: raise SystemExit(f"La hoja «{HOJA}» ya existe.")
    sheetId = max(int(m) for m in re.findall(r'<sheet[^>]*sheetId="(\d+)"', wbxml)) + 1
    relsxml = partes["xl/_rels/workbook.xml.rels"].decode("utf-8")
    ridmax = max(int(m) for m in re.findall(r'Id="rId(\d+)"', relsxml))
    rid = "rId%d" % (ridmax + 1)

    styles, E = ampliar_estilos(partes["xl/styles.xml"].decode("utf-8"))
    partes["xl/styles.xml"] = styles.encode("utf-8")
    partes[nuevo] = construir(d, E).xml().encode("utf-8")

    wbxml = wbxml.replace("</sheets>",
        f'<sheet name="{HOJA}" sheetId="{sheetId}" r:id="{rid}"/></sheets>', 1)
    partes["xl/workbook.xml"] = wbxml.encode("utf-8")
    partes["xl/_rels/workbook.xml.rels"] = relsxml.replace("</Relationships>",
        f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="{nuevo.replace("xl/","")}"/></Relationships>', 1).encode("utf-8")
    ct = partes["[Content_Types].xml"].decode("utf-8").replace("</Types>",
        f'<Override PartName="/{nuevo}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', 1)
    partes["[Content_Types].xml"] = ct.encode("utf-8")

    with zipfile.ZipFile(salida, "w") as out:
        for n in orden + [nuevo]:
            i = infos.get(n)
            zi = zipfile.ZipInfo(n, date_time=i.date_time if i else (2026, 1, 1, 0, 0, 0))
            zi.compress_type = i.compress_type if i else zipfile.ZIP_DEFLATED
            if i: zi.external_attr = i.external_attr
            out.writestr(zi, partes[n])
    print(f"hoja «{HOJA}» añadida como {nuevo} (sheetId {sheetId}, {rid})")

if __name__ == "__main__":
    main(*sys.argv[1:4])
