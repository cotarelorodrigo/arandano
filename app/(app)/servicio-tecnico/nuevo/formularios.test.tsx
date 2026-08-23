// Whitebox sobre el render estático de FormularioRecepcion (Task 3 del
// rediseño): renderToStaticMarkup y no @testing-library/react, mismo criterio
// que el resto del repo (ver app/(app)/inventario/formularios.test.tsx). Las
// acciones del servidor se mockean: lo que este archivo prueba es qué
// renderiza el formulario, no el dominio, que ya tiene su propio test contra
// una base real (acciones.test.ts, test/clientes.test.ts).
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormularioRecepcion } from '../formularios'
import type { ClienteEncontrado } from '@/lib/clientes/administrar'

const accionFalsa = async () => ({ error: null, aviso: null })

function render(clientes: ClienteEncontrado[], busquedaCliente = '') {
  return renderToStaticMarkup(
    <FormularioRecepcion
      accion={accionFalsa}
      clientes={clientes}
      busquedaCliente={busquedaCliente}
      claveIdempotencia="clave-de-prueba"
    />,
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
