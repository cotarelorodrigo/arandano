'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RolUsuario } from '@/lib/auth/sesion'
import { cn } from '@/lib/utils'

// Las pestañas de la aplicación, en un solo lugar.
type Pestana = { href: string; texto: string; soloDueno?: boolean }

const PESTANAS: Pestana[] = [
  { href: '/vender', texto: 'Vender' },
  { href: '/ventas', texto: 'Ventas' },
  { href: '/inventario', texto: 'Inventario' },
  { href: '/usuarios', texto: 'Usuarios', soloDueno: true },
]

/**
 * Por PREFIJO y no por igualdad: /ventas/<id> tiene que dejar Ventas
 * subrayado, o entrar al detalle de una venta apagaría toda la navegación.
 *
 * La barra del segundo caso no es cosmética: sin ella, `/vender-mayorista`
 * activaría Vender. Y es también lo que mantiene separados /vender y /ventas,
 * que se parecen lo suficiente como para tentar a alguien a comparar por los
 * primeros caracteres.
 */
export function estaActiva(href: string, ruta: string): boolean {
  return ruta === href || ruta.startsWith(`${href}/`)
}

/**
 * Es componente de CLIENTE desde el ciclo del home: la pestaña activa sale de
 * usePathname(), y un layout de servidor no puede saber en qué ruta está. No
 * cuesta nada sin JavaScript — Next renderiza los componentes de cliente en el
 * servidor para el HTML inicial, así que el subrayado sale correcto en la
 * primera carga, y cada navegación sin JS es una carga completa que vuelve a
 * salir correcta.
 *
 * Vivía acá porque tenía dos consumidores (el layout del grupo y app/page.tsx).
 * Desde que `/` redirige a /vender le quedó uno solo, y se queda igual por dos
 * motivos nuevos: es 'use client' —el layout no lo es— y es el punto de
 * extensión que CLAUDE.md promete para el registry de módulos. Cuando exista
 * Órdenes de Trabajo, sus pestañas entran por esta lista.
 */
export function Navegacion({ rol }: { rol: RolUsuario }) {
  const ruta = usePathname()

  return (
    /* -mb-px: el subrayado de 2 px de la pestaña activa se SOLAPA con el borde
       inferior del <header> en vez de quedar un pixel arriba, que es lo que
       dibujaba dos líneas paralelas. Es lo que la hace leer como una pestaña
       apoyada en el riel.

       Este -1 px no es un paso de la escala de espaciado (docs/sistema-de-
       diseno.md, sección "Espaciado y radio"): no sale de elegir un punto de
       esa lista, sale de medir el border-b de 1 px que tiene que tapar. Por
       eso está exceptuado ahí en vez de ser una violación sin documentar.

       overflow-x-auto: hoy sobra lugar con cuatro pestañas, pero este archivo
       es el punto de extensión que CLAUDE.md promete para el registry de
       módulos — cuando Órdenes de Trabajo sume las suyas, o en un teléfono, sin
       esto se rompe. Ahora sale gratis. */
    <nav className="-mb-px flex items-center gap-1 overflow-x-auto text-sm">
      {PESTANAS.filter((p) => !p.soloDueno || rol === 'DUENO').map((p) => {
        const activa = estaActiva(p.href, ruta)
        return (
          <Link
            key={p.href}
            href={p.href}
            // aria-current es lo que anuncia un lector de pantalla; el
            // subrayado solo no le dice nada a quien no ve la pantalla.
            aria-current={activa ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-t-sm border-b-2 px-3 py-2 transition-colors outline-none',
              // El anillo va INSET, y el motivo es mecánico: overflow-x-auto
              // computa el eje de bloque a `auto` también, así que un anillo
              // dibujado por fuera de la caja se recortaría arriba y abajo y
              // podría sacar una barra de scroll vertical. Uno interior no lo
              // toca el overflow.
              //
              // Y va OPACO (--ring, sin el /50 que usan botón e input): esos
              // otros controles acompañan el halo translúcido con un borde
              // sólido que también identifica el control (focus-visible:border-
              // ring), y acá no hay ese segundo indicador. Sin él, --ring/50
              // sobre --background da 2.70:1 — abajo del 3:1 que WCAG 1.4.11
              // pide para un indicador no textual. Opaco, el mismo par da
              // 10.79:1 (scripts/contraste.mts). Es el foco del elemento que
              // más se opera con teclado en el producto: no se le resigna nada.
              'focus-visible:inset-ring-3 focus-visible:inset-ring-ring',
              activa
                // El peso hace la mitad del trabajo: así el subrayado no tiene
                // que hacerlo todo, y de paso la pestaña activa y el anillo de
                // foco no se confunden, porque no comparten forma (una barra
                // recta abajo contra un halo alrededor del texto). Los dos son
                // --primary; lo que los distingue es la forma, no el color.
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {p.texto}
          </Link>
        )
      })}
    </nav>
  )
}
