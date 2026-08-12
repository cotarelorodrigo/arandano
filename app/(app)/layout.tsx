import { exigirSesion } from '@/lib/auth/sesion'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { Contexto } from '@/components/contexto'
import { salir } from './acciones'
import estilos from '@/components/cartel.module.css'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    <div className="flex min-h-full flex-col">
      {/* Dos filas con trabajos distintos: identidad arriba —de quién es esto,
          quién sos, cómo salir—, navegación abajo. */}
      <header className="border-b">
        <div className="flex items-center justify-between gap-6 px-6 py-3">
          {/* data-testid, y no una clase ni el texto suelto: es el marcador que
              scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
              una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
              not-found). Borrarlo hace fallar todos los casos de pantalla del
              gate a la vez, y el atributo tiene que quedar ÚLTIMO: el grep busca
              el `>` pegado al nombre.

              El cartel, no una etiqueta: es lo más grande de la aplicación, por
              encima del <h1> de cada pantalla (ver components/cartel.module.css).
              Sigue siendo <span> y no <h1> porque cada pantalla tiene el suyo y
              dos <h1> le mienten al outline del documento — pesa más a la vista
              sin pesar más semánticamente.

              min-w-0 es lo que hace que truncate funcione adentro de un flex, y
              con shrink-0 del otro lado el que cede es el cartel y no el botón
              de salir. */}
          <span
            className={`${estilos.cartel} min-w-0 truncate`}
            title={sesion.tenant.nombre}
            data-testid="tenant-nombre"
          >
            {sesion.tenant.nombre}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            {/* Se mudó desde app/page.tsx cuando `/` pasó a redirigir. Acá lo ve
                el barrido del gate en todas las pantallas, no en una sola.

                12 px y no 14: no es que el usuario importe menos, es que a 14
                competía con el nombre del local. --muted-foreground sobre
                --background da 5.17, y el par no cambia por bajar el tamaño. */}
            <span className="text-xs text-muted-foreground" data-testid="usuario-nombre">
              {sesion.usuario.nombre} · {sesion.usuario.rol === 'DUENO' ? 'Dueño' : 'Empleado'}
            </span>
            {/* Al lado del nombre, que es donde se lo busca. Un form y no un
                onClick: así el botón funciona igual sin JavaScript, como el
                resto de las pantallas. */}
            <form action={salir}>
              <Button type="submit" variant="ghost" size="sm">
                Salir
              </Button>
            </form>
          </div>
        </div>
        <div className="flex items-center justify-between px-6">
          <Navegacion rol={sesion.usuario.rol} />
          <Contexto className="text-xs text-muted-foreground" />
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
