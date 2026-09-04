import type { BaseDeTenant } from './entrar'
import { Formulario } from './formulario'
import { Hero } from './hero'
import { Nav, Pie } from './nav'
import { BarraDeProgreso, ProveedorDeMovimiento } from './movimiento'
import { Modulos, Rubros, Planes, Cierre } from './secciones'

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
 * dónde salen esos valores es la página.
 *
 * SIETE SECCIONES, y desde el rediseño son siete de verdad: Nav, Hero,
 * Módulos, Rubros, Planes, Cierre y Pie. La octava —`Muestra`, la copia del
 * carrito para el teléfono que el ciclo móvil había sumado entre Hero y
 * Módulos— se fue: `Retrato` sirve ahora los dos anchos desde un solo árbol,
 * así que ya no hay dos versiones del mismo carrito que mantener sincronizadas
 * ni el mismo dato renderizado dos veces en el DOM de cada request.
 *
 * Las secciones se reparten en cuatro archivos y no en uno solo de 764 líneas:
 * `./nav` (el marco), `./hero`, `./secciones` (las cuatro de contenido) y
 * `./base` (lo que comparten). El contenido en sí —qué módulos, qué rubros,
 * qué planes— vive en `./datos`, aparte del marcado.
 */
export function Landing({ base, whatsapp }: { base: BaseDeTenant; whatsapp: string }) {
  return (
    // bg-card, no sólo min-h-full: el .pen pinta el frame raíz (vDLU8) con
    // $ar-surface y sólo DOS secciones (Módulos, Planes) con $ar-bg. El
    // <body> de app/globals.css es bg-background, así que sin este fondo
    // propio la página entera terminaría en el gris de fondo y las dos
    // declaraciones bg-background de Módulos/Planes no pintarían nada
    // distinto de lo que ya hay.
    <ProveedorDeMovimiento>
      <div className="min-h-full bg-card">
        <BarraDeProgreso />
        <Nav base={base} />

        <main>
          <Hero whatsapp={whatsapp} />
          <Modulos />
          <Rubros />
          <Planes />
          <Cierre whatsapp={whatsapp}>
            {/* variante="oscura": este Formulario vive sobre la franja --marca
                del Cierre, no sobre un fondo claro como el del Hero. */}
            <Formulario whatsapp={whatsapp} variante="oscura" />
          </Cierre>
        </main>

        <Pie whatsapp={whatsapp} />
      </div>
    </ProveedorDeMovimiento>
  )
}
