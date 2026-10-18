import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que punto-de-venta.test.tsx: acciones.ts es 'use server' y
// su contrato ya lo prueba acciones.test.ts contra una base real. Acá sólo
// importa qué renderiza el chip, así que las dos actions se mockean.
vi.mock('./acciones', () => ({
  abrirCajaDesdeVender: vi.fn(),
  cerrarCajaDesdeVender: vi.fn(),
  cargarCotizacionDesdeVender: vi.fn(),
}))

// El chip de la cotización del dólar vive en dolar.tsx y se prueba en
// dolar.test.tsx; acá sólo hace falta algo que pasarle.
const SIN_COTIZACION = { historial: [], vieja: true, puedeCargar: false }
const CON_COTIZACION = {
  historial: [{ id: 'c1', valor: '1485', creadaEn: new Date('2026-08-21T17:32:00Z'), cargadaPor: 'La dueña' }],
  vieja: false,
  puedeCargar: false,
}

type Props = {
  caja: { id: string; abiertaEn: Date } | null
}

async function render(props: Props) {
  const { ChipCaja } = await import('./caja')
  return renderToStaticMarkup(<ChipCaja {...props} cotizacion={SIN_COTIZACION} />)
}

const FUENTE = readFileSync('app/(app)/vender/caja.tsx', 'utf8')

describe('el chip de caja', () => {
  it('con caja abierta el chip la muestra', async () => {
    const html = await render({
      caja: { id: 'c1', abiertaEn: new Date('2026-08-21T17:32:00Z') },
    })
    expect(html).toContain('Caja abierta')
    // Y NO el chip de la otra mitad: los dos estados son excluyentes.
    expect(html).not.toContain('Abrir caja')
  })

  it('sin caja abierta el chip ofrece abrirla', async () => {
    const html = await render({ caja: null })
    expect(html).toContain('Abrir caja')
    expect(html).not.toContain('Caja abierta')

    // Cableado: el formulario que arma este chip tiene que llamar a
    // abrirCajaDesdeVender —no a cerrarCajaDesdeVender ni a cualquier otra
    // cosa—. Mutar este nombre en el fuente (probado a mano, ver el reporte
    // de la task) pone este caso en rojo.
    expect(FUENTE).toMatch(/useActionState\(abrirCajaDesdeVender,\s*INICIAL\)/)
  })

  it('con caja abierta, el cierre cuelga de cerrarCajaDesdeVender', () => {
    // Mismo motivo que el caso de arriba, para la otra mitad del chip: sin
    // esto, invertir cuál action dispara cuál formulario no lo atraparía
    // ningún test (los dos formularios tienen la misma forma).
    expect(FUENTE).toMatch(/useActionState\(cerrarCajaDesdeVender,\s*INICIAL\)/)
  })

  // El chip de cotización va pegado al de caja, en el mismo componente: los
  // dos son el frame "Estado" del Topbar. Su contenido se prueba en
  // dolar.test.tsx.
  it('al lado del chip de caja va el de la cotización del dólar', async () => {
    const html = await render({ caja: null })
    expect(html).toContain('USD')
    expect(FUENTE).toMatch(/<ChipCotizacion cotizacion=\{cotizacion\} \/>/)
  })

  // Cuarta aparición del mismo defecto en el rediseño: un mensaje de error que
  // el lector de pantalla nunca anuncia porque nadie le puso el rol al
  // convertirlo de forma. Acá son dos —cerrar y abrir la caja—, y por eso el
  // caso NO pregunta "¿hay algún role=alert?": cuenta. Un test que se conforma
  // con encontrar uno se pone verde con el otro roto, que es exactamente cómo
  // este defecto sobrevivió tres veces.
  it('TODOS los mensajes de error del chip llevan role="alert"', () => {
    const errores = FUENTE.match(/<span[^>]*>\{estado\.error\}<\/span>/g) ?? []
    expect(errores.length).toBe(2)
    for (const span of errores) {
      expect(span).toContain('role="alert"')
    }
  })
})

// --- El teléfono: los chips de sólo lectura del cuerpo y el control del Topbar ---

describe('los chips de estado del cuerpo', () => {
  async function renderChips(props: { caja: { abiertaEn: Date } | null; conCotizacion?: boolean }) {
    const { ChipsDeEstado } = await import('./caja')
    return renderToStaticMarkup(
      <ChipsDeEstado caja={props.caja} cotizacion={props.conCotizacion ? CON_COTIZACION : SIN_COTIZACION} />,
    )
  }

  it('sólo existen en el teléfono', async () => {
    const html = await renderChips({ caja: null })
    const contenedor = html.match(/^<div class="[^"]*"/)?.[0]
    expect(contenedor, 'los dos chips tienen que venir en un contenedor propio').toBeTruthy()
    expect(contenedor).toContain('lg:hidden')
  })

  // design/arandano.pen dibuja `MP7Iu` y `fBLhr` SIN ningún control adentro:
  // son dos frames con texto, no botones. Abrir y cerrar el turno viven en el
  // control del Topbar (ver más abajo) justamente por eso — si estos chips
  // fueran clickeables, ese control no tendría razón de existir.
  it('no llevan ningún control adentro: la maqueta los dibuja de sólo lectura', async () => {
    const conCaja = await renderChips({
      caja: { abiertaEn: new Date('2026-08-21T17:32:00Z') },
      conCotizacion: true,
    })
    const sinCaja = await renderChips({ caja: null })
    for (const html of [conCaja, sinCaja]) {
      expect(html).not.toContain('<button')
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<input')
    }
  })

  it('dicen si la caja está abierta y a cuánto está el dólar', async () => {
    const html = await renderChips({
      caja: { abiertaEn: new Date('2026-08-21T17:32:00Z') },
      conCotizacion: true,
    })
    expect(html).toContain('Caja abierta')
    expect(html).toContain('USD')
    expect(html).toContain('1.485')
  })

  // Sin caja, el chip de sólo lectura NO puede decir "Abrir caja" —sería un
  // botón que no lo es—: dice qué pasa, y el control del Topbar es el que
  // ofrece hacer algo al respecto. Ámbar y no rojo, mismo criterio que el chip
  // interactivo de escritorio: vender sin caja está permitido.
  it('sin caja abierta lo dice, sin ofrecer abrirla', async () => {
    const html = await renderChips({ caja: null })
    expect(html).not.toContain('Caja abierta')
    expect(html).not.toContain('Abrir caja')
    expect(html).toContain('Sin caja')
    expect(html).toContain('text-warn')
  })
})

