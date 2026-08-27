import type { Metadata } from 'next'
import { exigirSesion } from '@/lib/auth/sesion'
import { CLAVES_DE_PERMISO } from '@/lib/permisos/catalogo'
import { permisosDe } from '@/lib/permisos/consultar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { SidebarArandano } from '@/components/shell/sidebar-arandano'
import { salir } from './acciones'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

// Ninguna pantalla de la aplicación se indexa: son datos de un local. Lo hereda
// todo lo que cuelgue de (app), así que una pantalla nueva nace cubierta.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  // El dueño los tiene todos sin fila, igual que en la guarda: pedirle la
  // tabla sería consultar para nada y dejaría la pestaña apagada en un local
  // recién creado, donde `usuario_permisos` está vacía por definición.
  //
  // Para un empleado, `permisosDe` está memoizada por request con `cache()`,
  // así que esto no suma una consulta por pantalla más allá de la primera.
  const permisos =
    sesion.usuario.rol === 'DUENO'
      ? CLAVES_DE_PERMISO
      : [...(await permisosDe(sesion.tenant.id, sesion.usuario.id))]

  return (
    // 15.5rem = 248 px, que es lo que dibuja design/arandano.pen. El default de
    // shadcn es 16rem: ocho pixeles que arrastrarían las diez pantallas.
    <SidebarProvider style={{ '--sidebar-width': '15.5rem' } as React.CSSProperties}>
      <SidebarArandano
        nombreLocal={sesion.tenant.nombre}
        nombreUsuario={sesion.usuario.nombre}
        rol={sesion.usuario.rol}
        permisos={permisos}
        alSalir={salir}
      />
      <SidebarInset>
        {/* El único control que la maqueta no dibuja, y existe sólo para que en
            un teléfono el paño se pueda abrir. En el 1440 del diseño no se ve. */}
        <SidebarTrigger className="m-2 md:hidden" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
