import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SelectorDeMoneda } from '@/components/selector-de-moneda'

// Mismo criterio que app/(app)/vender/caja.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza cada formulario.
vi.mock('./acciones', () => ({
  altaArticulo: vi.fn(),
  guardarArticulo: vi.fn(),
  bajaArticulo: vi.fn(),
  reactivarArticuloAccion: vi.fn(),
  ingresarMercaderia: vi.fn(),
  corregirPorConteo: vi.fn(),
  exportarHistorialCsv: vi.fn(),
}))

const ARBOL = [
  { id: 'id-cables', nombre: 'Cables', cuenta: 3, hijas: [] },
  {
    id: 'id-fundas', nombre: 'Fundas', cuenta: 12,
    hijas: [{ id: 'id-apple', nombre: 'Apple', cuenta: 7 }],
  },
]

// FormularioDeAlta y FichaDeArticulo renderizan <Encabezado> (Task 1 del
// ciclo del shell móvil, componente en components/shell/encabezado.tsx), que
// sin `atras` renderiza el SidebarTrigger de shadcn — y ése llama a
// useSidebar(), que tira si no hay un SidebarProvider como ancestro. Mismo
// motivo que ya documentó components/shell/encabezado.test.tsx.
async function renderAlta(arbol = ARBOL, puedeCostos = true) {
  const { FormularioDeAlta } = await import('./formularios')
  return renderToStaticMarkup(
    <SidebarProvider>
      <FormularioDeAlta proximoSku="A-0043" arbol={arbol} puedeCostos={puedeCostos} />
    </SidebarProvider>,
  )
}

async function renderFicha(
  categoriaId: string | null,
  extra: Partial<{ desactivado: boolean; puedeEditar: boolean; moneda: 'ARS' | 'USD' }> = {},
) {
  const { FichaDeArticulo } = await import('./formularios')
  return renderToStaticMarkup(
    <SidebarProvider>
      <FichaDeArticulo
        titulo="Vidrio templado 9H"
        subtitulo="SKU 000412 · Producto"
        articuloId="a1"
        nombre="Vidrio templado 9H"
        sku="000412"
        precio="12000"
        moneda={extra.moneda ?? 'ARS'}
        arbol={ARBOL}
        categoriaId={categoriaId}
        desactivado={extra.desactivado ?? false}
        puedeEditar={extra.puedeEditar ?? true}
        columnaIzquierda={<div>columna izquierda</div>}
      />
    </SidebarProvider>,
  )
}

