import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tile, ChipDeDelta, SegmentadoDeRango, monedaEfectiva } from './page'
import { SelectorDeMonedaElegida } from '@/components/selector-de-moneda-elegida'

// La decisión de invertir el tile —qué magnitud es "el número grande" cuando
// el período sólo cobró dólares— es la regla real, y vive en `soloEnDolares`
// (lib/dashboard/metricas.ts), con su propia cobertura en metricas.test.ts.
// Acá hubo un caso que decía protegerla pasándole `valor="US$ 4.120"` ya
// resuelto directo a `Tile` y afirmando que no aparecía '$ 0,00' —una cadena
// que esa fixture nunca podía producir—: ejercitaba la PRESENTACIÓN de un
// resultado ya decidido, nunca la decisión (octavo test hueco del ciclo,
// review final de rama). Se borra en vez de repetirse: `Tile` es un
// componente de presentación puro y `en pesos: el número grande y el dólar
// al pie` ya prueba que renderiza lo que se le pasa.
describe('el tile de marca', () => {
  it('en pesos: el número grande y el dólar al pie', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="TOTAL DEL PERÍODO" valor="$ 8.412.900"
        pie="US$ 4.120 aparte" delta={{ porcentaje: 18.4, sube: true }} marca />,
    )
    expect(html).toContain('$ 8.412.900')
    expect(html).toContain('US$ 4.120 aparte')
    expect(html).toContain('+18,4%')
  })
})

describe('el chip de delta', () => {
  it('el signo decide el ícono y el color', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: 9.1, sube: true }} />))
      .toContain('+9,1%')
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: -2.3, sube: false }} />))
      // Menos tipográfico (U+2212), no guion: es lo que dibuja la maqueta.
      .toContain('−2,3%')
  })

  it('sin delta no dibuja nada', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={null} />)).toBe('')
  })
})

describe('el segmentado de rango', () => {
  // Antes, este caso sólo afirmaba que 'aria-current="page"' aparecía EN
  // ALGÚN LUGAR del HTML y que el href de "Hoy" existía — pasaría igual si
  // SegmentadoDeRango marcara TODOS los chips como activos, o marcara el
  // chip equivocado. Lo que hay que afirmar es que el ÚNICO chip con
  // aria-current es el que se pidió como activo, y que los otros tres son
  // links de verdad a su propio rango.
  it('marca el activo y linkea los otros tres', () => {
    const html = renderToStaticMarkup(
      <SegmentadoDeRango activo="estemes" href={(r) => `/dashboard?rango=${r}`} />,
    )

    const activo = html.match(/aria-current="page"[^>]*>([^<]*)</)
    expect(activo?.[1]).toBe('Este mes')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)

    expect(html).toContain('href="/dashboard?rango=hoy"')
    expect(html).toContain('href="/dashboard?rango=7dias"')
    expect(html).toContain('href="/dashboard?rango=esteanio"')
    // El activo no se linkea a sí mismo con el parámetro puesto de más.
    expect(html).not.toContain('href="/dashboard?rango=estemes"')
  })
})

