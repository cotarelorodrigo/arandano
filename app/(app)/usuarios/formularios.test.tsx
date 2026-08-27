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
      <CardEquipo usuarios={USUARIOS} usuarioActualId="u1" onClaveGenerada={() => {}} />,
    )
  }

  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 4 en escritorio', async () => {
    const html = await render()
    expect(html).toContain('role="table"')
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[1fr_112px_118px_180px\]/)
  })

  it('el encabezado está oculto en el teléfono y se disuelve en escritorio, con 4 columnheader', async () => {
    const html = await render()
    expect(html).toContain('role="row" class="hidden lg:contents"')
    expect(html.match(/role="columnheader"/g)).toHaveLength(4)
  })

  it('toda fila de datos lleva lg:contents y role="row", con 4 celdas cada una', async () => {
    const html = await render()
    const filas = html.match(/role="row" class="[^"]*"/g) ?? []
    // El encabezado + las 2 filas de datos.
    expect(filas).toHaveLength(3)
    for (const fila of filas) expect(fila).toContain('lg:contents')
    expect(html.match(/role="cell"/g)).toHaveLength(8) // 4 columnas × 2 filas
  })

  it('la fila resalta al pasar el mouse en escritorio: group + group-hover en las 4 celdas', async () => {
    const html = await render()
    const filasDeDatos = html.match(/role="row" class="group [^"]*"/g) ?? []
    expect(filasDeDatos).toHaveLength(2)
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(8)
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
    expect(separadores).toHaveLength(2) // uno por fila
  })

  it('las acciones de fila siguen ahí: "Cambiar clave" para uno mismo, "Reactivar" para el desactivado', async () => {
    const html = await render()
    // u1 (Florencia) es "esUnoMismo": sólo "Cambiar clave", sin "Baja".
    // u4 (Nahuel) está desactivado: sólo "Reactivar".
    expect(html).toContain('Cambiar clave')
    expect(html).toContain('Reactivar')
    expect(html).not.toContain('Baja')
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
    return renderToStaticMarkup(<CuerpoUsuarios usuarios={USUARIOS} usuarioActualId="u1" />)
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