describe('FormularioDeAlta', () => {
  // La categoría se elige, no se tipea, desde que existe el árbol; el detalle
  // del control vive en selector-categoria.test.tsx. Este caso conserva lo
  // único que es del FORMULARIO y no del selector: que sigue siendo OPCIONAL.
  it('la categoría es opcional', async () => {
    const html = await renderAlta()
    expect(html).toContain('name="categoriaId"')
    expect(html).not.toMatch(/name="categoriaId"[^>]*required/)
  })

  // Task 3 del rediseño: las tres cards del relevamiento.
  it('tiene las tres cards: Qué estás cargando, Datos del artículo y Stock inicial', async () => {
    const html = await renderAlta()
    expect(html).toContain('Qué estás cargando')
    expect(html).toContain('Datos del artículo')
    expect(html).toContain('Stock inicial')
  })

  it('Producto y Servicio son tarjetas seleccionables (radio), no un <select>', async () => {
    const html = await renderAlta()
    // `name="tipo"` y no "<select>" a secas: desde que la categoría se elige
    // con el Select de shadcn, hay `<select>` en la pantalla — Radix renderiza
    // uno oculto para que el valor viaje en un form nativo, que es justamente
    // lo que hace que estos campos funcionen sin JavaScript. Lo que este caso
    // afirma es que el TIPO no es uno de ellos.
    expect(html).not.toMatch(/<select[^>]*name="tipo"/)
    expect(html).toMatch(/type="radio"[^>]*name="tipo"[^>]*value="PRODUCTO"/)
    expect(html).toMatch(/type="radio"[^>]*name="tipo"[^>]*value="SERVICIO"/)
    expect(html).toContain('Lleva stock y se descuenta al vender')
    expect(html).toContain('No lleva stock. Mano de obra, reparaciones')
  })

  // Por default arranca en Producto (mismo default que antes de este ciclo):
  // el radio de Producto tiene que salir marcado y el de Servicio no.
  it('Producto sale seleccionado por default, y el bloque de stock inicial está visible', async () => {
    const html = await renderAlta()
    // El orden de los atributos que emite React no es el de la declaración en
    // JSX (acá `checked=""` sale ANTES que `value="PRODUCTO"`), así que se
    // extrae el <input> entero por posición en vez de asumir un orden.
    const tagDe = (valor: string) => {
      const pos = html.indexOf(`value="${valor}"`)
      const desde = html.lastIndexOf('<input', pos)
      const hasta = html.indexOf('/>', pos)
      return html.slice(desde, hasta)
    }
    expect(tagDe('PRODUCTO')).toContain('checked=""')
    expect(tagDe('SERVICIO')).not.toContain('checked=""')
    expect(html).toContain('name="stockInicial"')
  })

  it('el costo unitario es opcional: sin el atributo required', async () => {
    const html = await renderAlta()
    const inicio = html.indexOf('name="costoUnitario"')
    expect(inicio, 'no se encontró el campo costoUnitario en el render').toBeGreaterThan(-1)
    const cierre = html.indexOf('/>', inicio)
    expect(html.slice(inicio, cierre)).not.toContain('required')
  })

  it('muestra el próximo código libre con el texto y el formato exactos del relevamiento', async () => {
    const html = await renderAlta()
    expect(html).toContain(
      'El próximo código libre es el A-0043. Puede haber huecos en la numeración: es a propósito.',
    )
  })

  // El bloque de stock inicial se oculta al elegir "Servicio" — comportamiento
  // que sólo se dispara con JS (onChange), así que no se puede ejercitar
  // clickeando en un render estático (vitest.config.mts corre en entorno
  // "node", sin DOM). Se cablea leyendo el FUENTE: el radio de Servicio tiene
  // que actualizar el estado que gobierna ese bloque.
  describe('ocultar el stock inicial al elegir "Servicio" (cableado, no ejercitable sin DOM)', () => {
    const FUENTE = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')

    it('el radio de Servicio dispara setTipo("SERVICIO")', () => {
      expect(FUENTE).toMatch(/value="SERVICIO"[\s\S]{0,200}onChange=\{\(\) => setTipo\('SERVICIO'\)\}/)
    })

    it('el bloque de Stock inicial está condicionado a tipo === \'PRODUCTO\'', () => {
      expect(FUENTE).toContain("tipo === 'PRODUCTO' && (")
    })
  })

  // Barrido final del cierre del rediseño (hallazgo M2): estos campos
  // heredaban el h-8 (32px) por default de shadcn Input, y design/arandano.pen
  // (frame `App / Artículo nuevo`, nodo `LBhdp`) mide sus campos a 40px —
  // verificado en vivo con el MCP de Pencil. Sin `h-10`, la pantalla se veía
  // más baja de lo que la maqueta dibuja, y nadie lo notaba: los tests
  // existentes no miraban altura, sólo `name`/`value`.
  it('los campos del alta miden 40px (h-10), no el h-8 por default de shadcn', async () => {
    const html = await renderAlta()
    // `categoria` salió de la lista: dejó de ser un <input> — ahora son dos
    // Select. Su alto lo fija el className del SelectTrigger, que el describe
    // de los selectores cubre aparte.
    for (const campo of ['name="nombre"', 'name="sku"', 'name="precio"', 'name="facturaProveedor"']) {
      const inicio = html.lastIndexOf('<input', html.indexOf(campo))
      const cierre = html.indexOf('/>', inicio)
      expect(inicio, `no se encontró el campo ${campo}`).toBeGreaterThan(-1)
      expect(html.slice(inicio, cierre), `${campo} no mide h-10`).toContain('h-10')
    }
  })
})