// Critical de la review de Task 11: `hrefRango` arrastra `?moneda`, así que
// desde `/dashboard?moneda=usd` en un mes con dólares, un click en "Hoy" —un
// día sin ninguno— dejaba `hayDolares` en `false` para ese período: el
// selector no se dibujaba, y no quedaba en pantalla ningún control para
// volver a pesos mientras los tiles seguían mostrando pesos reales.
// `monedaEfectiva()` es el fallback: cae a la que sí tuvo actividad, sin
// tocar `?moneda` (la pedida, la que preserva el resto de la navegación).
describe('monedaEfectiva: los paneles nunca se quedan con la pila vacía', () => {
  it('?moneda=usd en un período sin dólares cae a "ars"', () => {
    expect(monedaEfectiva('usd', /* huboEnPesos */ true, /* huboEnDolares */ false)).toBe('ars')
  })

  it('un período que sólo tuvo dólares cae a "usd" aunque `?moneda` siga en su default', () => {
    expect(monedaEfectiva('ars', /* huboEnPesos */ false, /* huboEnDolares */ true)).toBe('usd')
  })

  it('si la moneda pedida ya tuvo actividad, no cambia nada', () => {
    expect(monedaEfectiva('usd', true, true)).toBe('usd')
    expect(monedaEfectiva('ars', true, true)).toBe('ars')
  })

  // Sin actividad en NINGUNA moneda —tenant nuevo, período sin ventas—, la
  // función igual cae a la otra: mismo comportamiento que ya tiene
  // `monedaEfectiva` en /ventas (nunca comparó contra la otra pila, sólo
  // preguntó si la pedida estaba vacía). Es inofensivo acá: con las dos
  // vacías, `hayDolares` también da `false`, el selector no se dibuja, y
  // cualquiera de las dos monedas que termine "mostrándose" pinta el mismo
  // "todavía no se vendió nada" en los tres paneles — no hay nada visible
  // que la elección pueda contradecir.
  it('sin actividad en ninguna moneda, cae igual —inofensivo: no hay selector ni datos que contradecir', () => {
    expect(monedaEfectiva('ars', false, false)).toBe('usd')
    expect(monedaEfectiva('usd', false, false)).toBe('ars')
  })

  // La prueba de que el Critical queda resuelto de verdad: sin el fallback,
  // este escenario deja a la persona sin selector Y sin datos. Con él, el
  // selector se dibuja (hayDolares del período sigue en `false`... pero acá
  // lo que importa es que `monedaMostrada` cae a 'ars', que es la moneda con
  // datos) y el panel de medios muestra la plata real en vez de "sin datos".
  it('con la moneda efectiva, el panel de medios resuelve a la pila que sí tiene barras', () => {
    const huboEnPesos = true
    const huboEnDolares = false
    const monedaMostrada = monedaEfectiva('usd', huboEnPesos, huboEnDolares)
    expect(monedaMostrada).toBe('ars')
    // Y el selector, si se dibujara, resaltaría la que está en pantalla —no
    // la pedida—: pasarle `moneda` en vez de `monedaMostrada` marcaría "US$"
    // como activo mientras el panel de al lado muestra pesos.
    const html = renderToStaticMarkup(
      <SelectorDeMonedaElegida hayDolares moneda={monedaMostrada} href={(m) => `/dashboard?moneda=${m}`} />,
    )
    const links = html.match(/<a [^>]*>[^<]*<\/a>/g) ?? []
    const linkArs = links.find((l) => l.endsWith('>$</a>'))
    const linkUsd = links.find((l) => l.endsWith('>US$</a>'))
    expect(linkArs, `no se encontró el link de $ en: ${html}`).toContain('aria-current="page"')
    expect(linkUsd, `no se encontró el link de US$ en: ${html}`).not.toContain('aria-current')
  })
})

