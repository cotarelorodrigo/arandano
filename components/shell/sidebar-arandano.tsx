import { LogOut } from 'lucide-react'
import type { RolUsuario } from '@/lib/auth/sesion'
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
 * Es de SERVIDOR aunque `Navegacion` sea de cliente: lo único que necesita
 * saber la ruta es el menú, y meter todo el paño en el cliente arrastraría la
 * server action de salir a un componente que no la puede recibir.
 */
export function SidebarArandano({
  nombreLocal,
  nombreUsuario,
  rol,
  alSalir,
}: {
  nombreLocal: string
  nombreUsuario: string
  rol: RolUsuario
  alSalir: () => Promise<void>
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-0.5 px-5 pt-[22px] pb-[18px]">
        {/* El producto arriba y el local abajo, y no al revés: adentro del
            sistema, quién sos importa menos que dónde estás parado. Es la misma
            inversión de jerarquía que la persiana del login descubre. */}
        <span className="text-[10px] font-semibold tracking-[0.14em] text-sidebar-primary">
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
          <Navegacion rol={rol} />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2.5 px-4 pt-4 pb-[18px]">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            {/* bg-marca/text-marca-foreground no son utilidades: --color-marca
                no está en @theme inline (ver el comentario ahí mismo, en
                app/globals.css), así que hace falta el var(--token) directo. */}
            <AvatarFallback
              className="text-[13px]"
              style={{ backgroundColor: 'var(--marca)', color: 'var(--marca-foreground)' }}
            >
              {nombreUsuario.trim().charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-px">
            <span
              className="truncate text-[13px] text-sidebar-foreground"
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
          <form action={alSalir} className="ml-auto">
            <Button type="submit" variant="ghost" size="icon" aria-label="Salir">
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
        <Contexto className="text-[10px] text-muted-foreground" />
      </SidebarFooter>
    </Sidebar>
  )
}
