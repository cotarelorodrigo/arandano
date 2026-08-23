import type { BaseDeTenant } from './entrar'
import { Formulario } from './formulario'
import { Nav, Hero, Modulos, Rubros, Planes, Cierre, Pie } from './secciones'

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
 *
 * Las siete secciones (Nav, Hero, Módulos, Rubros, Planes, Cierre, Pie) siguen
 * el orden de design/arandano.pen, frame `Sitio / Landing` — ver el comentario
 * largo al principio de `secciones.tsx` para el porqué de cada cambio contra
 * lo que había antes de la Task 4 del cierre del rediseño.
 */
export function Landing({ base, whatsapp }: { base: BaseDeTenant; whatsapp: string }) {
  return (
    <div className="min-h-full">
      <Nav base={base} />

      <main>
        <Hero whatsapp={whatsapp} />
        <Modulos />
        <Rubros />
        <Planes />
        <Cierre>
          {/* variante="oscura": este Formulario vive sobre la franja
              --marca del Cierre, no sobre un fondo claro como el del Hero —
              ver el comentario de formulario.tsx. */}
          <Formulario whatsapp={whatsapp} variante="oscura" />
        </Cierre>
      </main>

      <Pie />
    </div>
  )
}
