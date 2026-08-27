// Whitebox sobre el render estático de FormularioRecepcion (Task 3 del
// rediseño): renderToStaticMarkup y no @testing-library/react, mismo criterio
// que el resto del repo (ver app/(app)/inventario/formularios.test.tsx). Las
// acciones del servidor se mockean: lo que este archivo prueba es qué
// renderiza el formulario, no el dominio, que ya tiene su propio test contra
// una base real (acciones.test.ts, test/clientes.test.ts).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarProvider } from '@/components/ui/sidebar'
import { FormularioRecepcion } from '../formularios'
import type { ClienteEncontrado } from '@/lib/clientes/administrar'

const accionFalsa = async () => ({ error: null, aviso: null })

// FormularioRecepcion renderiza <Encabezado> (Task 1 del ciclo del shell
// móvil), que sin `atras` renderiza el SidebarTrigger de shadcn — y ése llama
// a useSidebar(), que tira si no hay un SidebarProvider como ancestro. Mismo
// motivo que ya documentó components/shell/encabezado.test.tsx.
function render(clientes: ClienteEncontrado[], busquedaCliente = '') {
  return renderToStaticMarkup(
    <SidebarProvider>
      <FormularioRecepcion
        accion={accionFalsa}
        clientes={clientes}
        busquedaCliente={busquedaCliente}
        claveIdempotencia="clave-de-prueba"
      />
    </SidebarProvider>,
  )
}

const MARCOS_VERA: ClienteEncontrado = {
  id: 'c-1',
  nombre: 'Marcos Vera',
  telefono: '11 5412-9087',
  ordenesPrevias: 3,
}
const MARCOS_GUTIERREZ: ClienteEncontrado = {
  id: 'c-2',
  nombre: 'Marcos Gutiérrez',
  telefono: '11 3390-2214',
  ordenesPrevias: 1,
}

