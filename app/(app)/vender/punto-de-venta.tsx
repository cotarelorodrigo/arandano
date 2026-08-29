'use client'

import { Fragment, useActionState, useCallback, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleAlert, Minus, Plus, ScanBarcode, TriangleAlert, X } from 'lucide-react'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import { usePasoDeCobro, type Paso } from './paso'
import { ChipCaja, ChipsDeEstado, ControlDeCaja, type CajaDelChip } from './caja'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import { useIsMobile } from '@/hooks/use-mobile'
import { Encabezado } from '@/components/shell/encabezado'
import {
  aCentavos, aMilesimas, cantidadEnMilesimas, cotizacionEnDiezMilesimas, deCentavos,
  deMilesimas, dineroEnCentavos, montoEntregadoEnCentavos, pesosDePagoEnCentavos,
  porcentajeEnMilesimas, recargoEnCentavos, subtotalEnCentavos, totalesDePagosEnCentavos,
  totalesEnCentavos, type TotalesEnCentavos,
} from '@/lib/ventas/centavos'
// De TIPO y no de valor: `lib/planes/consultar.ts` importa Prisma, y un import
// de valor desde este archivo —que lleva 'use client'— arrastraría `pg` al
// bundle del navegador. Mismo caso que `ArticuloVendible`, y lo que vigila
// test/limite-cliente-servidor.test.ts.
import type { PlanVisible } from '@/lib/planes/consultar'
import {
  formatearPrecio, formatearCantidad, montoSinSigno, precioEnSuMoneda,
} from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import estilos from '@/components/importe.module.css'
import estilosCobro from './cobro.module.css'

const INICIAL: EstadoCobro = { error: null, venta: null }

/**
 * El `id` del `<form>` de cobro.
 *
 * En el teléfono el botón "Cobrar" vive en el pie fijo de la pantalla, que es
 * hermano del cuerpo y por lo tanto queda FUERA del `<form>`. El atributo HTML
 * `form` es lo que ata un botón remoto a su formulario — mismo mecanismo que
 * ya usan los formularios de `/inventario` para dibujar sus acciones en el
 * Topbar. Como constante y no tipeado dos veces: si el `id` y el `form` se
 * desincronizan, el botón deja de cobrar sin que nada se rompa a la vista.
 */
const ID_FORMULARIO_DE_COBRO = 'formulario-de-cobro'

type Linea = {
  articuloId: string
  sku: string
  descripcion: string
  precio: string
  // La moneda EN LA QUE ESTÁ el precio del artículo (Task 6), no en la que se
  // cobra: dos líneas pueden convivir en el mismo carrito, una en pesos y otra
  // en dólares, y cada una arrastra la suya para que `totalesEnCentavos` sepa
  // a qué pila sumar su subtotal.
  moneda: 'ARS' | 'USD'
  stock: string
  esProducto: boolean
  // Lo que la persona tipeó, tal cual: se parsea al calcular y se manda como
  // texto, que es lo que el server action espera.
  cantidad: string
}

type Pago = {
  medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO'
  // La moneda en la que se ENTREGA la plata: los billetes que entran al cajón.
  moneda: 'ARS' | 'USD'
  // Cuál de los DOS totales de la venta cubre este pago, que es una dimensión
  // APARTE de `moneda`: se entregan pesos contra el total en dólares
  // (`moneda: 'ARS'`, `cubre: 'USD'`) cada vez que alguien paga en pesos un
  // iPhone de lista en dólares, y al revés cada vez que alguien deja dólares
  // contra una venta en pesos. Espeja a `PagoDeVenta.cubre` del motor, donde
  // ausente vale `'ARS'` — que es lo que era toda venta antes de este ciclo.
  cubre: 'ARS' | 'USD'
  // Lo que este pago cubre de la venta, a precio de lista. **Va en dólares si
  // el pago toca dólares de algún lado** (`moneda` o `cubre`, ver
  // `baseEnDolaresCentavos` en lib/ventas/centavos.ts), y en pesos si no toca
  // ninguno: es la regla que hace que nada divida en ninguna punta. Se rotula
  // "Monto" cuando el pago no cruza monedas y "Cubre US$" cuando sí; el monto
  // que entra a la caja lo calcula el motor (`lib/ventas/crear.ts`).
  base: string
  cotizacion: string
  // Sólo UI: con cuánto paga el cliente, para calcular el vuelto. NO se manda
  // al servidor y NO se guarda — el pago que entra a la caja es el monto, no
  // lo que el cliente apoyó sobre el mostrador.
  recibido: string
  // El plan con el que se cobra ESTA parte, o null para precio de lista. Sólo
  // puede tener valor un pago del medio del plan y en pesos: el motor rechaza
  // lo demás (PLAN_NO_CORRESPONDE, PLAN_EN_DOLARES), así que la fila lo limpia
  // en cuanto cambia el medio o la moneda.
  planId: string | null
}

/**
 * El valor del ítem "Precio de lista" del selector de plan.
 *
 * Un centinela y NO la cadena vacía: Radix reserva `''` para "sin selección" y
 * un `SelectItem` con `value=""` tira en runtime. Nunca viaja al servidor — la
 * fila lo traduce a `null` antes de tocar el estado, y el JSON escondido manda
 * `undefined`, que `JSON.stringify` descarta.
 */
const SIN_PLAN = 'sin-plan'

/**
 * Qué carrito es éste, para la clave de idempotencia.
 *
 * Artículos y cantidades, que es lo que define la venta; el orden cuenta, y
 * está bien que cuente: reordenar es un cambio del carrito como cualquier otro
 * y lo único que provoca es una clave nueva.
 */
function firmaDelCarrito(lineas: Linea[]): string {
  return JSON.stringify(lineas.map((l) => [l.articuloId, l.cantidad]))
}

// La firma del carrito vacío, que es con lo que arranca la pantalla. Como
// constante y no calculada al vuelo: es el valor inicial del estado, y tiene
// que ser el MISMO en el render del servidor y en el del navegador.
const CARRITO_VACIO = firmaDelCarrito([])

/**
 * Un paso del stepper de cantidad: +1 o -1 unidad completa (1000 milésimas),
 * el mismo incremento que ya usa `agregar()` al reescanear un artículo
 * repetido.
 *
 * Exportada (y no interna) porque es la única forma de probar la aritmética
 * del stepper de verdad: este archivo se testea con `renderToStaticMarkup`
 * (sin jsdom ni fireEvent, ver la nota de `ticket.test.tsx`), que no ejecuta
 * handlers de clic. Llamar la función pura es lo que reemplaza a "apretar el
 * botón" en ese harness.
 *
 * Si lo tipeado no se entiende (NaN) el paso no hace nada: pisarlo con
 * basura sería peor que dejar la línea como está, mismo criterio que ya usa
 * `agregar()` con una cantidad a medio tipear. Restar tampoco baja de cero:
 * una cantidad negativa no significa nada acá, y sacar la línea entera es el
 * trabajo del botón "quitar" (el ícono x), no de este stepper.
 */
export function pasoDeCantidad(cantidad: string, delta: 1 | -1): string {
  const actual = cantidadEnMilesimas(cantidad)
  if (Number.isNaN(actual)) return cantidad
  return deMilesimas(Math.max(0, actual + delta * 1000))
}

/**
 * Los dos botones del stepper de cantidad, como DATO y no como dos bloques
 * JSX casi idénticos escritos a mano.
 *
 * La review de esta task encontró el motivo de que sea un array: con dos
 * <button> separados —cada uno con su propio `-1`/`1` tipeado al lado—,
 * invertir el signo de uno solo (el "−" suma, el "+" resta) es un cambio de
 * una palabra que ningún test atrapaba, porque `pasoDeCantidad` se probaba
 * aislada y nunca importaba QUÉ botón le pasa qué `delta`. Con el cableado
 * reducido a este array y renderizado con un `.map()` (ver más abajo), el
 * único lugar donde el signo se puede romper es ACÁ, y
 * `punto-de-venta.test.tsx` lo prueba directo, sin jsdom.
 */
export const PASOS_STEPPER: { verbo: string; delta: 1 | -1; Icono: typeof Minus }[] = [
  { verbo: 'Restar', delta: -1, Icono: Minus },
  { verbo: 'Sumar', delta: 1, Icono: Plus },
]

/**
 * Si esta tecla es el atajo que enfoca el buscador (F2), y ninguna otra.
 *
 * Extraída como función pura —sin tocar `buscador.current` ni el DOM—
 * porque es la ÚNICA parte del listener de F2 que se puede probar sin
 * jsdom, que este repo no tiene (ver la nota de `ticket.test.tsx`, que
 * explica por qué ese archivo tampoco lo necesita). `punto-de-venta.test.tsx`
 * prueba esta función.
 *
 * Lo que ESE test NO cubre, para que no se lea como cobertura completa: que
 * el listener esté realmente enganchado a `window`, que dispare
 * `preventDefault()`, y que `buscador.current?.focus()` mueva el foco de
 * verdad — eso es el cableado del `useEffect` de abajo, y sin jsdom no hay
 * forma de simular un `keydown` real ni de leer qué elemento quedó
 * enfocado. Si algún día ese cableado se rompe (el listener se desengancha,
 * o deja de llamar a `.focus()`), esta función seguiría en verde: prueba la
 * REGLA ("¿es F2?"), no el efecto de apretarla.
 */
export function esAtajoDeBuscador(tecla: string): boolean {
  return tecla === 'F2'
}

/**
 * Si esta tecla es el atajo que cobra (Enter), y ninguna otra.
 *
 * Sola no alcanza para decidir si el atajo TIENE que disparar — eso lo
 * completa `puedeDispararCobroDesdeFoco`, la otra mitad de la regla, separada
 * porque prueba algo distinto: ésta mira la tecla, aquélla mira dónde está
 * el foco.
 */
export function esAtajoDeCobro(tecla: string): boolean {
  return tecla === 'Enter'
}

/**
 * Si el foco en un elemento con esta etiqueta deja pasar el atajo global de
 * Enter-para-cobrar.
 *
 * ALLOW-LIST y no deny-list — cambiado en la revisión final del rediseño,
 * porque la deny-list original (negar INPUT/TEXTAREA/SELECT/BUTTON) tenía un
 * defecto de runtime real: afirmaba que "los selects de medio/moneda ya se
 * activan solos con Enter", cierto mientras eran `<select>` nativos, pero
 * FALSO desde que pasaron a `Select` de shadcn (Radix, ver
 * docs/pantallas.md). Radix no renderiza ningún `<select>` — el trigger es
 * un `<button>` y cada opción del popup abierto es un `<div role="option">`,
 * así que 'SELECT' quedó negando algo que ya no existe en esta pantalla, y
 * el `<div>` con el foco (la opción resaltada de un dropdown abierto)
 * quedaba FUERA de la lista negada. Con el foco ahí, apretar Enter elegía la
 * opción en Radix Y —en el mismo evento, porque ni `@radix-ui/react-select`
 * ni `DismissableLayer` cortan la propagación hacia `window`— disparaba el
 * atajo global con el medio/moneda TODAVÍA no actualizado en el estado de
 * React: cobraba la venta con el medio o la moneda anteriores. Verificado en
 * runtime, no sólo leído.
 *
 * La regla ahora es la inversa: el atajo sólo dispara con el foco en
 * `BODY`, o sin ningún elemento enfocado — exactamente donde Enter no
 * significa nada para NADIE más. Cualquier OTRO tagName se abstiene,
 * incluidos los que ya cambiaron de primitiva una vez (SELECT → Radix) y los
 * que puedan volver a cambiar. Una allow-list no se rompe cuando un
 * componente cambia de primitiva; una deny-list sí, que es exactamente lo
 * que acaba de pasar acá.
 *
 * Esto sigue resolviendo, SIN un caso especial para el buscador, el
 * requisito puntual de la task ("Enter no puede cobrar mientras el foco está
 * en el buscador, ahí Enter agrega el artículo"): el buscador es un INPUT
 * con foco propio, así que nunca es `BODY`.
 *
 * No es la única defensa: el listener global también se abstiene ENTERO
 * mientras haya un overlay de Radix abierto (ver `hayOverlayDeRadixAbierto`,
 * más abajo) — esa guarda cubre el caso general (cualquier tecla, cualquier
 * overlay); ésta cubre el caso puntual de Enter incluso cuando el foco quedó
 * en otro control que no es un overlay (el trigger ya cerrado, un botón de
 * la cinta, etc.).
 */
export function puedeDispararCobroDesdeFoco(etiqueta: string | undefined): boolean {
  return etiqueta === undefined || etiqueta === 'BODY'
}

/**
 * Si esta tecla es el atajo que arma/confirma el vaciado del carrito (Esc), y
 * ninguna otra.
 */
export function esAtajoDeVaciar(tecla: string): boolean {
  return tecla === 'Escape'
}

/**
 * "N artículos · N unidades" de la banda del total, con el singular que le
 * corresponde a cada mitad — en castellano cero y "muchos" comparten el
 * plural, así que 1 es la única excepción en los dos casos (mismo criterio ya
 * usado en `app/(app)/inventario/page.tsx` para "N artículos").
 *
 * Exportada por el mismo motivo que `pasoDeCantidad` y `esAtajoDeBuscador`:
 * este archivo se testea con `renderToStaticMarkup` sobre el carrito VACÍO
 * (ver la nota de `render()` en el test), así que un carrito con líneas de
 * verdad —4 artículos, 5 unidades— nunca llega a renderizarse ahí. Llamar la
 * función directo es lo único que prueba la pluralización con un carrito no
 * vacío.
 */
export function resumenDelCarrito(articulos: number, unidadesMilesimas: number): string {
  const unidadesTexto = formatearCantidad(deMilesimas(unidadesMilesimas))
  const arts = articulos === 1 ? '1 artículo' : `${articulos} artículos`
  const unids = unidadesTexto === '1' ? '1 unidad' : `${unidadesTexto} unidades`
  return `${arts} · ${unids}`
}

/**
 * Las unidades totales del carrito, en milésimas: la suma de cantidades de
 * TODAS las líneas, no la cantidad de líneas (eso ya lo da `lineas.length`,
 * el otro término de `resumenDelCarrito`). Una línea inválida (NaN) suma 0
 * acá — no puede envenenar el conteo entero, a diferencia de `totales`, donde
 * si es el precio de esa línea el que importa esa moneda se vuelve "—" más
 * abajo.
 *
 * Extraída como función pura por el mismo motivo que `resumenDelCarrito`
 * arriba: la review final de esta task encontró que forzar este resultado a
 * una constante (0), escrito inline en el cuerpo del componente sin nombre
 * propio, dejaba los tests de entonces en verde — el cableado que SÍ se
 * probaba (`resumenDelCarrito(lineas.length, unidadesMilesimas)`, el caso de
 * abajo) sigue intacto aunque la cuenta de adentro esté rota, porque ese
 * caso nunca mira DE DÓNDE sale el segundo argumento.
 */
export function unidadesDelCarrito(enCentavos: { cantidadMilesimas: number }[]): number {
  return enCentavos.reduce((acc, l) => acc + (Number.isNaN(l.cantidadMilesimas) ? 0 : l.cantidadMilesimas), 0)
}

/**
 * Las líneas de la banda de --marca: una por moneda con algo que mostrar, o
 * la de pesos sola cuando no hay ninguna otra — el ancla no puede desaparecer
 * con el carrito vacío (ver el comentario de la banda, más abajo).
 *
 * `totales.ars/usd !== 0` y no `> 0` decide si esa moneda "tiene algo que
 * mostrar": un `NaN` (una línea a medio tipear en esa moneda) también es
 * distinto de cero, así que la línea sigue ahí con "—" en vez de
 * desaparecer — la misma regla que ya usaba la banda de un solo total antes
 * de esta task. Con las DOS en cero (el carrito vacío, o el caso imposible en
 * la práctica de artículos a precio $0) se cae al caso de arriba: una sola
 * línea, en pesos.
 *
 * Con una sola moneda con algo que mostrar la banda queda con UNA línea,
 * igual que antes de esta task; las dos aparecen sólo con un carrito mixto —
 * es la lectura de `design/arandano.pen` que rige acá: la maqueta modela
 * reposo, no cada combinación posible, y su silencio sobre el carrito mixto
 * no es instrucción de no mostrar el total en dólares.
 */
export function lineasDeTotal(
  totales: TotalesEnCentavos,
): { moneda: 'ARS' | 'USD'; signo: string; monto: string }[] {
  const linea = (moneda: 'ARS' | 'USD', centavos: number) => ({
    moneda,
    signo: moneda === 'USD' ? 'US$' : '$',
    // `precioEnSuMoneda` adentro de `montoSinSigno` y no el ternario a mano:
    // el helper es exactamente ese ternario, y el `montoSinSigno` de afuera no
    // le estorba — la banda pinta su `$`/`US$` como SU PROPIO elemento (`signo`,
    // acá al lado), así que lo que se quita es el símbolo duplicado, no la
    // elección de moneda.
    monto: Number.isNaN(centavos)
      ? '—'
      : montoSinSigno(precioEnSuMoneda(deCentavos(centavos), moneda)),
  })
  const hayArs = totales.ars !== 0
  const hayUsd = totales.usd !== 0
  if (!hayArs && !hayUsd) return [linea('ARS', totales.ars)]
  return [...(hayArs ? [linea('ARS', totales.ars)] : []), ...(hayUsd ? [linea('USD', totales.usd)] : [])]
}