describe('FichaDeArticulo', () => {
  /**
   * El defecto que este ciclo cierra: la ficha tenía un campo de TEXTO mientras
   * el alta ya elegía del árbol, así que para ponerle marca a un artículo había
   * que tipear "Fundas · Apple" con un middot que no está en el teclado, y
   * tipear sólo "Apple" creaba un rubro raíz nuevo en silencio.
   */
  it('elige la categoría del árbol y ya no la tipea', async () => {
    const html = await renderFicha('id-apple')
    expect(html).toContain('name="categoriaId"')
    expect(html).toContain('name="marcaId"')
    expect(html).not.toContain('name="categoria"')
  })

  it('precarga la rama del artículo, rubro y marca', async () => {
    const html = await renderFicha('id-apple')
    expect(html).toContain('<input type="hidden" name="categoriaId" value="id-fundas"')
    expect(html).toContain('<input type="hidden" name="marcaId" value="id-apple"')
  })

  // Nullable en el schema: un artículo sin categoría no puede romper el
  // formulario de edición.
  it('sin categoría, los dos campos quedan vacíos y no revienta', async () => {
    const html = await renderFicha(null)
    expect(html).toContain('<input type="hidden" name="categoriaId" value=""')
    expect(html).not.toContain('value="null"')
  })

  // Task 4 del rediseño: "Guardar cambios" y "Desactivar" suben al Topbar
  // (design/arandano.pen, frame `y4tEb`), pero el <form> real —con los
  // campos— sigue en el Cuerpo. El único jeroglífico que los ata es el
  // atributo HTML `form`, y fijar el NOMBRE del argumento no fija su VALOR:
  // hay que comprobar que sea el MISMO string en el botón y en el <form>.
  describe('los botones del Topbar apuntan al <form> del Cuerpo por id', () => {
    it('"Guardar cambios" referencia el id del <form> que trae el campo "nombre"', async () => {
      const html = await renderFicha(null)
      const botonGuardar = html.match(
        /<button[^>]*form="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*Guardar cambios/,
      )
      expect(
        botonGuardar,
        'no se encontró el botón "Guardar cambios" con su atributo form',
      ).not.toBeNull()
      // El <form> que edita es el único de los dos que trae el campo
      // "nombre" — el otro es el <form> oculto de baja, que sólo lleva el
      // articuloId. Buscarlo por ESE contenido, y no asumir "cualquier form
      // de la ficha", es lo que distingue apuntar al form correcto de
      // apuntar al que sea.
      const formConNombre = html.match(/<form id="([^"]+)"[^>]*>(?:(?!<\/form>)[\s\S])*name="nombre"/)
      expect(formConNombre, 'no se encontró el <form> que trae el campo nombre').not.toBeNull()
      expect(botonGuardar![1]).toBe(formConNombre![1])
    })

    it('"Desactivar" referencia el id del <form> oculto que da de baja', async () => {
      const html = await renderFicha(null, { desactivado: false })
      const botonDesactivar = html.match(
        /<button[^>]*form="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*Desactivar/,
      )
      expect(botonDesactivar, 'no se encontró el botón "Desactivar" con su atributo form').not.toBeNull()
      const formOculto = html.match(/<form id="([^"]+)"[^>]*class="hidden"/)
      expect(formOculto, 'no se encontró el <form> oculto de baja').not.toBeNull()
      expect(botonDesactivar![1]).toBe(formOculto![1])
    })

    // El id del botón de Guardar y el del form de Baja tienen que ser
    // DISTINTOS: si por error compartieran el mismo string, "Guardar cambios"
    // dispararía el <form> equivocado (o al revés).
    it('el form de editar y el form de baja no comparten id', async () => {
      const html = await renderFicha(null)
      const formularios = [...html.matchAll(/<form id="([^"]+)"/g)].map((m) => m[1])
      expect(new Set(formularios).size).toBe(formularios.length)
    })
  })

  it('reactivado (desactivado=true) el botón dice "Reactivar", no "Desactivar"', async () => {
    const html = await renderFicha(null, { desactivado: true })
    expect(html).toContain('Reactivar')
    expect(html).not.toContain('>Desactivar<')
  })

  // Minor de la review: el botón quedó con variant="destructive" fijo —antes
  // era condicional—, así que "Reactivar" salía pintado en rojo como si fuera
  // una acción destructiva.
  it('"Reactivar" NO sale en rojo (variant destructive es sólo para Desactivar)', async () => {
    const html = await renderFicha(null, { desactivado: true })
    const boton = html.match(
      /<button[^>]*data-variant="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*Reactivar/,
    )
    expect(boton, 'no se encontró el botón "Reactivar" con su data-variant').not.toBeNull()
    expect(boton![1]).not.toBe('destructive')
  })

  it('"Desactivar" sí sale en rojo (variant destructive)', async () => {
    const html = await renderFicha(null, { desactivado: false })
    const boton = html.match(
      /<button[^>]*data-variant="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*Desactivar/,
    )
    expect(boton, 'no se encontró el botón "Desactivar" con su data-variant').not.toBeNull()
    expect(boton![1]).toBe('destructive')
  })

  // Sin puedeEditar no hay nada que editar ni que desactivar: ni el botón del
  // Topbar, ni el <form> oculto de baja, ni la card "Datos".
  it('sin puedeEditar no renderiza ninguna acción de edición', async () => {
    const html = await renderFicha(null, { puedeEditar: false })
    expect(html).not.toContain('Guardar cambios')
    expect(html).not.toContain('Desactivar')
    expect(html).not.toContain('Datos')
    expect(html).not.toMatch(/<form id="form-baja-articulo"/)
  })

  // Minor de la review: un EMPLEADO (puedeEditar=false) mirando un SERVICIO (sin
  // columnaDerechaExtra, que sólo arma page.tsx para un producto) se quedaba
  // sin "Datos" y sin "Cómo se movió", pero el <div> de 324 px seguía
  // reservando el hueco vacío igual. La columna entera tiene que desaparecer,
  // no sólo su contenido.
  it('sin nada que mostrar a la derecha, la columna de 324 px no se renderiza', async () => {
    const html = await renderFicha(null, { puedeEditar: false })
    expect(html).not.toContain('w-[324px]')
  })

  it('con puedeEditar, la columna de 324 px sí aparece (trae la card "Datos")', async () => {
    const html = await renderFicha(null, { puedeEditar: true })
    expect(html).toContain('w-[324px]')
  })

  it('la columna izquierda que arma page.tsx se renderiza tal cual', async () => {
    const html = await renderFicha(null)
    expect(html).toContain('columna izquierda')
  })

  // Mismo hallazgo M2 que FormularioDeAlta: los campos de la card "Datos"
  // heredaban el h-8 por default en vez de los 40px que mide el .pen.
  it('los campos de "Datos" miden 40px (h-10)', async () => {
    const html = await renderFicha('id-apple')
    for (const campo of ['name="nombre"', 'name="precio"', 'name="sku"']) {
      const inicio = html.lastIndexOf('<input', html.indexOf(campo))
      const cierre = html.indexOf('/>', inicio)
      expect(inicio, `no se encontró el campo ${campo}`).toBeGreaterThan(-1)
      expect(html.slice(inicio, cierre), `${campo} no mide h-10`).toContain('h-10')
    }
  })
})