describe('FormularioRecepcion — el buscador de cliente (Task 3 del rediseño)', () => {
  it('muestra las órdenes previas de cada cliente encontrado, no un conteo fijo', () => {
    const html = render([MARCOS_VERA, MARCOS_GUTIERREZ])
    expect(html).toContain('3 órdenes previas')
    expect(html).toContain('1 orden previa')
  })

  it('un cliente sin órdenes previas muestra 0 reales, no un conteo inventado', () => {
    const sinOrdenes: ClienteEncontrado = { id: 'c-3', nombre: 'Nuevo Cliente', telefono: null, ordenesPrevias: 0 }
    const html = render([sinOrdenes])
    expect(html).toContain('0 órdenes previas')
    // Y ningún otro número de la maqueta ("1", "3"…) coló por accidente en su
    // lugar: el bloque de ESTE cliente es el que hay que mirar.
    const inicio = html.indexOf('Nuevo Cliente')
    const bloque = html.slice(inicio, inicio + 300)
    expect(bloque).toContain('0 órdenes previas')
  })

  it('no es un <select>: las cards son la lista de resultados', () => {
    const html = render([MARCOS_VERA])
    expect(html).not.toContain('<select')
    expect(html).toContain('Marcos Vera')
  })

  it('sin nadie seleccionado, ningún resultado muestra la tilde de "seleccionado"', () => {
    // Por default clienteId === '': ninguno de los dos clientes de la lista
    // está seleccionado, así que el ícono de tilde (lucide "check") no puede
    // aparecer dentro del bloque de Resultados. Recortado a ESE bloque nada
    // más: la card "Qué se imprime" también usa `Check` (sus cuatro puntos),
    // así que buscar en el HTML entero daría un falso positivo siempre.
    const html = render([MARCOS_VERA, MARCOS_GUTIERREZ])
    const desde = html.indexOf('Marcos Vera')
    const hasta = html.indexOf('¿No aparece?')
    expect(desde).toBeGreaterThan(-1)
    expect(hasta).toBeGreaterThan(desde)
    expect(html.slice(desde, hasta)).not.toContain('lucide-check')
  })

  it('sin resultados y sin haber buscado, invita a buscar arriba', () => {
    const html = render([])
    expect(html).toContain('Buscalo arriba')
  })

  // Hallazgo I4 de la review final: el aviso de que buscar recarga la
  // pantalla y pierde lo tipeado del equipo había quedado sólo en un
  // comentario de código, no en la pantalla — el comportamiento nunca
  // cambió (el buscador sigue siendo un <form> GET), pero la advertencia sí
  // desapareció.
  it('avisa que buscar recarga la pantalla y pierde lo tipeado del equipo', () => {
    const html = render([])
    expect(html).toContain(
      'Buscá primero: al buscar se recarga la pantalla y se pierde lo que hayas cargado del equipo.',
    )
  })

  it('sin resultados pero habiendo buscado, invita a cargarlo como nuevo', () => {
    const html = render([], 'Alguien Que No Está')
    expect(html).toContain('No apareció ningún cliente con «Alguien Que No Está»')
  })

  it('la clave de desbloqueo se guarda pero avisa que no se imprime', () => {
    const html = render([])
    expect(html).toContain('name="claveDesbloqueo"')
    expect(html).toContain('La clave queda guardada en la orden pero NO se imprime en el ticket.')
  })

  it('el campo de clave NO tiene ningún valor pre-cargado que pudiera filtrarse', () => {
    // No es una aserción tautológica: si algún día alguien le pasara un
    // defaultValue con la clave real (p. ej. para "recordar" el último tipeo),
    // este test lo atrapa. Hoy el campo nace vacío.
    const html = render([])
    const inicio = html.indexOf('name="claveDesbloqueo"')
    const cierre = html.indexOf('/>', inicio)
    expect(html.slice(inicio, cierre)).not.toMatch(/value="[^"]/)
  })

  it('el botón de submit vive en el Topbar (acciones del Encabezado), no al pie del cuerpo', () => {
    const html = render([])
    const posTitulo = html.indexOf('Recibir un equipo')
    const posBoton = html.indexOf('Guardar e imprimir ticket')
    expect(posTitulo).toBeGreaterThan(-1)
    expect(posBoton).toBeGreaterThan(-1)
    // El botón aparece ANTES que las cards del cuerpo ("1 · Cliente"): está en
    // el Topbar, no al final del formulario.
    expect(posBoton).toBeLessThan(html.indexOf('1 · Cliente'))
  })

  it('"Cancelar" es un link ghost a /servicio-tecnico, junto al submit', () => {
    const html = render([])
    expect(html).toMatch(/href="\/servicio-tecnico"[^>]*>Cancelar/)
  })

  it('todos los campos reales apuntan al <form> invisible por su atributo form=', () => {
    const html = render([MARCOS_VERA])
    for (const campo of [
      'name="clienteId"',
      'name="clienteNombre"',
      'name="clienteTelefono"',
      'name="equipoMarca"',
      'name="equipoModelo"',
      'name="equipoSerie"',
      'name="claveDesbloqueo"',
      'name="fallaDeclarada"',
      'name="accesorios"',
      'name="danosVisibles"',
    ]) {
      const inicio = html.indexOf(campo)
      expect(inicio, `no se encontró ${campo}`).toBeGreaterThan(-1)
      const desde = html.lastIndexOf('<', inicio)
      const hasta = html.indexOf('>', inicio)
      expect(html.slice(desde, hasta), `${campo} no declara form="form-recepcion"`).toContain(
        'form="form-recepcion"',
      )
    }
  })

  it('el buscador de cliente es un <form> propio, no anidado en el de recepción', () => {
    const html = render([])
    // Ningún <form ...><form ...> consecutivo: si el buscador estuviera
    // anidado, el segundo <form action="/servicio-tecnico/nuevo"> aparecería
    // ANTES de que el primero (el invisible, con id="form-recepcion") cierre.
    const formInvisible = html.indexOf('id="form-recepcion"')
    const cierreFormInvisible = html.indexOf('</form>', formInvisible)
    const formBuscador = html.indexOf('action="/servicio-tecnico/nuevo"')
    expect(formInvisible).toBeGreaterThan(-1)
    expect(formBuscador).toBeGreaterThan(-1)
    expect(formBuscador).toBeGreaterThan(cierreFormInvisible)
  })

  // Barrido final del cierre del rediseño (hallazgo M1): la mitad de los
  // rótulos de esta pantalla pagaban la maqueta (11px/600/--foreground-soft)
  // y la otra mitad usaba el <Label> pelado de shadcn (14px/500, sin color
  // propio) — una inconsistencia visual entre campos de la MISMA card. Los
  // nueve rótulos de la card "2 · Equipo" y "3 · Qué le pasa" (Marca, Modelo,
  // IMEI, Clave, Falla, Accesorios, Daños) tienen que pagar el mismo
  // tratamiento que ya usaban Nombre y Teléfono.
  it('todos los rótulos de campo pagan el mismo tratamiento: 11px/600/--foreground-soft', () => {
    const html = render([])
    for (const rotulo of [
      'Nombre', 'Teléfono', 'Marca', 'Modelo', 'IMEI o número de serie',
      'Clave de desbloqueo', 'Falla declarada por el cliente', 'Accesorios entregados',
      'Daños visibles',
    ]) {
      const inicio = html.lastIndexOf('<label', html.indexOf(`>${rotulo}<`))
      const cierre = html.indexOf('>', inicio)
      expect(inicio, `no se encontró el <label> de "${rotulo}"`).toBeGreaterThan(-1)
      expect(
        html.slice(inicio, cierre),
        `el rótulo "${rotulo}" no paga text-[11px] font-semibold text-foreground-soft`,
      ).toContain('text-[11px] font-semibold text-foreground-soft')
    }
  })

  // Hallazgo M2: los mismos nueve campos heredaban el h-8 (32px) por default
  // de shadcn Input, y design/arandano.pen (frame `App / Recibir equipo`,
  // nodo `lIt3K`) mide los ocho campos de esta pantalla a 40px — verificado
  // en vivo con el MCP de Pencil.
  it('los campos de texto miden 40px (h-10), no el h-8 por default de shadcn', () => {
    const html = render([])
    for (const campo of [
      'name="clienteNombre"', 'name="clienteTelefono"', 'name="equipoMarca"', 'name="equipoModelo"',
      'name="equipoSerie"', 'name="claveDesbloqueo"', 'name="accesorios"', 'name="danosVisibles"',
    ]) {
      const inicio = html.lastIndexOf('<input', html.indexOf(campo))
      const cierre = html.indexOf('/>', inicio)
      expect(inicio, `no se encontró el campo ${campo}`).toBeGreaterThan(-1)
      expect(html.slice(inicio, cierre), `${campo} no mide h-10`).toContain('h-10')
    }
  })
})