/**
 * Qué cotización le corresponde a un pago que acaba de cambiar de `moneda` o
 * de `cubre`.
 *
 * **VACÍA cuando el pago CRUZA monedas**, y ésa es la regla del ciclo: la
 * cotización no se precarga nunca, ni con la del local ni con la del último
 * pago. Un `'1'` heredado sobre un pago que pasó a cruzar no es un default
 * inocente —es un dólar a un peso, y una venta que cierra por un número que
 * nadie tipeó—.
 *
 * **Y `'1'` cuando NO cruza**, que es lo que el servidor necesita: con
 * `moneda === cubre` la cotización no entra en ninguna cuenta (ver
 * `aporteDePago`/`montoEntregado` en lib/ventas/totales.ts), pero `crearVenta`
 * la exige mayor que cero igual y rechaza con COTIZACION_INVALIDA.
 *
 * Escribir el `'1'` acá es además lo que limpia una cotización MENTIROSA:
 * tipear 1485 con `cubre: 'USD'` y después volver el selector a pesos dejaba
 * ese 1485 pegado a un pago que ya no convierte nada, y como el servidor ni
 * la mira en ese caso, terminaba guardado en `Pago.cotizacion` —histórico e
 * inmutable— sin que ninguna cuenta de la pantalla lo notara.
 */
export function cotizacionParaElCruce(moneda: Pago['moneda'], cubre: Pago['cubre']): string {
  return moneda === cubre ? '1' : ''
}

/**
 * Qué total cubre un pago que se crea solo: el único que la venta tiene.
 *
 * Con las dos monedas presentes —y con el carrito vacío— manda ARS, que es el
 * default de siempre y el que deja elegir al selector de `Cubre`. Con SÓLO el
 * total en dólares distinto de cero manda USD: si no, el pago inicial de un
 * carrito de un solo iPhone arrancaría cubriendo un total en pesos que vale
 * cero, la venta no cerraría nunca, y el selector para corregirlo tampoco se
 * dibuja —aparece únicamente cuando la venta tiene los DOS totales—.
 */
export function cubrePorDefecto(totales: TotalesEnCentavos): 'ARS' | 'USD' {
  return totales.ars === 0 && totales.usd !== 0 ? 'USD' : 'ARS'
}

/**
 * El ÚNICO pago de la venta, seguido al total que le corresponde cuando el
 * carrito cambia.
 *
 * Mientras la venta tenga las DOS monedas manda lo que la persona eligió en el
 * selector de `Cubre`, y esto sólo le actualiza la base. Cuando queda UNA
 * sola, el pago se re-apunta a la que quedó: sacar la funda de un carrito
 * mixto dejaba al único pago cubriendo un total en pesos que ya no existe, con
 * el selector escondido —aparece sólo con los dos totales— y por lo tanto sin
 * ninguna forma de arreglarlo desde la pantalla.
 *
 * **Re-apuntar arrastra las otras tres cosas del pago, y ninguna es opcional:**
 *
 * - La MONEDA que entrega, para que el pago no quede cruzando sin que nadie lo
 *   haya pedido.
 * - La COTIZACIÓN, que se rehace en vez de heredarse: la vieja sería
 *   exactamente la cotización mentirosa que `cotizacionParaElCruce` existe
 *   para evitar.
 * - **El PLAN, que se limpia.** Es la misma regla que aplican los tres
 *   selectores de la fila —un plan que sobrevive a un cambio que lo vuelve
 *   inválido es un error del motor con la pantalla en verde— y acá el cambio
 *   de moneda lo dispara el carrito, no un clic. Sin esto, el pago pasaba a
 *   `moneda: 'USD'` con el plan puesto y las tres cosas malas juntas:
 *   `planesOfrecidos` no dibuja el selector para un pago en dólares, así que
 *   el plan quedaba sin ningún control que lo sacara; `cierra` daba verdadero,
 *   así que "Cobrar" se habilitaba para que el motor rechazara con
 *   PLAN_EN_DOLARES; y el pie calculaba el recargo sobre una base en dólares
 *   tratada como pesos.
 *
 * Extraída como función pura y no escrita adentro del `setPagos` por el mismo
 * motivo que `hayFaltanteDeVenta` o `cubrePorDefecto`: la review de esta task
 * mutó la condición del re-apuntado a `true` —anulándolo entero— y la suite
 * quedó en verde, porque nada lo probaba aislado y el harness no puede montar
 * un carrito.
 */
export function reapuntarPagoUnico(pago: Pago, totales: TotalesEnCentavos): Pago {
  const lasDos = totales.ars !== 0 && totales.usd !== 0
  const cubre = lasDos ? pago.cubre : cubrePorDefecto(totales)
  const seReapunto = cubre !== pago.cubre
  const moneda = seReapunto ? cubre : pago.moneda
  return {
    ...pago,
    cubre,
    moneda,
    cotizacion: seReapunto ? cotizacionParaElCruce(moneda, cubre) : pago.cotizacion,
    planId: seReapunto ? null : pago.planId,
    // El total DE LO QUE ESE PAGO CUBRE, y ya no el de su moneda: con
    // `moneda !== cubre` los dos dejan de coincidir, y seguir el de la moneda
    // haría que un pago en pesos contra el total en dólares persiguiera el
    // total en pesos.
    base: deCentavos(cubre === 'ARS' ? totales.ars : totales.usd),
  }
}

/**
 * Lo que una fila del panel de cobro tiene que decir de sí misma para que se
 * pueda calcular cuánta plata entra por ella.
 *
 * Las dos monedas van juntas a propósito: desde este ciclo, con la base sola y
 * la cotización sola ya no alcanza —la misma base `300` son 300 dólares o
 * 445.500 pesos según qué entrega y qué cubre—.
 */
type FilaDePagoDeLaPantalla = {
  moneda: Pago['moneda']
  cubre: Pago['cubre']
  base: string
  cotizacion: string
  planId: string | null
}

/**
 * Los pesos que ESTA fila entrega, antes del recargo.
 *
 * `montoEntregadoEnCentavos` (lib/ventas/centavos.ts) y no la base pelada: es
 * el espejo exacto de `montoEntregado` del motor, que es sobre lo que el
 * servidor calcula el recargo del plan. Un pago en pesos que cubre el total en
 * dólares tiene base 300 y entrega 445.500 pesos; aplicarle el porcentaje a
 * 300 daría un recargo mil veces más chico que el que cobra el motor.
 */
function pesosDeLaFilaEnCentavos(pago: FilaDePagoDeLaPantalla): number {
  return montoEntregadoEnCentavos({
    moneda: pago.moneda,
    cubre: pago.cubre,
    baseCentavos: dineroEnCentavos(pago.base),
    cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(pago.cotizacion),
  })
}

/**
 * Cuántos pesos vale la otra punta de un pago que CRUZA monedas, para el
 * renglón "Entran $X" (design/arandano.pen, nodo `OTlAa`).
 *
 * Reusa `pesosDePagoEnCentavos` (lib/ventas/centavos.ts) —el mismo cálculo
 * que ata el total de la venta contra la suma de los pagos— en vez de
 * reinventar "monto × cotización" a mano acá: son los mismos centavos que el
 * motor ya suma para decidir si la venta cierra, y escribir la cuenta dos
 * veces es la forma en que este archivo se desincronizaría de esa cuenta sin
 * que ningún test lo note.
 *
 * **Sirve para los DOS cruces, y por eso el renglón se gatea por `cruza` y ya
 * no por `moneda === 'USD'`**: `base × cotización` son los pesos que entran
 * cuando se entregan pesos contra el total en dólares, y los pesos de
 * mercadería que se cubren cuando se entregan dólares contra el total en
 * pesos. En los dos casos es el número que no está escrito en ningún campo de
 * la fila. Cuando el pago NO cruza no hay segunda punta que mostrar: el campo
 * de arriba ya lo dice todo.
 */
export function entranPesosCentavos(montoUsd: string, cotizacion: string): number {
  return pesosDePagoEnCentavos(dineroEnCentavos(montoUsd), cotizacionEnDiezMilesimas(cotizacion))
}

/**
 * Los planes que UN pago puede elegir: los de su medio, y sólo si es en pesos.
 *
 * Las dos mitades son la misma regla —no ofrecer lo que el servidor va a
 * rechazar—, con dos códigos distintos del motor detrás: un plan de otro medio
 * es `PLAN_NO_CORRESPONDE` y cualquier plan sobre un pago en dólares es
 * `PLAN_EN_DOLARES` (`lib/ventas/crear.ts`). Un selector que ofrezca
 * cualquiera de las dos cosas es un selector que ofrece un error.
 *
 * Función pura y exportada por el mismo motivo que `hayFaltanteDeVenta` o
 * `unidadesDelCarrito`: un filtro escrito inline en el JSX se puede invertir
 * —o perder una de las dos mitades— sin que ningún caso de render lo note,
 * porque este harness sólo llega a montar el pago en efectivo y en pesos que
 * arranca solo.
 *
 * **No mira `cubre`, y no es un olvido**: el motor prohíbe el plan sobre un
 * pago ENTREGADO en dólares (ahí el recargo saldría en dólares y volver a
 * pesos exigiría dividir), no sobre uno que CUBRA el total en dólares — un
 * pago en pesos contra el total en dólares lleva su plan sin problema, y es
 * justamente el caso del iPhone financiado en doce cuotas. Filtrar también
 * por `cubre` le sacaría al mostrador el caso más caro de la pantalla.
 */
export function planesOfrecidos(
  pago: { medio: Pago['medio']; moneda: Pago['moneda'] },
  planes: PlanVisible[],
): PlanVisible[] {
  if (pago.moneda !== 'ARS') return []
  return planes.filter((p) => p.medio === pago.medio)
}

/** Un importe del pie, con la misma guarda de NaN que el resto de la plata de
 *  esta pantalla: un monto a medio tipear deja la cuenta en NaN, y
 *  `formatearPrecio(NaN)` imprime "$ NaN". */
function montoDelPie(centavos: number): string {
  return Number.isNaN(centavos) ? '—' : formatearPrecio(deCentavos(centavos))
}

/**
 * Las tres líneas del pie del panel de cobro —Mercadería, Recargo (o
 * Descuento, según el signo) y Total a cobrar—, o ninguna cuando no hay ningún
 * plan elegido: sin recargo el pie no crece y la pantalla queda exactamente
 * como estaba.
 *
 * **La banda de `--marca` sigue mostrando la MERCADERÍA**, que es el ancla de
 * contenido de esta pantalla y el número contra el que se reparten los pagos.
 * El total a cobrar vive acá, en el panel donde se decide cuánta plata entra.
 *
 * **El total a cobrar es mercadería + recargo**, no la suma de los pagos: es
 * lo que va a entrar a la caja cuando la venta cierre, y sale del mismo número
 * que la banda de arriba en vez de una segunda cuenta que pueda decir otra
 * cosa.
 *
 * El recargo se calcula con `recargoEnCentavos` y `porcentajeEnMilesimas`
 * (`lib/ventas/centavos.ts`), que son el espejo exacto de `recargoDePago` del
 * servidor —`centavos.test.ts` compara las dos aritméticas caso por caso—, y
 * no con una cuenta propia: un porcentaje aplicado dos veces de dos formas es
 * la manera de que el pie diga un número y el motor cobre otro. Sobre la BASE
 * ya convertida a pesos, igual que el servidor, que sólo acepta plan con
 * cotización 1.
 *
 * Un recargo en NaN (monto a medio tipear) NO esconde el pie: `NaN !== 0`, así
 * que las tres líneas siguen ahí con "—" donde no se puede calcular. Esconder
 * el bloque entero mientras se retipea un monto haría parpadear tres líneas en
 * cada tecla.
 */
export function lineasDelPieDeCobro(
  mercaderiaCentavos: number,
  pagos: FilaDePagoDeLaPantalla[],
  planes: PlanVisible[],
  hayTotalEnDolares: boolean,
): { rotulo: string; monto: string }[] {
  const conPlan = pagos.flatMap((p) => {
    const plan = planes.find((pl) => pl.id === p.planId)
    return plan ? [{ pago: p, plan }] : []
  })
  // `recargoDeLaFilaEnCentavos` y no la cuenta inline: es la MISMA función que
  // usa el chip de vuelto de cada fila, así que el pie y el vuelto no pueden
  // aplicar el porcentaje de dos formas distintas.
  const recargoCentavos = conPlan.reduce(
    (acc, { pago }) => acc + recargoDeLaFilaEnCentavos(pago, planes),
    0,
  )
  if (recargoCentavos === 0) return []

  // LA PALABRA SALE DEL SIGNO, no es fija. "Recargo Contado −$ 1.000,00"
  // contradice su propio número en la misma línea, y el descuento por pago
  // contado es un caso de primera clase de este producto —tan común como el
  // recargo por cuotas, lo dice el spec—, no un borde. Del NETO y no del
  // porcentaje de un plan: con dos planes que se compensan, el signo del total
  // es lo único que describe bien lo que pasó.
  //
  // Y bajo "Descuento" el importe va SIN signo (`Math.abs`). El rótulo ya dice
  // de qué lado está, y un "−" al lado de la palabra es una doble negación que
  // en un mostrador se lee al revés ("descuento negativo"). Así se lee
  // cualquier ticket —mercadería, menos el descuento, total—, y el total, que
  // queda POR DEBAJO de la mercadería, es la confirmación de la dirección. Es
  // a propósito lo contrario de `formatearPorcentaje`, que sí muestra el signo
  // siempre: ahí el rótulo de la columna es fijo y el signo es lo ÚNICO que
  // distingue un plan de recargo de uno de descuento.
  //
  // Con el recargo en NaN (un monto a medio tipear) no hay signo que mirar y
  // la palabra cae en "Recargo" con "—" de importe: no afirma ningún número,
  // así que tampoco puede contradecir a ninguno.
  const palabra = recargoCentavos < 0 ? 'Descuento' : 'Recargo'
  // Con UN solo plan elegido el rótulo lo nombra ("Recargo 3 cuotas"): un
  // "Recargo" pelado no dice de qué recargo habla. Con dos planes distintos el
  // número es la suma de los dos, así que nombrar a uno sería atribuirle un
  // recargo que no es suyo.
  const nombres = [...new Set(conPlan.map(({ plan }) => plan.nombre))]
  return [
    { rotulo: 'Mercadería', monto: montoDelPie(mercaderiaCentavos) },
    {
      rotulo: nombres.length === 1 ? `${palabra} ${nombres[0]}` : palabra,
      monto: montoDelPie(Math.abs(recargoCentavos)),
    },
    {
      // "Total a cobrar EN PESOS" en cuanto la venta tiene también un total en
      // dólares, y ése es el hallazgo Important 2 de la review: este pie es un
      // desglose en pesos de punta a punta (ver `mercaderiaEnPesosCentavos`),
      // así que con una funda de $10.000 con descuento y un iPhone de US$ 300
      // pagado EN dólares la línea decía "Total a cobrar $9.000" sin mencionar
      // los dólares en ningún lado — y el chip de faltante en dólares tampoco
      // los menciona, porque esa parte está cubierta y el chip en cero no se
      // dibuja. Un cajero que confía en la línea rotulada "Total a cobrar"
      // cobra de menos, y la venta cierra igual porque el motor la da por
      // cerrada.
      //
      // El rótulo y no una segunda línea en dólares: la maqueta no dibuja este
      // bloque (deuda ya anotada), y agregarle una línea es diseño nuevo sobre
      // algo que nadie dibujó. Decir en qué moneda está el número que ya
      // muestra es la corrección más chica que lo vuelve cierto.
      rotulo: hayTotalEnDolares ? 'Total a cobrar en pesos' : 'Total a cobrar',
      monto: montoDelPie(mercaderiaCentavos + recargoCentavos),
    },
  ]
}

/**
 * El recargo (o descuento, con signo) que UNA fila de pago le suma a su base,
 * en centavos. Cero sin plan elegido, que es el caso normal.
 *
 * Con `recargoEnCentavos` y `porcentajeEnMilesimas` (`lib/ventas/centavos.ts`),
 * que son el espejo exacto de `recargoDePago` del servidor —`centavos.test.ts`
 * compara las dos aritméticas caso por caso—, y sobre los PESOS QUE ENTREGA la
 * fila (`pesosDeLaFilaEnCentavos`), igual que el motor. Recibe la fila entera y
 * ya no la base y la cotización sueltas: desde este ciclo, saber cuántos pesos
 * entran exige saber además qué moneda se entrega y qué total se cubre.
 */
export function recargoDeLaFilaEnCentavos(
  pago: FilaDePagoDeLaPantalla,
  planes: PlanVisible[],
): number {
  const plan = planes.find((p) => p.id === pago.planId)
  if (!plan) return 0
  return recargoEnCentavos(pesosDeLaFilaEnCentavos(pago), porcentajeEnMilesimas(plan.porcentaje))
}

/**
 * Lo que hay que cobrarle a la persona por ESTA fila de pago, en centavos: su
 * base más el recargo de su plan.
 *
 * **Es lo que el chip de vuelto tiene que restarle a "con cuánto paga", y no
 * la base.** La base es lo que ese pago cubre de la MERCADERÍA, a precio de
 * lista; con un plan de efectivo en pesos —el descuento por pago contado, que
 * este producto trata como caso de primera clase— los dos números no
 * coinciden, y restar la base le devolvía de menos a quien paga en efectivo
 * con descuento y de más con un recargo. Plata real, del cajón, en la única
 * pantalla del producto donde se cuentan billetes.
 *
 * Exportada y no inline en el JSX por el mismo motivo que `planesOfrecidos` o
 * `hayFaltanteDeVenta`: este harness sólo llega a montar el pago en efectivo y
 * en pesos que arranca solo, así que una cuenta escrita adentro del JSX no la
 * puede probar nadie.
 */
export function aCobrarDeLaFilaEnCentavos(
  pago: FilaDePagoDeLaPantalla,
  planes: PlanVisible[],
): number {
  return pesosDeLaFilaEnCentavos(pago) + recargoDeLaFilaEnCentavos(pago, planes)
}

