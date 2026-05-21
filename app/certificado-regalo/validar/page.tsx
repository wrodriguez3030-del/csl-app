import { CertificadoRegaloData, certificateSignature } from "@/lib/certificado-regalo"

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const raw = params[key]
  return Array.isArray(raw) ? raw[0] || "" : raw || ""
}

export default async function ValidarCertificadoRegaloPage({ searchParams }: Props) {
  const params = await searchParams
  const data: CertificadoRegaloData = {
    codigo: value(params, "c"),
    otorgadoA: value(params, "o"),
    cortesiaDe: value(params, "d"),
    validoPor: value(params, "v"),
    fecha: value(params, "f"),
  }
  const firma = value(params, "s")
  const valido = Boolean(data.codigo && firma && certificateSignature(data) === firma)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-white">
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className={`mb-5 inline-flex rounded-full px-4 py-2 text-sm font-bold ${valido ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
          {valido ? "Certificado validado por Cibao Spa Laser" : "Certificado no validado"}
        </div>
        <h1 className="text-3xl font-bold">Validación de certificado</h1>
        <div className="mt-6 space-y-3 text-sm">
          <p><b>Código:</b> {data.codigo || "-"}</p>
          <p><b>Otorgado a:</b> {data.otorgadoA || "-"}</p>
          <p><b>Cortesía de:</b> {data.cortesiaDe || "-"}</p>
          <p><b>Válido por:</b> {data.validoPor || "-"}</p>
          <p><b>Fecha:</b> {data.fecha || "-"}</p>
        </div>
        <p className="mt-6 text-xs text-slate-400">
          Esta página verifica la firma digital impresa en el QR del certificado.
        </p>
      </div>
    </main>
  )
}