describe('MoverStock', () => {
  async function renderMoverStock(puedeCostos = true) {
    const { MoverStock } = await import('./formularios')
    return renderToStaticMarkup(<MoverStock articuloId="a1" puedeCostos={puedeCostos} />)
  }

  // Mismo hallazgo M2: "Ingresar mercadería" y "Corregir por conteo" son las
  // otras dos cards de esta pantalla con campos de texto, y ninguna
  // declaraba su altura — heredaban el h-8 por default de shadcn Input.
  it('los campos de las dos cards miden 40px (h-10)', async () => {
    const html = await renderMoverStock()
    for (const campo of [
      'name="cantidad"', 'name="costoUnitario"', 'name="nota"', 'name="stockContado"',
    ]) {
      const inicio = html.lastIndexOf('<input', html.indexOf(campo))
      const cierre = html.indexOf('/>', inicio)
      expect(inicio, `no se encontró el campo ${campo}`).toBeGreaterThan(-1)
      expect(html.slice(inicio, cierre), `${campo} no mide h-10`).toContain('h-10')
    }
  })
})

// Minor de la review: BotonExportarCsv no se renderizaba en ningún test. La
// descarga en sí (Blob, appendChild, click(), revokeObjectURL) no se puede
// ejercitar con renderToStaticMarkup —no hay DOM en el entorno "node" de
// vitest, y este repo no suma jsdom sólo para esto (ver el minor de la
// dependencia muerta)—, así que el render estático cubre lo que sí se puede
// (que exista, con su texto inicial) y el resto se ata leyendo el FUENTE,
// mismo criterio que ya usa este archivo para "ocultar el stock inicial".
describe('BotonExportarCsv', () => {
  it('se renderiza con su texto inicial, sin disparar la exportación', async () => {
    const { BotonExportarCsv } = await import('./formularios')
    const html = renderToStaticMarkup(<BotonExportarCsv articuloId="a1" />)
    expect(html).toContain('Exportar CSV →')
    expect(html).not.toContain('Exportando…')
  })
})

