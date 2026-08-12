'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RolUsuario } from '@/lib/auth/sesion'
import { cn } from '@/lib/utils'

/**
 * Las pestañas de la aplicación, en un solo lugar.
 *
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

export function Navegacion({ rol }: { rol: RolUsuario }) {
  const ruta = usePathname()

  return (
    <nav className="flex items-center gap-1 text-sm">
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
              'border-b-2 px-3 py-2 font-medium transition-colors',
              activa
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {p.texto}
          </Link>
        )
      })}
    </nav>
  )
}
