import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que punto-de-venta.test.tsx: acciones.ts es 'use server' y
// su contrato ya lo prueba acciones.test.ts contra una base real. Acá sólo
// importa qué renderiza el chip, así que las dos actions se mockean.
vi.mock('./acciones', () => ({
  abrirCajaDesdeVender: vi.fn(),
  cerrarCajaDesdeVender: vi.fn(),
}))

type Props = {
  caja: { id: string; abiertaEn: Date } | null
  cotizacionUsd: string | null
  cotizacionUsdEn: Date | null
}

async function render(props: Props) {
  const { ChipCaja } = await import('./caja')
  return renderToStaticMarkup(<ChipCaja {...props} />)
}

const FUENTE = readFileSync('app/(app)/vender/caja.tsx', 'utf8')

describe('el chip de caja', () => {
  it('con caja abierta el chip la muestra', async () => {
    const html = await render({
      caja: { id: 'c1', abiertaEn: new Date('2026-08-21T17:32:00Z') },
      cotizacionUsd: null,
      cotizacionUsdEn: null,
    })
    expect(html).toContain('Caja abierta')
    // Y NO el chip de la otra mitad: los dos estados son excluyentes.
    expect(html).not.toContain('Abrir caja')
  })

  it('sin caja abierta el chip ofrece abrirla', async () => {
    const html = await render({ caja: null, cotizacionUsd: null, cotizacionUsdEn: null })
    expect(html).toContain('Abrir caja')
    expect(html).not.toContain('Caja abierta')

    // Cableado: el formulario que arma este chip tiene que llamar a
    // abrirCajaDesdeVender —no a cerrarCajaDesdeVender ni a cualquier otra
    // cosa—. Mutar este nombre en el fuente (probado a mano, ver el reporte
    // de la task) pone este caso en rojo.
    expect(FUENTE).toMatch(/useActionState\(abrirCajaDesdeVender,\s*INICIAL\)/)
  })

  it('con caja abierta, el cierre cuelga de cerrarCajaDesdeVender', () => {
    // Mismo motivo que el caso de arriba, para la otra mitad del chip: sin
    // esto, invertir cuál action dispara cuál formulario no lo atraparía
    // ningún test (los dos formularios tienen la misma forma).
    expect(FUENTE).toMatch(/useActionState\(cerrarCajaDesdeVender,\s*INICIAL\)/)
  })

  it('muestra la cotización del local y de cuándo es', async () => {
    const html = await render({
      caja: null,
      cotizacionUsd: '1485.00',
      cotizacionUsdEn: new Date('2026-08-21T17:32:00Z'),
    })
    expect(html).toContain('USD')
    expect(html).toContain('1.485,00')

    // La fecha viaja al tooltip (Radix Tooltip.Portal), que sólo monta
    // contenido en el cliente: renderToStaticMarkup no lo ejecuta —por eso
    // este caso no busca "Actualizada el" en el HTML—, así que el cableado
    // de la fecha se comprueba en el fuente.
    expect(FUENTE).toMatch(/Actualizada el \{formatearFecha\(en\)\}/)
  })

  it('sin cotización cargada no inventa un número', async () => {
    const html = await render({ caja: null, cotizacionUsd: null, cotizacionUsdEn: null })
    expect(html).toContain('—')
    // Ninguna cifra con forma de plata (miles con punto, centavos con coma)
    // en toda la salida — y no un `/\d/` a secas, que también matchearía el
    // hash del classname que el Proxy de CSS modules fabrica bajo `css:
    // false` (ver la nota de punto-de-venta.test.tsx sobre eso) y daría este
    // caso en rojo por una razón que no tiene nada que ver con lo que prueba.
    expect(html).not.toMatch(/\d{1,3}(\.\d{3})*,\d{2}/)
  })

  it('con cotización cargada pero sin fecha, tampoco se arriesga el tooltip', async () => {
    // Caso defensivo: si algún día el dato queda inconsistente (cotización
    // sin su fecha), el chip sigue sin mentir mostrando "de cuándo es" nada.
    const html = await render({ caja: null, cotizacionUsd: '1485.00', cotizacionUsdEn: null })
    expect(html).toContain('1.485,00')
  })
  // Cuarta aparición del mismo defecto en el rediseño: un mensaje de error que
  // el lector de pantalla nunca anuncia porque nadie le puso el rol al
  // convertirlo de forma. Acá son dos —cerrar y abrir la caja—, y por eso el
  // caso NO pregunta "¿hay algún role=alert?": cuenta. Un test que se conforma
  // con encontrar uno se pone verde con el otro roto, que es exactamente cómo
  // este defecto sobrevivió tres veces.
  it('TODOS los mensajes de error del chip llevan role="alert"', () => {
    const errores = FUENTE.match(/<span[^>]*>\{estado\.error\}<\/span>/g) ?? []
    expect(errores.length).toBe(2)
    for (const span of errores) {
      expect(span).toContain('role="alert"')
    }
  })
})
