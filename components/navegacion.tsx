'use client'

import Link from 'next/link'
import { Package, ReceiptText, ShoppingCart, Users, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import type { RolUsuario } from '@/lib/auth/sesion'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

// Las pestañas de la aplicación, en un solo lugar.
type Pestana = { href: string; texto: string; icono: LucideIcon; soloDueno?: boolean }

const PESTANAS: Pestana[] = [
  { href: '/vender', texto: 'Vender', icono: ShoppingCart },
  { href: '/ventas', texto: 'Ventas', icono: ReceiptText },
  { href: '/inventario', texto: 'Inventario', icono: Package },
  // Fija y visible en TODO tenant, incluido el que no hace servicio técnico.
  // Es deuda consciente y está escrita en el spec con su vencimiento: cuando
  // exista el registry de módulos, esta entrada sale de TenantModule. El
  // disparador es el primer tenant de un rubro sin servicio técnico.
  { href: '/servicio-tecnico', texto: 'Servicio Técnico', icono: Wrench },
  { href: '/usuarios', texto: 'Usuarios', icono: Users, soloDueno: true },
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
    <SidebarMenu>
      {PESTANAS.filter((p) => !p.soloDueno || rol === 'DUENO').map((p) => {
        const activa = estaActiva(p.href, ruta)
        return (
          <SidebarMenuItem key={p.href}>
            {/* isActive pinta el fondo y el color; aria-current es lo que un
                lector de pantalla anuncia. Los dos, siempre: el layout viejo ya
                los tenía a los dos y no se pierde nada en la mudanza. */}
            <SidebarMenuButton asChild isActive={activa}>
              <Link href={p.href} aria-current={activa ? 'page' : undefined}>
                <p.icono aria-hidden="true" />
                <span>{p.texto}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
