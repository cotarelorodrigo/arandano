import type { Metadata } from 'next'
import { exigirSesion } from '@/lib/auth/sesion'
import { CLAVES_DE_PERMISO } from '@/lib/permisos/catalogo'
import { permisosDe } from '@/lib/permisos/consultar'
import { botHabilitadoEn } from '@/lib/bot/habilitado'
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

  /**
   * El gate del rollout del bot, aplicado sacándole BOT a la lista de arriba.
   *
   * `BOT_HABILITADO_EN` decide en qué LOCALES existe el bot mientras se prueba
   * en producción con uno solo (ver `lib/bot/habilitado.ts`), y sacar el
   * permiso es exactamente lo que significa: en este local todavía nadie tiene
   * esa capacidad, ni el dueño. Filtrar acá y no adentro de `<Navegacion>` deja
   * el gate en el componente de SERVIDOR, que es el único que puede leer
   * `process.env`.
   *
   * **No reemplaza al permiso ni lo duplica**: son dos preguntas distintas —en
   * qué locales existe el bot, y a quién del local se le delega—, así que un
   * empleado sin BOT sigue sin ver la pestaña aunque su local esté en la lista.
   * Y no alcanza por sí solo: la pantalla y las cinco acciones repiten el gate,
   * porque una pestaña que no se dibuja no es una defensa.
   *
   * Se borra entero el día que el bot se libere a todos, junto con la línea de
   * `docker/compose.prod.yml`.
   */
  const visibles = botHabilitadoEn(sesion.subdominio)
    ? permisos
    : permisos.filter((p) => p !== 'BOT')

  return (
    // 15.5rem = 248 px, que es lo que dibuja design/arandano.pen. El default de
    // shadcn es 16rem: ocho pixeles que arrastrarían las diez pantallas.
    <SidebarProvider style={{ '--sidebar-width': '15.5rem' } as React.CSSProperties}>
      <SidebarArandano
        nombreLocal={sesion.tenant.nombre}
        nombreUsuario={sesion.usuario.nombre}
        rol={sesion.usuario.rol}
        permisos={visibles}
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