/**
 * Task 9 del ciclo móvil (design/arandano.pen, frame `H1Wm6`): `atras` vuelve
 * al tablero, y la ranura derecha del teléfono queda apagada —sus acciones
 * bajan al pie—, mismo criterio que ya prueba `app/(app)/inventario/
 * formularios.test.tsx` para `FormularioDeAlta`.
 */
describe('atras="/servicio-tecnico" y sin accionMovil (Task 9 del ciclo móvil)', () => {
  it('vuelve a /servicio-tecnico desde la ranura izquierda del teléfono', () => {
    const html = render([])
    // La etiqueta se extrae y DESPUÉS se afirma el href, en vez de un
    // regex que fije el orden de los atributos: desde que <Encabezado>
    // navega con `Link` de Next (hallazgo I3 de la review final), el href
    // sale último y no primero. Mismo mecanismo que ya usaba
    // components/shell/encabezado.test.tsx para la variante <button>.
    const volver = html.match(/<a[^>]*aria-label="Volver"[^>]*>/)?.[0]
    expect(volver, `no se encontró la flecha de volver en: ${html}`).toBeTruthy()
    expect(volver).toContain('href="/servicio-tecnico"')
  })

  // Se verifica por RENDER real y no por FUENTE: si algo agregara accionMovil
  // algún día, este caso lo detecta aunque no toque la línea del <Encabezado>.
  // Cuenta las ranuras de 38px del Topbar (izquierda + derecha), no todos los
  // aria-label del documento: el buscador de cliente también lleva el suyo
  // ("Buscar cliente por nombre o teléfono"), sin relación con esto.
  it('no ofrece ninguna acción del teléfono: una sola ranura de 38px en el Topbar (la de "Volver")', () => {
    const html = render([])
    const ranuras = html.match(/size-\[38px\] shrink-0 items-center justify-center rounded-\[10px\] lg:hidden/g) ?? []
    expect(ranuras).toHaveLength(1)
  })
})

/**
 * Task 9 del ciclo móvil (design/arandano.pen, nodo "Pie" de `H1Wm6`):
 * mismo mecanismo que ya usa `app/(app)/inventario/formularios.tsx` para
 * `FormularioDeAlta` — dos botones, uno `hidden lg:flex` (dentro de
 * `acciones`, que ya lo envuelve el propio `Encabezado`) y otro `lg:hidden`,
 * atados al MISMO `<form id="form-recepcion">` por el atributo `form=` y al
 * MISMO `pendiente` de `useActionState`.
 */
