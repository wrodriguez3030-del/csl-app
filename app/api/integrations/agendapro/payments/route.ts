/**
 * Webhook de PAGOS de AgendaPro — variante con token en query-string:
 *   POST /api/integrations/agendapro/payments?token=<AGENDAPRO_WEBHOOK_SECRET>
 *
 * También existe la variante con token en la ruta (más limpia para pegar en
 * AgendaPro): POST /api/integrations/agendapro/payments/<AGENDAPRO_WEBHOOK_SECRET>
 * (ver ./[token]/route.ts). Ambas comparten la lógica en
 * lib/server/agendapro-webhook.ts. El webhook de CLIENTES (../webhook) queda intacto.
 */

import { NextResponse } from "next/server"
import { agendaProWebhookHealth, handleAgendaProPaymentWebhook } from "@/lib/server/agendapro-webhook"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: Request) {
  return handleAgendaProPaymentWebhook(request)
}

/** GET = health-check sin secretos. */
export async function GET() {
  return NextResponse.json(agendaProWebhookHealth())
}
