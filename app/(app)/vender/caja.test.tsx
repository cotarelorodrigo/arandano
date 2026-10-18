import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CajaDelChip } from './caja'
import { cajaDePrueba } from '@/test/caja-de-prueba'

// Mismo criterio que punto-de-venta.test.tsx: acciones.ts es 'use server' y
// su contrato ya lo prueba acciones.test.ts contra una base real. Acá sólo
// importa qué renderiza el chip, así que las dos actions se mockean.
vi.mock('./acciones', () => ({
  abrirCajaDesdeVender: vi.fn(),
  cerrarCajaDesdeVender: vi.fn(),
  registrarMovimientoDesdeVender: vi.fn(),
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
  caja: CajaDelChip | null
}

async function render(props: Props) {
  const { ChipCaja } = await import('./caja')
  return legible(renderToStaticMarkup(<ChipCaja {...props} cotizacion={SIN_COTIZACION} />))
}

const FUENTE = readFileSync('app/(app)/vender/caja.tsx', 'utf8')

/** `Intl` separa el signo de la moneda con un espacio duro (U+00A0); los
 *  casos de abajo escriben un espacio común para que se lean. Normalizar el
 *  HTML y no los literales es lo que deja escribir "$ 55.000,00" en el test. */
function legible(html: string): string {
  return html.replace(/\u00a0/g, ' ')
}

describe('el chip de caja', () => {
  it('con caja abierta el chip la muestra', async () => {
    const html = await render({ caja: cajaDePrueba() })
    expect(html).toContain('Caja abierta')
    // Y NO el chip de la otra mitad: los dos estados son excluyentes.
    expect(html).not.toContain('Abrir caja')
  })

  // La mitad del pedido del cliente (ciclo del arqueo): "ver desde la caja
  // cuánto efectivo hay ahora". El ejemplo del pedido: 10.000 + 50.000 − 5.000.
  it('el chip dice el efectivo actual, y abre el panel de la caja', async () => {
    const html = await render({ caja: cajaDePrueba() })
    expect(html).toContain('Caja abierta · $ 55.000,00')
    // Un Dialog de Radix: lo que hace que los atajos de /vender se abstengan
    // mientras el panel está abierto (Enter en el cierre no cobra la venta).
    expect(html).toMatch(/^<button[^>]*aria-haspopup="dialog"/)
  })

  it('los dólares van en el chip sólo si el turno los tuvo', async () => {
    const sin = await render({ caja: cajaDePrueba() })
    expect(sin).not.toContain('US$')
    const con = await render({
      caja: cajaDePrueba({
        conDolares: true,
        efectivo: { ...cajaDePrueba().efectivo, actual: { ars: '55000.00', usd: '300.00' } },
      }),
    })
    expect(con).toContain('Caja abierta · $ 55.000,00 · US$ 300,00')
  })

  // El mismo defecto de teclado que ya se pagó con el chip "USD" (dolar.tsx):
  // Radix le devuelve el foco al disparador al cerrarse, y con el foco en un
  // <button> Enter no cobra —y reabría el panel—. Sin devolverlo, cae en
  // <body>, que es donde los atajos de /vender viven.
  it('al cerrarse, el panel no le devuelve el foco al chip', () => {
    const inicio = FUENTE.indexOf('function ChipCajaAbierta')
    const cuerpo = FUENTE.slice(inicio, FUENTE.indexOf('export function detenerEscapeGlobal'))
    expect(cuerpo).toContain('<DialogContent')
    expect(cuerpo).toContain('onCloseAutoFocus={(e) => e.preventDefault()}')
    expect(cuerpo).toContain('<PanelDeCaja')
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
    // ningún test.
    const cierre = FUENTE.slice(FUENTE.indexOf('export function FormularioDeCierre'))
    expect(cierre).toMatch(/^[\s\S]{0,200}useActionState\(cerrarCajaDesdeVender,\s*INICIAL\)/)
  })

  it('y el registro de un movimiento cuelga de registrarMovimientoDesdeVender', () => {
    const mov = FUENTE.slice(FUENTE.indexOf('function FormularioDeMovimiento'))
    expect(mov).toMatch(/^[\s\S]{0,200}useActionState\(registrarMovimientoDesdeVender,\s*INICIAL\)/)
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
  // Desde el ciclo del arqueo son tres: abrir, registrar un movimiento y
  // cerrar.
  it('TODOS los mensajes de error del chip llevan role="alert"', () => {
    const errores = FUENTE.match(/<span[^>]*>\{estado\.error\}<\/span>/g) ?? []
    expect(errores.length).toBe(3)
    for (const span of errores) {
      expect(span).toContain('role="alert"')
    }
  })
})

// --- El teléfono: los chips de sólo lectura del cuerpo y el control del Topbar ---

describe('los chips de estado del cuerpo', () => {
  async function renderChips(props: { caja: CajaDelChip | null; conCotizacion?: boolean }) {
    const { ChipsDeEstado } = await import('./caja')
    return legible(
      renderToStaticMarkup(
        <ChipsDeEstado caja={props.caja} cotizacion={props.conCotizacion ? CON_COTIZACION : SIN_COTIZACION} />,
      ),
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
    const conCaja = await renderChips({ caja: cajaDePrueba(), conCotizacion: true })
    const sinCaja = await renderChips({ caja: null })
    for (const html of [conCaja, sinCaja]) {
      expect(html).not.toContain('<button')
      expect(html).not.toContain('<form')
      expect(html).not.toContain('<input')
    }
  })

  it('dicen si la caja está abierta y a cuánto está el dólar', async () => {
    const html = await renderChips({ caja: cajaDePrueba(), conCotizacion: true })
    // Con el efectivo actual, igual que el chip de escritorio (ciclo del
    // arqueo): el teléfono dice lo mismo.
    expect(html).toContain('Caja abierta · $ 55.000,00')
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
  async function renderControl(caja: CajaDelChip | null) {
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
  it('la hoja aloja los MISMOS componentes que el chip de escritorio', () => {
    expect(FUENTE).toMatch(/<SheetContent/)
    // Desde el ciclo del arqueo, el panel entero de la caja (detalle,
    // movimientos y cierre con arqueo), no sólo la confirmación de cierre.
    expect(FUENTE).toMatch(/caja \? \(\s*<PanelDeCaja/)
    expect(FUENTE).toMatch(/<FormularioDeApertura/)
    // Una sola definición de cada formulario: el teléfono y el escritorio
    // comparten el cableado de la acción, y lo único que cambia es el layout.
    for (const nombre of ['FormularioDeApertura', 'FormularioDeCierre', 'FormularioDeMovimiento', 'PanelDeCaja']) {
      expect([...FUENTE.matchAll(new RegExp(`function ${nombre}\\b`, 'g'))].length, nombre).toBe(1)
    }
    // Y el panel se monta en los dos lugares: el diálogo del chip y la hoja.
    expect([...FUENTE.matchAll(/<PanelDeCaja\b/g)].length).toBe(2)
  })

  // Las dos capacidades que la versión con menú perdía.
  it('abrir la caja desde el teléfono sigue pidiendo el saldo inicial', () => {
    const posicion = FUENTE.indexOf('function FormularioDeApertura')
    const contexto = FUENTE.slice(posicion, FUENTE.indexOf('// --- El teléfono ---'))
    expect(contexto).toContain('name="saldoInicial"')
    expect(contexto).toContain('Saldo inicial')
  })

  it('cerrar la caja sigue siendo de dos pasos, y el segundo es contar', async () => {
    // El primero es "Cerrar caja" en el panel; el segundo, el formulario de
    // cierre con lo contado y su propio botón. Ninguno de los dos cierra
    // solo con un click.
    const { PanelDeCaja } = await import('./caja')
    const panel = renderToStaticMarkup(<PanelDeCaja caja={cajaDePrueba()} />)
    expect(panel).toContain('Cerrar caja')
    expect(panel).not.toContain('type="submit"')
    expect(FUENTE).toContain('Cerrar la caja')
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

// --- El panel de la caja (ciclo del arqueo, 2026-10-18) ---
//
// El contenido del Dialog y de la Sheet vive en un Portal que
// renderToStaticMarkup no monta, así que el panel, el cierre y la apertura se
// renderizan directo: son los MISMOS componentes que montan las dos copias.

describe('el panel de la caja', () => {
  async function panel(caja: CajaDelChip) {
    const { PanelDeCaja } = await import('./caja')
    return legible(renderToStaticMarkup(<PanelDeCaja caja={caja} />))
  }

  it('desglosa el efectivo: apertura, cobrado, egresos y el actual', async () => {
    const html = await panel(cajaDePrueba())
    expect(html).toContain('Apertura')
    expect(html).toContain('$ 10.000,00')
    expect(html).toContain('Cobrado en efectivo')
    expect(html).toContain('$ 50.000,00')
    expect(html).toContain('Egresos')
    expect(html).toContain('$ 5.000,00')
    expect(html).toContain('Efectivo actual')
    expect(html).toContain('$ 55.000,00')
  })

  // Un local que nunca registró un retiro no tiene por qué leer "Retiros
  // $ 0,00" cada vez que abre el panel.
  it('las filas en cero no se dibujan, salvo la cuenta que todo turno tiene', async () => {
    const html = await panel(cajaDePrueba())
    expect(html).not.toContain('Retiros')
    expect(html).not.toContain('Ingresos')
    expect(html).not.toContain('Devuelto por anulaciones')
  })

  // Spec, decisión 3: la columna de dólares sólo si el turno tuvo alguno.
  it('la columna de dólares, sólo si el turno tuvo alguno', async () => {
    expect(await panel(cajaDePrueba())).not.toContain('Dólares')
    const con = await panel(
      cajaDePrueba({
        conDolares: true,
        efectivo: { ...cajaDePrueba().efectivo, actual: { ars: '55000.00', usd: '300.00' } },
      }),
    )
    expect(con).toContain('Dólares')
    expect(con).toContain('US$ 300,00')
  })

  it('lista los movimientos del turno con quién, cuándo y el signo', async () => {
    const html = await panel(
      cajaDePrueba({
        movimientos: [
          {
            id: 'm1', tipo: 'EGRESO', moneda: 'ARS', monto: '5000.00', nota: 'Delivery',
            usuario: 'Flor', creadoEn: new Date('2026-08-21T18:00:00Z'),
          },
        ],
      }),
    )
    expect(html).toContain('Movimientos del turno')
    expect(html).toContain('Delivery')
    expect(html).toContain('15:00 · Flor')
    expect(html).toContain('− $ 5.000,00')
  })

  it('ofrece registrar un movimiento y cerrar la caja', async () => {
    const html = await panel(cajaDePrueba())
    expect(html).toContain('Registrar movimiento')
    expect(html).toContain('Cerrar caja')
  })
})

describe('el formulario de cierre', () => {
  async function cierre(caja: CajaDelChip) {
    const { FormularioDeCierre } = await import('./caja')
    return legible(renderToStaticMarkup(<FormularioDeCierre caja={caja} onVolver={() => {}} />))
  }

  it('muestra el esperado y pide lo contado, obligatorio', async () => {
    const html = await cierre(cajaDePrueba())
    expect(html).toContain('Esperado')
    expect(html).toContain('$ 55.000,00')
    const contado = html.match(/<input[^>]*name="contadoArs"[^>]*>/)?.[0]
    expect(contado, 'no está el campo del contado en pesos').toBeTruthy()
    expect(contado).toContain('required')
    expect(html).toContain('name="retiradoArs"')
    expect(html).toContain('name="notaCierre"')
  })

  it('sin dólares en el turno, no pide contarlos', async () => {
    const html = await cierre(cajaDePrueba())
    expect(html).not.toContain('name="contadoUsd"')
    const con = await cierre(cajaDePrueba({ conDolares: true }))
    expect(con).toContain('name="contadoUsd"')
    expect(con).toContain('name="retiradoUsd"')
  })

  // El submit del cierre es el del formulario, y nada más: Enter en un campo
  // lo envía (es un Dialog/Sheet de Radix, así que el atajo de cobrar de
  // /vender no lo ve). Lo que se fija acá es que sea UN botón de submit y que
  // diga lo que hace.
  it('tiene un solo botón de envío, que dice lo que hace', async () => {
    const html = await cierre(cajaDePrueba())
    expect([...html.matchAll(/type="submit"/g)]).toHaveLength(1)
    expect(html).toContain('Cerrar la caja')
  })
})

describe('la cuenta en vivo del cierre', () => {
  async function cuenta(contado: string, retirado = '', esperado = '55000.00') {
    const { CuentaEnVivo } = await import('./caja')
    return legible(
      renderToStaticMarkup(<CuentaEnVivo esperado={esperado} contado={contado} retirado={retirado} moneda="ARS" />),
    )
  }

  it('el ejemplo del pedido: contado 55.000, retiro 45.000 → cuadra y quedan 10.000', async () => {
    const html = await cuenta('55000', '45000')
    expect(html).toContain('Cuadra')
    expect(html).toContain('Queda $ 10.000,00')
    expect(html).toContain('text-ok')
  })

  // Ámbar y no rojo: la diferencia no bloquea el cierre.
  it('faltan y sobran, en ámbar', async () => {
    const falta = await cuenta('54800')
    expect(falta).toContain('Faltan $ 200,00')
    expect(falta).toContain('text-warn')
    expect(await cuenta('55200')).toContain('Sobran $ 200,00')
  })

  it('retirar más de lo contado se avisa antes de enviar', async () => {
    expect(await cuenta('1000', '2000')).toContain('Se retira más de lo contado')
  })

  it('sin contado no muestra nada', async () => {
    expect(await cuenta('')).toBe('')
  })

  // `54.800` es ambiguo para la gramática (miles o decimales) y el servidor
  // lo rechaza: en vez de una cuenta inventada, cómo escribirlo.
  it('con un contado que no se entiende, no hay cuenta sino cómo escribirlo', async () => {
    for (const texto of ['abc', '54.800']) {
      const html = await cuenta(texto)
      expect(html).not.toContain('Cuadra')
      expect(html).not.toContain('Faltan')
      expect(html).toContain('No se entiende lo contado')
    }
  })
})

describe('la apertura', () => {
  async function apertura(sugerida: { ars: string; usd: string } | null) {
    const { FormularioDeApertura } = await import('./caja')
    return renderToStaticMarkup(<FormularioDeApertura sugerida={sugerida} onCancelar={() => {}} apilado />)
  }

  it('sin un cierre previo con arqueo arranca en 0, como antes', async () => {
    const html = await apertura(null)
    expect(html).toMatch(/name="saldoInicial"[^>]*value="0"|value="0"[^>]*name="saldoInicial"/)
  })

  // Spec, decisión 3: arranca con lo que quedó en el último cierre.
  it('con un cierre previo, arranca con lo que quedó', async () => {
    const html = await apertura({ ars: '10000.00', usd: '0.00' })
    expect(html).toMatch(/name="saldoInicial"[^>]*value="10000"|value="10000"[^>]*name="saldoInicial"/)
    expect(html).toContain('lo que quedó en el último cierre')
  })

  // El local que no maneja dólares no ve un campo de más.
  it('los dólares arrancan plegados', async () => {
    const html = await apertura(null)
    expect(html).not.toContain('name="saldoInicialUsd"')
    expect(html).toContain('+ dólares')
  })

  // Pero si quedaron dólares, esconderlos haría abrir sin ellos sin que
  // nadie lo decida.
  it('desplegados si lo que quedó trae dólares', async () => {
    const html = await apertura({ ars: '10000.00', usd: '150.50' })
    expect(html).toContain('name="saldoInicialUsd"')
    expect(html).toContain('value="150.5"')
    expect(html).not.toContain('+ dólares')
  })
})