describe('el pie del teléfono repite las acciones del Topbar (Task 9 del ciclo móvil)', () => {
  it('"Cancelar" y "Guardar e imprimir" aparecen dos veces (Topbar y pie)', () => {
    const html = render([])
    expect([...html.matchAll(/>Cancelar</g)]).toHaveLength(2)
    // Substring y no la frase completa: el Topbar dice "Guardar e imprimir
    // ticket" (sin cambios) y el pie dice "Guardar e imprimir" a secas —nodo
    // `O0unea` de H1Wm6—, porque a 390px de ancho, junto al botón "Cancelar",
    // "...ticket" no entra. El substring común cubre las dos redacciones.
    expect([...html.matchAll(/Guardar e imprimir/g)]).toHaveLength(2)
  })

  it('el pie nuevo es lg:hidden', () => {
    const fuente = readFileSync('app/(app)/servicio-tecnico/formularios.tsx', 'utf8')
    expect(fuente).toMatch(/border-t bg-card p-\[14px\] lg:hidden/)
  })

  // El mismo `pendiente` gobierna los dos: si alguien partiera el pie a otro
  // componente con su propio useActionState, este caso lo detecta.
  it('"disabled={pendiente}" aparece dos veces (Topbar y pie)', () => {
    const fuente = readFileSync('app/(app)/servicio-tecnico/formularios.tsx', 'utf8')
    const inicio = fuente.indexOf('export function FormularioRecepcion')
    const fin = fuente.indexOf('export function PanelEstado')
    const cuerpo = fuente.slice(inicio, fin)
    expect([...cuerpo.matchAll(/disabled=\{pendiente\}/g)]).toHaveLength(2)
  })

  it('el botón del Topbar sigue siendo el primero en el DOM', () => {
    const html = render([])
    const posTopbar = html.indexOf('Guardar e imprimir ticket')
    const posPie = html.lastIndexOf('Guardar e imprimir')
    expect(posTopbar).toBeGreaterThan(-1)
    expect(posPie).toBeGreaterThan(posTopbar)
  })
})

/**
 * Task 9 del ciclo móvil (design/arandano.pen, frame `H1Wm6`): las cuatro
 * cards (Cliente, Equipo, Qué le pasa, Qué se imprime) se apilan en una sola
 * columna en el teléfono, y quedan como hoy (dos columnas) en escritorio.
 */
describe('las cuatro cards se apilan en el teléfono (Task 9 del ciclo móvil)', () => {
  it('las dos columnas del cuerpo pasan a flex-col lg:flex-row', () => {
    const html = render([])
    expect(html).toMatch(/class="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4"/)
  })

  it('el cuerpo entero pasa a padding/gap mobile-first', () => {
    const html = render([])
    expect(html).toMatch(/class="flex flex-col gap-3 px-\[14px\] py-3 lg:gap-4 lg:p-6"/)
  })
})

/**
 * Corrección del coordinador tras el reporte de la Task 9: el frame `H1Wm6`
 * apila "IMEI o número de serie" y "Clave de desbloqueo" en dos filas de
 * ancho completo en el teléfono (nodos `vFqyt`/`nXu5B`, cada uno su propia
 * fila) — no la fila fija de dos campos que sigue trayendo escritorio. El
 * brief resumió esto como "cards apiladas" en prosa; manda la maqueta.
 * "Marca"/"Modelo" no se tocan: la maqueta SÍ los dibuja en una fila (nodo
 * `w6yjn`, sin distinción de ancho).
 */
describe('IMEI y Clave de desbloqueo se apilan en el teléfono (corrección del coordinador, frame H1Wm6)', () => {
  it('la fila de IMEI/Clave pasa a flex-col lg:flex-row', () => {
    const html = render([])
    expect(html).toMatch(/class="flex flex-col gap-3 lg:flex-row lg:gap-\[10px\]"/)
  })

  it('el campo IMEI ocupa el ancho sobrante recién en escritorio (lg:flex-1)', () => {
    const html = render([])
    const inicioLabel = html.indexOf('IMEI o número de serie')
    const desde = html.lastIndexOf('<div', inicioLabel)
    const hasta = html.indexOf('</div>', html.indexOf('name="equipoSerie"'))
    const bloque = html.slice(desde, hasta)
    expect(bloque).toContain('lg:flex-1')
    expect(bloque).not.toMatch(/class="flex flex-1 flex-col/)
  })

  it('el campo Clave mide 190px recién en escritorio (lg:w-[190px])', () => {
    const html = render([])
    const inicioLabel = html.indexOf('Clave de desbloqueo')
    const desde = html.lastIndexOf('<div', inicioLabel)
    const hasta = html.indexOf('</div>', html.indexOf('name="claveDesbloqueo"'))
    const bloque = html.slice(desde, hasta)
    expect(bloque).toContain('lg:w-[190px]')
    expect(bloque).not.toMatch(/class="flex w-\[190px\]/)
  })

  it('Marca y Modelo siguen en una sola fila fija: la maqueta no los apila', () => {
    const html = render([])
    // El campo Marca vive DENTRO de la fila que se quiere afirmar sin
    // cambios: se busca la fila (name="equipoMarca" es su primer
    // descendiente) y se comprueba que sigue siendo la de siempre.
    const posMarca = html.indexOf('name="equipoMarca"')
    const desde = html.lastIndexOf('<div class="flex gap-[10px]">', posMarca)
    const hasta = html.indexOf('</div>', html.indexOf('name="equipoModelo"'))
    expect(desde).toBeGreaterThan(-1)
    const bloque = html.slice(desde, hasta)
    expect(bloque).toContain('name="equipoModelo"')
  })
})