describe('la descarga del CSV: inserta el <a> en el DOM y difiere el revoke (minor de la review)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')

  // Sin esto, Safari no dispara la descarga de un <a download> al que nunca
  // se le hizo appendChild — "la forma canónica de la descarga que no hace
  // nada en Safari" (texto literal del hallazgo).
  it('inserta el <a> en el DOM con appendChild antes de clickearlo', () => {
    expect(FUENTE).toContain('document.body.appendChild(enlace)')
  })

  // revokeObjectURL sincrónico justo después del click() puede ganarle a la
  // descarga que el navegador todavía no arrancó del todo.
  it('revoca la URL en el siguiente tick (setTimeout), no sincrónicamente tras el click', () => {
    expect(FUENTE).toMatch(
      /enlace\.click\(\)[\s\S]{0,400}setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 0\)/,
    )
  })
})

/**
 * Task 7 del ciclo móvil (design/arandano.pen, frames `m34Naf`/`T5gME`): las
 * acciones del Topbar se repiten al pie en el teléfono, atadas al MISMO
 * `<form>`/`useActionState` que el botón de escritorio — ver el docblock de
 * `FichaDeArticulo` sobre por qué es un solo componente.
 */
describe('el pie del teléfono repite las acciones del Topbar (Task 7 del ciclo móvil)', () => {
  it('FormularioDeAlta: "Guardar artículo" y "Cancelar" aparecen dos veces', async () => {
    const html = await renderAlta()
    expect([...html.matchAll(/Guardar artículo/g)]).toHaveLength(2)
    expect([...html.matchAll(/>Cancelar</g)]).toHaveLength(2)
  })

  // El botón del Topbar vive dentro de `acciones`, que el propio `Encabezado`
  // envuelve en `hidden lg:flex` — acá sólo se afirma que el pie NUEVO es
  // `lg:hidden` y no al revés.
  it('FormularioDeAlta: el pie nuevo es lg:hidden', () => {
    const FUENTE = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
    expect(FUENTE).toMatch(/border-t bg-card p-\[14px\] lg:hidden/)
  })

  // El mismo `pendiente` gobierna los dos: si alguien partiera el pie a otro
  // componente con su propio useActionState, este caso lo detecta.
  it('FormularioDeAlta: "disabled={pendiente}" aparece dos veces (Topbar y pie)', () => {
    const FUENTE = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
    const inicio = FUENTE.indexOf('export function FormularioDeAlta')
    const fin = FUENTE.indexOf('export function FichaDeArticulo')
    const cuerpo = FUENTE.slice(inicio, fin)
    expect([...cuerpo.matchAll(/disabled=\{pendiente\}/g)]).toHaveLength(2)
  })

  it('FichaDeArticulo: "Guardar cambios" y "Desactivar" aparecen dos veces, con el mismo form=', async () => {
    const html = await renderFicha(null)
    const guardar = [...html.matchAll(/form="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Guardar cambios/g)]
    expect(guardar).toHaveLength(2)
    expect(new Set(guardar.map((m) => m[1])).size).toBe(1)

    const desactivar = [...html.matchAll(/form="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Desactivar/g)]
    expect(desactivar).toHaveLength(2)
    expect(new Set(desactivar.map((m) => m[1])).size).toBe(1)
  })

  // Mismo criterio que arriba: el mismo `editando`/`dandoBaja` (el `pendiente`
  // de cada uno de los dos useActionState de FichaDeArticulo) tiene que
  // gobernar los DOS botones de cada acción.
  it('FichaDeArticulo: "disabled={editando}" y "disabled={dandoBaja}" aparecen dos veces cada uno', () => {
    const FUENTE = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
    const inicio = FUENTE.indexOf('export function FichaDeArticulo')
    const fin = FUENTE.indexOf('export function MoverStock')
    const cuerpo = FUENTE.slice(inicio, fin)
    expect([...cuerpo.matchAll(/disabled=\{editando\}/g)]).toHaveLength(2)
    expect([...cuerpo.matchAll(/disabled=\{dandoBaja\}/g)]).toHaveLength(2)
  })

  // Cuidado con los id duplicados (brief): los botones del pie repiten
  // `form=`, nunca `id=` — sólo tiene que haber dos <form id="..."> en toda
  // la ficha (el de editar y el oculto de baja), nunca un tercero por los
  // botones del pie.
  it('FichaDeArticulo: los botones del pie no agregan ningún <form> ni id nuevo', async () => {
    const html = await renderFicha(null)
    const formularios = [...html.matchAll(/<form id="([^"]+)"/g)].map((m) => m[1])
    expect(formularios).toHaveLength(2)
    expect(new Set(formularios).size).toBe(2)
  })

  it('sin puedeEditar, el pie del teléfono tampoco se renderiza', async () => {
    const html = await renderFicha(null, { puedeEditar: false })
    expect(html).not.toMatch(/border-t bg-card p-\[14px\] lg:hidden/)
  })

  // El riesgo propio del merge con el ciclo de permisos (2026-08-26): los
  // botones de esta pantalla están DUPLICADOS —Topbar (`hidden lg:flex`) y
  // pie del teléfono (`lg:hidden`)—, y el permiso `ARTICULOS_EDITAR` llegó
  // cuando existía una sola copia. Gatear sólo la de escritorio dejaba a un
  // empleado sin el permiso con "Desactivar" y "Guardar cambios" a mano en el
  // teléfono, con el gate entero en verde.
  //
  // Este caso cuenta las DOS copias en las dos direcciones: con el permiso
  // tienen que estar las dos, sin el permiso ninguna. Un `puedeEditar` que
  // gatee una sola lo rompe (daría 1 y no 0, o 1 y no 2).
  it('las DOS copias de cada botón las gobierna el mismo puedeEditar', async () => {
    const con = await renderFicha(null, { puedeEditar: true })
    const sin = await renderFicha(null, { puedeEditar: false })
    for (const etiqueta of ['Guardar cambios', 'Desactivar']) {
      expect([...con.matchAll(new RegExp(etiqueta, 'g'))]).toHaveLength(2)
      expect([...sin.matchAll(new RegExp(etiqueta, 'g'))]).toHaveLength(0)
    }
  })
})

describe('atras="/inventario" y sin accionMovil (Task 7 del ciclo móvil, spec §7.4)', () => {
  it('FormularioDeAlta vuelve a /inventario desde la ranura izquierda del teléfono', async () => {
    const html = await renderAlta()
    // La etiqueta se extrae y DESPUÉS se afirma el href, en vez de un
    // regex que fije el orden de los atributos: desde que <Encabezado>
    // navega con `Link` de Next (hallazgo I3 de la review final), el href
    // sale último y no primero. Mismo mecanismo que ya usaba
    // components/shell/encabezado.test.tsx para la variante <button>.
    const volver = html.match(/<a[^>]*aria-label="Volver"[^>]*>/)?.[0]
    expect(volver, `no se encontró la flecha de volver en: ${html}`).toBeTruthy()
    expect(volver).toContain('href="/inventario"')
  })

  it('FichaDeArticulo vuelve a /inventario desde la ranura izquierda del teléfono', async () => {
    const html = await renderFicha(null)
    // La etiqueta se extrae y DESPUÉS se afirma el href, en vez de un
    // regex que fije el orden de los atributos: desde que <Encabezado>
    // navega con `Link` de Next (hallazgo I3 de la review final), el href
    // sale último y no primero. Mismo mecanismo que ya usaba
    // components/shell/encabezado.test.tsx para la variante <button>.
    const volver = html.match(/<a[^>]*aria-label="Volver"[^>]*>/)?.[0]
    expect(volver, `no se encontró la flecha de volver en: ${html}`).toBeTruthy()
    expect(volver).toContain('href="/inventario"')
  })

  // El frame T5gME dibuja un `more-vertical`, pero sus dos acciones ya están
  // al pie y las secundarias ya están en el cuerpo: no pasarlo es una
  // decisión ya tomada (spec §7.4), no un olvido. Se verifica por RENDER real
  // y no por FUENTE: si algo agregara accionMovil algún día, este caso lo
  // detecta aunque no toque la línea del <Encabezado>.
  it('la ficha no ofrece ninguna acción del teléfono además de "Volver"', async () => {
    const html = await renderFicha(null)
    const etiquetas = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1])
    expect(etiquetas).toEqual(['Volver'])
  })
})

describe('las tarjetas y las columnas pasan a flex-col lg:flex-row (Task 7 del ciclo móvil)', () => {
  it('Producto/Servicio se apilan en el teléfono y quedan lado a lado en escritorio', async () => {
    const html = await renderAlta()
    expect(html).toMatch(/class="flex flex-col gap-3 lg:flex-row"/)
  })

  it('las dos columnas del alta (contenido + Stock inicial) se apilan en el teléfono', async () => {
    const html = await renderAlta()
    expect(html).toMatch(/class="flex flex-col gap-3 p-\[14px\] lg:flex-row lg:items-start lg:gap-4 lg:p-6"/)
  })

  it('las dos columnas de la ficha (columnaIzquierda + Datos/Gráfico) se apilan en el teléfono', async () => {
    const html = await renderFicha(null)
    expect(html).toMatch(/class="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4"/)
  })
})

describe('el selector de moneda está en las DOS pantallas', () => {
  const fuente = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')

  // El punto entero de esta task: si alguna pantalla arma su propio Select en
  // vez de instanciar el componente compartido, este caso lo detecta. Cuenta
  // apariciones, no compara un string armado a mano con las dos etiquetas
  // adentro, porque lo que importa es que existan las DOS, no en qué orden
  // caen los atributos de cada tag.
  it('lo instancian el alta y la ficha, y ninguna arma su propio Select', () => {
    const apariciones = fuente.match(/<SelectorDeMoneda/g) ?? []
    expect(apariciones).toHaveLength(2)
  })

  // Separado del caso de arriba a propósito: congelar el ORDEN de atributos en
  // un único string es la clase de aserción que se rompe con un reformateo
  // cosmético y se termina ignorando. Acá cada expectativa se limita a lo que
  // de verdad distingue a una pantalla de la otra.
  it('el alta arranca en pesos', () => {
    expect(fuente).toContain('<SelectorDeMoneda id="moneda" name="moneda" valorInicial="ARS"')
  })

  it('la ficha precarga la moneda del artículo', () => {
    expect(fuente).toContain('<SelectorDeMoneda id="e-moneda" name="moneda" valorInicial={moneda}')
  })
})

describe('SelectorDeMoneda', () => {
  it('avisa al pasar de pesos a dólares, porque el número no se reinterpreta solo', () => {
    const html = renderToStaticMarkup(<SelectorDeMoneda id="m" name="moneda" valorInicial="USD" />)
    expect(html).toContain('name="moneda"')
    expect(html).toContain('value="USD"')
  })

  it('el campo compuesto mide 9 px en las esquinas externas', () => {
    // design/arandano.pen, nodos `UI6JI` (alta) y `eKwLI` (ficha): [9,0,0,9]
    // en el selector y [0,9,9,0] en el input. El default de shadcn
    // (`rounded-lg`, 10 px con --radius: 0.625rem) dejaba a este campo como el
    // único del formulario con un radio distinto del de sus vecinos, que ya
    // escriben rounded-[9px] explícito.
    const html = renderToStaticMarkup(<SelectorDeMoneda id="m" name="moneda" valorInicial="ARS" />)
    expect(html).toContain('rounded-l-[9px]')

    const fuente = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
    const derechos = fuente.match(/rounded-l-none rounded-r-\[9px\]/g) ?? []
    // Las DOS copias, el alta y la ficha: la lección del ciclo del 2026-08-28
    // es que este campo ya divergió una vez entre las dos pantallas.
    expect(derechos).toHaveLength(2)
  })
})
