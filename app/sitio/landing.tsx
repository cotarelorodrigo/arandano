import { Entrar, type BaseDeTenant } from './entrar'
import { Formulario } from './formulario'
import { Cartel, Prueba, Direccion, LoQueHace, Rubros, Planes, Cierre } from './secciones'

/**
 * El sitio público del ápex.
 *
 * Vive acá y no en una ruta propia porque el ápex llega por DNS y no por path:
 * `app/page.tsx` es el único lugar donde se lo puede atender. Este directorio no
 * tiene page.tsx, así que no crea ninguna ruta — es composición, igual que
 * formularios.tsx en las pantallas de la aplicación.
 *
 * `base` y `whatsapp` entran por props y no se leen del entorno acá: así el
 * componente es probable sin tocar process.env, y el único lugar que sabe de
 * dónde salen esos valores es la página. `base` son las tres piezas con las que
 * se direcciona un tenant (protocolo, dominio y puerto), que la página saca de
 * `piezasDeOrigen()` — las mismas que usa el baseURL de Better Auth.
 */
export function Landing({ base, whatsapp }: { base: BaseDeTenant; whatsapp: string }) {
  return (
    <div className="min-h-full">
      {/* La barra: Arándano firma chico, igual que en el login. La plataforma no
          se pone el cartel del cliente. */}
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-3">
          <span className="text-sm font-medium tracking-widest uppercase">Arándano</span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground md:inline">Ya tengo cuenta</span>
            <Entrar base={base} />
          </div>
        </div>
      </header>

      <main>
        <Cartel />
        <Prueba />
        <Direccion dominio={base.dominio} />
        <LoQueHace />
        <Rubros />
        <Planes />
        <Cierre>
          <Formulario whatsapp={whatsapp} />
        </Cierre>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-5xl px-6 py-6 text-xs text-muted-foreground">
          Arándano — sistema de gestión para comercios argentinos.
        </div>
      </footer>
    </div>
  )
}
