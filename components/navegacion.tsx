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
    // gap-0.5 (2 px) es el frame `Nav` de design/arandano.pen (Shell/Sidebar):
    // SidebarMenu trae gap-0 por default, y sin pisarlo los cinco ítems
    // quedaban pegados uno contra el otro.
    <SidebarMenu className="gap-0.5">
      {PESTANAS.filter((p) => !p.soloDueno || rol === 'DUENO').map((p) => {
        const activa = estaActiva(p.href, ruta)
        return (
          <SidebarMenuItem key={p.href}>
            {/* isActive pinta el fondo y el color; aria-current es lo que un
                lector de pantalla anuncia. Los dos, siempre: el layout viejo ya
                los tenía a los dos y no se pierde nada en la mudanza. */}
            {/* Geometría del ítem, contra el frame `Nav/*` de Shell/Sidebar en
                design/arandano.pen: padding [9,12], gap 11 entre ícono y
                rótulo, cornerRadius 9, ícono 17×17, peso 600 activo / 500
                inactivo. shadcn trae p-2 gap-2 rounded-md [&_svg]:size-4 y sólo
                pinta font-medium (500) en el activo — nada en el inactivo.
                h-auto porque size="default" fija h-8 (32 px), y 9+9 de padding
                sobre un ícono de 17 no entra ahí: el ítem tiene que poder
                crecer. p-[9px] y no py-[9px]: sólo un p-* completo pisa el
                p-2 de base (twMerge no funde ejes sueltos con el atajo); el
                px-3 de al lado gana el horizontal igual, por el orden real de
                Tailwind en la hoja de estilos. */}
            <SidebarMenuButton
              asChild
              isActive={activa}
              className="h-auto gap-[11px] rounded-[9px] p-[9px] px-3 font-medium data-active:font-semibold [&_svg]:size-[17px]"
            >
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