/**
 * Si UN pago puede mostrar su chip de vuelto, dado el estado de PAGO
 * agregado de toda la venta.
 *
 * Vuelto y faltante son estados excluyentes a propósito, y hasta esta task
 * nada lo garantizaba: mostrar "te sobran $10.000" en un pago en efectivo
 * mientras la VENTA completa sigue corta —porque hay otro pago insuficiente
 * al lado— le dice al cajero que dé vuelto sobre una venta que en conjunto no
 * cerró. `hayFaltante` tiene que venir calculado sobre TODOS los pagos
 * (`faltanCentavos > 0`, ver el cuerpo de `PuntoDeVenta`), no sobre éste
 * solo — por eso es un parámetro y no algo que esta función recalcule.
 */
export function puedeMostrarVuelto(esEfectivoArs: boolean, hayFaltante: boolean): boolean {
  return esEfectivoArs && !hayFaltante
}

/**
 * Si la VENTA completa tiene faltante, dado cuánto falta en centavos.
 *
 * NaN (un monto a medio tipear en CUALQUIER pago) cuenta como "sí hay
 * faltante" — "no se sabe si cierra" no es licencia para mostrarle vuelto a
 * nadie, mismo criterio conservador que ya usa `hayLineaInvalida` en el
 * cuerpo de `PuntoDeVenta`.
 *
 * Extraída como función pura por el mismo motivo que `pasoDeCantidad` o
 * `resumenDelCarrito` más arriba: la review final de esta task encontró que
 * invertir esta cuenta a mano (adentro del cuerpo del componente, sin
 * nombre propio) dejaba los tests de entonces en verde — nada la probaba
 * aislada, y el cableado que SÍ se probaba (`hayFaltante={hayFaltante}`, más
 * abajo) sigue intacto aunque la cuenta de adentro esté invertida.
 */
export function hayFaltanteDeVenta(faltanCentavos: number): boolean {
  return Number.isNaN(faltanCentavos) || faltanCentavos > 0
}

/**
 * La mercadería EN PESOS que la venta pide, que es contra lo que el pie del
 * cobro suma el recargo del plan.
 *
 * El total en pesos del carrito MÁS los pesos con los que los pagos cubren la
 * parte en dólares. No es `totales.ars` a secas, y ése era el provisorio que
 * la Task 9 dejó anotado: un carrito de un solo iPhone de lista US$ 300 pagado
 * en pesos con un plan tiene `totales.ars` en cero, así que el pie decía
 * "Mercadería $0 / Total a cobrar $178.200" mientras la fila de arriba decía
 * "A cobrar $623.700" — dos números de la misma pantalla contradiciéndose.
 *
 * **La parte que se paga EN dólares no entra acá**, y por eso el pie sigue
 * siendo un desglose en pesos de punta a punta: no hay pesos que sumarle, y el
 * plan tampoco puede tocarla (el motor sólo acepta plan sobre un pago
 * entregado en pesos, ver `planesOfrecidos`).
 *
 * Lo que eso deja afuera es real: en un carrito mixto pagado mitad en dólares,
 * el pie habla sólo de la mitad en pesos. **Y el chip de faltante en dólares
 * NO lo compensa** —eso decía la primera versión de este comentario y es
 * falso—: si esa parte está cubierta, `faltan.usd` da cero y el chip no se
 * dibuja. Lo que lo vuelve honesto es el rótulo: con un total en dólares
 * presente, la última línea dice "Total a cobrar EN PESOS" (ver
 * `lineasDelPieDeCobro`).
 */
export function mercaderiaEnPesosCentavos(
  totales: TotalesEnCentavos,
  pagos: FilaDePagoDeLaPantalla[],
): number {
  return pagos.reduce(
    (acc, p) => (p.moneda === 'ARS' && p.cubre === 'USD' ? acc + pesosDeLaFilaEnCentavos(p) : acc),
    totales.ars,
  )
}

/**
 * Un chip de faltante por cada moneda que la venta tenga, en el mismo orden
 * que la banda del total (`lineasDeTotal`): pesos y después dólares.
 *
 * `totales.x !== 0` y no `> 0`, por lo mismo que `lineasDeTotal`: una línea a
 * medio tipear deja esa moneda en NaN, que también es distinto de cero, y el
 * chip se sigue reservando su lugar —lo pinta o no lo pinta `ChipDeFaltante`,
 * que ya trata el NaN—. Con una sola moneda en la venta sale UN chip, igual
 * que antes de este ciclo; con el carrito vacío y sin pagos no sale ninguno,
 * que es lo mismo que hacía el chip único con `hayCarrito` en falso.
 *
 * **O `faltan.x !== 0`, aunque el total de esa moneda sea cero** (ola final
 * del ciclo del precio en dólares). Ese `o` cubre el único camino que dejaba
 * "Cobrar" apagado y MUDO, y hace falta describirlo entero porque la
 * condición sola no lo sugiere:
 *
 *  1. Carrito mixto (un iPhone en dólares + una funda de $15.000) y DOS
 *     pagos, uno apuntado a cada total.
 *  2. Se saca la funda: `totales.ars` pasa a 0.
 *  3. `reapuntarPagoUnico` no corre —sólo re-apunta cuando hay UN pago, ver
 *     ahí—, así que el segundo pago se queda cubriendo pesos con base 15.000.
 *  4. `faltan.ars = 0 − 15.000 = −15.000`, la venta no cierra y "Cobrar"
 *     queda deshabilitado.
 *  5. Con la condición vieja (`totales.ars !== 0`) el chip que lo explicaría
 *     no se dibujaba, y el selector `Cubre` tampoco (`ofreceCubre` pide las
 *     dos monedas presentes), así que no quedaba ni cartel ni control.
 *
 * Con el `o`, ese estado muestra `Sobran $ 15.000,00` — que es exactamente el
 * cartel que faltaba. Es recuperable como siempre ("Quitar pago", Esc-Esc),
 * pero ahora la pantalla dice qué pasó en vez de apagar el botón sin motivo
 * visible. Es el reverso del defecto simétrico que ya se corrigió en este
 * mismo ciclo, donde "Cobrar" quedaba habilitado y el motor rechazaba.
 */
export function chipsDeFaltante(
  totales: TotalesEnCentavos,
  faltan: TotalesEnCentavos,
): { moneda: 'ARS' | 'USD'; faltanCentavos: number }[] {
  return [
    ...(totales.ars !== 0 || faltan.ars !== 0
      ? [{ moneda: 'ARS' as const, faltanCentavos: faltan.ars }] : []),
    ...(totales.usd !== 0 || faltan.usd !== 0
      ? [{ moneda: 'USD' as const, faltanCentavos: faltan.usd }] : []),
  ]
}

/**
 * Si hay algún overlay de Radix abierto ahora mismo: el listbox de un
 * `Select` desplegado, un dialog o un menu. Los tres primitivos comparten el
 * mismo defecto (ver el comentario largo de `puedeDispararCobroDesdeFoco` y
 * el del efecto que llama a esta función): ninguno corta la propagación del
 * evento hacia `window`, así que el listener global de esta pantalla ve el
 * mismo Enter/Escape que Radix ya está atendiendo. La salida no es adivinar
 * qué tecla hace qué cosa en cada primitivo — es que el listener se
 * ABSTENGA por completo mientras el overlay siga montado.
 *
 * `[role="listbox"]` (y análogos) sólo existen en el DOM mientras el overlay
 * está DESPLEGADO: `SelectContent` de `@radix-ui/react-select` se monta con
 * `<Presence present={context.open}>` y se DESMONTA al cerrar —no lo oculta
 * con `display:none` ni con un atributo `data-state="closed"` que quedara
 * dando vueltas—, así que alcanza con preguntarle al DOM en cada tecla, sin
 * guardar estado propio por cada `SelectContent` de la pantalla (la tercera
 * opción que la review consideró, y la que este archivo NO eligió).
 *
 * SIN TEST: usa `document`, que es DOM real (ver la nota del efecto que la
 * llama). Se verificó en runtime con un test de jsdom escrito para esta
 * task y borrado después de confirmar — el resultado queda en el reporte
 * final, no acá.
 */
function hayOverlayDeRadixAbierto(): boolean {
  return document.querySelector('[role="listbox"], [role="dialog"], [role="menu"]') !== null
}

