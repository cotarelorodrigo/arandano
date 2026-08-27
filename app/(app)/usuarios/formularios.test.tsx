import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UsuarioDeFila } from './fila-acciones'

// Mismo criterio que app/(app)/inventario/formularios.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza la pantalla. fila-acciones.tsx importa
// el MISMO módulo (misma ruta relativa './acciones', mismo archivo), así que
// este único mock alcanza para todo el árbol de CuerpoUsuarios.
vi.mock('./acciones', () => ({
  altaEmpleado: vi.fn(),
  nuevaClave: vi.fn(),
  baja: vi.fn(),
  alta: vi.fn(),
  cambiarPermiso: vi.fn(),
}))

async function renderAlta() {
  const { AltaDeEmpleado } = await import('./formularios')
  return renderToStaticMarkup(<AltaDeEmpleado onClaveGenerada={() => {}} />)
}

describe('AltaDeEmpleado', () => {
  it('tiene los cuatro campos con sus rótulos', async () => {
    const html = await renderAlta()
    expect(html).toContain('Nombre y apellido')
    expect(html).toContain('Mail')
    expect(html).toContain('Rol')
    expect(html).toContain('Contraseña inicial')
  })

  it('el placeholder de la contraseña inicial pide 8 caracteres', async () => {
    const html = await renderAlta()
    expect(html).toContain('placeholder="mínimo 8 caracteres"')
  })

  it('el botón lleva el ícono user-plus y el texto "Agregar al equipo"', async () => {
    const html = await renderAlta()
    expect(html).toContain('Agregar al equipo')
    expect(html).toContain('<svg')
  })

  // El control segmentado de Rol (design/arandano.pen, nodo `iotGr`): dos
  // pastillas, "Empleado" seleccionado por default. data-state lo pone Radix
  // en el propio render de servidor a partir de `value` — no hace falta
  // simular ningún click para verificar el estado INICIAL.
  it('el rol es un control segmentado con "Empleado" preseleccionado', async () => {
    const html = await renderAlta()
    expect(html).toContain('Empleado')
    expect(html).toContain('Dueño')
    // No hay <select> nativo: la maqueta lo reemplaza por el toggle group.
    expect(html).not.toContain('<select')
    // data-state lo pone Radix a partir del `value` controlado — comprobar
    // que el botón "Empleado" quede en "on" y "Dueño" en "off" (no sólo que
    // los dos textos existan) es lo que de verdad prueba "preseleccionado".
    expect(html).toMatch(/data-state="on"[^>]*>Empleado</)
    expect(html).toMatch(/data-state="off"[^>]*>Dueño</)
  })

  it('el value oculto que viaja al FormData empieza en EMPLEADO', async () => {
    const html = await renderAlta()
    expect(html).toMatch(/name="rol"\s+value="EMPLEADO"/)
  })

  // I3 de la review final: el botón "Agregar persona" del Topbar (page.tsx)
  // apunta a `#alta`. Esta card es su único destino posible, así que el id
  // tiene que estar de verdad en el markup, no sólo en el fuente.
  it('la card lleva id="alta": es el destino del botón del Topbar', async () => {
    const html = await renderAlta()
    expect(html).toContain('id="alta"')
  })

  // Task 10 del ciclo móvil (frame `NIyHG`, nodo `Q5UJWP`): el header de la
  // card en el teléfono usa el padding [12,14] del frame, el de escritorio
  // (13/18) no se toca — CardConEncabezado es compartido con "El equipo del
  // local", así que este único caso alcanza para las dos cards.
  it('el header de la card usa el padding del teléfono, sin tocar el de escritorio (Task 10)', async () => {
    const html = await renderAlta()
    expect(html).toContain('class="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]"')
  })

  // Nodo `rodaD` (Contenido): gap 12, padding 14 en el teléfono; el
  // desktop (gap 14, padding 18) es el que ya tenía el formulario.
  it('el formulario usa el gap/padding del teléfono, sin tocar los de escritorio (Task 10)', async () => {
    const html = await renderAlta()
    expect(html).toContain('class="flex flex-col gap-3 p-[14px] lg:gap-[14px] lg:p-[18px]"')
  })

  // Ronda de arreglos 1 (Importante 3): "Agregar al equipo" (nodo `FDeDS`)
  // seguía con los valores de escritorio (`UQcir`) sin `lg:`.
  it('el botón "Agregar al equipo" mide 48px/radio 11/gap 8 en el teléfono, 38px/radio 9/gap 6 en escritorio', async () => {
    const html = await renderAlta()
    expect(html).toContain('h-12')
    expect(html).toContain('rounded-[11px]')
    expect(html).toContain('gap-2')
    expect(html).toContain('lg:h-[38px]')
    expect(html).toContain('lg:rounded-[9px]')
    expect(html).toContain('lg:gap-1.5')
  })
})

