import { exigirSesion } from '@/lib/auth/sesion'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { Contexto } from '@/components/contexto'
import { salir } from './acciones'

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
        <div className="flex items-center justify-between px-6 py-3">
          {/* data-testid, y no una clase ni el texto suelto: es el marcador que
              scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
              una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
              not-found). Borrarlo hace fallar todos los casos de pantalla del
              gate a la vez, y el atributo tiene que quedar ÚLTIMO: el grep busca
              el `>` pegado al nombre.

              Ya NO es un link. Enlazaba a la home, y por eso la navegación no
              tenía "Inicio"; con la pestaña Vender a la vista, el link
              redundante pasó a ser éste. Queda como identidad y nada más. */}
          <span className="font-medium" data-testid="tenant-nombre">
            {sesion.tenant.nombre}
          </span>
          <div className="flex items-center gap-3">
            {/* Se mudó desde app/page.tsx cuando `/` pasó a redirigir. Acá lo ve
                el barrido del gate en todas las pantallas, no en una sola. */}
            <span className="text-sm text-muted-foreground" data-testid="usuario-nombre">
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