export function PuntoDeVenta({
  planes,
  caja,
  cotizacionUsd,
  cotizacionUsdEn,
}: {
  // `cotizacionInicial` se borró en este ciclo: era la última cotización con la
  // que se había cobrado un pago (`Pago.cotizacion`, histórica) y precargaba el
  // campo. La cotización arranca VACÍA siempre — ver `cotizacionParaElCruce`.

  // Los planes ACTIVOS del local, leídos en el servidor (`page.tsx`) por lo
  // mismo que la cotización: el cliente no consulta la base. Vacío es el caso
  // normal de un local que no cargó ninguno, y entonces la pantalla no dibuja
  // un solo control nuevo.
  planes: PlanVisible[]
  // Los tres datos del chip de caja. Llegan como props y no se leen acá: el
  // servidor los resuelve en page.tsx (ver su comentario) y este componente
  // los reparte entre el chip del header, el del cuerpo y el menú del Topbar.
  caja: CajaDelChip | null
  cotizacionUsd: string | null
  cotizacionUsdEn: Date | null
}) {
  const [estado, accion, cobrando] = useActionState(cobrar, INICIAL)
  // El paso de la venta en el teléfono: carrito o cobro. Vive en la URL vía
  // `pushState`, sin pasar por el router de Next — ver app/(app)/vender/paso.ts
  // para el porqué (una navegación remontaría este componente con el carrito
  // de la venta en curso adentro).
  const { paso, irACobro, volverAlCarrito, descartarElCobro } = usePasoDeCobro()
  const enTelefono = useIsMobile()
  // En escritorio el paso se ignora POR COMPLETO: las dos columnas se ven
  // siempre y el Topbar no cambia, aunque la URL traiga `?paso=cobro` —lo que
  // pasa, por ejemplo, al agrandar la ventana a mitad de un cobro—. Las
  // columnas resuelven lo suyo por CSS (`hidden lg:flex`, más abajo), que no
  // necesita saber el ancho; el Topbar no puede, porque su título y su flecha
  // son props y no clases, así que ahí sí hace falta preguntar.
  const pasoVisible = enTelefono ? paso : 'carrito'
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ArticuloVendible[]>([])
  // Una clave por CARRITO, no por formulario: se renueva cuando cambia lo que
  // se está vendiendo (ver el ajuste de más abajo). Atarla a la vida del
  // componente —renovarla sólo al cobrar bien— tenía un modo de falla que es
  // el espejo del que la clave existe para evitar: si la respuesta del cobro
  // se pierde en el camino, quien cobra no ve el cartel de éxito, agrega el
  // artículo que faltaba y vuelve a apretar Cobrar con la misma clave; el
  // motor devuelve la venta ANTERIOR, la pantalla dice "cobrada" y el artículo
  // agregado no se cobró ni se descontó del stock. Un carrito distinto es una
  // venta distinta. El doble click y el F5 no cambian el carrito, así que
  // siguen cubiertos.
  //
  // Arranca vacía —y no con un uuid— para que el render del servidor y el del
  // navegador coincidan: `crypto.randomUUID()` en el estado inicial daba dos
  // valores distintos. Con el carrito vacío no hay nada que cobrar, así que
  // una clave vacía nunca llega a enviarse.
  const [clave, setClave] = useState('')
  const [carritoReflejado, setCarritoReflejado] = useState(CARRITO_VACIO)
  // La última venta ya procesada por la limpieza de abajo, para no repetirla
  // en cada render.
  const [ventaProcesada, setVentaProcesada] = useState<string | null>(null)
  const [pagos, setPagos] = useState<Pago[]>([])
  // El último total que los pagos ya reflejaron, para el ajuste de más abajo:
  // sin esto, "seguir el total" se repetiría en cada render y pisaría un monto
  // que la persona ya tocó a mano. Los DOS totales (Task 9): un pago en pesos
  // y uno en dólares siguen totales distintos, así que hace falta poder
  // comparar los dos por separado.
  const [totalReflejado, setTotalReflejado] = useState<TotalesEnCentavos | null>(null)
  const buscador = useRef<HTMLInputElement>(null)
  // La búsqueda vigente, para que la respuesta de una búsqueda vieja no pueda
  // pisar la de una más nueva: `clearTimeout` cancela el TIMER si `busqueda`
  // cambió antes de los 200ms, pero no puede cancelar una promesa que ya está
  // en vuelo. Se actualiza en un efecto sin dependencias (corre después de
  // cada render) para no repetir el mismo lint que ya se peleó en el efecto
  // de abajo: mutar un ref no es un setState.
  const busquedaVigente = useRef(busqueda)
  useEffect(() => {
    busquedaVigente.current = busqueda
  })
  // Guarda de reentrada para el Enter del buscador. Sin estado a propósito:
  // no hay que re-renderizar por esto, y un ref no entra en las reglas de
  // set-state que este archivo ya tuvo que esquivar.
  const consultando = useRef(false)
  // El <form> de Cobro, para que el atajo global de Enter pueda dispararlo
  // desde CUALQUIER parte de la pantalla (no sólo con el foco adentro del
  // form) sin duplicar la lógica de envío: `requestSubmit()` es el mismo
  // camino que ya usa el botón, con la misma validación de campos.
  const formularioCobro = useRef<HTMLFormElement>(null)
  // Si el primer Esc ya armó la confirmación de vaciado, esperando el
  // segundo. Ver el comentario largo en el useEffect de abajo para el
  // porqué de dos pasos.
  const [vaciadoArmado, setVaciadoArmado] = useState(false)
  // El timer que desarma la confirmación sola, para que un Esc de hace un
  // rato no quede "cargado" esperando un segundo Esc que ya no tiene que ver
  // con el primero.
  const desarmarVaciado = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Buscar mientras se tipea, con un respiro para no pegarle al servidor en
  // cada tecla. 200ms es lo que separa "tipeando" de "terminó de tipear". El
  // vaciado cuando el texto queda vacío vive en `alCambiarBusqueda`, no acá:
  // el lint del proyecto (react-hooks/set-state-in-effect) rechaza un setState
  // síncrono en el cuerpo de un efecto.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto === '') return
    const t = setTimeout(() => {
      buscarArticulos(texto).then((r) => {
        // Sólo se acepta si el cuadro sigue diciendo lo mismo que cuando se
        // pidió esta búsqueda. Sin esto, tipear rápido de "coca" a "cola" y
        // mandar Enter antes de que vuelva la respuesta de "coca" agregaría
        // el artículo equivocado a una venta en curso.
        if (busquedaVigente.current.trim() === texto) setResultados(r)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [busqueda])

  const enCentavos = lineas.map((l) => ({
    cantidadMilesimas: cantidadEnMilesimas(l.cantidad),
    precioCentavos: aCentavos(l.precio),
    moneda: l.moneda,
  }))
  // Los DOS totales del carrito, uno por moneda (Task 9): `totalesEnCentavos`
  // ya los separa, así que un `NaN` en una línea en pesos no apaga el total en
  // dólares del iPhone de al lado, y viceversa.
  const totales = totalesEnCentavos(enCentavos)
  // NaN cubre las tres formas de estar mal, porque `cantidadEnMilesimas`
  // devuelve NaN para todas: no es un número, la gramática lo considera
  // ambiguo, o el campo quedó VACÍO. El vacío importa aparte: antes contaba
  // como cero, la línea pasaba por buena, Cobrar se encendía y el servidor
  // rechazaba la venta entera con "falta la cantidad".
  const hayLineaInvalida = enCentavos.some((l) => Number.isNaN(l.cantidadMilesimas))
  const hayCarrito = lineas.length > 0 && (totales.ars > 0 || totales.usd > 0) && !hayLineaInvalida
  // Las líneas que pinta la banda de --marca (más abajo) y el subtítulo del
  // Encabezado en el cobro del teléfono: las DOS copias del mismo total leen
  // de ACÁ, no cada una su propia cuenta.
  const lineasTotal = lineasDeTotal(totales)

  // unidadesDelCarrito (arriba): la suma de cantidades, no la cantidad de
  // líneas (eso ya lo da `lineas.length`, el otro término de
  // `resumenDelCarrito`).
  const unidadesMilesimas = unidadesDelCarrito(enCentavos)

  // Clave nueva en cuanto el carrito deja de ser el que la clave describe.
  // Ajuste durante el render, con la misma forma que los dos bloques de abajo:
  // se compara contra lo último reflejado y ese mismo estado se actualiza acá,
  // así que el render siguiente ya no entra y no hay ciclo.
  const firmaActual = firmaDelCarrito(lineas)
  if (firmaActual !== carritoReflejado) {
    setCarritoReflejado(firmaActual)
    // Sin carrito no hay venta que identificar, y una clave sin usar gastada
    // en cada limpieza no molesta a nadie pero tampoco sirve.
    setClave(lineas.length === 0 ? '' : crypto.randomUUID())
  }

  // Cuando el carrito cambia y hay un solo pago, se le sigue el total DE SU
  // MONEDA (Task 9 — antes sólo pesos, porque no existía un total en dólares
  // del cual seguir a un pago en USD): el caso del 90% es cobrar todo junto
  // y no tener que retocar el monto cada vez que se agrega un artículo, sea
  // cual sea la moneda del único pago. Con dos pagos se deja de tocar — ahí
  // la persona ya decidió cómo reparte.
  // Ajuste durante el render (no un efecto) por la misma razón que el bloque
  // de `ventaProcesada` de abajo: comparar contra `totalReflejado`, que este
  // mismo bloque actualiza, es lo que hace que el segundo render no vuelva a
  // dispararlo.
  //
  // Una cantidad a medio tipear deja NaN en LA MONEDA de esa línea (ver
  // `totalesEnCentavos`), y `NaN !== NaN` es siempre verdadero: sin el
  // `!Number.isNaN` de las dos mitades, la guarda nunca cerraría y `setPagos`
  // seguiría devolviendo un array y un objeto nuevos en cada pasada hasta
  // "Too many re-renders", perdiendo la venta en curso. Con CUALQUIERA de las
  // dos monedas inválida los pagos se quedan con el último total bueno; el
  // botón ya está apagado por `hayLineaInvalida`, así que no hace falta nada
  // más.
  //
  // **La guarda es de las DOS monedas juntas a propósito, y es un límite
  // aceptado, no algo diferido.** Partirla por moneda —dejar que el pago que
  // cubre dólares siga su total mientras la línea en pesos está a medio
  // tipear— es más fino y no está construido: obliga a decidir, pago por
  // pago, a qué pila sigue cada uno, y a que `reapuntarPagoUnico` conviva con
  // un total envenenado de un solo lado. Lo que se pierde mientras tanto es
  // chico y transitorio: mientras una cantidad esté ilegible, los pagos se
  // quedan quietos en el último total bueno, y en cuanto se termine de tipear
  // vuelven a seguirlo. **El disparador para partirla**: que a alguien del
  // mostrador le moleste de verdad tener que retocar el monto de un pago
  // después de corregir una cantidad en la OTRA moneda.
  const totalesValidos = !Number.isNaN(totales.ars) && !Number.isNaN(totales.usd)
  const totalesCambiaron =
    totalReflejado === null || totales.ars !== totalReflejado.ars || totales.usd !== totalReflejado.usd
  if (totalesValidos && totalesCambiaron) {
    setTotalReflejado(totales)
    setPagos((previos) => {
      // El pago que nace solo se ENTREGA en la misma moneda del total que
      // CUBRE (`moneda: cubre`), así no arranca cruzando y no pide una
      // cotización que nadie tipeó todavía. Un carrito en pesos queda
      // exactamente igual que antes de este ciclo: EFECTIVO, en pesos, contra
      // el total en pesos.
      if (previos.length === 0) {
        const cubre = cubrePorDefecto(totales)
        return [
          {
            medio: 'EFECTIVO',
            moneda: cubre,
            cubre,
            base: deCentavos(cubre === 'ARS' ? totales.ars : totales.usd),
            // No cruza (moneda === cubre), así que 1 — ver `cotizacionParaElCruce`.
            cotizacion: cotizacionParaElCruce(cubre, cubre),
            recibido: '',
            planId: null,
          },
        ]
      }
      // Con UN solo pago se le sigue el total que cubre, y se lo re-apunta si
      // esa moneda desapareció del carrito — ver `reapuntarPagoUnico`, que es
      // donde vive la regla entera. Con dos o más se deja de tocar: ahí la
      // persona ya decidió cómo reparte.
      if (previos.length === 1) return [reapuntarPagoUnico(previos[0], totales)]
      return previos
    })
  }

  // Al cobrar bien: carrito vacío y pagos vacíos (la clave se renueva sola,
  // por el ajuste de la firma de más arriba), calculado
  // durante el render en vez de en un efecto — es el patrón que React
  // documenta para "ajustar estado cuando cambia otro estado" (comparar
  // contra la última venta ya procesada), y el único que este lint acepta
  // para un setState síncrono.
  if (estado.venta && estado.venta.id !== ventaProcesada) {
    setVentaProcesada(estado.venta.id)
    setLineas([])
    setBusqueda('')
    setResultados([])
    // La clave no se toca acá: vaciar el carrito ya la renueva por el ajuste
    // de arriba, y tenerla en un solo lugar es lo que evita que las dos
    // reglas se contradigan.
    // Pagos vacíos y no la fila fija de antes: el ajuste de arriba la vuelve
    // a poner en el próximo render, ya por el total de la venta siguiente
    // (0 hasta que se agregue el primer artículo).
    setPagos([])
  }

  // Qué pasa cuando una venta se cobró bien. Un efecto de verdad y no un
  // ajuste durante el render, porque las dos cosas que hace son efectos:
  // `pushState` toca el historial del navegador y `focus()` toca el DOM, y las
  // dos sólo pueden pasar después de que React confirmó el render.
  //
  // LA VUELTA AL CARRITO ES LO PRIMERO, y en el teléfono no es cosmética.
  // Vaciar el carrito y devolver el foco al buscador —lo único que hacía este
  // efecto— deja la pantalla invitando a escanear el próximo artículo; si el
  // paso sigue en cobro, la card del carrito y su banda de total están en
  // `hidden`, así que ese escaneo suma líneas a una tabla que no se ve y a un
  // total que no se ve. Es el flujo normal, venta tras venta.
  //
  // `descartarElCobro` y NO `volverAlCarrito`: son la misma vuelta con
  // historiales distintos (ver `MotivoDelPaso` en paso.ts). Esta vuelta no la
  // pidió nadie, así que no le corresponde una entrada propia — y dejarla
  // rompía el Atrás después de cada venta: volvía a `?paso=cobro` con la venta
  // ya cobrada y este mismo efecto la empujaba afuera otra vez.
  //
  // EL FOCO ESPERA A LA PASADA SIGUIENTE. Con el paso todavía en cobro el
  // buscador está en `display:none` (ver su `hidden lg:block`, más abajo), y
  // `focus()` sobre un elemento oculto no hace nada. `paso` está en las
  // dependencias justamente para eso: la vuelta corta esta pasada, el cambio
  // de paso vuelve a disparar el efecto, y ahí el buscador ya está visible.
  //
  // No hay rebote posible al revés (volver a cobro y que esto lo eche al
  // carrito): para llegar al cobro hace falta carrito, y agregar cualquier
  // línea limpia `ventaProcesada` (ver `actualizarCarrito`).
  //
  // EN ESCRITORIO LA RAMA DE LA VUELTA NO CORRE NUNCA, y no por un chequeo de
  // ancho: es estructural. Lo único que pone el paso en cobro es el botón del
  // pie, que es `lg:hidden`.
  useEffect(() => {
    if (!ventaProcesada) return
    if (paso === 'cobro') {
      descartarElCobro()
      return
    }
    buscador.current?.focus()
  }, [ventaProcesada, paso, descartarElCobro])

  // F2 enfoca el buscador desde cualquier parte de la pantalla: es el atajo
  // que el chip de al lado promete, no sólo lo anuncia. En un mostrador que
  // se opera sin mouse, un chip que muestra un atajo que no hace nada es peor
  // que no tenerlo.
  //
  // SIN TEST de este efecto en sí —sólo de `esAtajoDeBuscador`, la regla que
  // decide la tecla (ver su comentario)—. Enganchar `window`, disparar
  // `preventDefault` y mover el foco de verdad son DOM real, y este repo no
  // corre jsdom (ver la nota de `ticket.test.tsx`). Quede anotado así a
  // propósito, para que la presencia de un test sobre `esAtajoDeBuscador` no
  // se lea como si este bloque entero estuviera cubierto.
  useEffect(() => {
    function alApretarTecla(e: KeyboardEvent) {
      if (!esAtajoDeBuscador(e.key)) return
      e.preventDefault()
      buscador.current?.focus()
    }
    window.addEventListener('keydown', alApretarTecla)
    return () => window.removeEventListener('keydown', alApretarTecla)
  }, [])

  function alCambiarBusqueda(valor: string) {
    setBusqueda(valor)
    // Vacío no dispara el debounce del efecto de arriba (ver el `return`
    // temprano ahí), así que el vaciado va acá.
    if (valor.trim() === '') setResultados([])
  }

  // Cualquier cambio en el carrito significa que la persona ya dejó de mirar
  // el resultado de la venta anterior y está armando la siguiente: el cartel
  // de éxito se apaga acá, no recién cuando llegue la próxima venta cobrada.
  function actualizarCarrito(actualizar: (previas: Linea[]) => Linea[]) {
    setLineas(actualizar)
    setVentaProcesada((actual) => (actual ? null : actual))
    // Cualquier cambio real en el carrito desarma una confirmación de
    // vaciado que hubiera quedado pendiente: si la persona siguió vendiendo
    // en vez de confirmar el segundo Esc, un vaciado que dispara solo unos
    // segundos después sobre un carrito YA DISTINTO sería peor que el
    // problema que el armado existe para evitar.
    if (desarmarVaciado.current) {
      clearTimeout(desarmarVaciado.current)
      desarmarVaciado.current = null
    }
    setVaciadoArmado((actual) => (actual ? false : actual))
  }

  function agregar(a: ArticuloVendible) {
    actualizarCarrito((previas) => {
      const yaEsta = previas.find((l) => l.articuloId === a.id)
      // Incrementa en vez de duplicar: dos pasadas del lector sobre el mismo
      // código son dos unidades, no dos líneas iguales.
      if (yaEsta) {
        return previas.map((l) => {
          if (l.articuloId !== a.id) return l
          const actual = cantidadEnMilesimas(l.cantidad)
          // Si lo que había tipeado es inválido (NaN), sumar propagaría esa
          // NaN a texto: mejor dejar la línea como está que pisarla con
          // basura — ver `deMilesimas`, que es aritmética entera y no
          // flotante, a propósito.
          if (Number.isNaN(actual)) return l
          return { ...l, cantidad: deMilesimas(actual + 1000) }
        })
      }
      return [
        ...previas,
        {
          articuloId: a.id,
          sku: a.sku,
          descripcion: a.nombre,
          precio: a.precio,
          moneda: a.moneda,
          stock: a.stock,
          esProducto: a.esProducto,
          cantidad: '1',
        },
      ]
    })
    setBusqueda('')
    setResultados([])
    buscador.current?.focus()
  }

  async function alTeclearEnBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // ANTES del primer await, siempre: después de un await ya no tiene
    // efecto, y es un modo de falla que no se ve leyendo por encima.
    e.preventDefault()

    const texto = busqueda.trim()
    if (texto === '') return

    // Un Enter mientras otro está consultando se descarta. Cuando el handler
    // era sincrónico esto no hacía falta: el segundo Enter encontraba el
    // cuadro ya vacío (`agregar` lo vacía) y salía por el early-return de
    // arriba. Ahora el cuadro recién se vacía cuando la consulta resuelve,
    // así que sin esta guarda un doble golpe —o el key-repeat— suma la
    // cantidad dos veces por una sola intención, sin nada visible que lo
    // delate: es cobrar de más en un mostrador.
    if (consultando.current) return
    consultando.current = true
    try {
      // Se CONSULTA en vez de leerse de `resultados`: un lector de código de
      // barras tipea y manda Enter en mucho menos que los 200ms del
      // debounce, así que al momento del Enter `resultados` todavía no tiene
      // nada de este scan —y puede tener lo de una búsqueda anterior—.
      // Leerlo perdía el scan en silencio, o peor, agregaba el artículo
      // equivocado a una venta en curso.
      const encontrados = await buscarArticulos(texto)

      // Si mientras se consultaba la persona siguió tipeando, este Enter ya
      // no describe lo que hay en el cuadro: se descarta entero. Agregar
      // igual sumaría un artículo que ya no se pidió Y le borraría lo que
      // está escribiendo, porque `agregar` limpia el buscador.
      if (busquedaVigente.current.trim() !== texto) return

      // Coincidencia EXACTA de código primero: eso es lo que manda un
      // lector. Si no la hay, el primer resultado, que es lo que espera
      // quien busca por nombre.
      const exacto = encontrados.find((a) => a.sku.toLowerCase() === texto.toLowerCase())
      const elegido = exacto ?? encontrados[0]
      if (elegido) agregar(elegido)
    } finally {
      // En `finally` y no al final del try: si la consulta falla, el
      // buscador tiene que quedar usable igual, no trabado para siempre.
      consultando.current = false
    }
  }

  function cambiarPago(i: number, cambio: Partial<Pago>) {
    setPagos((previos) => previos.map((p, j) => (j === i ? { ...p, ...cambio } : p)))
  }

  // Lo que los pagos cubren, POR MONEDA y contra el total que cada uno
  // declara: `totalesDePagosEnCentavos` es el espejo exacto de `totalesDePagos`
  // del motor, redondeo por pago incluido. Y `cotizacionEnDiezMilesimas` y no
  // `aMilesimas`: la cotización se guarda con CUATRO decimales, así que
  // truncarla al tercero —`1234,5678` a `1234,567`— mueve el total de un pago
  // grande lo suficiente como para que la pantalla diga que cierra y el motor
  // rechace con PAGOS_NO_CIERRAN.
  const pagadoTotales = totalesDePagosEnCentavos(
    pagos.map((p) => ({
      moneda: p.moneda,
      cubre: p.cubre,
      baseCentavos: dineroEnCentavos(p.base),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(p.cotizacion),
    })),
  )
  // DOS faltantes, uno por moneda, y no uno solo contra los pesos: hasta la
  // Task 9 el faltante no sabía nada de la moneda del pago, así que un pago en
  // dólares que cubría exacto la parte en dólares dejaba "Faltan" prendido
  // igual y el botón apagado.
  const faltan: TotalesEnCentavos = {
    ars: totales.ars - pagadoTotales.ars,
    usd: totales.usd - pagadoTotales.usd,
  }
  // Las DOS en cero: una venta mixta no cierra por tener cubierta la mitad en
  // pesos, que es exactamente el mismo criterio que aplica `crearVenta` con sus
  // dos invariantes (lib/ventas/crear.ts).
  const cierra = hayCarrito && faltan.ars === 0 && faltan.usd === 0
  // hayFaltanteDeVenta (arriba), aplicada a CADA moneda: NaN (un monto a medio
  // tipear en cualquier pago) cuenta como "sí hay faltante" — "no se sabe si
  // cierra" no es licencia para mostrarle vuelto a nadie, es el mismo criterio
  // conservador que ya usa `hayLineaInvalida` más arriba. Y alcanza con que
  // falte UNA de las dos: el vuelto se apaga igual.
  const hayFaltante = hayFaltanteDeVenta(faltan.ars) || hayFaltanteDeVenta(faltan.usd)
  // Un chip por moneda que la venta tenga (ver `chipsDeFaltante`). Se calcula
  // acá una sola vez y viaja a los DOS pies —el de la card y el del teléfono—,
  // por la misma regla que la lista del pie: dos cuentas separadas es cómo una
  // copia se queda atrás sin que nada avise.
  const chipsDelFaltante = chipsDeFaltante(totales, faltan)

  // El pie del panel de cobro: vacío mientras no haya ningún plan elegido (ver
  // `lineasDelPieDeCobro`). Sobre la mercadería EN PESOS —la del carrito más la
  // que los pagos en pesos cubren del total en dólares, ver
  // `mercaderiaEnPesosCentavos`— y ya no sobre `totales.ars` a secas, que era
  // el provisorio que dejó la Task 9.
  const lineasDelPie = lineasDelPieDeCobro(
    mercaderiaEnPesosCentavos(totales, pagos),
    pagos,
    planes,
    totales.usd !== 0,
  )

  /**
   * Un paso del vaciado del carrito en dos golpes: el primero arma la
   * confirmación, el segundo vacía.
   *
   * LO DISPARAN DOS COSAS y comparten este estado, no tienen uno cada una: el
   * atajo Esc (escritorio) y el botón "Vaciar" del encabezado del carrito en
   * el teléfono (design/arandano.pen, nodo `L5UIo`). Con dos `vaciadoArmado`
   * separados, armar por un camino y confirmar por el otro quedaría
   * desincronizado, y el desarme automático a los 3 segundos bajaría sólo uno
   * de los dos — un carrito que se vacía por un Esc que la persona ya se
   * olvidó de haber apretado.
   *
   * POR QUÉ DOS PASOS Y NO UN confirm() NI UN VACIADO DESHACIBLE: ver el
   * comentario de la leyenda, más abajo en el JSX.
   *
   * `useCallback` y no una función suelta: el listener global de teclado la
   * llama, así que entra en sus dependencias. Sin memoizar cambiaría de
   * identidad en cada render —incluido cada tecla del buscador— y el listener
   * se re-engancharía otras tantas veces. Con estas dos dependencias sólo
   * cambia cuando cambia algo que el efecto YA escuchaba.
   */
  const alternarVaciado = useCallback(() => {
    // Nada que vaciar.
    if (lineas.length === 0) return
    if (vaciadoArmado) {
      // El desarme (timer + estado) lo hace `actualizarCarrito` mismo
      // —cualquier cambio de carrito lo hace, ver su comentario—, así que acá
      // no hay que repetirlo.
      actualizarCarrito(() => [])
      setPagos([])
      return
    }
    // Primer golpe: arma la confirmación y NO borra nada todavía.
    setVaciadoArmado(true)
    if (desarmarVaciado.current) clearTimeout(desarmarVaciado.current)
    desarmarVaciado.current = setTimeout(() => setVaciadoArmado(false), 3000)
  }, [lineas.length, vaciadoArmado])

  // Enter cobra y Esc vacía el carrito — los otros dos atajos que promete la
  // leyenda bajo el botón (design/arandano.pen, nodo `k1dDB`). Van en un
  // efecto aparte del de F2 de arriba: ese no depende de nada del estado de
  // la venta (deps `[]`), y este sí —si cierra, si ya está cobrando, cuántas
  // líneas hay, si el vaciado ya está armado—, así que mezclarlos forzaría a
  // re-enganchar también el listener de F2 en cada tecla.
  //
  // SIN TEST de este efecto en sí, mismo motivo que el de F2: enganchar
  // `window`, leer `document.activeElement` y llamar `requestSubmit()` es
  // DOM real, y este repo no corre jsdom (ver la nota de `ticket.test.tsx`).
  // Lo que SÍ se prueba son las reglas puras que deciden cada atajo:
  // `esAtajoDeCobro`, `puedeDispararCobroDesdeFoco` y `esAtajoDeVaciar`.
  //
  // LA GUARDA QUE FALTABA, encontrada en la revisión final de esta task: un
  // `<Select>` de Radix abierto (el de medio o el de moneda, en cualquier
  // `FilaDePago`) deja pasar Enter y Esc hacia ACÁ sin avisar. Ninguno de los
  // dos corta la propagación del evento —`@radix-ui/react-select` no llama a
  // `stopPropagation` ni una vez, y `DismissableLayer` escucha Escape en
  // `document` en fase de CAPTURA pero tampoco la corta—, así que este
  // listener en `window` ve exactamente el mismo evento que Radix ya está
  // atendiendo. Con Enter eso cobraba la venta con el medio/moneda todavía
  // no actualizado en React (ver el comentario largo de
  // `puedeDispararCobroDesdeFoco`); con Esc, cerraba el dropdown Y armaba (o
  // confirmaba) el vaciado del carrito en el mismo golpe de tecla — dos Esc
  // sueltos para abrir "Medio" y "Moneda" alcanzaban para vaciar un carrito
  // de 15 ítems sin que la persona lo pidiera. `hayOverlayDeRadixAbierto()`
  // es la abstención que cierra los dos a la vez: si hay un overlay
  // montado, este listener no hace NADA con la tecla, y deja que sea Radix
  // quien decida.
  useEffect(() => {
    function alApretarTecla(e: KeyboardEvent) {
      if (hayOverlayDeRadixAbierto()) return

      if (esAtajoDeVaciar(e.key)) {
        // Nada que vaciar: ni vale la pena armar la confirmación, ni tragarse
        // la tecla, que puede tener trabajo en otro lado de la pantalla. El
        // mismo chequeo vive también adentro de `alternarVaciado` (que es
        // donde manda), porque acá decide algo distinto: si llamar o no a
        // preventDefault.
        if (lineas.length === 0) return
        e.preventDefault()
        alternarVaciado()
        return
      }

      if (esAtajoDeCobro(e.key)) {
        const etiqueta = (document.activeElement as HTMLElement | null)?.tagName
        if (!puedeDispararCobroDesdeFoco(etiqueta)) return
        // Mismo chequeo que ya usa el atributo `disabled` del botón: el
        // atajo no puede tener más permiso para cobrar que el botón que
        // dice imitar. `requestSubmit()` sobre un <form> NO respeta por su
        // cuenta que el submit esté disabled —ésa es la razón de este
        // chequeo manual, no una prolijidad de más—.
        if (!cierra || cobrando) return
        e.preventDefault()
        formularioCobro.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', alApretarTecla)
    // Sólo desengancha el listener, y a propósito no toca
    // `desarmarVaciado.current` acá: este efecto se re-ejecuta cada vez que
    // cambia una de sus dependencias —incluida `vaciadoArmado`, que cambia
    // JUSTO al armar—, así que limpiar el timer en este cleanup lo
    // cancelaría en el mismo instante en que se lo acaba de crear. El timer
    // vive en un ref y sobrevive a los re-enganches de este efecto a
    // propósito; si la pantalla se desmonta con el vaciado armado, el
    // `setVaciadoArmado` que dispara 3 segundos después no rompe nada en
    // React 18+ (dejó de advertir por setState de un componente desmontado).
    return () => window.removeEventListener('keydown', alApretarTecla)
  }, [alternarVaciado, lineas.length, vaciadoArmado, cierra, cobrando])

  return (
    <>
      {/* El Encabezado se renderiza ACÁ y no en page.tsx —que es un componente
          de servidor— porque sus props dependen del paso, que es estado de
          cliente: en el teléfono el Topbar del cobro dice "Cobro", muestra el
          total de la venta y cambia la hamburguesa por una flecha de volver
          (design/arandano.pen, el Topbar de `keRdN`). `Encabezado` es JSX puro,
          sin ninguna API de servidor, así que un componente cliente puede
          importarlo y renderizarlo.

          `alVolver` y no `atras`: un href a /vender dispararía una navegación
          de Next, y ése es exactamente el remonte que perdería el carrito.

          El subtítulo del carrito —"Miér 21 ago · 14:32" en la maqueta— sigue
          sin construirse, y ahora por un motivo distinto del que anotaba
          page.tsx: ya no es que un componente de servidor lo dejaría
          congelado, es que un reloj vivo acá sería una feature (un intervalo
          más el hidratado) y no presentación. Queda anotado. */}
      <Encabezado
        titulo={pasoVisible === 'cobro' ? 'Cobro' : 'Vender'}
        subtitulo={
          // `lineasTotal` (arriba): la MISMA cuenta que la banda de --marca,
          // y no una tercera hecha a mano — es la copia de ese dato para el
          // Topbar del teléfono, que reemplaza a la banda mientras dura el
          // paso de cobro (ver el comentario de la Card del carrito, más
          // abajo: se esconde con `hidden lg:flex` en ese paso).
          pasoVisible === 'cobro' && !lineasTotal.some((l) => l.monto === '—')
            ? `Venta de ${lineasTotal.map((l) => `${l.signo} ${l.monto}`).join(' + ')}`
            : undefined
        }
        alVolver={pasoVisible === 'cobro' ? volverAlCarrito : undefined}
        acciones={
          <ChipCaja caja={caja} cotizacionUsd={cotizacionUsd} cotizacionUsdEn={cotizacionUsdEn} />
        }
        // La ranura derecha del teléfono queda apagada en el cobro: el frame
        // `keRdN` la dibuja deshabilitada (`NlGrn: enabled false`), y abrir o
        // cerrar el turno en medio de un cobro no es lo que nadie va a querer.
        controlMovil={pasoVisible === 'cobro' ? undefined : <ControlDeCaja caja={caja} />}
      />

      {/* "Cuerpo": el buscador a todo el ancho, arriba de las dos columnas.
          `padding [12,14]` y `gap 12` en el teléfono (frame `q0WKV` de
          `VaHod`, la medida que comparten las doce pantallas móviles);
          `p-6`/`gap-[18px]` en escritorio, que es lo que ponía page.tsx antes
          de que el padding se mudara acá adentro junto con el Encabezado.
          `flex-1` para que el pie del teléfono quede abajo de todo aunque la
          venta tenga dos artículos: en escritorio no se nota, porque no hay
          nada después del cuerpo. */}
      <div className="flex flex-1 flex-col gap-3 px-[14px] py-3 lg:gap-[18px] lg:p-6">
        {/* Los dos chips de estado, que en escritorio viven en el Topbar
            (`acciones`, hidden lg:flex) y en el teléfono abren el cuerpo.
            De sólo lectura: ver el comentario de ChipsDeEstado en caja.tsx. */}
        <ChipsDeEstado caja={caja} cotizacionUsd={cotizacionUsd} />

        {/* El buscador: a todo el ancho del Cuerpo, ya no encajado en la
            columna izquierda. El borde violeta de 2px es PERMANENTE —no sólo
            en foco—: design/arandano.pen lo pide así porque en este mostrador
            el cuadro es lo primero que se mira, y un borde que sólo aparece al
            enfocar no ayuda a encontrarlo de entrada. El resplandor
            (shadow-[...]) también sale del .pen: un halo de 4px con --primary
            al 12% de opacidad, armado con color-mix() y NO con un rgba()/hex
            inventado — docs/sistema-de-diseno.md (vía
            app/login/persiana.module.css) es explícito: "el brillo y el surco
            salen de tokens con color-mix, no de rgba() inventados". Con la
            paleta ya repintada una vez (2026-08-21), un halo con el violeta
            viejo hardcodeado quedaría huérfano la próxima vez y nadie se
            enteraría; con color-mix(var(--primary)) sigue al token. */}
        {/* El buscador no existe en el paso de cobro: `keRdN` no lo dibuja —su
            Cuerpo es banda total, los pagos y el botón que suma uno— y es lo que
            volvía silencioso el defecto que arregla el efecto de arriba, porque
            era lo que permitía escanear desde una pantalla donde el carrito no
            se ve. Mobile-first, igual que las dos columnas: en `lg:` está
            siempre, sin mirar el paso. */}
        <div className={`${paso === 'cobro' ? 'hidden lg:block' : 'block'} relative`}>
          {/* focus-within y no el focus-visible del <Input>: el ring por
              default aparecería sólo alrededor del campo de texto —que no
              cubre ni el ícono ni el chip F2—, y se vería como un rectángulo
              roto en medio de la barra. El <Input> de adentro apaga su propio
              ring (ver más abajo) para que sea ESTE, el de la barra entera, el
              que se vea al enfocar. */}
          {/* 52 px en el teléfono (nodo `I5IuID` de VaHod), 58 en escritorio. */}
          <div className="flex h-[52px] items-center gap-3 rounded-[14px] border-2 border-primary bg-card px-[18px] shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)] focus-within:ring-3 focus-within:ring-ring/50 lg:h-[58px]">
            <ScanBarcode aria-hidden="true" className="size-[22px] shrink-0 text-primary" />
            <Input
              id="buscar"
              ref={buscador}
              autoFocus
              autoComplete="off"
              value={busqueda}
              onChange={(e) => alCambiarBusqueda(e.target.value)}
              onKeyDown={alTeclearEnBuscador}
              placeholder="Escaneá un código o buscá por nombre…"
              aria-label="Buscar artículo"
              className="h-full flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            />
            {/* El chip promete un atajo de teclado, y un teléfono no tiene
                teclas de función: ahí es un cartel que no se puede cumplir.
                `I5IuID` tampoco lo dibuja. Los tres atajos en sí no se tocan
                —siguen enganchados a `window` en los dos anchos—: lo que se
                oculta es la promesa, no el mecanismo. */}
            <span className="hidden shrink-0 rounded-sm bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground-soft lg:inline-block">
              F2
            </span>
          </div>

          {resultados.length > 0 && (
            <ul className="absolute z-10 mt-2 w-full divide-y rounded-md border bg-card shadow-md">
              {resultados.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => agregar(a)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>
                      {a.nombre} <span className="text-muted-foreground">· {a.sku}</span>
                    </span>
                    <span>
                      {/* `precioEnSuMoneda` y no `formatearPrecio`: el precio
                          del artículo está en SU moneda (`Articulo.moneda`), y
                          un iPhone de lista US$ 300 mostrado como "$ 300,00"
                          se lee tres órdenes de magnitud abajo. Es el primer
                          número que ve quien busca el artículo, así que es
                          donde más caro sale equivocarse. */}
                      <span className={estilos.importe}>{precioEnSuMoneda(a.precio, a.moneda)}</span>
                      {/* El stock no es plata, así que no lleva estilos.importe —
                          pero sigue siendo una cifra que se compara de un
                          vistazo, así que conserva tabular-nums. Un servicio
                          muestra —, nunca 0: el motor no le descuenta stock, y
                          un cero ahí se leería como faltante. */}
                      <span className="ml-3 tabular-nums text-muted-foreground">
                        {a.esProducto ? formatearCantidad(a.stock) : '—'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* "Fila": las dos columnas — el carrito y el cobro. El corte pasó de
            `md:` a `lg:` con el ciclo móvil: a 768 px al carrito le quedaban
            136 px al lado del panel de 384 (ver hooks/use-mobile.ts, que hace
            esa cuenta). */}
        <div className="flex flex-col gap-[18px] lg:flex-row">
          {/* El carrito entero vive dentro de una card con radius y borde
              propios — antes era una <table> suelta. Se contiene con
              max-w-3xl por la misma razón que antes: en un monitor de 22" una
              card sin techo deja un hueco enorme entre el nombre del artículo y
              su precio, que es más de lo que el ojo enlaza de una sola pasada.
              `max-w-3xl` es un token de max-width de Tailwind, no un paso de la
              escala de espaciado, así que no cae bajo la regla del
              subconjunto.

              En el teléfono el cobro es pantalla propia, así que el carrito se
              esconde mientras dura (frames `VaHod` y `keRdN`). Se escribe
              mobile-first —el valor del teléfono sin prefijo, el de escritorio
              con `lg:`— y NO con `max-lg:`: arriba de 1024 las dos columnas
              terminan en `flex` sin mirar el paso, que es la regla. */}
          <Card
            className={`${
              paso === 'cobro' ? 'hidden lg:flex' : 'flex'
            } max-w-3xl flex-1 gap-0 rounded-[16px] border py-0 ring-0`}
          >
            {/* El encabezado del carrito, SÓLO en el teléfono (nodo `L5UIo`):
                padding [11,14], borde inferior, "Carrito" a la izquierda y
                "Vaciar" a la derecha. En escritorio esa franja ya la ocupa la
                fila de encabezados de la tabla, que en el teléfono no se ve
                casi entera.

                POR QUÉ EL BOTÓN NO ES OPCIONAL: en escritorio vaciar el
                carrito lo da el doble Esc, y un teléfono no tiene Esc. Sin él,
                deshacer una venta mal armada era borrar ítem por ítem con la
                ✕. Comparte `vaciadoArmado` con el atajo (ver
                `alternarVaciado`), así que los dos caminos no se pueden
                desincronizar.

                "Carrito" paga Archivo (14/600, `Y7AGpE`) vía el módulo de
                Cobro: comparte familia y peso con el título de esa card y sólo
                cambia el tamaño, que es exactamente cómo ese módulo está
                pensado para usarse (ver su comentario). La fila "Cobro" de la
                escala en docs/sistema-de-diseno.md dice hoy "16 px el título" y
                pasa a tener dos tamaños — lo actualiza la task de
                documentación del ciclo, que junta todos los roles que la
                maqueta móvil achica. */}
            <div className="flex items-center justify-between border-b px-[14px] py-[11px] lg:hidden">
              <span className={`${estilosCobro.titulo} text-sm text-foreground`}>Carrito</span>
              <button
                type="button"
                onClick={alternarVaciado}
                disabled={lineas.length === 0}
                className={`text-xs font-semibold disabled:opacity-40 ${
                  vaciadoArmado ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {vaciadoArmado ? 'Sí, vaciar' : 'Vaciar'}
              </button>
            </div>

            {/* El carrito deja de ser una tabla HTML: sigue el patrón que
                estrena `Listado` en app/(app)/ventas/page.tsx (líneas
                337-366 de ese archivo) — grid + `display:contents`, con las
                mismas 5 anchuras que declaraban las celdas de encabezado de
                antes (Artículo sin ancho fijo → `1fr`, 104, 110, 130, 28 = w-7).

                `VaHod` apila TRES líneas por ítem —nombre+✕ / meta /
                stepper…subtotal— (nodos `UMJEA`/`IKwdw`/`rXeg5`/`mRrMW`), a
                diferencia de `Listado`, donde el agrupador siempre junta
                columnas ADYACENTES. Acá "Quitar" —la ÚLTIMA columna en
                escritorio— tiene que convivir con el NOMBRE —la PRIMERA— en
                la misma línea del teléfono, con Cantidad/Precio/Subtotal en
                el medio: agruparlas no alcanza. Se resuelve dejando el DOM en
                el mismo orden que las columnas de escritorio (ninguna
                auto-colocación exótica hace falta: Artículo, [Cantidad,
                Precio, Subtotal agrupadas], Quitar) y anclando "Quitar" con
                `absolute` sólo en el teléfono — ver su comentario, más
                abajo. */}
            <div role="table" className="grid grid-cols-1 lg:grid-cols-[1fr_104px_110px_130px_28px]">
              {/* Fila "hundida": fondo --muted, padding [12,18] y 14 de gap
                  entre columnas. Sólo existe en escritorio —`hidden`
                  la saca del todo en el teléfono, `lg:contents` la disuelve
                  ahí para que sus 5 `columnheader` pasen a ser las celdas de
                  la primera fila del grid—, igual que el encabezado de
                  `Listado`. */}
              <div role="row" className="hidden lg:contents">
                <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Artículo
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-center text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Cantidad
                </div>
                {/* Vuelve a existir en escritorio: la Task 3 la había
                    escondido del todo (sin reflow posible mientras esto
                    seguía siendo una tabla HTML) como mitigación temporal.
                    Con el reflow ya resuelto acá, no hay motivo para seguir
                    sin ella en escritorio. */}
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Precio
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Subtotal
                </div>
                {/* La columna de "Quitar" queda vacía en el encabezado. */}
                <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px]" />
              </div>

              {lineas.map((l, i) => {
                const cantidadMilesimas = cantidadEnMilesimas(l.cantidad)
                const invalida = Number.isNaN(cantidadMilesimas)
                const quedaria = aMilesimas(l.stock) - cantidadMilesimas
                return (
                  // `group` + `relative`: `group` es lo que restituye el
                  // hover de fila de escritorio (ver `lg:group-hover:` en
                  // cada celda, más abajo — mismo mecanismo que `Listado`).
                  // `relative` es el ancla del botón "Quitar" en el
                  // teléfono, y no le hace nada a escritorio: ahí la fila es
                  // `lg:contents` y una caja sin caja no tiene `position`.
                  //
                  // El `border-b`/`last:border-b-0` de acá siguen sin
                  // prefijo, y siguen sirviendo: en el teléfono la fila ES
                  // una caja real (no es `display:contents` ahí), así que
                  // ahí pintan. En escritorio no hacen nada — por eso cada
                  // celda lleva su propio `lg:border-b`/`lg:group-last:
                  // border-b-0` más abajo (Ronda de arreglos 1 sobre la
                  // Task 4b; el principio completo, con el porqué del
                  // envoltorio de centrado, vive en el docblock de
                  // `Listado`, app/(app)/ventas/page.tsx).
                  <div
                    key={l.articuloId}
                    role="row"
                    className="group relative flex flex-col gap-2 border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
                  >
                    {/* Artículo: nombre + meta (SKU/Servicio, el precio
                        unitario sólo en el teléfono, el aviso de cantidad
                        inválida y el de stock). `pr-9` en el teléfono
                        reserva el lugar del botón "Quitar", que flota
                        encima con `absolute` (ver más abajo) y no empuja
                        este contenido con su propio ancho — a diferencia de
                        `Listado`, acá no hay una celda de grid propia para
                        "Quitar" al lado de ésta. Es la celda más alta de la
                        fila (dos líneas siempre), así que no necesita el
                        envoltorio de centrado que sí llevan las otras
                        cuatro, más abajo: ya queda estirada de punta a
                        punta. */}
                    <div
                      role="cell"
                      className="pr-9 whitespace-normal lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                    >
                      {/* `gap-2` (8px) en el teléfono —el mismo que separa
                          los 3 bloques de `VaHod`— y `lg:gap-0.5` para no
                          mover el aspecto de escritorio, que ya usaba ese
                          espaciado más apretado. */}
                      <div className="flex flex-col gap-2 lg:gap-0.5">
                        <span className="text-sm font-medium text-foreground">{l.descripcion}</span>
                        <div className="flex items-center gap-2">
                          {/* El SKU bajo el nombre: antes sólo se veía en el
                              buscador. Un servicio no tiene SKU de stock, así
                              que muestra "Servicio" en su lugar — mismo
                              criterio que ya usa la lista de resultados para
                              el stock de un servicio (una raya, no un cero). */}
                          <span className="text-[11px] text-muted-foreground">
                            {l.esProducto ? `SKU ${l.sku}` : 'Servicio'}
                            {/* El precio unitario, que en el teléfono no
                                tiene columna propia (ver el columnheader de
                                Precio, más arriba): la maqueta lo pone acá,
                                pegado al SKU, con el mismo tratamiento de
                                meta. En escritorio desaparece de esta línea,
                                porque su columna vuelve. */}
                            {/* En la moneda de la línea, igual que la columna
                                "Precio" de escritorio: el carrito mixto tiene
                                una línea en pesos y otra en dólares al mismo
                                tiempo, así que el símbolo es lo único que las
                                distingue. */}
                            <span className="lg:hidden"> · {precioEnSuMoneda(l.precio, l.moneda)} c/u</span>
                          </span>
                          {/* Antes que el aviso de stock: una cantidad que no
                              se entiende ni siquiera se puede evaluar contra
                              el stock (`quedaria` también sería NaN). Ésta sí
                              queda en rojo: a diferencia del aviso de stock,
                              una cantidad ilegible SÍ impide seguir —apaga
                              Cobrar—, así que acá el rojo es el color
                              correcto (docs/sistema-de-diseno.md: "el ámbar
                              no es un rojo suave", el rojo es para lo que
                              bloquea). */}
                          {invalida && (
                            <span className="text-[11px] font-semibold text-destructive">
                              cantidad inválida
                            </span>
                          )}
                          {/* Se advierte y NO se bloquea: el motor permite
                              vender sin stock a propósito, y la pantalla no
                              puede ser más estricta que el motor sin volverse
                              mentirosa. Ámbar y no rojo: vender con stock
                              negativo está PERMITIDO en este producto, así
                              que esto es "hay que mirar", no "no se puede
                              seguir" — el rojo queda para lo que sí bloquea
                              (arriba). */}
                          {!invalida && l.esProducto && quedaria < 0 && (
                            <Badge
                              variant="outline"
                              className="h-auto gap-[5px] border-transparent bg-warn-soft px-[7px] py-[2px] text-[10px] font-semibold text-warn"
                            >
                              <TriangleAlert aria-hidden="true" />
                              sin stock suficiente
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Agrupador: junta Cantidad, Precio (oculto acá) y
                        Subtotal en una sola línea del teléfono; disuelto en
                        escritorio, donde vuelven a ser 3 celdas separadas. */}
                    <div className="flex items-center gap-[10px] lg:contents">
                      <div role="cell" className="lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                        {/* Envoltorio de centrado (Ronda de arreglos 1,
                            Importante 2): la CELDA se queda estirada (el
                            default de Grid) para que su `border-b` quede a
                            la altura del resto de la fila; quien centra el
                            contenido, sólo en escritorio, es este `<div>`
                            interno con `lg:h-full` (100% de la celda
                            estirada) — ver el docblock de `Listado`,
                            app/(app)/ventas/page.tsx. */}
                        <div className="lg:flex lg:h-full lg:items-center">
                          {/* El stepper [-] [valor] [+]: los botones cubren sumar
                              y restar de a una unidad completa, pero el campo del
                              medio sigue siendo editable a mano — el motor admite
                              cantidades con hasta tres decimales a propósito
                              (lib/formato/mostrar.ts: "Medio kilo de harina
                              necesita los decimales"), y +1/-1 no alcanza para
                              tipear "0,5". Los dos botones salen de
                              `PASOS_STEPPER.map(...)` y no de dos <button>
                              escritos a mano: ver el porqué en la definición del
                              array, un poco más arriba. */}
                          {/* focus-within por la misma razón que la barra del
                              buscador: el <Input> del medio apaga su propio ring
                              para que el foco se vea en el stepper entero, no en
                              un rectángulo que ignora los botones [-]/[+]. */}
                          <div className="flex h-9 w-[104px] items-center rounded-[9px] border border-input focus-within:ring-3 focus-within:ring-ring/50">
                            {PASOS_STEPPER.map(({ verbo, delta, Icono }) => (
                              <Fragment key={verbo}>
                                <button
                                  type="button"
                                  aria-label={`${verbo} una unidad a ${l.descripcion}`}
                                  className="flex h-full w-8 items-center justify-center text-foreground-soft hover:bg-muted"
                                  onClick={() =>
                                    actualizarCarrito((p) =>
                                      p.map((x, j) =>
                                        j === i ? { ...x, cantidad: pasoDeCantidad(x.cantidad, delta) } : x,
                                      ),
                                    )
                                  }
                                >
                                  <Icono className="size-[13px]" />
                                </button>
                                {/* El valor editable va entre los dos botones:
                                    se intercala acá, después del primero
                                    (Restar), en vez de partir el .map en dos para
                                    no perder el orden visual [-] [valor] [+]. */}
                                {delta === -1 && (
                                  <Input
                                    inputMode="decimal"
                                    value={l.cantidad}
                                    onChange={(e) =>
                                      actualizarCarrito((p) =>
                                        p.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                                      )
                                    }
                                    aria-label={`Cantidad de ${l.descripcion}`}
                                    className={`h-full flex-1 border-0 bg-transparent px-0 py-0 text-center font-semibold text-foreground shadow-none focus-visible:ring-0 ${estilos.importe}`}
                                  />
                                )}
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      </div>
                      {/* Su columnheader ya explica por qué esta celda no se
                          ve en el teléfono. */}
                      <div
                        role="cell"
                        className={`hidden text-foreground-soft lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors ${estilos.importe}`}
                      >
                        <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                          {precioEnSuMoneda(l.precio, l.moneda)}
                        </div>
                      </div>
                      {/* `ml-auto` empuja el subtotal a la derecha del
                          agrupador en el teléfono —el "Espaciador" de la
                          maqueta (nodo `WMA3r`)—; `lg:ml-0` lo apaga en
                          escritorio, donde el envoltorio de centrado interno
                          (más abajo) ya lo alinea a la derecha con
                          `justify-end`, dentro de su propia columna de
                          130px. */}
                      <div
                        role="cell"
                        className={`ml-auto text-[15px] font-semibold text-foreground lg:ml-0 lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors ${estilos.importe}`}
                      >
                        <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                          {/* El subtotal hereda la moneda de su línea: es
                              cantidad × precio, así que no puede estar en otra
                              — y es el número que la banda de total suma a la
                              pila de esa misma moneda. */}
                          {invalida
                            ? '—'
                            : precioEnSuMoneda(
                                deCentavos(subtotalEnCentavos(cantidadMilesimas, aCentavos(l.precio))),
                                l.moneda,
                              )}
                        </div>
                      </div>
                    </div>

                    {/* Quitar: en escritorio es la 5ª celda del grid, como
                        siempre (`lg:static` la devuelve a celda de grid
                        normal). En el teléfono NO se agrupa junto al nombre
                        —quedan Cantidad, Precio y Subtotal de por medio en el
                        DOM—, así que se ancla con `absolute` al padding del
                        ítem (arriba a la derecha, nodo `hRb9c`), relativo a
                        la fila (`relative`, más arriba), independiente de
                        dónde cae en el flujo normal.

                        EL COSTO, Y LA ALTERNATIVA, para quien vuelva acá: el
                        botón queda visualmente junto al nombre pero en el DOM
                        sigue siendo la QUINTA celda, así que por teclado se
                        llega después del stepper y del subtotal. La maqueta lo
                        modela como hermano del nombre. La salida conocida —que
                        la ola final de la review dejó anotada en vez de
                        aplicar, porque toca las cinco celdas de escritorio de
                        una pantalla ya verificada a ojo— es **anidarlo junto
                        al nombre en el DOM y darle a las CINCO celdas un
                        `lg:col-start-N` explícito**: así el orden de lectura y
                        el de tabulación pasan a ser el del teléfono, y la
                        grilla de escritorio se reconstruye por posición
                        declarada en vez de por orden del DOM. Es todo o nada:
                        con `col-start` en una sola celda, las otras cuatro
                        siguen fluyendo y se corren. */}
                    <div
                      role="cell"
                      className="absolute top-[11px] right-[14px] lg:static lg:border-b lg:p-[11px] lg:pr-[18px] lg:pl-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                    >
                      <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => actualizarCarrito((p) => p.filter((_, j) => j !== i))}
                          aria-label={`Quitar ${l.descripcion}`}
                          className="text-muted-foreground"
                        >
                          <X className="size-[15px]" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {lineas.length === 0 && (
              <p className="px-[18px] py-3 text-sm text-muted-foreground">
                Buscá un artículo para empezar la venta.
              </p>
            )}

            {/* Empuja la banda del total al fondo de la card cuando el panel
                de Cobro de al lado es más alto que la cinta. */}
            <div className="flex-1" />

            {/* La banda del total: la ÚNICA superficie de --marca de esta
                pantalla (design/arandano.pen, nodo `B7teV`), alrededor del dato
                que /vender existe para mostrar — docs/sistema-de-diseno.md,
                sección "Un ancla de contenido por pantalla". El avatar del pie
                del sidebar también pinta con --marca, pero ancla la identidad
                de quién está adentro del sistema en las diez pantallas, no el
                dato de ÉSTA en particular: las dos conviven a propósito, según
                ese mismo documento.

                bg/color con var(--token) inline, y no una utilidad de
                Tailwind: --marca y sus variantes no están en @theme (ver el
                comentario en app/globals.css) porque nada más que este tipo de
                superficie las consume, así que ninguna clase de Tailwind las
                resuelve — mismo patrón que ya usa
                components/shell/sidebar-arandano.tsx para el avatar.

                Está siempre, incluso con el carrito vacío en $ 0,00 — un ancla
                que aparece y desaparece no es un ancla. Con una cantidad a
                medio tipear `totales` queda en NaN EN SU MONEDA, y esa línea
                muestra "—", igual que ya hace la columna Subtotal de cada
                línea inválida unas líneas más arriba.

                UNA línea por moneda con algo que mostrar (Task 9,
                `lineasTotal` = `lineasDeTotal(totales)`, arriba): con un solo
                pago en pesos —el caso de siempre— es EXACTAMENTE el markup de
                antes, un signo y un monto; las dos aparecen sólo con un
                carrito mixto, que es la lectura de `design/arandano.pen` que
                rige acá (ver el comentario de `lineasDeTotal`). */}
            <div
              className="flex items-center justify-between px-[22px] py-5"
              style={{ backgroundColor: 'var(--marca)' }}
            >
              <div className="flex flex-col gap-0.5">
                {/* letter-spacing 1.4 y no 0.8: es más ancho que el de los
                    encabezados de columna de arriba, a propósito — el .pen no
                    los iguala (ver docs/sistema-de-diseno.md). */}
                <span
                  className="text-[10px] font-bold tracking-[1.4px] uppercase"
                  style={{ color: 'var(--marca-soft)' }}
                >
                  Total
                </span>
                {/* Rol "Meta" sobre la banda oscura: --marca-dim, no
                    --marca-soft (docs/sistema-de-diseno.md, "Meta" en la
                    escala) — de los dos tintes de marca la maqueta eligió el
                    más apagado para el texto que acompaña sin competir. */}
                <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
                  {resumenDelCarrito(lineas.length, unidadesMilesimas)}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                {lineasTotal.map((l) => (
                  <div key={l.moneda} className="flex items-center gap-2">
                    <span className={estilos.signo} style={{ color: 'var(--marca-soft)' }}>
                      {l.signo}
                    </span>
                    <span className={estilos.total} style={{ color: 'var(--marca-foreground)' }}>
                      {/* El "$ "/"US$ " que formatearPrecio()/formatearDolares() ya
                          anteponen se descartan con montoSinSigno()
                          (lib/formato/mostrar.ts, dentro de `lineasDeTotal`): el
                          signo es SU PROPIO elemento (arriba), no parte de esta
                          cadena — es justo lo que separa esta banda del pie viejo. */}
                      {l.monto}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* w-96 (384px) y no el w-80 (320px) de antes: design/arandano.pen,
              nodo `Cyias`. gap-0/py-0/ring-0 por el mismo motivo que ya anota
              la card del Carrito de arriba: las secciones de adentro (el
              encabezado, el pie) traen su propio padding y su propio borde, y
              el `Card` de shadcn por default suma los suyos.

              En el teléfono el ancho fijo no cabe: ocupa el ancho del cuerpo, y
              los 384 px vuelven en `lg:`. La visibilidad es el espejo exacto
              del carrito de arriba — ver su comentario. */}
          <Card
            className={`${
              paso === 'cobro' ? 'flex' : 'hidden lg:flex'
            } w-full gap-0 rounded-[16px] border py-0 ring-0 lg:w-96`}
          >
            {/* El encabezado: título + contador de pagos en la MISMA fila
                (design/arandano.pen, nodos `EszMA`/`NyUYT`) — no `CardHeader`
                de shadcn, que arma una grilla pensada para título+acción con
                ícono, no para dos textos en los extremos de una fila. */}
            <div className="flex items-center justify-between border-b px-[18px] py-[14px]">
              {/* "Cobro" y no "Cobrar": el botón de abajo dice Cobrar, y una
                  acción tiene un solo nombre en todo el flujo. La card nombra
                  la zona, el botón nombra lo que pasa al apretarlo. Archivo
                  600 vía cobro.module.css — ver ese archivo para el porqué de
                  un módulo nuevo. */}
              <span className={`${estilosCobro.titulo} text-base text-foreground`}>Cobro</span>
              <span className="text-xs text-muted-foreground">
                {pagos.length === 1 ? '1 pago' : `${pagos.length} pagos`}
              </span>
            </div>

            {/* El `id` es lo que ata el botón del pie del teléfono —que vive
                afuera de este <form>— vía el atributo HTML `form`. Ver
                ID_FORMULARIO_DE_COBRO, arriba. */}
            <form
              ref={formularioCobro}
              id={ID_FORMULARIO_DE_COBRO}
              action={accion}
              className="flex flex-1 flex-col"
            >
              <input type="hidden" name="clave" value={clave} />
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
                )}
              />
              <input
                type="hidden"
                name="pagos"
                value={JSON.stringify(
                  // `recibido` NO viaja: es una ayuda de pantalla para calcular
                  // el vuelto, y lo que entra a la caja es el monto.
                  pagos.map((p) => ({
                    medio: p.medio,
                    moneda: p.moneda,
                    // Qué total cubre este pago. Va SIEMPRE, incluido el 'ARS'
                    // del caso común: el servidor lo trata como opcional
                    // (`PagoDeVenta.cubre`, ausente vale 'ARS'), pero mandarlo
                    // sólo a veces sería un campo que aparece y desaparece
                    // según el carrito, y eso es más difícil de leer en un log
                    // que un campo que siempre está.
                    cubre: p.cubre,
                    base: p.base,
                    // '1' cuando el pago NO cruza monedas, y nunca la cadena
                    // vacía: ahí el servidor no usa la cotización para ninguna
                    // cuenta pero la exige mayor que cero igual
                    // (COTIZACION_INVALIDA). El estado ya guarda '1' en ese
                    // caso (`cotizacionParaElCruce`); esto lo vuelve a decir
                    // en el borde donde importa, que es el que ve el motor.
                    cotizacion: p.moneda === p.cubre ? '1' : p.cotizacion,
                    // `undefined` y no `null` cuando no hay plan: JSON.stringify
                    // descarta la clave entera, así que un local sin planes manda
                    // exactamente el mismo JSON que antes de que este campo
                    // existiera.
                    planId: p.planId ?? undefined,
                  })),
                )}
              />

              <div className="flex flex-col gap-3 p-4">
                {pagos.map((p, i) => (
                  <FilaDePago
                    key={i}
                    pago={p}
                    indice={i}
                    planes={planes}
                    // El selector de `Cubre` sólo tiene sentido con los DOS
                    // totales sobre la mesa: con una sola moneda no hay nada
                    // que elegir y la fila queda idéntica a la de antes de
                    // este ciclo.
                    ofreceCubre={totales.ars > 0 && totales.usd > 0}
                    hayFaltante={hayFaltante}
                    onCambiar={(cambio) => cambiarPago(i, cambio)}
                    onQuitar={() => setPagos((p2) => p2.filter((_, j) => j !== i))}
                    puedeQuitar={pagos.length > 1}
                  />
                ))}
                {/* outline y con ícono "+", ya no relleno gris (design/arandano.pen,
                    nodo `RJII3`) — border-input y no el border-border del outline
                    por default: la maqueta pinta este borde con el mismo
                    $ar-line-strong que ya usan los selects y el stepper, no con
                    el borde tenue genérico de una card. */}
                <Button
                  type="button"
                  variant="outline"
                  className="h-[38px] gap-[7px] rounded-[9px] border-input text-[13px] font-semibold text-foreground-soft"
                  onClick={() =>
                    setPagos((p) => {
                      // El pago nuevo va contra el total que TODAVÍA falta: con
                      // los pesos ya cubiertos, el que queda es el de dólares.
                      // Misma regla que el pago inicial, sobre el faltante en
                      // vez de sobre el total.
                      const cubre = cubrePorDefecto(faltan)
                      const faltaEnEseTotal = cubre === 'ARS' ? faltan.ars : faltan.usd
                      return [
                        ...p,
                        {
                          medio: 'EFECTIVO',
                          // Se entrega en la misma moneda que cubre, igual que
                          // el pago inicial: así no arranca cruzando.
                          moneda: cubre,
                          cubre,
                          // Vacío y no `deCentavos(NaN)` si una línea del carrito
                          // está a medio tipear: `Math.max(0, NaN)` es NaN,
                          // `deCentavos(NaN)` es el string literal "NaN.NaN", y el
                          // campo Monto de la fila nueva arrancaba mostrando eso —
                          // el mismo defecto preexistente que "Entran $X", acá del
                          // otro lado del cálculo (el precargado, no el mostrado).
                          base: Number.isNaN(faltaEnEseTotal)
                            ? ''
                            : deCentavos(Math.max(0, faltaEnEseTotal)),
                          cotizacion: cotizacionParaElCruce(cubre, cubre),
                          recibido: '',
                          // A precio de lista: el pago nuevo arranca en efectivo, y
                          // heredar el plan del pago de al lado sería cobrar un
                          // recargo que nadie eligió para esta parte.
                          planId: null,
                        },
                      ]
                    })
                  }
                >
                  <Plus className="size-[14px]" aria-hidden="true" />
                  Agregar pago
                </Button>
              </div>

              {/* Empuja el pie al fondo de la card cuando hay pocos pagos —
                  mismo rol que el espaciador análogo del Carrito. */}
              <div className="flex-1" />

              {/* El pie de la card, SÓLO en escritorio: en el teléfono estas
                  mismas tres piezas viven en `PieDeVenta`, el pie fijo de la
                  pantalla (ver su comentario para el porqué de dos botones y
                  no uno movido de lugar). */}
              <div className="hidden flex-col gap-2.5 border-t p-4 lg:flex">
                <AvisosDelCobro estado={estado} ventaProcesada={ventaProcesada} />

                {/* Va DESPUÉS de los carteles de error/éxito y ANTES del chip
                    de faltante: los carteles son transitorios y ya viven
                    arriba del pie; estas tres líneas y el chip son lo que se
                    lee de un vistazo justo antes de apretar Cobrar, así que
                    quedan pegadas al botón. */}
                <PieDeTotales lineas={lineasDelPie} />

                {chipsDelFaltante.map((c) => (
                  <ChipDeFaltante
                    key={c.moneda}
                    moneda={c.moneda}
                    faltanCentavos={c.faltanCentavos}
                    hayCarrito={hayCarrito}
                  />
                ))}

                {/* 54px de alto, ícono arrow-right, texto en Archivo
                    (design/arandano.pen, nodo `yJaPt`) — el orden texto-luego-
                    ícono importa: es el orden de los hijos en el .pen, no un
                    detalle visual libre. */}
                <Button
                  type="submit"
                  disabled={!cierra || cobrando}
                  className={`h-[54px] gap-[9px] rounded-[12px] text-[17px] ${estilosCobro.boton}`}
                >
                  {cobrando ? 'Cobrando…' : 'Cobrar'}
                  <ArrowRight className="size-[18px]" aria-hidden="true" />
                </Button>

                {/* La leyenda de los atajos (design/arandano.pen, nodo
                    `k1dDB`), que cambia de texto y de color mientras el Esc
                    está armado: es la única señal de que hay una confirmación
                    pendiente, y sin ella el primer Esc parecería no haber
                    hecho nada.

                    POR QUÉ DOS PASOS Y NO UN confirm() NI UN VACIADO
                    DESHACIBLE. Esc es la tecla que este mismo atajo pone a un
                    solo toque de distancia de vaciar un carrito de quince
                    ítems sin red — la task lo pide explícito. Un `confirm()`
                    del navegador bloquea el hilo y no se puede estilar; un
                    diálogo (Sheet/Dialog) suma una capa de foco atrapado y
                    Radix le pone su PROPIO manejo de Escape encima, que
                    competiría con este mismo atajo por la misma tecla. Un
                    vaciado "deshacible" (un toast con Deshacer) necesita una
                    librería que este repo no tiene y un estado extra para
                    guardar el carrito viejo mientras dura la ventana de
                    deshacer. Confirmar con un SEGUNDO Esc, en cambio, reusa
                    exactamente el mismo mecanismo que `AnularVenta`
                    (app/(app)/ventas/formularios.tsx) ya eligió para "esto es
                    irreversible pero frecuente": confirmación en dos pasos
                    sobre la MISMA tecla/botón, sin diálogo y sin dependencia
                    nueva. El desarme solo a los 3 segundos (o al tocar
                    cualquier línea del carrito, ver `actualizarCarrito`) es lo
                    que evita que un Esc de hace un rato "cargue" un vaciado
                    que ya no tiene que ver con la intención actual. */}
                <p
                  className={`text-center text-[11px] ${
                    vaciadoArmado ? 'font-semibold text-destructive' : 'text-muted-foreground'
                  }`}
                >
                  {vaciadoArmado ? 'Esc de nuevo para vaciar el carrito' : 'Enter para cobrar · Esc para vaciar'}
                </p>
              </div>
            </form>
          </Card>
        </div>
      </div>

      <PieDeVenta
        paso={paso}
        estado={estado}
        ventaProcesada={ventaProcesada}
        chipsDelFaltante={chipsDelFaltante}
        hayCarrito={hayCarrito}
        cierra={cierra}
        cobrando={cobrando}
        irACobro={irACobro}
        lineasDelPie={lineasDelPie}
      />
    </>
  )
}

/**
 * Los dos carteles del cobro: el error del servidor y el "Venta #N cobrada".
 *
 * Extraídos en el ciclo móvil por el mismo motivo que `ChipDeFaltante`: se
 * dibujan en los dos pies —el de la card (escritorio) y el fijo del teléfono—
 * y una sola definición es lo que impide que uno se quede atrás. La maqueta
 * del teléfono no los dibuja (`keRdN` modela una venta que todavía no se
 * cobró), y van igual: sin ellos, en un teléfono cobrar bien no diría nada y
 * cobrar mal tampoco.
 */
function AvisosDelCobro({
  estado,
  ventaProcesada,
}: {
  estado: EstadoCobro
  ventaProcesada: string | null
}) {
  return (
    <>
      {estado.error && (
        <Alert variant="destructive">
          <AlertDescription>{estado.error}</AlertDescription>
        </Alert>
      )}
      {/* Sólo mientras `ventaProcesada` siga siendo ésta: en cuanto el carrito
          cambia (ver `actualizarCarrito`) el cartel se apaga, para que no
          quede colgado mientras se arma la venta siguiente. */}
      {estado.venta && estado.venta.id === ventaProcesada && (
        <Alert>
          <AlertDescription>
            Venta #{estado.venta.numero} cobrada.{' '}
            <Link href={`/ventas/${estado.venta.id}`} className="underline">
              Ver detalle
            </Link>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}

/**
 * El pie fijo del teléfono (frames `CWVCG` de `VaHod` y `c8rrQG` de `keRdN`):
 * un botón `Cobrar →` de 54 px, y en el paso de cobro además la banda de
 * faltante arriba.
 *
 * NO existe en escritorio (`lg:hidden`): ahí el mismo botón, el mismo chip y
 * la leyenda de atajos siguen viviendo al pie de la card de Cobro, que es
 * donde los dibuja la maqueta de 1440. Son dos botones y no uno movido de
 * lugar —un elemento del DOM no puede estar en dos sitios—, atados al mismo
 * `<form>` por el atributo `form` y apagados por la misma condición.
 *
 * `sticky bottom-0` y no `fixed`: alcanza para que el pie quede pegado abajo
 * mientras el cuerpo scrollea, sin sacar al elemento del flujo ni obligar a
 * reservarle altura al cuerpo.
 *
 * EL BOTÓN HACE DOS COSAS DISTINTAS SEGÚN EL PASO, y es a propósito: en el
 * carrito AVANZA al cobro (`VaHod` lleva a `keRdN`, que es donde se eligen los
 * medios de pago), y recién en el cobro cobra de verdad. Mismo rótulo porque
 * es el mismo trabajo visto desde dos momentos; el que cobra ve "Cobrar" y
 * llega a cobrar, sin tener que aprender un segundo verbo.
 */
/**
 * El pie de tres líneas del cobro: mercadería, el recargo o descuento del
 * plan, y el total a cobrar. Vacío —y entonces no dibuja nada— mientras no
 * haya ningún plan elegido (ver `lineasDelPieDeCobro`).
 *
 * **Un solo componente para las DOS copias del pie**: el de escritorio, que
 * vive dentro de la card de Cobro, y `PieDeVenta`, el pie fijo del teléfono.
 * Escribirlo dos veces es exactamente el modo de falla que el merge del ciclo
 * de permisos con el del teléfono dejó documentado en CLAUDE.md (una copia se
 * actualiza y la otra no, con todo el gate en verde).
 *
 * design/arandano.pen no dibuja este bloque —la maqueta es anterior a los
 * planes de pago, y la deuda queda anotada en
 * docs/correcciones-pendientes-del-pen.md—, así que el tratamiento se toma
 * prestado del renglón "Entran $X" de cada fila de pago, que es el otro sitio
 * de esta pantalla donde un rótulo y un importe conviven en una línea: rótulo
 * 12px en --muted-foreground, importe 13px semibold en Archivo.
 *
 * La última línea es el total a cobrar, y se destaca: borde arriba y el mismo
 * peso que el chip. Se decide por POSICIÓN (la última de las tres) y no por un
 * flag en el dato, porque el orden lo fija `lineasDelPieDeCobro` y es el único
 * que tiene sentido — mercadería, lo que se le suma, y el resultado.
 */
function PieDeTotales({ lineas }: { lineas: { rotulo: string; monto: string }[] }) {
  if (lineas.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {lineas.map(({ rotulo, monto }, i) => {
        const esTotal = i === lineas.length - 1
        return (
          <div
            key={rotulo}
            className={`flex items-center justify-between px-0.5 ${esTotal ? 'border-t pt-2' : ''}`}
          >
            <span
              className={
                esTotal ? 'text-xs font-semibold text-foreground' : 'text-xs text-muted-foreground'
              }
            >
              {rotulo}
            </span>
            <span
              className={`${estilos.importe} ${
                esTotal
                  ? 'text-[15px] font-bold text-foreground'
                  : 'text-[13px] font-semibold text-foreground-soft'
              }`}
            >
              {monto}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function PieDeVenta({
  paso,
  estado,
  ventaProcesada,
  chipsDelFaltante,
  hayCarrito,
  cierra,
  cobrando,
  irACobro,
  lineasDelPie,
}: {
  paso: Paso
  estado: EstadoCobro
  ventaProcesada: string | null
  /** Las tres líneas del desglose por plan, ya resueltas a texto por
   *  `lineasDelPieDeCobro`. Vacío mientras no haya ningún plan elegido. */
  lineasDelPie: { rotulo: string; monto: string }[]
  /** Un chip por moneda que la venta tenga, ya resueltos por
   *  `chipsDeFaltante`. La MISMA lista que dibuja el pie de escritorio. */
  chipsDelFaltante: { moneda: 'ARS' | 'USD'; faltanCentavos: number }[]
  hayCarrito: boolean
  cierra: boolean
  cobrando: boolean
  irACobro: () => void
}) {
  // Las clases del botón se comparten entre las dos ramas: 54 px de alto,
  // radio 12 y el texto en Archivo (`f4EIb`/`yLjMa`), igual que el botón de
  // escritorio — cobro.module.css no cambia con el ancho, a propósito.
  const clasesBoton = `h-[54px] w-full gap-[9px] rounded-[12px] text-[17px] ${estilosCobro.boton}`

  return (
    // padding [10,14,14,14] y gap 9 (los dos frames `Pie` coinciden), fondo
    // --card con borde superior de 1.
    <div className="sticky bottom-0 z-10 flex flex-col gap-[9px] border-t bg-card px-[14px] pt-[10px] pb-[14px] lg:hidden">
      {/* En los dos pasos, no sólo en el cobro: después de cobrar bien el
          carrito queda vacío y `PuntoDeVenta` sigue en el paso en que estaba,
          así que el cartel tiene que poder verse desde donde sea que quedó la
          persona. */}
      <AvisosDelCobro estado={estado} ventaProcesada={ventaProcesada} />
      {/* Sólo en el paso de cobro, igual que el chip: en el carrito todavía no
          hay pagos, así que no hay plan elegido y el pie estaría siempre
          vacío — pero el `paso === 'cobro'` explícito es lo que evita que un
          plan que quedó elegido de una venta anterior lo haga aparecer arriba
          del carrito de la siguiente. */}
      {paso === 'cobro' && <PieDeTotales lineas={lineasDelPie} />}
      {paso === 'cobro' &&
        chipsDelFaltante.map((c) => (
          <ChipDeFaltante
            key={c.moneda}
            moneda={c.moneda}
            faltanCentavos={c.faltanCentavos}
            hayCarrito={hayCarrito}
          />
        ))}
      {paso === 'cobro' ? (
        <Button
          type="submit"
          form={ID_FORMULARIO_DE_COBRO}
          disabled={!cierra || cobrando}
          className={clasesBoton}
        >
          {cobrando ? 'Cobrando…' : 'Cobrar'}
          <ArrowRight className="size-[18px]" aria-hidden="true" />
        </Button>
      ) : (
        <Button type="button" onClick={irACobro} disabled={!hayCarrito} className={clasesBoton}>
          Cobrar
          <ArrowRight className="size-[18px]" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

/**
 * El chip de faltante/sobrante (design/arandano.pen, nodos `G9w7U` de
 * escritorio y `qoMga` del pie del teléfono, que coinciden en geometría:
 * radio 10, padding [9,12]).
 *
 * Extraído en el ciclo móvil porque ahora se dibuja en DOS pies —el de la card
 * de cobro (escritorio) y el fijo del teléfono— y dos copias del mismo JSX es
 * cómo una se queda atrás sin que nada avise. En cada ancho se ve una sola:
 * la otra está bajo `display:none`, que además la saca del árbol de
 * accesibilidad, así que el `role="status"` no se anuncia dos veces.
 *
 * "Sobran" no está en la maqueta —el ejemplo que dibuja ya cierra corto, nunca
 * de más—, pero el motor SÍ deja pagar de más (dos pagos que suman más que el
 * total), y avisarlo ya evitaba un cobro de más antes del rediseño. Se
 * mantiene en el mismo chip, con el verde de "--ok" en vez de reinventar un
 * color que ningún nodo del .pen pide, y SIN el ícono `circle-alert` — ver el
 * comentario de `puedeMostrarVuelto` sobre el ícono.
 *
 * `role="status"` porque el cartel aparece y cambia de texto sin que nadie lo
 * mire, y es la única pista de por qué el botón sigue apagado — se perdió al
 * migrar de un <p> suelto a este `Badge` (que es un <span> pelado, ver
 * components/ui/badge.tsx) en la Task 3 del rediseño, sin que ningún test lo
 * reclamara. `punto-de-venta.test.tsx` ahora lo fija.
 */
function ChipDeFaltante({
  moneda,
  faltanCentavos,
  hayCarrito,
}: {
  /** En qué moneda está este faltante: decide el símbolo del importe, no el
   *  color ni el rótulo. Un carrito mixto dibuja dos de estos chips. */
  moneda: 'ARS' | 'USD'
  faltanCentavos: number
  hayCarrito: boolean
}) {
  if (Number.isNaN(faltanCentavos) || faltanCentavos === 0 || !hayCarrito) return null
  return (
    <Badge
      role="status"
      variant="outline"
      className={`h-auto w-full justify-between gap-3 rounded-[10px] border-transparent px-3 py-[9px] ${
        faltanCentavos > 0 ? 'bg-destructive-soft' : 'bg-ok-soft'
      }`}
    >
      <span
        className={`flex items-center gap-[7px] text-xs font-semibold ${
          faltanCentavos > 0 ? 'text-destructive' : 'text-ok'
        }`}
      >
        {faltanCentavos > 0 && <CircleAlert className="size-[14px]" aria-hidden="true" />}
        {faltanCentavos > 0 ? 'Faltan' : 'Sobran'}
      </span>
      <span
        className={`${estilos.importe} text-[15px] font-bold ${
          faltanCentavos > 0 ? 'text-destructive' : 'text-ok'
        }`}
      >
        {/* `precioEnSuMoneda` y no `formatearPrecio`: el chip de dólares tiene
            que decir "US$ 300,00" y no "$ 300,00". Es el mismo helper que usa
            la ficha del artículo, así que el símbolo sale de un solo lugar. */}
        {precioEnSuMoneda(deCentavos(Math.abs(faltanCentavos)), moneda)}
      </span>
    </Badge>
  )
}

/**
 * Un campo de monto con su rótulo: Monto, Cotización o "Con cuánto paga"
 * comparten exactamente el mismo tratamiento en design/arandano.pen (rótulo
 * 11px/600 + input de 40px con el valor en Archivo, alineado a la derecha) —
 * sólo cambia la etiqueta y qué campo de `Pago` atan. Extraído para no
 * escribir ese bloque tres veces dentro de `FilaDePago`.
 */
function CampoMonto({
  id,
  etiqueta,
  valor,
  onChange,
}: {
  id: string
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-[5px]">
      <Label htmlFor={id} className="text-[11px] font-semibold text-foreground-soft">
        {etiqueta}
      </Label>
      {/* El relevamiento pide 15px/600 para Monto/Cotización/Recibido. El
          TAMAÑO no se fuerza a propósito —queda en el `text-base`/`md:text-sm`
          responsivo que ya trae `Input` por default (docs/sistema-de-diseno.md,
          "text-base en inputs hasta md"): abajo de 16px iOS hace zoom al
          enfocar, y en una tablet de mostrador eso es la pantalla saltando en
          cada pago. El PESO sí —`font-semibold`—, hallazgo de la review final:
          no tiene la misma excusa, y sin él quedaba en el 400 por default. */}
      <Input
        id={id}
        inputMode="decimal"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 rounded-[9px] border-input text-right font-semibold ${estilos.importe}`}
      />
    </div>
  )
}

/**
 * Una fila del formulario de pago: medio, moneda, monto, cotización (sólo si
 * es USD) y el campo de vuelto (sólo si es efectivo en pesos).
 *
 * Extraída de adentro del `pagos.map` de `PuntoDeVenta`: ese mapeo por sí
 * solo eran ~110 líneas de JSX inline en un componente que ya era el más
 * grande del proyecto, y fue justo ahí donde se escondió el bug de "Too many
 * re-renders" del primer round de review — el tamaño del bloque es lo que lo
 * hizo difícil de mirar. Es una mudanza sin cambio de comportamiento
 * respecto de lo que había antes de esta extracción.
 */
function FilaDePago({
  pago,
  indice,
  planes,
  ofreceCubre,
  hayFaltante,
  onCambiar,
  onQuitar,
  puedeQuitar,
}: {
  pago: Pago
  indice: number
  // TODOS los planes del local, sin filtrar: la fila filtra por su propio
  // medio y su moneda (`planesOfrecidos`), y ese filtro tiene que rehacerse en
  // cada cambio de medio.
  planes: PlanVisible[]
  // Si la venta tiene los DOS totales, y entonces hay algo que elegir en el
  // selector de `Cubre`. Viene calculado de arriba y no se deduce acá: es una
  // propiedad de la VENTA (qué monedas tiene el carrito), no del pago.
  ofreceCubre: boolean
  // Si la VENTA completa (todos los pagos, no sólo éste) sigue corta — ver
  // `puedeMostrarVuelto` para el porqué de este parámetro.
  hayFaltante: boolean
  onCambiar: (cambio: Partial<Pago>) => void
  onQuitar: () => void
  puedeQuitar: boolean
}) {
  // El vuelto sólo tiene sentido calculado en pesos: `formatearPrecio` está
  // cableado a ARS, así que un vuelto en dólares saldría formateado como si
  // fueran pesos (US$20 de vuelto se leería "$ 20,00"). En dólares el vuelto
  // no se calcula así de todos modos, así que el campo directamente no se
  // ofrece.
  const esEfectivoArs = pago.medio === 'EFECTIVO' && pago.moneda === 'ARS'
  // El pago CRUZA monedas cuando lo que entrega no es lo que cubre: ahí —y
  // sólo ahí— hay una conversión de por medio, así que hay una cotización que
  // pedir y un segundo número que mostrar. Cuando no cruza, la fila se dibuja
  // exactamente como antes de este ciclo.
  const cruza = pago.moneda !== pago.cubre
  // Cuando cruza, la base SIEMPRE está en dólares: `baseEnDolares` (el mismo
  // predicado del motor, `lib/ventas/centavos.ts`) es verdadero en cuanto una
  // de las dos puntas es USD, y si cruza al menos una lo es. Por eso el rótulo
  // puede decir "US$" sin preguntar cuál de las dos, y por eso nada divide.
  const etiquetaDelMonto = cruza ? 'Cubre US$' : 'Monto'
  // Calculado ACÁ, una sola vez, y no adentro del JSX de "Entran $X": monto o
  // cotización a medio tipear (el campo vacío incluido) dejan
  // `entranPesosCentavos` en NaN, y `formatearPrecio` de un NaN imprime
  // "$ NaN" — el único importe de la pantalla que no aplicaba la guarda que
  // el resto del archivo ya usa por regla escrita (ver `:916` la banda del
  // total, `:1112` el chip de faltante). Guardado en una constante para que
  // el guard de renderizado y el guard de "Agregar pago" (más abajo, en el
  // componente padre) no puedan divergir en cómo detectan el NaN.
  const pesosDelPagoCentavos = entranPesosCentavos(pago.base, pago.cotizacion)
  // Los pesos que esta fila ENTREGA, sin el recargo: es contra este número
  // —y no contra la base— que se compara lo que hay que cobrar, porque desde
  // este ciclo la base puede estar en dólares.
  const entregadoCentavos = pesosDeLaFilaEnCentavos(pago)
  // Lo que hay que cobrar por ESTA fila: lo que entrega más el recargo de su
  // plan. Contra esto se calcula el vuelto, no contra la base — ver
  // `aCobrarDeLaFilaEnCentavos` para el porqué.
  const aCobrarCentavos = aCobrarDeLaFilaEnCentavos(pago, planes)
  // Si el plan de esta fila mueve el número o no. Gobierna DOS renglones —el
  // de "A cobrar", que sólo existe cuando difieren, y el rótulo del de
  // arriba— para que no puedan contradecirse: si uno aparece, el otro cambia
  // de nombre. Un plan al 0 % (o ningún plan) no mueve nada y deja la fila
  // exactamente como estaba antes del ciclo de planes.
  const elPlanMueveElNumero =
    !Number.isNaN(aCobrarCentavos) && aCobrarCentavos !== entregadoCentavos
  // Los planes que ESTA fila puede ofrecer: los de su medio y sólo en pesos
  // (ver `planesOfrecidos`). Vacío significa que la fila no dibuja ningún
  // control de plan — un local sin planes no ve nada nuevo.
  const planesDelMedio = planesOfrecidos(pago, planes)

  return (
    // fill $ar-bg (--background) y no --card: design/arandano.pen pinta cada
    // pago con el mismo gris del lienzo, para que se distinga de la card
    // blanca de Cobro que lo contiene (nodos `XdYjF`/`VnEsm`).
    <div className="flex flex-col gap-2.5 rounded-xl bg-background p-3">
      <div className="flex items-center gap-2">
        {/* Cambiar el medio LIMPIA el plan, en el mismo cambio de estado: un
            plan de crédito que sobreviva a un cambio a efectivo es
            exactamente el PLAN_NO_CORRESPONDE que el motor rechaza, con la
            pantalla mostrando algo que se ve válido. Esconder el selector no
            alcanza — el `planId` viejo seguiría en el estado y viajando en el
            JSON escondido. */}
        <Select
          value={pago.medio}
          onValueChange={(medio) => onCambiar({ medio: medio as Pago['medio'], planId: null })}
        >
          {/* h-9! (important): SelectTrigger fija su alto con
              data-[size=default]:h-8, una clase condicionada por atributo que
              gana por especificidad a un h-9 suelto — sin el !, el trigger se
              queda en 32px y el radio 9 (design/arandano.pen pide 36px). */}
          <SelectTrigger
            aria-label={`Medio del pago ${indice + 1}`}
            className="h-9! flex-1 justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EFECTIVO">Efectivo</SelectItem>
            <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
            <SelectItem value="TARJETA_DEBITO">Débito</SelectItem>
            <SelectItem value="TARJETA_CREDITO">Crédito</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={pago.moneda}
          onValueChange={(valor) => {
            const moneda = valor as Pago['moneda']
            onCambiar({
              moneda,
              // La cotización se rehace con el cruce nuevo: vacía si el pago
              // pasa a cruzar (nunca precargada, ni con la del local ni con la
              // del último pago) y 1 si deja de cruzar, que además es lo que
              // borra una cotización mentirosa. Ver `cotizacionParaElCruce`.
              cotizacion: cotizacionParaElCruce(moneda, pago.cubre),
              // Y limpia el plan, por lo mismo que el selector de medio de al
              // lado: un plan sobre un pago ENTREGADO en dólares es el
              // PLAN_EN_DOLARES que el motor rechaza. Se limpia en las DOS
              // direcciones —de vuelta a pesos también— porque un plan que
              // reaparezca solo al volver de dólares es un recargo que nadie
              // volvió a elegir.
              planId: null,
            })
          }}
        >
          <SelectTrigger
            aria-label={`Moneda del pago ${indice + 1}`}
            className="h-9! w-[92px] justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* El selector de `Cubre`: contra cuál de los dos totales va este pago.
          SÓLO cuando la venta tiene los DOS —con una sola moneda no hay nada
          que elegir, y la fila queda idéntica a la de antes de este ciclo—.

          design/arandano.pen no dibuja este control (la maqueta es anterior a
          los precios en dólares, deuda anotada en
          docs/correcciones-pendientes-del-pen.md), así que el tratamiento se
          copia del selector de plan de acá abajo, que es el otro control que
          nació sin frame: fila propia, porque en un panel de 384 px un tercer
          control apretaría al de Medio, que es el que más se toca.

          Con rótulo VISIBLE y no sólo `aria-label`, a diferencia de los otros
          tres selectores: los de Medio, Moneda y Plan se explican solos por su
          valor ("Efectivo", "US$", "Crédito 3 cuotas"), y "total en dólares"
          sin la palabra que lo introduce no dice qué relación tiene con el
          pago. Juntos se leen como la oración que son. */}
      {ofreceCubre && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-foreground-soft">Cubre</span>
          <Select
            value={pago.cubre}
            onValueChange={(valor) => {
              const cubre = valor as Pago['cubre']
              onCambiar({
                cubre,
                // La cotización se rehace con el cruce nuevo, igual que en el
                // selector de moneda de arriba — ver `cotizacionParaElCruce`.
                cotizacion: cotizacionParaElCruce(pago.moneda, cubre),
                // Y limpia el plan, por lo mismo que los otros dos selectores:
                // el recargo se aplica sobre los pesos que la fila entrega, y
                // cambiar de total cambia ese número. Un plan que sobreviva a
                // un cambio que lo vuelve inválido —o que le cambia la base al
                // recargo— es un error del motor con la pantalla en verde.
                planId: null,
              })
            }}
          >
            <SelectTrigger
              aria-label={`Cubre del pago ${indice + 1}`}
              className="h-9! flex-1 justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ARS">total en pesos</SelectItem>
              <SelectItem value="USD">total en dólares</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* El selector de plan, SÓLO si el medio elegido tiene planes cargados:
          un local que no cargó ninguno no ve un solo control nuevo, que es la
          promesa explícita del spec.

          En su propia fila y no al lado de Medio/Moneda: en un panel de 384px
          un tercer control apretaría justo el de Medio, que es el que más se
          toca, y el nombre de un plan ("Crédito 3 cuotas sin interés") es
          largo. design/arandano.pen no dibuja este control —la maqueta es
          anterior a los planes de pago, y la deuda queda anotada en
          docs/correcciones-pendientes-del-pen.md—, así que el tratamiento es
          el mismo del selector de Medio de arriba, que es el control hermano. */}
      {planesDelMedio.length > 0 && (
        <Select
          value={pago.planId ?? SIN_PLAN}
          onValueChange={(valor) => onCambiar({ planId: valor === SIN_PLAN ? null : valor })}
        >
          <SelectTrigger
            aria-label={`Plan del pago ${indice + 1}`}
            className="h-9! w-full justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Un valor centinela y no "": Radix reserva la cadena vacía para
                "sin selección" y un SelectItem con value="" tira en runtime. */}
            <SelectItem value={SIN_PLAN}>Precio de lista</SelectItem>
            {planesDelMedio.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {cruza ? (
        // Monto y Cotización lado a lado (design/arandano.pen, frame
        // "Montos" del Pago 2) — sólo cuando el pago cruza monedas, porque
        // sólo ahí hay una conversión, y por lo tanto un segundo campo con el
        // que compartir la fila. Antes de este ciclo "cruzar" era exactamente
        // `moneda === 'USD'`, así que para un local que no vende en dólares
        // esto no cambia nada.
        <div className="flex gap-2">
          <CampoMonto
            id={`monto-${indice}`}
            etiqueta={etiquetaDelMonto}
            valor={pago.base}
            onChange={(v) => onCambiar({ base: v })}
          />
          <CampoMonto
            id={`cot-${indice}`}
            etiqueta="Cotización"
            valor={pago.cotizacion}
            onChange={(v) => onCambiar({ cotizacion: v })}
          />
        </div>
      ) : (
        <CampoMonto
          id={`monto-${indice}`}
          etiqueta={etiquetaDelMonto}
          valor={pago.base}
          onChange={(v) => onCambiar({ base: v })}
        />
      )}

      {cruza && (
        // "Entran $X": cuántos pesos representa este pago en dólares
        // (design/arandano.pen, nodo `OTlAa`). entranPesosCentavos reusa el
        // mismo cálculo que cierra la venta — ver su comentario. Guarda de
        // NaN igual que el resto de la plata de esta pantalla: borrar el
        // campo Monto o Cotización para retipearlo deja `pesosDelPagoCentavos`
        // en NaN, y "Entran $ NaN" es un cartel sin sentido.
        //
        // **El rótulo cambia a "Base en pesos" cuando la fila lleva un plan
        // que mueve el número** (ola final del ciclo del precio en dólares).
        // Con base US$ 300 a 1485 y un plan del 40 %, la fila decía
        // `Entran $ 445.500,00` y dos renglones más abajo
        // `A cobrar $ 623.700,00`: dos importes contradictorios pegados, en
        // la única pantalla donde se cuentan billetes. Lo que entra al cajón
        // son los 623.700; los 445.500 son la mercadería convertida, antes
        // del recargo. No se esconde el renglón —el número es el que deja ver
        // que la cotización aplicada es la que se tipeó, y es el puente entre
        // "Cubre US$ 300" y "A cobrar"— sino que se lo llama por su nombre.
        //
        // Y el rótulo es CONDICIONAL y no fijo a propósito: sin plan (que es
        // el estado que la maqueta dibuja, y el de todo local que no financia)
        // "Entran" sigue siendo exacto y la fila queda byte a byte como el
        // `.pen` la modela.
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">
            {elPlanMueveElNumero ? 'Base en pesos' : 'Entran'}
          </span>
          <span className={`${estilos.importe} text-[13px] font-semibold text-foreground-soft`}>
            {Number.isNaN(pesosDelPagoCentavos) ? '—' : formatearPrecio(deCentavos(pesosDelPagoCentavos))}
          </span>
        </div>
      )}

      {/* "A cobrar $X": lo que hay que pedirle a la persona por ESTA fila
          cuando su plan mueve el número — la base es lo que el pago cubre de
          la mercadería a precio de lista, y con un plan no es lo mismo. Sin
          esta línea, el campo de arriba dice "Monto 10.000" y el cajón espera
          9.000 sin que la pantalla lo diga en ningún lado; el pie de la card
          da el total de la venta, no el de cada fila, así que con pagos
          partidos entre dos planes no alcanza. Sólo aparece cuando los dos
          números difieren: sin plan sería repetir el campo de arriba.
          Mismo tratamiento que "Entran", que es el otro renglón de esta fila
          donde un rótulo y un importe derivado conviven en una línea — y la
          MISMA condición, `elPlanMueveElNumero`, que le cambia el rótulo a
          ése: los dos renglones tienen que hablar del mismo caso o vuelven a
          contradecirse. */}
      {elPlanMueveElNumero && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">A cobrar</span>
          <span className={`${estilos.importe} text-[13px] font-semibold text-foreground-soft`}>
            {formatearPrecio(deCentavos(aCobrarCentavos))}
          </span>
        </div>
      )}

      {esEfectivoArs && (
        <CampoMonto
          id={`rec-${indice}`}
          etiqueta="Con cuánto paga (opcional)"
          valor={pago.recibido}
          onChange={(v) => onCambiar({ recibido: v })}
        />
      )}
      {/* El chip de vuelto: verde, con el monto en Archivo
          (design/arandano.pen, nodo `USFQ3`) — y gateado por
          puedeMostrarVuelto, no sólo por esEfectivoArs: mientras la VENTA
          completa siga corta (hayFaltante), este pago no muestra vuelto,
          aunque el campo "con cuánto paga" de arriba siga disponible para
          tipear. Sin ícono, a diferencia del chip de Faltante — el .pen no le
          pone uno (nodo `USFQ3` sólo tiene rótulo + monto). */}
      {puedeMostrarVuelto(esEfectivoArs, hayFaltante) &&
        pago.recibido.trim() !== '' &&
        dineroEnCentavos(pago.recibido) > aCobrarCentavos && (
          <Badge
            variant="outline"
            className="h-auto w-full justify-between gap-2 rounded-[9px] border-transparent bg-ok-soft px-[11px] py-2"
          >
            <span className="text-xs font-semibold text-ok">Vuelto</span>
            <span className={`${estilos.importe} text-[15px] font-bold text-ok`}>
              {formatearPrecio(deCentavos(dineroEnCentavos(pago.recibido) - aCobrarCentavos))}
            </span>
          </Badge>
        )}
      {puedeQuitar && (
        <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
          Quitar pago
        </Button>
      )}
    </div>
  )
}