/**
 * `CardEquipo` (Task 10 del ciclo móvil): el patrón grid + display:contents
 * de la Task 4 (ver el docblock de `Listado` en app/(app)/ventas/page.tsx),
 * con dos particularidades propias de esta pantalla:
 *
 * - Un avatar nuevo, sólo en el teléfono (`lg:hidden`): el escritorio nunca
 *   mostró un avatar en la columna Persona y no puede empezar a mostrarlo
 *   ahora ("el escritorio no puede cambiar de aspecto").
 * - A diferencia de app/(app)/servicio-tecnico/page.tsx (que tiene que
 *   DUPLICAR su chip de estado porque el orden de columnas de escritorio no
 *   coincide con el orden que pide el teléfono), acá el orden de escritorio
 *   —Persona, Rol, Estado, Acciones— YA es el orden que el teléfono necesita
 *   (nombre+mail, después chip de rol, chip de estado y las acciones, en ese
 *   orden). Rol, Estado y Acciones se agrupan en un envoltorio `lg:contents`
 *   propio (la "línea de chips" del teléfono) sin que haga falta duplicar
 *   ninguna celda.
 */
describe('CardEquipo: el patrón grid + display:contents (Task 10)', () => {
  const USUARIOS: UsuarioDeFila[] = [
    {
      id: 'u1',
      nombre: 'Florencia Díaz',
      email: 'flor@celularesflor.com.ar',
      rol: 'DUENO',
      desactivadoEn: null,
    },
    {
      id: 'u4',
      nombre: 'Nahuel Ríos',
      email: 'nahuel@celularesflor.com.ar',
      rol: 'EMPLEADO',
      desactivadoEn: new Date('2026-01-01'),
    },
  ]

  async function render() {
    const { CardEquipo } = await import('./formularios')
    return renderToStaticMarkup(
      <CardEquipo
        usuarios={USUARIOS}
        usuarioActualId="u1"
        permisosPorUsuario={{ u4: ['VENTAS_ANULAR', 'COSTOS'] }}
        onClaveGenerada={() => {}}
      />,
    )
  }

  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 5 en escritorio', async () => {
    const html = await render()
    expect(html).toContain('role="table"')
    // Cinco pistas desde el ciclo de permisos por usuario (2026-08-26):
    // "Permisos" (140px, la misma anchura que declaraba su <TableHead> en
    // origin/main) entra entre Estado y Acciones.
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[1fr_112px_118px_140px_180px\]/)
  })

  it('el encabezado está oculto en el teléfono y se disuelve en escritorio, con 5 columnheader', async () => {
    const html = await render()
    expect(html).toContain('role="row" class="hidden lg:contents"')
    expect(html.match(/role="columnheader"/g)).toHaveLength(5)
    expect(html).toContain('Permisos')
  })

  it('toda fila de datos lleva lg:contents y role="row", con 5 celdas cada una', async () => {
    const html = await render()
    const filas = html.match(/role="row" class="[^"]*"/g) ?? []
    // El encabezado + las 2 filas de datos.
    expect(filas).toHaveLength(3)
    for (const fila of filas) expect(fila).toContain('lg:contents')
    // 5 columnas × 2 filas. La celda de "Permisos" cuenta también en la fila
    // del DUEÑO, que no lleva switches: con `lg:contents` sobre la fila, una
    // celda salteada correría todas las columnas siguientes de ESA fila.
    expect(html.match(/role="cell"/g)).toHaveLength(10)
  })

  it('la fila resalta al pasar el mouse en escritorio: group + group-hover en las 4 celdas', async () => {
    const html = await render()
    const filasDeDatos = html.match(/role="row" class="group [^"]*"/g) ?? []
    expect(filasDeDatos).toHaveLength(2)
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(10)
    for (const celda of celdas) {
      expect(celda).toContain('lg:group-hover:bg-muted/50')
      expect(celda).toContain('lg:transition-colors')
    }
  })

  it('el borde entre filas vive en cada celda, apagado sólo en la última fila (escritorio)', async () => {
    const html = await render()
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    for (const celda of celdas) expect(celda).toContain('lg:border-b')
    const conGroupLast = celdas.filter((c) => c.includes('lg:group-last:border-b-0'))
    expect(conGroupLast).toHaveLength(celdas.length)
  })

  it('en el teléfono, cada fila muestra un avatar circular con la inicial del nombre, oculto en escritorio', async () => {
    const html = await render()
    // size-[34px] + lg:hidden es una combinación propia del avatar: ningún
    // chip de esta fila mide 34px.
    const avatares = html.match(/class="[^"]*size-\[34px\][^"]*lg:hidden[^"]*"/g) ?? []
    expect(avatares).toHaveLength(2)
    expect(html).toMatch(/>F<\/span>/) // Florencia
    expect(html).toMatch(/>N<\/span>/) // Nahuel
  })

  it('no hay contenido duplicado: cada chip aparece una sola vez por fila (a diferencia de servicio-tecnico)', async () => {
    const html = await render()
    expect(html.match(/>Dueño</g)).toHaveLength(1)
    expect(html.match(/>Activo</g)).toHaveLength(1)
    expect(html.match(/>Desactivado</g)).toHaveLength(1)
  })

  it('la fila fusiona rol, estado y acciones en el mismo envoltorio (línea de chips del teléfono)', async () => {
    const html = await render()
    // Dos filas -> dos envoltorios "línea de chips" (Rol+Estado+Acciones).
    const lineas = html.match(/class="flex flex-wrap items-center gap-1\.5 lg:contents"/g) ?? []
    expect(lineas).toHaveLength(2)
  })

  // El .pen manda incluso sobre el checklist de la task, que no lo
  // mencionaba: el nodo `hfAYV` ("Chips") dibuja un separador "·" antes de
  // las acciones en las TRES filas del ejemplo ("· Cambiar clave", "·
  // Cambiar clave · Baja", "· Reactivar"). Sólo en el teléfono — en
  // escritorio esta celda nunca llevó separador.
  it('el separador "·" aparece antes de las acciones, sólo en el teléfono (nodo hfAYV)', async () => {
    const html = await render()
    const separadores = html.match(/<span aria-hidden="true" class="[^"]*lg:hidden[^"]*">·<\/span>/g) ?? []
    // Uno por fila antes de las acciones (2), más el de la celda "Permisos"
    // de la única fila de EMPLEADO — el disparador se funde en esa misma
    // línea y paga el mismo separador.
    expect(separadores).toHaveLength(3)
  })

  it('las acciones de fila siguen ahí: "Cambiar clave" para uno mismo, "Reactivar" para el desactivado', async () => {
    const html = await render()
    // u1 (Florencia) es "esUnoMismo": sólo "Cambiar clave", sin "Baja".
    // u4 (Nahuel) está desactivado: sólo "Reactivar".
    expect(html).toContain('Cambiar clave')
    expect(html).toContain('Reactivar')
    expect(html).not.toContain('Baja')
  })

  /**
   * La columna "Permisos" (ciclo de permisos por usuario, 2026-08-26),
   * fundida en la fila del teléfono por el merge de los dos ciclos. Lo que
   * estos casos cuidan es lo que ninguno de los dos lados podía cuidar solo:
   * que la columna nueva respete el patrón grid + `display:contents`, y que
   * en el teléfono viva en la línea de acciones con UN SOLO nodo en el DOM.
   */
  describe('la columna "Permisos"', () => {
    it('el disparador muestra el conteo del empleado, y el dueño no lleva ninguno', async () => {
      const html = await render()
      expect(html).toContain('2 de 6 permisos')
      // Un dueño puede todo por construcción: su celda queda vacía.
      expect(html.match(/permisos</g) ?? []).toHaveLength(1)
      expect(html).not.toContain('Sin permisos')
    })

    it('en el teléfono el disparador se funde en la línea de acciones, sin duplicar el nodo', async () => {
      const html = await render()
      // Un solo nodo: el mismo <button> sirve a los dos anchos. Si alguien
      // duplicara la celda (una `lg:hidden` y otra `hidden lg:flex`), el
      // conteo aparecería dos veces.
      expect(html.match(/2 de 6 permisos/g) ?? []).toHaveLength(1)
      // Y vive DENTRO del envoltorio "línea de chips" del teléfono, o sea
      // después del chip de estado y antes de las acciones.
      const linea = html.indexOf('flex flex-wrap items-center gap-1.5 lg:contents')
      expect(linea).toBeGreaterThan(-1)
      expect(html.indexOf('2 de 6 permisos')).toBeGreaterThan(linea)
      expect(html.indexOf('Reactivar')).toBeGreaterThan(html.indexOf('2 de 6 permisos'))
    })

    it('en el teléfono el disparador paga el mismo tratamiento que los links de acciones (10px), y en escritorio el botón de siempre', async () => {
      const html = await render()
      const desde = html.lastIndexOf('<button', html.indexOf('2 de 6 permisos'))
      const boton = html.slice(desde, html.indexOf('>', desde))
      // Teléfono: 10px, semibold, --primary, sin fondo — igual que ENLACE
      // (fila-acciones.tsx).
      expect(boton).toContain('text-[10px]')
      expect(boton).toContain('font-semibold')
      expect(boton).toContain('text-primary')
      // Escritorio: exactamente lo que pintaban size="sm" + variant="ghost"
      // en origin/main.
      expect(boton).toContain('lg:h-7')
      expect(boton).toContain('lg:px-2.5')
      expect(boton).toContain('lg:text-[0.8rem]')
      expect(boton).toContain('lg:font-medium')
      expect(boton).toContain('lg:hover:bg-muted')
    })

    it('la celda del dueño desaparece del teléfono pero sigue ocupando su pista en escritorio', async () => {
      const html = await render()
      const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
      const ocultas = celdas.filter((c) => /class="[^"]*\bhidden\b[^"]*lg:block/.test(c))
      // Exactamente una: la celda "Permisos" de la fila del DUEÑO.
      expect(ocultas).toHaveLength(1)
    })

    it('la celda con contenido centra con envoltorio, nunca con self-center', async () => {
      const html = await render()
      expect(html).not.toContain('self-center')
      // Rol, Estado y Permisos: tres celdas más cortas que "Persona", las
      // tres con el mismo envoltorio de centrado.
      const envoltorios = html.match(/class="lg:flex lg:h-full lg:items-center"/g) ?? []
      expect(envoltorios.length).toBeGreaterThanOrEqual(5)
    })
  })
})

