// Whitebox sobre el render estático y sobre el FUENTE, mismo criterio que
// app/(app)/inventario/[id]/page.test.tsx: DetalleDeOrden es un Server
// Component async con sesión y Prisma reales, sin arnés en este repo para
// montarlo fuera de un request. Las funciones puras (transicionesDisponibles,
// fechaYHoraDelEvento, tituloDeEvento) y el componente de sólo lectura
// (Bitacora) SÍ se importan y se prueban directo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prisma, type EstadoOrden } from '@/generated/prisma/client'
import { ESTADOS, TRANSICIONES, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import {
  transicionesDisponibles,
  fechaYHoraDelEvento,
  tituloDeEvento,
  Bitacora,
  CardFallaYDiagnostico,
  CardCliente,
  type EventoDeBitacora,
} from './page'

const FUENTE = readFileSync('app/(app)/servicio-tecnico/[id]/page.tsx', 'utf8')

describe('transicionesDisponibles (Task 4 del rediseño: el paño de estado)', () => {
  // Recorre los NUEVE estados, no uno solo: el brief pide "exactamente las
  // transiciones legales desde ese estado", y una sola muestra no probaría
  // que el resto del grafo también se respeta.
  it('sin anular, devuelve EXACTAMENTE lo que dice TRANSICIONES, estado por estado', () => {
    for (const estado of ESTADOS) {
      expect(transicionesDisponibles(estado, false), `estado ${estado}`).toEqual(TRANSICIONES[estado])
    }
  })

  // El caso que decide la Task 4 completa: anular NO es un estado —es una
  // columna aparte (OrdenDeTrabajo.anuladaEn)—, así que TRANSICIONES no sabe
  // nada de eso. Sin este guard, una orden anulada en EN_REPARACION seguiría
  // ofreciendo Listo/Presupuestado/Sin reparación.
  it('anulada, NINGÚN estado ofrece transiciones — ni siquiera los que tienen varias', () => {
    for (const estado of ESTADOS) {
      expect(transicionesDisponibles(estado, true), `estado ${estado} anulado`).toEqual([])
    }
  })
})

describe('fechaYHoraDelEvento (Task 4 del rediseño: la meta de un evento de la bitácora)', () => {
  it('el ejemplo exacto de la maqueta: "15/08 · 09:12"', () => {
    // 09:12 en Buenos Aires (UTC-3) es 12:12 UTC.
    expect(fechaYHoraDelEvento(new Date('2026-08-15T12:12:00Z'))).toBe('15/08 · 09:12')
  })

  it('el día y el mes SIEMPRE llevan cero a la izquierda, sin año', () => {
    expect(fechaYHoraDelEvento(new Date('2026-01-05T12:00:00Z'))).toMatch(/^\d{2}\/\d{2} · \d{2}:\d{2}$/)
    expect(fechaYHoraDelEvento(new Date('2026-01-05T12:00:00Z'))).not.toContain('2026')
  })
})

describe('tituloDeEvento (Task 4 del rediseño: los títulos de la bitácora)', () => {
  it('el evento de apertura (desde null) dice "Equipo recibido", no "Pasó a Recibido"', () => {
    expect(tituloDeEvento({ desde: null, hasta: 'RECIBIDO' })).toBe('Equipo recibido')
  })

  // Recorre varios estados de destino, no uno solo.
  it('cualquier otro evento dice "Pasó a <Estado>", con el nombre en castellano', () => {
    const casos: [EstadoOrden, EstadoOrden][] = [
      ['RECIBIDO', 'EN_DIAGNOSTICO'],
      ['PRESUPUESTADO', 'APROBADO'],
      ['EN_REPARACION', 'LISTO'],
    ]
    for (const [desde, hasta] of casos) {
      expect(tituloDeEvento({ desde, hasta })).toBe(`Pasó a ${NOMBRE_ESTADO[hasta]}`)
    }
  })
})

describe('Bitacora (Task 4 del rediseño)', () => {
  const EVENTOS: EventoDeBitacora[] = [
    {
      id: 'e-3',
      desde: 'PRESUPUESTADO',
      hasta: 'EN_REPARACION',
      nota: 'Llegó el módulo del proveedor.',
      creadoEn: new Date('2026-08-15T12:12:00Z'),
      usuario: { nombre: 'Rubén' },
    },
    {
      id: 'e-2',
      desde: 'RECIBIDO',
      hasta: 'PRESUPUESTADO',
      nota: '$ 145.000 con módulo original.',
      creadoEn: new Date('2026-08-11T14:20:00Z'),
      usuario: { nombre: 'Rubén' },
    },
    {
      id: 'e-1',
      desde: null,
      hasta: 'RECIBIDO',
      nota: 'Marco golpeado en la esquina inferior derecha.',
      creadoEn: new Date('2026-07-29T13:35:00Z'),
      usuario: { nombre: 'Florencia' },
    },
  ]

  it('respeta el orden que se le pasa: más nueva primero, si así llega', () => {
    // Bitacora no ordena por su cuenta —el orden real, MÁS NUEVA PRIMERO, lo
    // decide el `orderBy` de la consulta de page.tsx (verificado más abajo
    // por FUENTE)—; esto comprueba que el componente no reordena ni invierte
    // lo que recibe, que sería el bug que dejaría el orden de la consulta sin
    // efecto visible.
    const html = renderToStaticMarkup(<Bitacora eventos={EVENTOS} />)
    const posEnReparacion = html.indexOf('Pasó a En reparación')
    const posPresupuestado = html.indexOf('Pasó a Presupuestado')
    const posRecibido = html.indexOf('Equipo recibido')
    expect(posEnReparacion).toBeGreaterThan(-1)
    expect(posPresupuestado).toBeGreaterThan(posEnReparacion)
    expect(posRecibido).toBeGreaterThan(posPresupuestado)
  })

  // El requisito explícito del brief: CADA evento muestra su ícono — no sólo
  // "alguno lo tiene". Recorre los tres eventos del ejemplo, cada uno con el
  // ícono de ESTADO_VISUAL que corresponde a SU PROPIO `hasta`.
  it('cada evento muestra el ícono de ESTADO_VISUAL para su propio estado, no uno genérico', () => {
    const html = renderToStaticMarkup(<Bitacora eventos={EVENTOS} />)
    // wrench = EN_REPARACION (evento e-3)
    expect(html).toContain('lucide-wrench')
    // file-text = PRESUPUESTADO (evento e-2)
    expect(html).toContain('lucide-file-text')
    // inbox = RECIBIDO (evento e-1, el de apertura)
    expect(html).toContain('lucide-inbox')
  })

  it('la línea del riel no aparece después del último evento (el extremo)', () => {
    const html = renderToStaticMarkup(<Bitacora eventos={EVENTOS} />)
    // Tres eventos → como mucho DOS líneas conectoras (entre 1-2 y 2-3), no
    // tres: la última fila no tiene "línea siguiente" que dibujar.
    const lineas = html.match(/w-\[2px\] flex-1 bg-border/g) ?? []
    expect(lineas).toHaveLength(2)
  })

  it('muestra la nota y quién hizo el cambio', () => {
    const html = renderToStaticMarkup(<Bitacora eventos={EVENTOS} />)
    expect(html).toContain('Llegó el módulo del proveedor.')
    expect(html).toContain('Rubén')
    expect(html).toContain('Florencia')
  })

  it('un evento sin nota (nota null) no revienta ni deja un guión inventado', () => {
    const sinNota: EventoDeBitacora = { ...EVENTOS[0], nota: null }
    const html = renderToStaticMarkup(<Bitacora eventos={[sinNota]} />)
    expect(html).toContain('Pasó a En reparación')
  })

  // Task 9 del ciclo móvil (design/arandano.pen, frame `B3noN`): sin scroll
  // interno propio en el teléfono —fluye con el resto del cuerpo—, y se
  // queda como hoy en escritorio (h-full + su propio overflow-y-auto, para
  // parejarse con la columna vecina).
  it('es fluida en el teléfono: sin scroll interno propio, y se queda como hoy en escritorio', () => {
    const html = renderToStaticMarkup(<Bitacora eventos={EVENTOS} />)
    expect(html).toMatch(/class="flex flex-col overflow-hidden rounded-2xl border bg-card lg:h-full"/)
    expect(html).toMatch(/class="flex flex-col px-\[18px\] pt-4 lg:flex-1 lg:overflow-y-auto"/)
  })
})

describe('CardFallaYDiagnostico (hallazgo I2 de la review final: el presupuesto formateado)', () => {
  const ORDEN_BASE = {
    id: 'o-1',
    fallaDeclarada: 'no carga',
    diagnostico: null,
  }

  // El caso central: `String(Decimal)` para "145000.00" da "145000" —
  // decimal.js poda los ceros de cola—, y así se veía el presupuesto como un
  // número pelado. El nodo `XuSfC` de la maqueta dice "145.000,00".
  it('el presupuesto se ve en el formato argentino de la maqueta, no crudo', () => {
    const html = renderToStaticMarkup(
      <CardFallaYDiagnostico
        orden={{ ...ORDEN_BASE, montoEstimado: new Prisma.Decimal('145000.00') }}
        anulada={false}
      />,
    )
    expect(html).toContain('value="145.000,00"')
    expect(html).not.toContain('value="145000"')
  })

  it('un monto con centavos también se formatea, no sólo el ejemplo redondo', () => {
    const html = renderToStaticMarkup(
      <CardFallaYDiagnostico
        orden={{ ...ORDEN_BASE, montoEstimado: new Prisma.Decimal('35250.5') }}
        anulada={false}
      />,
    )
    expect(html).toContain('value="35.250,50"')
  })

  it('sin presupuesto todavía, el campo nace vacío y no "NaN" ni "0"', () => {
    const html = renderToStaticMarkup(
      <CardFallaYDiagnostico orden={{ ...ORDEN_BASE, montoEstimado: null }} anulada={false} />,
    )
    expect(html).not.toContain('NaN')
    expect(html).toContain('name="montoEstimado"')
  })

  it('anulada, no se ofrece el formulario de diagnóstico (y por lo tanto tampoco el presupuesto)', () => {
    const html = renderToStaticMarkup(
      <CardFallaYDiagnostico
        orden={{ ...ORDEN_BASE, montoEstimado: new Prisma.Decimal('145000.00') }}
        anulada={true}
      />,
    )
    expect(html).not.toContain('name="montoEstimado"')
  })
})

describe('CardCliente (hallazgo I3 de la review final: la orden que se está mirando no se cuenta a sí misma)', () => {
  it('resta la orden actual: 4 órdenes en total se muestran como 3 previas', () => {
    const html = renderToStaticMarkup(
      <CardCliente cliente={{ nombre: 'Marcos Vera', telefono: '111', _count: { ordenes: 4 } }} />,
    )
    expect(html).toContain('>3<')
    expect(html).not.toContain('>4<')
  })

  it('un cliente que viene por primera vez ve 0 previas, no 1', () => {
    const html = renderToStaticMarkup(
      <CardCliente cliente={{ nombre: 'Nuevo Cliente', telefono: null, _count: { ordenes: 1 } }} />,
    )
    expect(html).toContain('>0<')
    expect(html).not.toContain('>1<')
  })
})

describe('la consulta y el armado de la ficha (Task 4 del rediseño)', () => {
  it('la bitácora se pide MÁS NUEVA PRIMERO (orderBy desc), al revés que antes del ciclo', () => {
    expect(FUENTE).toContain("orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }]")
  })

  it('el select de cliente trae el conteo de órdenes previas (_count), no sólo nombre y teléfono', () => {
    expect(FUENTE).toMatch(/cliente:\s*{\s*select:\s*{\s*nombre:\s*true,\s*telefono:\s*true,\s*_count:/)
  })

  it('los "siguientes" del paño salen de transicionesDisponibles(orden.estado, anulada)', () => {
    expect(FUENTE).toContain('transicionesDisponibles(orden.estado, anulada)')
  })

  it('"Daños visibles" NO aparece en la card Equipo: la maqueta enumera cuatro filas, no cinco', () => {
    const desdeEquipo = FUENTE.indexOf('function CardEquipo')
    const hastaEquipo = FUENTE.indexOf('function CardFallaYDiagnostico')
    expect(desdeEquipo).toBeGreaterThan(-1)
    expect(hastaEquipo).toBeGreaterThan(desdeEquipo)
    expect(FUENTE.slice(desdeEquipo, hastaEquipo)).not.toContain('danosVisibles')
  })

  it('el formulario de diagnóstico se apaga con la orden anulada, igual que antes del ciclo', () => {
    expect(FUENTE).toContain('{!anulada ? (\n          <FormularioDiagnostico')
  })

  // Hallazgo M6 de la review final: el aviso "Anulada por…" vivía en
  // `text-muted-foreground` —el color más apagado de la paleta— para el
  // estado que más hay que ver. Ahora reusa el mismo patrón que
  // `/ventas/[id]` ya usa para su venta anulada: `Alert` sobre
  // `bg-destructive-soft`, texto en `text-destructive`.
  it('el aviso de orden anulada usa el mismo patrón que /ventas/[id] (Alert + bg-destructive-soft)', () => {
    const desde = FUENTE.indexOf('{anulada ? (')
    const hasta = FUENTE.indexOf('<PanelEstado')
    expect(desde).toBeGreaterThan(-1)
    expect(hasta).toBeGreaterThan(desde)
    const bloque = FUENTE.slice(desde, hasta)
    expect(bloque).toContain('bg-destructive-soft')
    expect(bloque).toContain('text-destructive')
    expect(bloque).not.toContain('text-muted-foreground')
  })
})
