import Link from 'next/link'
import type { MonedaElegida } from '@/lib/ventas/medios'

/**
 * El selector `$ / US$` (design/arandano.pen) que gobierna un panel dibujado
 * EN UNA SOLA moneda a la vez: "Cómo entró la plata" de `/ventas`
 * (`app/(app)/ventas/grafico.tsx`) y los cuatro paneles de `/dashboard`
 * (`app/(app)/dashboard/paneles.tsx`).
 *
 * **Compartido acá y no copiado dos veces**, que es justo el defecto que la
 * review final de rama encontró: las dos pantallas tenían el MISMO marcado y
 * las MISMAS clases, y ya habían divergido —`/ventas` seguía con un `<a>`
 * pelado (recarga completa en cada toggle) mientras `/dashboard` ya usaba
 * `<Link>`—. Es la tercera instancia de la forma "dos copias que hay que
 * acordarse de sincronizar" que este repo documenta (el merge del ciclo
 * móvil con "Anular orden", y `monedaEfectiva` reimplementada en Task 11 en
 * vez de compartida, son las otras dos).
 *
 * `<Link>` y no un control de cliente: el estado vive en la URL (`?moneda`),
 * como el resto de los filtros de cada pantalla, así que el selector —y con
 * él, el panel entero— funciona sin JavaScript.
 *
 * La regla del producto la aplica el LLAMADOR, no este componente: sin
 * `hayDolares` no se dibuja nada, ni siquiera un control deshabilitado —un
 * local que no usa dólares no ve ninguna diferencia con lo que ya conoce.
 */
export function SelectorDeMonedaElegida({
  hayDolares, moneda, href,
}: {
  hayDolares: boolean
  moneda: MonedaElegida
  /** El link de cada opción, armado por la pantalla: este componente no
   *  conoce el resto del query string (`?rango`, `?vista`). */
  href: (m: MonedaElegida) => string
}) {
  if (!hayDolares) return null
  return (
    <div className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]">
      {(['ars', 'usd'] as const).map((m) => (
        <Link
          key={m}
          href={href(m)}
          aria-current={m === moneda ? 'page' : undefined}
          className={
            m === moneda
              ? 'rounded-[8px] bg-card px-[10px] py-1 text-[11px] font-semibold text-foreground shadow-sm'
              : 'rounded-[8px] px-[10px] py-1 text-[11px] font-semibold text-muted-foreground'
          }
        >
          {m === 'ars' ? '$' : 'US$'}
        </Link>
      ))}
    </div>
  )
}
