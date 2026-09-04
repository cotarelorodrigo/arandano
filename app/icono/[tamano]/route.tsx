import { ImageResponse } from 'next/og'
import { notFound } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { inicialDe } from '@/lib/marca/inicial'
import { TAMANOS } from '@/lib/marca/tamanos-de-icono'

/**
 * El ícono que el dueño ve en la pantalla de inicio de su celular: la inicial
 * de su local sobre el arándano.
 *
 * Generado y no un PNG en public/, por la misma razón que
 * app/opengraph-image.tsx: un binario a mano se desincroniza del color de
 * marca sin que nadie se entere.
 */
export const dynamic = 'force-dynamic'

// Los valores de color están copiados a mano de app/globals.css: Satori no
// resuelve var(--marca). test/icono.test.ts los compara contra los tokens reales.

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ tamano: string }> },
) {
  const { tamano } = await params
  const lado = Number(tamano)
  if (!TAMANOS.includes(lado as (typeof TAMANOS)[number])) notFound()

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') notFound()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#2a1760',
          color: '#ffffff',
          // La mitad del lado deja la altura de mayúscula en ~35 % del ícono,
          // bien adentro del círculo del 80 % con el que Android recorta la
          // variante maskable. Por eso la misma imagen sirve para las dos.
          fontSize: lado * 0.5,
        }}
      >
        {inicialDe(resolucion.tenant.nombre)}
      </div>
    ),
    { width: lado, height: lado },
  )
}