// Task 12: "Exportar CSV" existe en DOS copias —el Topbar de escritorio
// (`acciones`) y la ranura de 38 px del teléfono (`controlMovil`)—, mismo
// patrón que ya documenta test/permisos-en-las-dos-copias.test.ts para otras
// pantallas. `Dashboard` (el default export) es un Server Component `async`
// que abre sesión y consulta Prisma, así que no se puede montar acá — el
// caso mira el FUENTE, como ya hacen los de /inventario y /formas-de-pago en
// ese archivo.
//
// Se cuenta en las DOS direcciones a propósito (Ruling de esta task): un
// `toContain` solo pasaría igual con una sola copia presente. Verificado a
// mano, borrando cada copia por separado, que los tres casos de abajo se
// ponen en rojo (ver task-12-report.md).
describe('/dashboard: "Exportar CSV" existe dos veces —Topbar y ranura del teléfono— con el mismo rango', () => {
  const FUENTE = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')

  it('BotonDeExportar aparece exactamente dos veces', () => {
    expect([...FUENTE.matchAll(/<BotonDeExportar\b/g)]).toHaveLength(2)
  })

  it('una copia vive dentro de `acciones` (Topbar) y la otra dentro de `controlMovil` (teléfono)', () => {
    const accionesInicio = FUENTE.indexOf('acciones={')
    const controlMovilInicio = FUENTE.indexOf('controlMovil={')
    expect(accionesInicio, 'no se encontró el atributo acciones').toBeGreaterThan(-1)
    expect(controlMovilInicio, 'no se encontró el atributo controlMovil').toBeGreaterThan(-1)
    expect(FUENTE.slice(accionesInicio, controlMovilInicio)).toContain('<BotonDeExportar')
    expect(FUENTE.slice(controlMovilInicio)).toContain('<BotonDeExportar')
  })

  // Las dos copias tienen que exportar el MISMO período, no uno cada una: es
  // exactamente la clase de divergencia silenciosa que ya rompió "Anular
  // orden" en el merge del ciclo móvil (CLAUDE.md).
  it('las dos reciben rango={rango}', () => {
    // `\s+` y no un espacio literal: QA (2026-09-02) reformateó los
    // call sites a un atributo por línea al arreglar el bug de abajo, y un
    // espacio fijo hubiera dejado este caso en rojo por un cambio de
    // formato, no por una divergencia real.
    expect([...FUENTE.matchAll(/<BotonDeExportar\s+rango=\{rango\}/g)]).toHaveLength(2)
  })

  // QA (2026-09-02, Critical): `BotonDeExportar` pedía `children: (exportando)
  // => ReactNode` —un render prop—, y esta pantalla se lo pasaba en las DOS
  // copias: `page.tsx` es un Server Component `async`, y un Server
  // Component NO puede pasarle una función a un Client Component — sólo
  // elementos, que se serializan. React tira "Functions are not valid as a
  // child of Client Components" en TODO render, así que `/dashboard` daba
  // 500 siempre. Ninguno de los tres casos de arriba lo veía —miran
  // presencia y atributos, no la FORMA de `children`—, y tampoco `npm test`
  // en general, `tsc`, `lint` ni `npm run build`: recién lo vio abrir la
  // pantalla. La red general —que barre TODA `app/`, no sólo esta
  // pantalla— vive en test/servidor-llama-a-cliente.test.ts; este caso es
  // la instancia mínima atada a la fuente concreta que rompió.
  it('ninguna copia le pasa una función como children (el bug real: children era un render prop)', () => {
    // El componente pasó a ser autocerrado (`reposo`/`enCurso` como props),
    // así que ninguna apertura de <BotonDeExportar debería tener, como
    // primer hijo, una función de flecha — el patrón exacto que tiraba el
    // 500: `{(exportando) => ...}`. `[^>]*` (no `[^]*?`) a propósito: no
    // cruza un `>` literal, así que no se escapa de ESTA apertura hacia
    // contenido de otro componente más abajo en el archivo.
    expect(FUENTE).not.toMatch(/<BotonDeExportar\b[^>]*>\s*\{\s*\([^)]*\)\s*=>/)
  })
})

// `Dashboard` (el default export) es un Server Component `async` que abre
// sesión y consulta Prisma, así que no se puede montar acá — el caso mira el
// FUENTE, mismo patrón que el bloque de "Exportar CSV" de arriba y que
// app/(app)/usuarios/page.test.tsx.
//
// La pestaña escondida no es una defensa: `/dashboard` se alcanza tipeando la
// URL, y el layout del grupo sólo exige SESIÓN, no rol. Sin esta mitad, el
// cambio sería cosmético.
describe('/dashboard es sólo del dueño', () => {
  const FUENTE = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')

  it('la página abre sesión con exigirDuenio', () => {
    expect(FUENTE).toContain('await exigirDuenio()')
  })

  // Las dos direcciones: sin esto, un `exigirSesion()` que quedara al lado del
  // `exigirDuenio()` —o en su lugar tras un refactor— pasaría el caso de
  // arriba en verde y dejaría entrar a cualquier sesión.
  it('y no queda ningún exigirSesion en la pantalla', () => {
    expect(FUENTE).not.toContain('exigirSesion')
  })
})
