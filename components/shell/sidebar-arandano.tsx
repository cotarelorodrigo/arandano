import { LogOut } from 'lucide-react'
import type { RolUsuario } from '@/lib/auth/sesion'
import type { Permiso } from '@/lib/permisos/catalogo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { Contexto } from '@/components/contexto'
import estilos from '@/components/cartel.module.css'

/**
 * El paño de 248 px que envuelve toda la aplicación.
 *
 * La geometría sale de design/arandano.pen (frame `Shell/Sidebar`), no de
 * mirar la captura: marca `pad:[22,20,18,20] gap:2`, nav `pad:[6,12] gap:2`,
 * pie `pad:[16,16,18,16] gap:10`.
 *
 * Es de SERVIDOR aunque `Navegacion` sea de cliente: no HAY que serlo. Lo
 * único que precisa saber la ruta es `Navegacion`, que ya es `'use client'` y
 * se las arregla sola; el resto del paño es marcado estático más un
 * `<form action={alSalir}>` que el servidor resuelve. Quedarse de servidor es
 * lo que deja del lado del cliente lo mínimo posible.
 */
export function SidebarArandano({
  nombreLocal,
  nombreUsuario,
  rol,
  permisos,
  alSalir,
}: {
  nombreLocal: string
  nombreUsuario: string
  rol: RolUsuario
  /** Los permisos de esta sesión, sólo para decidir qué pestañas se dibujan.
   *  Los resuelve el layout: este paño no consulta nada. */
  permisos: readonly Permiso[]
  alSalir: () => Promise<void>
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-0.5 px-5 pt-[22px] pb-[18px]">
        {/* El producto arriba y el local abajo, y no al revés: adentro del
            sistema, quién sos importa menos que dónde estás parado. Es la misma
            inversión de jerarquía que la persiana del login descubre. */}
        {/* font-bold y tracking-[0.16em]: el nodo "Producto" del frame Marca
            (Shell/Sidebar) pide fontWeight 700 y letterSpacing 1.6 sobre
            fontSize 10 (1.6/10 = 0.16em). */}
        <span className="text-[10px] font-bold tracking-[0.16em] text-sidebar-primary">
          ARÁNDANO
        </span>
        {/* min-w-0 es lo que hace que truncate funcione adentro de un flex.
            data-testid va ÚLTIMO: el grep de scripts/smoke.sh busca el `>`
            pegado al nombre. */}
        <span
          className={`${estilos.cartel} min-w-0 truncate text-sidebar-foreground`}
          title={nombreLocal}
          data-testid="tenant-nombre"
        >
          {nombreLocal}
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-1.5">
          {/* El landmark que `components/navegacion.tsx` dejó de dibujar al
              pasar de un <nav> a un <ul> (SidebarMenu, de shadcn): sin esto un
              lector de pantalla perdía la navegación entera, porque un <ul>
              suelto no se anuncia como landmark. */}
          <nav aria-label="Navegación">
            <Navegacion rol={rol} permisos={permisos} />
          </nav>
        </SidebarGroup>
      </SidebarContent>

      {/* border-t: el frame Pie de la maqueta lleva stroke:$ar-line arriba (1
          px), y SidebarFooter no trae borde por default. --sidebar-border es
          el mismo color ($ar-line) bajo el nombre que el sidebar de shadcn ya
          usa en sus propias clases. */}
      <SidebarFooter className="gap-2.5 border-t border-sidebar-border px-4 pt-4 pb-[18px]">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            {/* bg-marca/text-marca-foreground no son utilidades: --color-marca
                no está en @theme inline (ver el comentario ahí mismo, en
                app/globals.css), así que hace falta el var(--token) directo.
                bg-transparent/text-transparent no pintan nada — están para
                pisar el bg-muted/text-muted-foreground que trae por default
                AvatarFallback (components/ui/avatar.tsx): sin esto seguían
                colgadas en el className, un color que el style de abajo tapa
                pero que quien lea las clases creería que es el real.
                font-semibold: el nodo "Inicial" del frame Pie pide
                fontWeight 600. */}
            <AvatarFallback
              className="bg-transparent text-[13px] font-semibold text-transparent"
              style={{ backgroundColor: 'var(--marca)', color: 'var(--marca-foreground)' }}
            >
              {nombreUsuario.trim().charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-px">
            {/* font-semibold: el nodo "Nombre" del frame Pie pide fontWeight
                600 — a diferencia de "Rol", debajo, que pide "normal". */}
            <span
              className="truncate text-[13px] font-semibold text-sidebar-foreground"
              data-testid="usuario-nombre"
            >
              {nombreUsuario}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {rol === 'DUENO' ? 'Dueño' : 'Empleado'}
            </span>
          </div>
          {/* Un form y no un onClick: así el botón funciona igual sin
              JavaScript, como el resto de las pantallas. */}
          {/* El frame "Salir" no es cuadrado: padding [6,8] alrededor de un
              ícono de 16 da ~32×28, no los 32×32 de size="icon". size-auto
              saca el tamaño fijo y deja que el padding arme la caja;
              rounded-md es el token que coincide con el cornerRadius 8 del
              frame (--radius-md, no el rounded-lg que trae Button). */}
          <form action={alSalir} className="ml-auto">
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="size-auto rounded-md px-2 py-1.5"
              aria-label="Salir"
            >
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
        <Contexto className="text-[10px] text-muted-foreground" />
      </SidebarFooter>
    </Sidebar>
  )
}
