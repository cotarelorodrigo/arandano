// Whitebox sobre el render estático de PanelEstado, FichaDeOrden y
// FormularioDiagnostico (Task 4 del rediseño): renderToStaticMarkup, mismo
// criterio que app/(app)/inventario/formularios.test.tsx. formularios.tsx
// sólo importa TIPOS de ./acciones (EstadoServicio), nunca las funciones en
// sí, así que no hace falta mockear nada — se pasa una acción falsa como prop,
// igual que nuevo/formularios.test.tsx.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarProvider } from '@/components/ui/sidebar'
import { PanelEstado, FichaDeOrden, FormularioDiagnostico, textoDeAntiguedad } from './formularios'
import { NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'

const accionFalsa = async () => ({ error: null, aviso: null })

describe('textoDeAntiguedad', () => {
  it('0 días es "hoy", sin la palabra "hace" — eso ya lo dice el rótulo de arriba', () => {
    expect(textoDeAntiguedad(0)).toBe('hoy')
  })

  it('1 día es singular', () => {
    expect(textoDeAntiguedad(1)).toBe('1 día')
  })

  it('el ejemplo de la maqueta: "6 días", sin "hace" adelante', () => {
    expect(textoDeAntiguedad(6)).toBe('6 días')
    expect(textoDeAntiguedad(6)).not.toContain('hace')
  })
})

describe('PanelEstado (Task 4 del rediseño: el paño "ESTADO ACTUAL")', () => {
  function render(siguientes: ('LISTO' | 'PRESUPUESTADO' | 'SIN_REPARACION' | 'RECHAZADO' | 'APROBADO')[]) {
    return renderToStaticMarkup(
      <PanelEstado
        accion={accionFalsa}
        ordenId="o-1"
        estado="EN_REPARACION"
        siguientes={siguientes}
        nombres={NOMBRE_ESTADO}
        diasEnEstado={6}
      />,
    )
  }

  it('muestra el estado actual y su tiempo transcurrido', () => {
    const html = render(['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'])
    expect(html).toContain('En reparación')
    expect(html).toContain('6 días')
    expect(html).toContain('ESTADO ACTUAL')
    expect(html).toContain('HACE')
  })

  // El requisito explícito del brief: los botones son EXACTAMENTE las
  // transiciones que se le pasan (que en la pantalla real vienen de
  // transicionesDisponibles/TRANSICIONES) — ni de más ni de menos. La
  // maqueta muestra "Rechazado" para EN_REPARACION; el grafo real no lo
  // incluye ahí, y este test verifica que el componente no lo inventa por su
  // cuenta si no viene en `siguientes`.
  it('los botones son exactamente las transiciones que se le pasan, ni una de más', () => {
    const siguientes = ['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'] as const
    const html = render([...siguientes])
    for (const s of siguientes) {
      expect(html, `falta el botón ${s}`).toContain(NOMBRE_ESTADO[s])
    }
    // "Rechazado" es justamente lo que la maqueta dibuja para EN_REPARACION y
    // el grafo real NO ofrece ahí (decisión 2 del ciclo): no puede aparecer
    // como botón si no vino en `siguientes`.
    expect(html).not.toContain('Rechazado')
  })

  it('recorre distintos conjuntos de transiciones, no uno solo', () => {
    const soloUno = render(['APROBADO'])
    expect(soloUno).toContain('Aprobado')
    expect(soloUno).not.toContain('Listo')
    expect(soloUno).not.toContain('Presupuestado')

    const dos = render(['RECHAZADO', 'SIN_REPARACION'])
    expect(dos).toContain('Rechazado')
    expect(dos).toContain('Sin reparación')
    expect(dos).not.toContain('Aprobado')
  })

  // El caso central de la Task 4: una orden anulada no ofrece NINGUNA
  // transición — ni "MOVER A", ni un solo botón.
  it('sin transiciones (orden anulada), no hay "MOVER A" ni ningún botón, sólo el aviso', () => {
    const html = render([])
    expect(html).not.toContain('MOVER A')
    expect(html).not.toContain('name="hasta"')
    expect(html).toContain('Esta orden no se puede mover más.')
  })

  it('el primer botón es el camino PRINCIPAL (sólido); el resto es fantasma (translúcido)', () => {
    const html = render(['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'])
    const posListo = html.indexOf('>Listo<')
    const desdeListo = html.lastIndexOf('<button', posListo)
    const botonListo = html.slice(desdeListo, html.indexOf('</button>', posListo))
    expect(botonListo).toContain('var(--marca-foreground)')
    expect(botonListo).not.toContain('color-mix')

    const posPresupuestado = html.indexOf('>Presupuestado<')
    const desdePresupuestado = html.lastIndexOf('<button', posPresupuestado)
    const botonPresupuestado = html.slice(desdePresupuestado, html.indexOf('</button>', posPresupuestado))
    expect(botonPresupuestado).toContain('color-mix')
  })

  it('el nota de validación del servidor está siempre presente cuando hay transiciones', () => {
    const html = render(['LISTO'])
    expect(html).toContain('esconder un botón no es una validación')
  })

  // Hallazgo C1 de la review final: el campo de nota había desaparecido y con
  // él el único escritor de EventoOrden.nota. Sin este caso, el defecto no
  // ponía nada en rojo (grep confirmó que ningún test cubría `name="nota"`).
  it('trae el campo de nota, único escritor de EventoOrden.nota', () => {
    const html = render(['LISTO'])
    expect(html).toContain('name="nota"')
    expect(html).toContain('Nota (opcional)')
  })

  it('sin transiciones (orden anulada), tampoco hay campo de nota: no hay a qué evento atarla', () => {
    const html = render([])
    expect(html).not.toContain('name="nota"')
  })

  // Task 9 del ciclo móvil (design/arandano.pen, frame `B3noN`, nodo
  // `W8tnTz` "Transiciones"): los botones se apilan uno debajo del otro en
  // el teléfono, a 44px de alto (h-11) — y quedan como hoy en escritorio
  // (lado a lado si entran, 40px de alto).
  it('los botones de transición se apilan en el teléfono a 44px, y quedan lado a lado a 40px en escritorio', () => {
    const html = render(['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'])
    expect(html).toMatch(/class="flex flex-col gap-2 lg:flex-row lg:flex-wrap"/)

    const posListo = html.indexOf('>Listo<')
    const desdeListo = html.lastIndexOf('<button', posListo)
    const botonListo = html.slice(desdeListo, html.indexOf('</button>', posListo))
    expect(botonListo).toContain('h-11')
    expect(botonListo).toContain('lg:h-10')
    expect(botonListo).toContain('w-full')
    expect(botonListo).toContain('lg:w-auto')
  })
})

describe('FichaDeOrden (Task 4 del rediseño: Topbar de la ficha)', () => {
  // FichaDeOrden renderiza <Encabezado> (Task 1 del ciclo del shell móvil),
  // que sin `atras` renderiza el SidebarTrigger de shadcn — y ése llama a
  // useSidebar(), que tira si no hay un SidebarProvider como ancestro. Mismo
  // motivo que ya documentó components/shell/encabezado.test.tsx.
  function render(opts: { anulada?: boolean; esDuenio?: boolean } = {}) {
    return renderToStaticMarkup(
      <SidebarProvider>
        <FichaDeOrden
          titulo="Orden #221 · Samsung A54"
          subtitulo="Ingresó el 29/07/2026 · hace 23 días en el local"
          ordenId="o-1"
          anulada={opts.anulada ?? false}
          esDuenio={opts.esDuenio ?? true}
          accionAnular={accionFalsa}
          columnaIzquierda={<div>cuerpo izquierdo</div>}
          columnaDerecha={<div>bitácora</div>}
        />
      </SidebarProvider>,
    )
  }

  it('"Reimprimir ticket" siempre está y apunta al ticket de ESTA orden', () => {
    const html = render()
    expect(html).toMatch(/href="\/servicio-tecnico\/o-1\/ticket"[^>]*>[\s\S]*?Reimprimir ticket/)
  })

  it('el dueño con la orden viva ve "Anular orden"', () => {
    const html = render({ esDuenio: true, anulada: false })
    expect(html).toContain('Anular orden')
  })

  it('un empleado NO ve "Anular orden", aunque la orden esté viva', () => {
    const html = render({ esDuenio: false, anulada: false })
    expect(html).not.toContain('Anular orden')
  })

  it('una orden YA anulada no ofrece anularla de nuevo, ni para el dueño', () => {
    const html = render({ esDuenio: true, anulada: true })
    expect(html).not.toContain('Anular orden')
  })

  it('el <form> invisible de anular sólo existe cuando el botón puede aparecer', () => {
    expect(render({ esDuenio: true, anulada: false })).toContain('id="form-anular-orden"')
    expect(render({ esDuenio: false, anulada: false })).not.toContain('id="form-anular-orden"')
    expect(render({ esDuenio: true, anulada: true })).not.toContain('id="form-anular-orden"')
  })

  it('las dos columnas del cuerpo se renderizan', () => {
    const html = render()
    expect(html).toContain('cuerpo izquierdo')
    expect(html).toContain('bitácora')
  })

  // Hallazgo M5 de la review final: "Anular orden" quedaba pegado a
  // "Reimprimir ticket" —el botón que más se aprieta acá— y disparaba la
  // acción irreversible con un solo click. El primer render tiene que ser un
  // botón que ARMA la confirmación, no uno que ya está atado al <form> de
  // anular: si alguien revirtiera el mecanismo a un submit directo, este caso
  // tiene que quedar en rojo.
  it('"Anular orden" arma la confirmación en vez de anular con un solo click', () => {
    const html = render({ esDuenio: true, anulada: false })
    const inicio = html.indexOf('Anular orden')
    expect(inicio).toBeGreaterThan(-1)
    const desde = html.lastIndexOf('<button', inicio)
    const cierre = html.indexOf('>', desde)
    const etiqueta = html.slice(desde, cierre)
    expect(etiqueta).toContain('type="button"')
    expect(etiqueta).not.toContain(`form="${'form-anular-orden'}"`)
    // Sin confirmar todavía: ni "Sí, anular" ni "Cancelar" aparecen.
    expect(html).not.toContain('Sí, anular')
    expect(html).not.toContain('>Cancelar<')
  })

  // Task 9 del ciclo móvil (design/arandano.pen, frame `B3noN`).
  it('vuelve a /servicio-tecnico desde la ranura izquierda del teléfono', () => {
    const html = render()
    // La etiqueta se extrae y DESPUÉS se afirma el href, en vez de un
    // regex que fije el orden de los atributos: desde que <Encabezado>
    // navega con `Link` de Next (hallazgo I3 de la review final), el href
    // sale último y no primero. Mismo mecanismo que ya usaba
    // components/shell/encabezado.test.tsx para la variante <button>.
    const volver = html.match(/<a[^>]*aria-label="Volver"[^>]*>/)?.[0]
    expect(volver, `no se encontró la flecha de volver en: ${html}`).toBeTruthy()
    expect(volver).toContain('href="/servicio-tecnico"')
  })

  it('las dos columnas del cuerpo pasan a flex-col lg:flex-row en el teléfono', () => {
    const html = render()
    expect(html).toMatch(/class="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4"/)
  })

  /**
   * Corrección del coordinador tras el reporte de la Task 9: el frame
   * `B3noN` (Orden ficha) dibuja el ícono `printer` como `accionMovil` con
   * tono `suave` en el Topbar del teléfono — no una ranura vacía. Sin esto,
   * "Reimprimir ticket" desaparecía bajo 1024px sin reaparecer en ningún
   * otro lado: una capacidad perdida, no una simplificación.
   */
  it('la ranura derecha del teléfono es "Reimprimir ticket" (printer, tono suave)', () => {
    const html = render()
    // Sin fijar el orden de los atributos, por lo mismo que la flecha de
    // volver de acá arriba: `Link` de Next emite el href al final.
    const ranura = html.match(/<a[^>]*aria-label="Reimprimir ticket"[^>]*>/)?.[0]
    expect(ranura, `no se encontró la ranura de reimprimir en: ${html}`).toBeTruthy()
    expect(ranura).toContain('href="/servicio-tecnico/o-1/ticket"')
    expect(ranura, 'tono "suave": la maqueta la pinta con --muted').toMatch(
      /class="[^"]*bg-muted text-foreground[^"]*"/,
    )
  })

  /**
   * Corrección del coordinador: `B3noN` también baja "Anular orden" al
   * cuerpo (nodo `Jq2Rf`, 46px de alto, ancho completo) — el Topbar lo sigue
   * mostrando en escritorio (`hidden lg:flex`, sin cambios), pero bajo
   * 1024px esa acción no reaparecía en ningún lado. Mismo componente
   * `BotonAnular`, mismo mecanismo de confirmación en dos pasos: sólo se le
   * suma una className de tamaño para esta segunda instancia.
   */
  it('"Anular orden" se duplica al final del cuerpo en el teléfono, a 46px de alto', () => {
    const html = render({ esDuenio: true, anulada: false })
    const apariciones = [...html.matchAll(/Anular orden/g)]
    expect(apariciones).toHaveLength(2)

    const ultima = html.lastIndexOf('Anular orden')
    const desde = html.lastIndexOf('<button', ultima)
    const boton = html.slice(desde, html.indexOf('</button>', ultima))
    expect(boton).toContain('h-[46px]')
    // Conserva el lenguaje visual destructivo: no es un botón nuevo desde
    // cero, es la MISMA instancia de BotonAnular con otro tamaño.
    expect(boton).toContain('border-destructive')
    expect(boton).toContain('text-destructive')
  })

  it('el bloque del cuerpo es lg:hidden: en escritorio sigue viviendo sólo en el Topbar', () => {
    const html = render({ esDuenio: true, anulada: false })
    expect(html).toMatch(/class="flex gap-\[10px\] lg:hidden"/)
  })

  it('sin poder anular (empleado, u orden ya anulada), tampoco aparece el bloque del cuerpo', () => {
    expect(render({ esDuenio: false, anulada: false })).not.toContain('Anular orden')
    expect(render({ esDuenio: true, anulada: true })).not.toContain('Anular orden')
  })
})

describe('FormularioDiagnostico (Task 4 del rediseño: fila diagnóstico + presupuesto)', () => {
  // Hallazgo I2 de la review final: `montoEstimado` viaja YA FORMATEADO desde
  // el llamador ([id]/page.tsx, CardFallaYDiagnostico) — el texto exacto de la
  // maqueta ("145.000,00", nodo `XuSfC`), no el `String(Decimal)` crudo que
  // decimal.js poda a "145000". Antes este caso pasaba "145000" como prop y
  // comprobaba que "145000" apareciera: una aserción que bendecía el formato
  // crudo en vez de probar el formato de verdad. Este componente no formatea
  // nada por su cuenta —eso lo prueba `[id]/page.test.tsx` sobre
  // `CardFallaYDiagnostico`, que es donde vive `montoSinSigno(formatearPrecio(
  // ...))`—; lo único que le toca a éste es no arruinar lo que ya le llega
  // formateado.
  it('trae los valores ya cargados, con el presupuesto en el formato que le pasa el llamador', () => {
    const html = renderToStaticMarkup(
      <FormularioDiagnostico
        accion={accionFalsa}
        ordenId="o-1"
        diagnostico="Módulo roto"
        montoEstimado="145.000,00"
      />,
    )
    expect(html).toContain('Módulo roto')
    expect(html).toContain('value="145.000,00"')
    expect(html).not.toContain('value="145000"')
    expect(html).toContain('Guardar diagnóstico')
  })

  // Barrido final del cierre del rediseño (hallazgo M1): estos dos rótulos
  // usaban el <Label> pelado de shadcn mientras el resto de la pantalla
  // (Nombre, Teléfono en FormularioRecepcion) ya pagaba la maqueta —
  // 11px/600/--foreground-soft. Ver nuevo/formularios.test.tsx para el
  // mismo caso sobre los otros siete rótulos de esta pantalla.
  it('"Diagnóstico del técnico" y "Presupuesto" pagan el mismo tratamiento que el resto de la pantalla', () => {
    const html = renderToStaticMarkup(
      <FormularioDiagnostico accion={accionFalsa} ordenId="o-1" diagnostico="" montoEstimado="" />,
    )
    for (const rotulo of ['Diagnóstico del técnico', 'Presupuesto']) {
      const inicio = html.lastIndexOf('<label', html.indexOf(`>${rotulo}<`))
      const cierre = html.indexOf('>', inicio)
      expect(inicio, `no se encontró el <label> de "${rotulo}"`).toBeGreaterThan(-1)
      expect(
        html.slice(inicio, cierre),
        `el rótulo "${rotulo}" no paga text-[11px] font-semibold text-foreground-soft`,
      ).toContain('text-[11px] font-semibold text-foreground-soft')
    }
  })

  // Hallazgo M2: el campo "Presupuesto" heredaba el h-8 (32px) por default de
  // shadcn Input; design/arandano.pen (frame `App / Orden ficha`, nodo
  // `XVOe5`) lo mide a 40px, verificado en vivo con el MCP de Pencil.
  it('"Presupuesto" mide 40px (h-10), no el h-8 por default de shadcn', () => {
    const html = renderToStaticMarkup(
      <FormularioDiagnostico accion={accionFalsa} ordenId="o-1" diagnostico="" montoEstimado="" />,
    )
    const inicio = html.lastIndexOf('<input', html.indexOf('name="montoEstimado"'))
    const cierre = html.indexOf('/>', inicio)
    expect(inicio).toBeGreaterThan(-1)
    expect(html.slice(inicio, cierre)).toContain('h-10')
  })
})
