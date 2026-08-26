import type { Metadata } from 'next'
import { exigirSesion } from '@/lib/auth/sesion'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
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

  return (
    // 15.5rem = 248 px, que es lo que dibuja design/arandano.pen. El default de
    // shadcn es 16rem: ocho pixeles que arrastrarían las diez pantallas.
    <SidebarProvider style={{ '--sidebar-width': '15.5rem' } as React.CSSProperties}>
      <SidebarArandano
        nombreLocal={sesion.tenant.nombre}
        nombreUsuario={sesion.usuario.nombre}
        rol={sesion.usuario.rol}
        alSalir={salir}
      />
      {/* El SidebarTrigger vivía suelto acá (m-2 md:hidden) sólo para que en
          un teléfono el paño se pudiera abrir. Se mudó a la ranura izquierda
          de <Encabezado> (components/shell/encabezado.tsx), que cada
          page.tsx ya renderiza — así el control queda al lado del título en
          vez de flotando arriba de él. */}
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
