import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Las guardas de permiso, sobre pantallas cuyos botones están DUPLICADOS.
 *
 * **Por qué existe este archivo.** El ciclo del teléfono (2026-08-26) duplicó
 * varias acciones: una copia en el Topbar (`hidden lg:flex`) y otra en el
 * cuerpo o en la ranura móvil del encabezado (`lg:hidden` / `accionMovil`),
 * atadas al mismo `form` y al mismo estado. El ciclo de permisos por usuario
 * (2026-08-26, `main`) puso sus guardas sobre el botón que existía cuando ESE
 * ciclo empezó — o sea, sobre una sola de las dos copias. Un merge descuidado
 * gatea la copia de escritorio y deja la del teléfono a la vista: un empleado
 * sin el permiso vería el botón en el móvil, con el gate entero en verde.
 *
 * **Dónde vive cada mitad de la cobertura.** Cuando el componente se puede
 * renderizar, el caso va al test de esa pantalla y cuenta apariciones en las
 * dos direcciones (con el permiso, las dos copias; sin el permiso, ninguna):
 * ver `app/(app)/servicio-tecnico/formularios.test.tsx` ("las DOS copias de
 * «Anular orden»") y `app/(app)/inventario/formularios.test.tsx` ("las DOS
 * copias de cada botón las gobierna el mismo `puedeEditar`"). Acá quedan las
 * que NO se pueden renderizar: `app/(app)/inventario/page.tsx` es un Server
 * Component async que abre sesión y consulta Prisma, así que su Topbar y su
 * `accionMovil` sólo se pueden mirar sobre el fuente.
 *
 * El punto ciego, escrito para que nadie confunda "pasa" con "está cubierto":
 * un grep no sabe si la expresión es la correcta, sólo si es la MISMA en los
 * dos lugares. Lo que atrapa —y es lo que este merge necesitaba— es que una de
 * las dos copias se quede con la guarda vieja o sin ninguna.
 */

const INVENTARIO = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

/** El bloque de JSX que arranca en `marca` y termina donde arranca el
 *  siguiente atributo de primer nivel del mismo `<Encabezado>`. */
function atributo(fuente: string, nombre: string): string {
  const desde = fuente.indexOf(`${nombre}={`)
  expect(desde, `no se encontró el atributo ${nombre}`).toBeGreaterThan(-1)
  return fuente.slice(desde, desde + 700)
}

describe('/inventario: "Artículo nuevo" existe dos veces y las dos las gobierna ARTICULOS_CREAR', () => {
  it('el botón del Topbar (escritorio) se guarda con puedeCrear', () => {
    expect(atributo(INVENTARIO, 'acciones')).toContain('puedeCrear ? (')
  })

  it('la ranura del teléfono (accionMovil) se guarda con el MISMO puedeCrear', () => {
    const movil = atributo(INVENTARIO, 'accionMovil')
    expect(movil).toContain('puedeCrear')
    expect(movil).toContain("href: '/inventario/nuevo'")
  })

  // Y al revés: el chequeo binario de rol que había antes del ciclo de
  // permisos no puede quedar en ningún lado de esta pantalla. Si alguien
  // resolviera un conflicto futuro trayendo el bloque viejo de vuelta, una de
  // las dos copias volvería a mirar el rol en vez del permiso.
  it('no queda ningún chequeo de rol suelto en la pantalla', () => {
    expect(INVENTARIO).not.toContain("sesion.usuario.rol === 'DUENO'")
  })
})

describe('/inventario: el árbol de categorías se renderiza dos veces y las dos leen CATEGORIAS', () => {
  // Uno vive en la columna de escritorio (`hidden lg:block`) y el otro dentro
  // del `Sheet` del teléfono. Son el MISMO componente, con el ABM entero
  // adentro (crear, renombrar, mover, borrar): gatear uno solo dejaría el ABM
  // a mano para un empleado sin el permiso en el ancho que no se gateó.
  it('los dos PanelDeCategorias reciben puedeAdministrar={puedeCategorias}', () => {
    const paneles = [...INVENTARIO.matchAll(/<PanelDeCategorias/g)]
    expect(paneles, 'esta pantalla renderiza el panel dos veces').toHaveLength(2)

    const conPermiso = [...INVENTARIO.matchAll(/puedeAdministrar=\{puedeCategorias\}/g)]
    expect(conPermiso, 'las dos copias tienen que recibir el mismo permiso').toHaveLength(2)
  })
})

describe('servicio técnico: la ficha guarda sus dos copias con la MISMA expresión', () => {
  const FICHA = readFileSync('app/(app)/servicio-tecnico/formularios.tsx', 'utf8')

  // El caso que de verdad prueba el comportamiento (los conteos con y sin
  // permiso, y con la orden ya anulada) vive en formularios.test.tsx, que sí
  // puede renderizar. Éste cuida lo que aquél no puede distinguir: que el
  // nombre usado sea el derivado (`seOfreceAnular`) y no la prop pelada
  // (`puedeAnular`), que es exactamente lo que el merge automático dejó mal
  // sin marcar conflicto — el nombre viejo del derivado y el nombre nuevo de
  // la prop son el mismo string.
  it('ninguna copia usa la prop pelada `puedeAnular` como guarda de render', () => {
    expect(FICHA).not.toContain('{puedeAnular ?')
    expect(FICHA).not.toContain('{puedeAnular &&')
  })

  it('las tres guardas de render (Topbar, <form> y cuerpo del teléfono) usan seOfreceAnular', () => {
    const guardas = [...FICHA.matchAll(/\{seOfreceAnular \?/g)]
    expect(guardas, 'Topbar, el <form> invisible y el bloque lg:hidden').toHaveLength(3)
  })
})

describe('/ventas/[id]: el permiso se combina con anuladaEn antes de llegar al componente', () => {
  const VENTA = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')

  it('Detalle recibe seOfreceAnular(permiso, anuladaEn), nunca el permiso pelado', () => {
    expect(VENTA).toContain('ofreceAnular={seOfreceAnular(puedeAnularVenta, venta.anuladaEn)}')
    expect(VENTA).not.toContain('ofreceAnular={puedeAnularVenta}')
  })

  // Esta pantalla tiene UNA sola copia del botón —la zona de riesgo se
  // muestra en los dos anchos, no se duplica—, y eso es lo que hace que
  // alcance con la guarda de arriba. El caso está para que se rompa si
  // alguien duplica el botón sin duplicar la guarda.
  it('el botón de anular sigue existiendo una sola vez', () => {
    expect([...VENTA.matchAll(/<AnularVenta /g)]).toHaveLength(1)
  })
})
