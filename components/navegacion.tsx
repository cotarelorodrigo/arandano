import Link from 'next/link'
import type { RolUsuario } from '@/lib/auth/sesion'

/**
 * Los enlaces de la aplicación, en un solo lugar.
 *
 * Lo usan DOS consumidores y por eso vive en components/ y no adentro de
 * `app/(app)/`: el layout del grupo, y `app/page.tsx`, que no puede estar bajo
 * ese grupo —el ápex entra por la misma ruta y no tiene sesión— y por lo tanto
 * no hereda su layout. Dos listas de enlaces se desincronizan en cuanto
 * aparezca la quinta sección.
 *
 * Cuatro secciones, sin "Inicio": el nombre del local en el header ya enlaza
 * a la home (ver app/(app)/layout.tsx), así que un link más al mismo destino
 * era redundante.
 *
 * Sin registry de módulos todavía: CLAUDE.md promete la navegación como punto
 * de extensión del núcleo, y ese punto se diseña bien cuando exista Órdenes de
 * Trabajo para tironear de él. Tenerlos centralizados acá es lo que hace barato
 * ese refactor.
 */
export function Navegacion({ rol }: { rol: RolUsuario }) {
  return (
    <nav className="flex items-center gap-4 text-sm">
      {/* Link y no <a>: son rutas internas de Next, y el `href="/"` con <a>
          dispara @next/next/no-html-link-for-pages (esta regla sí detecta la
          ruta raíz aunque no navegue bien las agrupadas bajo (app), que es por
          qué el resto del código de este ciclo ya usa Link en vez de <a> para
          links internos — ver app/(app)/inventario/page.tsx y nuevo/page.tsx). */}
      <Link href="/vender" className="hover:underline">
        Vender
      </Link>
      <Link href="/ventas" className="hover:underline">
        Ventas
      </Link>
      <Link href="/inventario" className="hover:underline">
        Inventario
      </Link>
      {rol === 'DUENO' && (
        <Link href="/usuarios" className="hover:underline">
          Usuarios
        </Link>
      )}
    </nav>
  )
}