describe('el control de caja del Topbar', () => {
  async function renderControl(caja: { abiertaEn: Date } | null) {
    const { ControlDeCaja } = await import('./caja')
    return renderToStaticMarkup(<ControlDeCaja caja={caja} cotizacion={SIN_COTIZACION} />)
  }

  it('es la ranura derecha del teléfono y no existe en escritorio', async () => {
    const html = await renderControl(null)
    const trigger = html.match(/<button[^>]*>/)?.[0]
    expect(trigger, 'no se encontró el disparador del control').toBeTruthy()
    expect(trigger).toContain('size-[38px]')
    expect(trigger).toContain('rounded-[10px]')
    expect(trigger).toContain('lg:hidden')
    expect(trigger).toContain('aria-label=')
  })

  // El contenido de un Sheet de Radix vive en un Portal y sólo se monta con la
  // hoja abierta, así que renderToStaticMarkup no lo ve nunca. Lo que este
  // caso puede afirmar es el cableado.
  //
  // POR QUÉ UNA HOJA Y NO UN MENÚ: un DropdownMenu no puede alojar el campo de
  // saldo inicial —Radix le pone typeahead al menú y le pelea a cualquier
  // <input> adentro—, así que la primera versión abría la caja en 0 en
  // silencio. Eso no es una comodidad perdida: el arqueo, cuando exista, va a
  // cuadrar contra ese número.
  it('la hoja aloja los MISMOS formularios que el chip de escritorio', () => {
    expect(FUENTE).toMatch(/<SheetContent/)
    expect(FUENTE).toMatch(/caja \? \(\s*<ConfirmarCierre/)
    expect(FUENTE).toMatch(/<FormularioDeApertura/)
    // Una sola definición de cada formulario: el teléfono y el escritorio
    // comparten el cableado de la acción, y lo único que cambia es el layout.
    expect([...FUENTE.matchAll(/function FormularioDeApertura/g)].length).toBe(1)
    expect([...FUENTE.matchAll(/function ConfirmarCierre/g)].length).toBe(1)
  })

  // Las dos capacidades que la versión con menú perdía.
  it('abrir la caja desde el teléfono sigue pidiendo el saldo inicial', () => {
    const posicion = FUENTE.indexOf('function FormularioDeApertura')
    const contexto = FUENTE.slice(posicion, FUENTE.indexOf('// --- El teléfono ---'))
    expect(contexto).toContain('name="saldoInicial"')
    expect(contexto).toContain('Saldo inicial')
  })

  it('cerrar la caja desde el teléfono sigue pidiendo confirmación', () => {
    // `ConfirmarCierre` ES el segundo paso: el primero es abrir la hoja. Su
    // botón dice "Sí, cerrar", la misma fórmula que ya usa AnularVenta.
    expect(FUENTE).toContain('Sí, cerrar')
  })

  // El bug que esta pantalla YA tuvo —Enter cobrando con el medio anterior
  // porque un overlay de Radix dejaba pasar la tecla— nació de suponer qué
  // renderiza un primitivo. Acá la suposición sería "un Sheet es un dialog":
  // se verifica contra el paquete instalado, así que un cambio de Radix que
  // moviera el rol rompe el gate en vez de romper el mostrador.
  it('la hoja monta un [role="dialog"], que es lo que hace que los atajos de /vender se abstengan', () => {
    expect(
      readFileSync('components/ui/sheet.tsx', 'utf8'),
      'Sheet tiene que seguir siendo el Dialog de Radix',
    ).toMatch(/Dialog as SheetPrimitive/)

    const candidatos = [
      'node_modules/@radix-ui/react-dialog/dist/index.mjs',
      'node_modules/radix-ui/node_modules/@radix-ui/react-dialog/dist/index.mjs',
    ]
    const fuente = candidatos.map((r) => (existsSync(r) ? readFileSync(r, 'utf8') : null)).find(Boolean)
    expect(fuente, `no se encontró @radix-ui/react-dialog en ${candidatos.join(' ni ')}`).toBeTruthy()
    expect(
      fuente,
      'el Content de Radix dejó de declarar role="dialog": hayOverlayDeRadixAbierto() ' +
        '(app/(app)/vender/punto-de-venta.tsx) lo busca por ese selector, así que los ' +
        'atajos de teclado dejarían de abstenerse con la hoja de caja abierta.',
    ).toContain('role: "dialog"')
  })
})
