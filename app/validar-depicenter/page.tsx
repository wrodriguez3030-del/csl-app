/**
 * Validador público de Certificados Digitales DEPICENTER.
 *
 * Se llega aquí escaneando el QR del certificado:
 *   /validar-depicenter?c=CODIGO&o=...&d=...&v=...&f=YYYY-MM-DD&s=FIRMA
 *
 * Lógica:
 *  1. Calculamos la firma esperada con los params y comparamos con `s`.
 *     Si no coincide → el QR fue alterado.
 *  2. Consultamos el backend (`/api/public/validar-depicenter`) por el
 *     código para mostrar el estado actual del certificado (Activo /
 *     Usado / Vencido / Cancelado) — esto evita que un QR válido pero
 *     ya canjeado pase como bueno.
 *
 * Si la tabla aún no existe (PGRST205) el backend responde
 * `tableMissing: true` y mostramos un mensaje amigable sin error 500.
 */
import { depicenterSignature, type CertificadoDepicenterData } from "@/lib/certificado-depicenter"

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type ServerResponse = {
  ok: boolean
  found?: boolean
  tableMissing?: boolean
  certificado?: {
    codigo: string
    fecha?: string
    fechaVencimiento?: string
    otorgadoA: string
    cortesiaDe: string
    validoPor: string
    estado: string
    sucursal?: string
    emitidoEn?: string
  }
  error?: string
}

function val(params: Record<string, string | string[] | undefined>, key: string) {
  const raw = params[key]
  return Array.isArray(raw) ? raw[0] || "" : raw || ""
}

function formatDate(value?: string) {
  if (!value) return "-"
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

async function fetchCertificado(codigo: string): Promise<ServerResponse> {
  if (!codigo) return { ok: true, found: false }
  // En server components, fetch contra la propia app necesita un origin
  // absoluto. Vercel inyecta VERCEL_URL; en local usamos NEXT_PUBLIC_SITE_URL
  // o caemos al fallback localhost.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  try {
    const r = await fetch(`${origin}/api/public/validar-depicenter?codigo=${encodeURIComponent(codigo)}`, {
      cache: "no-store",
    })
    return (await r.json()) as ServerResponse
  } catch {
    return { ok: false, error: "No se pudo consultar el certificado." }
  }
}

export default async function ValidarDepicenterPage({ searchParams }: Props) {
  const params = await searchParams
  const data: CertificadoDepicenterData = {
    codigo: val(params, "c"),
    otorgadoA: val(params, "o"),
    cortesiaDe: val(params, "d"),
    validoPor: val(params, "v"),
    fecha: val(params, "f"),
  }
  const firma = val(params, "s")
  const firmaOk = Boolean(data.codigo && firma && depicenterSignature(data) === firma)
  const server = await fetchCertificado(data.codigo)

  const cert = server.certificado
  const estado = cert?.estado || (firmaOk ? "Activo" : "No validado")

  const isValid = firmaOk && server.ok && server.found && estado === "Activo"
  const isUsed = server.found && estado === "Usado"
  const isCancelled = server.found && estado === "Cancelado"
  const isExpired = server.found && estado === "Vencido"
  const tableMissing = server.tableMissing === true

  // Color del banner por estado
  let bannerCls = "bg-red-500/20 text-red-200 ring-red-400/40"
  let bannerText = "Certificado NO validado"
  if (tableMissing) {
    bannerCls = "bg-amber-500/20 text-amber-200 ring-amber-400/40"
    bannerText = "Validación temporalmente no disponible"
  } else if (isValid) {
    bannerCls = "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40"
    bannerText = "Certificado válido · Depicenter Skin Laser"
  } else if (isUsed) {
    bannerCls = "bg-slate-500/30 text-slate-200 ring-slate-400/40"
    bannerText = "Este certificado ya fue utilizado"
  } else if (isCancelled) {
    bannerCls = "bg-red-500/20 text-red-200 ring-red-400/40"
    bannerText = "Este certificado fue cancelado"
  } else if (isExpired) {
    bannerCls = "bg-amber-500/20 text-amber-200 ring-amber-400/40"
    bannerText = "Este certificado está vencido"
  } else if (!firmaOk && data.codigo) {
    bannerText = "El código de seguridad del QR no coincide"
  }

  // Datos a mostrar: priorizamos los del servidor (autoritativos), caemos
  // a los del QR si la consulta falló o el certificado todavía no existe
  const show = {
    codigo: cert?.codigo || data.codigo || "-",
    otorgadoA: cert?.otorgadoA || data.otorgadoA || "-",
    cortesiaDe: cert?.cortesiaDe || data.cortesiaDe || "-",
    validoPor: cert?.validoPor || data.validoPor || "-",
    fecha: cert?.fecha || data.fecha || "-",
    fechaVencimiento: cert?.fechaVencimiento || "-",
    estado,
  }

  return (
    <main
      className="min-h-screen px-4 py-12 text-white"
      style={{ background: "linear-gradient(180deg, #082c2b 0%, #051a19 100%)" }}
    >
      <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
        <div className={`mb-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ring-1 ${bannerCls}`}>
          {bannerText}
        </div>
        <h1 className="font-serif text-3xl font-bold tracking-tight" style={{ color: "#7FE3DE" }}>
          Validación de certificado
        </h1>
        <p className="mt-1 text-sm text-slate-300">Depicenter · Skin Laser</p>

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex flex-col gap-1 border-b border-white/10 pb-2">
            <dt className="text-xs uppercase tracking-wide text-slate-400">Código</dt>
            <dd className="font-mono text-base">{show.codigo}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Estado</dt>
              <dd className="text-base font-semibold">{show.estado}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Emitido</dt>
              <dd className="text-base">{formatDate(show.fecha)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400">Vence</dt>
              <dd className="text-base">{formatDate(show.fechaVencimiento)}</dd>
            </div>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Otorgado a</dt>
            <dd className="text-base">{show.otorgadoA}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Cortesía de</dt>
            <dd className="text-base">{show.cortesiaDe}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-400">Válido por</dt>
            <dd className="text-base">{show.validoPor}</dd>
          </div>
        </dl>

        {!tableMissing && !server.found && data.codigo && (
          <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            El código no figura en nuestra base de datos. Si lo recibiste físicamente,
            comunícate con Depicenter para verificar autenticidad.
          </p>
        )}

        {tableMissing && (
          <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            La base de certificados aún se está preparando. Verifica de nuevo en unos minutos
            o contacta a Depicenter directamente.
          </p>
        )}

        <p className="mt-6 text-xs text-slate-400">
          La firma incluida en el QR se verifica contra los datos visibles en el
          certificado. El estado se consulta en tiempo real con Depicenter.
        </p>
      </div>
    </main>
  )
}
