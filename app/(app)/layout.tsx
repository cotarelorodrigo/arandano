import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { salir } from './acciones'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        {/* data-testid, y no una clase ni el texto suelto: es el marcador que
            scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
            una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
            not-found). Borrarlo hace fallar todos los casos de pantalla del
            gate a la vez. El mismo atributo, con el mismo nombre, está en
            app/login/formulario.tsx y en app/page.tsx — esta última porque `/`
            es pantalla de tenant pero NO vive bajo (app), así que no hereda
            este layout y tiene que ponerlo por su cuenta.

            El nombre del local enlaza a la home, ahora que "Inicio" salió de
            la navegación. El Link ENVUELVE al span en vez de llevar el
            data-testid él mismo: scripts/smoke.sh busca el atributo con el
            `>` pegado, y moverlo (o agregar algo después) rompe ese grep para
            toda pantalla autenticada del gate. */}
        <Link href="/" className="hover:underline">
          <span className="font-medium" data-testid="tenant-nombre">
            {sesion.tenant.nombre}
          </span>
        </Link>
        <Navegacion rol={sesion.usuario.rol} />
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {sesion.usuario.nombre} · {sesion.usuario.rol === 'DUENO' ? 'Dueño' : 'Empleado'}
          </span>
          {/* Al lado del nombre, que es donde se lo busca. Un form y no un
              onClick: así el botón funciona igual sin JavaScript, como el
              resto de las pantallas de este ciclo. */}
          <form action={salir}>
            <Button type="submit" variant="ghost" size="sm">
              Salir
            </Button>
          </form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
