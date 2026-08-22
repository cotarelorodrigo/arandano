import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

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
}))

async function renderAlta() {
  const { FormularioDeAlta } = await import('./formularios')
  return renderToStaticMarkup(<FormularioDeAlta proximoSku="A-0043" />)
}

async function renderFicha(
  categoria: string | null,
  extra: Partial<{ desactivado: boolean; esDuenio: boolean }> = {},
) {
  const { FichaDeArticulo } = await import('./formularios')
  return renderToStaticMarkup(
    <FichaDeArticulo
      titulo="Vidrio templado 9H"
      subtitulo="SKU 000412 · Producto"
      articuloId="a1"
      nombre="Vidrio templado 9H"
      sku="000412"
      precio="12000"
      categoria={categoria}
      desactivado={extra.desactivado ?? false}
      esDuenio={extra.esDuenio ?? true}
      columnaIzquierda={<div>columna izquierda</div>}
    />,
  )
}

describe('FormularioDeAlta', () => {
  // Task 1 del rediseño: Articulo.categoria existe en el schema y nadie la
  // escribe todavía. La maqueta la muestra en el listado y en la ficha pero
  // no en este formulario — a propósito se aparta acá: un campo que se
  // muestra y no se puede cargar nace siempre vacío.
  it('tiene un campo de categoría, y es opcional', () => {
    return renderAlta().then((html) => {
      expect(html).toContain('name="categoria"')
      expect(html).not.toMatch(/name="categoria"[^>]*required/)
    })
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
    expect(html).not.toContain('<select')
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
})

describe('FichaDeArticulo', () => {
  it('tiene un campo de categoría prellenado con el valor actual', async () => {
    const html = await renderFicha('Accesorios · Protección')
    expect(html).toContain('name="categoria"')
    expect(html).toContain('value="Accesorios · Protección"')
  })

  // Nullable en el schema: un artículo sin categoría no puede romper el
  // formulario de edición.
  it('sin categoría, el campo queda vacío y no revienta', async () => {
    const html = await renderFicha(null)
    expect(html).toContain('name="categoria"')
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

  // Sin esDuenio no hay nada que editar ni que desactivar: ni el botón del
  // Topbar, ni el <form> oculto de baja, ni la card "Datos".
  it('sin esDuenio no renderiza ninguna acción de edición', async () => {
    const html = await renderFicha(null, { esDuenio: false })
    expect(html).not.toContain('Guardar cambios')
    expect(html).not.toContain('Desactivar')
    expect(html).not.toContain('Datos')
    expect(html).not.toMatch(/<form id="form-baja-articulo"/)
  })

  it('la columna izquierda que arma page.tsx se renderiza tal cual', async () => {
    const html = await renderFicha(null)
    expect(html).toContain('columna izquierda')
  })
})
