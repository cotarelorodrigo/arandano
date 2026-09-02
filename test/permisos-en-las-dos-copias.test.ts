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

/**
 * El bloque de JSX que arranca en `${nombre}={` y corta en el primer límite
 * de atributo REAL que aparece después: la línea que abre el siguiente
 * atributo de primer nivel del mismo `<Encabezado>` (`\n<espacios><nombre>={`)
 * o el `/>` que cierra el elemento — lo que venga primero. No es un largo
 * fijo: la versión anterior cortaba a los 700 caracteres siguientes, y medido
 * sobre este archivo la separación real entre el cierre de `acciones` y el
 * inicio de `accionMovil` son 108 caracteres de prosa de comentario — un
 * comentario un poco más largo que nombrara el permiso de al lado hacía
 * pasar el `toContain` sin que la guarda existiera.
 */
function atributo(fuente: string, nombre: string): string {
  const desde = fuente.indexOf(`${nombre}={`)
  expect(desde, `no se encontró el atributo ${nombre}`).toBeGreaterThan(-1)

  const inicioValor = desde + nombre.length + 2 // largo de `${nombre}={`
  const resto = fuente.slice(inicioValor)

  const proximoAtributo = resto.search(/\n[ \t]*[a-zA-Z]+=\{/)
  const cierreElemento = resto.search(/\/>/)

  const candidatos = [proximoAtributo, cierreElemento].filter((indice) => indice !== -1)
  expect(candidatos.length, `no se encontró el fin del atributo ${nombre}`).toBeGreaterThan(0)

  return fuente.slice(desde, inicioValor + Math.min(...candidatos))
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
    // Task 10: `anuladaEn` viaja en `datos` —lo que devuelve `datosDelDetalle`,
    // extraída del Server Component para poder probar el `select` de los
    // IMEI contra la base—, ya no en `venta.anuladaEn` a secas.
    expect(VENTA).toContain('ofreceAnular={seOfreceAnular(puedeAnularVenta, datos.anuladaEn)}')
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

describe('/vender: ChipCaja/ControlDeCaja son la sexta acción duplicada del repo, y HOY no llevan permiso', () => {
  const VENDER = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
  const CAJA = readFileSync('app/(app)/vender/caja.tsx', 'utf8')

  // `ChipCaja` (escritorio, dentro de `acciones`, `hidden lg:flex`) y
  // `ControlDeCaja` (teléfono, en `controlMovil`) son las dos copias: las dos
  // montan los mismos `FormularioDeApertura` y `ConfirmarCierre` de
  // `caja.tsx`. HOY está bien que ninguna lleve guarda de permiso —CLAUDE.md
  // fija que cualquiera del local, dueño o empleado, abre y cierra la caja—,
  // así que no hay ninguna fuga. Lo que este caso documenta es el sitio: el
  // día que exista un permiso de caja (la pieza 6 del roadmap, el arqueo),
  // este archivo es donde alguien tiene que agregar la cobertura de que las
  // DOS copias gatean con el MISMO permiso — si no, vuelve exactamente el bug
  // que este archivo existe para cuidar.
  it('las dos copias existen: <ChipCaja> en escritorio y <ControlDeCaja> en el teléfono', () => {
    expect(VENDER).toContain('<ChipCaja')
    expect(VENDER).toContain('<ControlDeCaja')
  })

  it('las dos montan FormularioDeApertura/ConfirmarCierre sin que nada tome un permiso todavía', () => {
    expect(CAJA).toContain('function FormularioDeApertura')
    expect(CAJA).toContain('function ConfirmarCierre')
    // Ninguna firma de este archivo recibe un `puedeX: boolean` —la
    // convención que usan `puedeCrear`, `puedeEditar`, `puedeAnular`,
    // `puedeCategorias`— todavía. Este caso se pone rojo apenas alguien
    // empiece a gatear una de las dos copias, que es la señal de "che, vení
    // a leer el comentario de arriba y gateá la otra también".
    expect(CAJA).not.toMatch(/puede\w*:\s*boolean/)
  })
})

describe('/formas-de-pago: "Plan nuevo" existe dos veces y la pantalla entera la gobierna PLANES_PAGO', () => {
  const PAGINA = readFileSync('app/(app)/formas-de-pago/page.tsx', 'utf8')
  const FORMULARIOS = readFileSync('app/(app)/formas-de-pago/formularios.tsx', 'utf8')

  // Las DOS copias, en las dos direcciones: `acciones` (escritorio, que
  // `<Encabezado>` envuelve en `hidden lg:flex`) y `controlMovil` (la ranura
  // derecha del Topbar del teléfono). El merge del ciclo de precios con el del
  // teléfono dejó sólo la primera, y "Plan nuevo" desaparecía del teléfono sin
  // reaparecer en ningún lado.
  it('el alta se coloca en el Topbar de escritorio Y en la ranura del teléfono', () => {
    expect(PAGINA).toContain('acciones={<DialogoDePlan />}')
    expect(PAGINA).toContain('controlMovil={<DialogoDePlan movil />}')
  })

  // Y las dos salen del MISMO componente: es lo que hace que agregarle una
  // guarda de permiso más adelante no pueda alcanzar a una sola.
  it('las dos copias son el mismo DialogoDePlan, con su trigger elegido por `movil`', () => {
    expect([...PAGINA.matchAll(/<DialogoDePlan /g)]).toHaveLength(2)
    expect(FORMULARIOS).toMatch(/export function DialogoDePlan\(\{ plan, movil = false \}/)
  })

  // A diferencia de `/inventario`, acá el permiso NO gatea un botón sino la
  // pantalla entera: `exigirPermiso` corta antes de renderizar nada, así que
  // no hay dos copias que gatear por separado. Este caso fija esa asimetría
  // para que nadie "arregle" la ausencia de un `puedeCrear` agregando uno.
  it('el permiso corta antes del render, así que ningún botón lo evalúa por su cuenta', () => {
    expect(PAGINA).toContain("exigirPermiso('PLANES_PAGO')")
    // Sobre el fuente SIN comentarios: este archivo nombra `PLANES_PAGO` en
    // prosa, explicando qué pasa si a alguien se lo revocan con el diálogo
    // abierto. Lo que el caso prohíbe es que lo EVALÚE.
    const sinComentarios = FORMULARIOS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(sinComentarios).not.toMatch(/PLANES_PAGO/)
  })
})

describe('/bot: el disparador de conexión existe dos veces y las dos son sólo del dueño', () => {
  const PAGINA = readFileSync('app/(app)/bot/page.tsx', 'utf8')
  const FORMULARIOS = readFileSync('app/(app)/bot/formularios.tsx', 'utf8')

  // Las DOS copias: `acciones` (escritorio, que `<Encabezado>` envuelve en
  // `hidden lg:flex`) y `controlMovil` (la ranura derecha del Topbar del
  // teléfono). Sin la segunda, conectar el WhatsApp del local sería imposible
  // desde un celular — que es justamente el aparato donde el dueño tiene la
  // cuenta de Facebook del negocio con la que hay que firmar.
  it('el disparador se coloca en el Topbar de escritorio Y en la ranura del teléfono', () => {
    expect([...PAGINA.matchAll(/<BotonDeConexion /g)]).toHaveLength(2)
    expect(PAGINA).toContain('controlMovil={')
    expect(PAGINA).toMatch(/<BotonDeConexion[^>]*movil/)
  })

  /**
   * Y las dos reciben las MISMAS props de guarda, contado en las dos
   * direcciones. Un `not.toContain` no alcanzaría: pasaría igual si una copia
   * quedó gateada y la otra no, que es exactamente el bug que el merge del
   * ciclo del teléfono produjo con "Anular orden".
   */
  it('las dos copias llevan el mismo esDuenio y el mismo kapsoListo', () => {
    expect([...PAGINA.matchAll(/esDuenio=\{esDuenio\}/g)]).toHaveLength(2)
    expect([...PAGINA.matchAll(/kapsoListo=\{vista\.kapsoListo\}/g)]).toHaveLength(2)
  })

  // Y la guarda vive en UN solo componente, así que no hay forma de que una
  // copia se salte el chequeo: las dos son la misma función con `movil` distinto.
  it('la guarda vive adentro del componente compartido, no en cada llamador', () => {
    expect(FORMULARIOS).toMatch(/if \(!esDuenio \|\| !kapsoListo\) return null/)
  })

  // La pantalla entera exige BOT, igual que /formas-de-pago con PLANES_PAGO: el
  // permiso corta antes de renderizar, así que ningún botón lo evalúa por su
  // cuenta. Este caso fija esa asimetría con `esDuenio`, que SÍ se evalúa
  // adentro porque la pantalla es de todos los que tienen BOT y sólo la
  // conexión es del dueño.
  it('el permiso corta antes del render; lo único que se evalúa adentro es el rol', () => {
    expect(PAGINA).toContain("exigirPermiso('BOT')")
    const sinComentarios = FORMULARIOS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(sinComentarios, "formularios.tsx no debe evaluar 'BOT' por su cuenta").not.toMatch(
      /'BOT'/,
    )
  })
})