/**
 * Ronda de arreglos 1 (Importante 1): `CardReglas` había quedado como un
 * bloque plano (`gap-[9px] p-[18px]`, sin un solo `lg:`) mientras el nodo
 * móvil `gfLvS` la rediseña entera: encabezado separado por borde (`SgnAN`,
 * padding [12,14]) + Contenido (`n1mqsf`, gap 12, padding 14), con el ícono
 * en `$ar-ok` (no `$ar-primary`) a 15px. Exportada, mismo criterio que
 * `CardEquipo`.
 */
describe('CardReglas: la card se rediseña entera en el teléfono (Ronda de arreglos 1)', () => {
  async function render() {
    const { CardReglas } = await import('./formularios')
    return renderToStaticMarkup(<CardReglas />)
  }

  it('el encabezado usa el padding del teléfono (12/14), con borde — el mismo patrón que las otras dos cards', async () => {
    const html = await render()
    expect(html).toContain('border-b px-[14px] py-3')
  })

  it('el título paga Archivo/14/600 en el teléfono, y sigue sin Archivo/13/700 en escritorio (invierte la excepción)', async () => {
    const html = await render()
    expect(html).toContain('Dos reglas que el sistema no deja romper')
    // No se puede afirmar el font-family final (viene de un CSS module con
    // @media adentro, y vitest corre con css:false — ver el comentario del
    // propio módulo), pero si el h2 no lleva NINGUNA clase del módulo
    // (fabricada por el Proxy, con guion bajo), es que el JSX dejó de
    // importar `estilos` para este título.
    const h2 = html.match(/<h2[^>]*>Dos reglas que el sistema no deja romper<\/h2>/)?.[0] ?? ''
    expect(h2).toMatch(/class="_/)
  })

  // Ronda de arreglos 2 (CRÍTICO): la Ronda 1 reusó CardConEncabezado tal
  // cual y esta card heredó su `border-b` y su padding [13,18] — que en el
  // nodo de escritorio `U7ROu` NO existen (frame plano: título y puntos
  // como hermanos directos, sin sub-frame de encabezado). Ninguno de los
  // tests de la Ronda 1 lo atrapó porque todos verificaban PRESENCIA de
  // clases nuevas, nunca la AUSENCIA de las viejas en escritorio — el propio
  // revisor corrió esa suite con la regresión adentro y dio todo en verde.
  // Este caso verifica la ausencia de verdad: el borde y el padding [13,18]
  // de las otras dos cards están CANCELADOS acá, con su propio contrapeso.
  it('en escritorio, el header de "Dos reglas" NO lleva borde ni el padding [13,18] — reconstruye el frame plano de U7ROu', async () => {
    const html = await render()
    // El único <div> de esta card con "items-center justify-between" es el
    // header (el resto son "Punto" o el contenedor de contenido).
    const header = html.match(/<div class="flex items-center justify-between[^"]*">/)?.[0] ?? ''
    expect(header).not.toBe('')
    // El borde SIGUE presente para el teléfono (mobile-first)...
    expect(header).toContain('border-b')
    // ...pero cancelado en escritorio, a diferencia de "El equipo del
    // local"/"Agregar a alguien" (ver el caso de AltaDeEmpleado más arriba,
    // que exige EXACTAMENTE `lg:py-[13px]` sin ninguna cancelación de borde).
    expect(header).toContain('lg:border-b-0')
    // Y el padding vertical de escritorio de las otras dos cards (13px
    // arriba Y abajo) NO aparece acá — el de esta card es asimétrico
    // (18 arriba, 0 abajo, el resto lo pone el gap del contenedor raíz).
    expect(header).not.toContain('lg:py-[13px]')
    expect(header).toContain('lg:pt-[18px]')
    expect(header).toContain('lg:pb-0')
  })

  // El "salto de 9px" entre el título y el primer punto, reconstruido en
  // escritorio a través de TRES piezas que tienen que sumar exactamente 9 y
  // no otro número: el pb-0 del header (arriba), el gap-9 del contenedor
  // raíz (en el medio) y el pt-0 del contenido (abajo). Si cualquiera de las
  // tres volviera a tener su propio padding vertical, el salto real dejaría
  // de ser 9px sin que ningún test de "presencia de clase" lo notara.
  it('el contenedor raíz suma el gap-9 que falta entre el header (plano) y el contenido, sólo en escritorio', async () => {
    const html = await render()
    // El contenedor raíz de la card entera: el primer <div> con
    // "rounded-2xl border bg-card" (CardConEncabezado).
    const raiz = html.match(/<div class="flex flex-col overflow-hidden rounded-2xl border bg-card[^"]*">/)?.[0] ?? ''
    expect(raiz).not.toBe('')
    expect(raiz).toContain('lg:gap-[9px]')
  })

  it('el contenido pasa a gap 12/padding 14 en el teléfono; en escritorio NO repite el padding de arriba (ya lo puso el header)', async () => {
    const html = await render()
    expect(html).toContain('gap-3 p-[14px]')
    expect(html).toContain('lg:gap-[9px]')
    expect(html).toContain('lg:px-[18px]')
    expect(html).toContain('lg:pb-[18px]')
    // El punto crítico: SIN `lg:pt-0`, el contenido sumaría sus propios 18px
    // de arriba a los 18+9 que ya pone el header+gap, y el salto real
    // dejaría de ser 9px — exactamente el defecto que esta ronda corrige.
    expect(html).toContain('lg:pt-0')
    // Y el viejo `lg:p-[18px]` de la Ronda 1 (padding parejo en las 4
    // direcciones) no puede seguir ahí: es lo que reintroducía el padding de
    // arriba que el header+gap ya cubren.
    expect(html).not.toMatch(/lg:p-\[18px\]\b/)
  })

  // Guarda de no-regresión del lado de las OTRAS dos cards: `plano` es un
  // opt-in con default `undefined` (falsy). Si alguna vez ese default
  // cambiara a `true` sin querer, este caso (que renderiza AltaDeEmpleado,
  // una card que NUNCA pasa `plano`) lo notaría.
  it('CardConEncabezado sin `plano` (las otras dos cards) sigue con el borde y el padding [13,18] de siempre', async () => {
    const { AltaDeEmpleado } = await import('./formularios')
    const html = renderToStaticMarkup(<AltaDeEmpleado onClaveGenerada={() => {}} />)
    const header = html.match(/<div class="flex items-center justify-between[^"]*">/)?.[0] ?? ''
    expect(header).not.toBe('')
    expect(header).toContain('lg:py-[13px]')
    expect(header).not.toContain('lg:border-b-0')
    expect(header).not.toContain('lg:pt-[18px]')
  })

  it('el ícono de cada punto es 15px/text-ok en el teléfono, 14px/text-primary en escritorio (invierte el color)', async () => {
    const html = await render()
    const iconos = html.match(/<svg[^>]*lucide-shield-check[^>]*>/g) ?? []
    expect(iconos).toHaveLength(2)
    for (const icono of iconos) {
      expect(icono).toContain('size-[15px]')
      expect(icono).toContain('text-ok')
      expect(icono).toContain('lg:size-[14px]')
      expect(icono).toContain('lg:text-primary')
    }
  })

  it('las dos reglas del sistema siguen apareciendo palabra por palabra', async () => {
    const html = await render()
    expect(html).toContain('Nunca puede quedar el local sin un dueño activo.')
    expect(html).toContain(
      'Resetear una contraseña cierra todas las sesiones de esa persona — incluida la tuya, si te la cambiás a vos.',
    )
  })
})

describe('CuerpoUsuarios', () => {
  const USUARIOS = [
    {
      id: 'u1',
      nombre: 'Florencia Díaz',
      email: 'flor@celularesflor.com.ar',
      rol: 'DUENO' as const,
      desactivadoEn: null,
    },
    {
      id: 'u4',
      nombre: 'Nahuel Ríos',
      email: 'nahuel@celularesflor.com.ar',
      rol: 'EMPLEADO' as const,
      desactivadoEn: new Date('2026-01-01'),
    },
  ]

  async function render() {
    const { CuerpoUsuarios } = await import('./formularios')
    return renderToStaticMarkup(
      <CuerpoUsuarios usuarios={USUARIOS} usuarioActualId="u1" permisosPorUsuario={{}} />,
    )
  }

  // Minor 16 de la review final: este nombre decía "cuatro" y la lista de al
  // lado nombra tres cards.
  it('arma las tres cards: Equipo, Alta y Reglas (el aviso de clave no está sin clave generada)', async () => {
    const html = await render()
    expect(html).toContain('El equipo del local')
    expect(html).toContain('Agregar a alguien')
    expect(html).toContain('Dos reglas que el sistema no deja romper')
    // Sin ningún claveGenerada todavía, el bloque ámbar no se pinta — el
    // componente lo monta condicionalmente (`{claveGenerada && ...}`).
    expect(html).not.toContain('Se muestra una sola vez')
  })

  it('lista a las personas con su chip de rol y de estado', async () => {
    const html = await render()
    expect(html).toContain('Florencia Díaz')
    expect(html).toContain('Nahuel Ríos')
    expect(html).toContain('Activo')
    expect(html).toContain('Desactivado')
  })

  it('las dos reglas del sistema aparecen palabra por palabra', async () => {
    const html = await render()
    expect(html).toContain('Nunca puede quedar el local sin un dueño activo.')
    expect(html).toContain(
      'Resetear una contraseña cierra todas las sesiones de esa persona — incluida la tuya, si te la cambiás a vos.',
    )
  })

  // Task 10 del ciclo móvil (frame `NIyHG`, nodo `k7F13E`): en el teléfono
  // las cuatro piezas del cuerpo (Clave generada, Equipo, Alta, Reglas) son
  // una lista plana con gap 12 uniforme — la maqueta las dibuja como
  // hermanas directas de "Cuerpo", no agrupadas en dos columnas. El
  // mecanismo es el mismo `contents` (sin `lg:`) + `order-N`/`lg:order-none`
  // que ya usa `FichaDeArticulo` (app/(app)/inventario/formularios.tsx): las
  // dos columnas de escritorio se disuelven en el teléfono, y cada pieza
  // lleva el `order-N` que le toca en el teléfono sin tocar su lugar real en
  // el DOM (que sigue siendo el de escritorio).
  it('el cuerpo pasa de columna (teléfono) a fila (escritorio)', async () => {
    const html = await render()
    expect(html).toMatch(/class="flex flex-col[^"]*\blg:flex-row\b[^"]*"/)
  })

  it('Equipo, Alta y Reglas llevan su order-N con lg:order-none — listas para reordenarse sólo en el teléfono', async () => {
    const html = await render()
    // Equipo es order-2 (el Aviso, cuando existe, es order-1 y va primero).
    expect(html).toContain('class="order-2 lg:order-none"')
    expect(html).toContain('class="order-3 lg:order-none"')
    expect(html).toContain('class="order-4 lg:order-none"')
  })

  it('sin clave generada, el Aviso ni se monta: no aparece ningún order-1', async () => {
    const html = await render()
    expect(html).not.toContain('order-1')
  })
})

/**
 * El wiring de `order-1` para el Aviso no se puede ejercitar por render
 * (nace de `claveGenerada`, un `useState` interno que sólo un click real —
 * imposible sin jsdom, ver vitest.config.mts— puede setear). Se verifica en
 * el FUENTE, mismo criterio que ya usa este archivo para lo que el arnés no
 * puede montar (p. ej. page.test.tsx con `Usuarios`).
 */
describe('El bloque "Clave generada" se arma con order-1 (fuente, Task 10)', () => {
  it('formularios.tsx envuelve <AvisoClaveGenerada> con order-1 lg:order-none', () => {
    const fuente = readFileSync('app/(app)/usuarios/formularios.tsx', 'utf8')
    expect(fuente).toMatch(/order-1 lg:order-none"[\s\S]{0,120}<AvisoClaveGenerada/)
  })

  it('los dos envoltorios de columna se disuelven en el teléfono (contents) y arman recién en escritorio', () => {
    const fuente = readFileSync('app/(app)/usuarios/formularios.tsx', 'utf8')
    expect(fuente).toContain('className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4"')
    expect(fuente).toContain('className="contents lg:flex lg:flex-col lg:w-[360px] lg:shrink-0 lg:gap-4"')
  })
})
