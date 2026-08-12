'use client'

import { useActionState, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import {
  aCentavos, aMilesimas, cantidadEnMilesimas, cotizacionEnDiezMilesimas, deCentavos,
  deMilesimas, dineroEnCentavos, subtotalEnCentavos, totalDePagosEnCentavos, totalEnCentavos,
} from '@/lib/ventas/centavos'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const INICIAL: EstadoCobro = { error: null, venta: null }

type Linea = {
  articuloId: string
  sku: string
  descripcion: string
  precio: string
  stock: string
  esProducto: boolean
  // Lo que la persona tipeó, tal cual: se parsea al calcular y se manda como
  // texto, que es lo que el server action espera.
  cantidad: string
}

type Pago = {
  medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO'
  moneda: 'ARS' | 'USD'
  monto: string
  cotizacion: string
  // Sólo UI: con cuánto paga el cliente, para calcular el vuelto. NO se manda
  // al servidor y NO se guarda — el pago que entra a la caja es el monto, no
  // lo que el cliente apoyó sobre el mostrador.
  recibido: string
}

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

export function PuntoDeVenta({ cotizacionInicial }: { cotizacionInicial: string | null }) {
  const [estado, accion, cobrando] = useActionState(cobrar, INICIAL)
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
  // que la persona ya tocó a mano.
  const [totalReflejado, setTotalReflejado] = useState<number | null>(null)
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
  }))
  const totalCentavos = totalEnCentavos(enCentavos)
  // NaN cubre las tres formas de estar mal, porque `cantidadEnMilesimas`
  // devuelve NaN para todas: no es un número, la gramática lo considera
  // ambiguo, o el campo quedó VACÍO. El vacío importa aparte: antes contaba
  // como cero, la línea pasaba por buena, Cobrar se encendía y el servidor
  // rechazaba la venta entera con "falta la cantidad".
  const hayLineaInvalida = enCentavos.some((l) => Number.isNaN(l.cantidadMilesimas))
  const hayCarrito = lineas.length > 0 && totalCentavos > 0 && !hayLineaInvalida

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

  // Cuando el carrito cambia y hay un solo pago en pesos, se le sigue el
  // total: el caso del 90% es cobrar todo junto y no tener que retocar el
  // monto cada vez que se agrega un artículo. Con dos pagos, o con uno en
  // dólares, se deja de tocar — ahí la persona ya decidió cómo reparte.
  // Ajuste durante el render (no un efecto) por la misma razón que el bloque
  // de `ventaProcesada` de abajo: comparar contra `totalReflejado`, que este
  // mismo bloque actualiza, es lo que hace que el segundo render no vuelva a
  // dispararlo.
  //
  // Una cantidad a medio tipear deja `totalCentavos` en NaN, y `NaN !==
  // NaN` es siempre verdadero: sin este `!Number.isNaN`, la guarda nunca
  // cerraría y `setPagos` seguiría devolviendo un array y un objeto nuevos en
  // cada pasada —aunque `setTotalReflejado(NaN)` sí frene por el bail-out de
  // React, `Object.is(NaN, NaN)` es `true`— hasta "Too many re-renders",
  // perdiendo la venta en curso. Mientras la línea sea inválida los pagos se
  // quedan con el último total bueno; el botón ya está apagado por
  // `hayLineaInvalida`, así que no hace falta nada más.
  if (!Number.isNaN(totalCentavos) && totalCentavos !== totalReflejado) {
    setTotalReflejado(totalCentavos)
    setPagos((previos) => {
      if (previos.length === 0) {
        return [
          { medio: 'EFECTIVO', moneda: 'ARS', monto: deCentavos(totalCentavos), cotizacion: '1', recibido: '' },
        ]
      }
      if (previos.length === 1 && previos[0].moneda === 'ARS') {
        return [{ ...previos[0], monto: deCentavos(totalCentavos) }]
      }
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

  // El foco sí necesita un efecto de verdad: tocar el DOM sólo puede pasar
  // después de que React confirmó el render, no durante.
  useEffect(() => {
    if (ventaProcesada) buscador.current?.focus()
  }, [ventaProcesada])

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

  // `totalDePagosEnCentavos` y NO `totalEnCentavos`: la cotización se guarda
  // con CUATRO decimales, así que tiene su propia conversión. Convertirla con
  // `aMilesimas` truncaría el cuarto —`1234,5678` a `1234,567`— y sobre un
  // pago grande eso mueve el total lo suficiente como para que la pantalla
  // diga que cierra y el motor rechace con PAGOS_NO_CIERRAN. La Task 3 dejó
  // las dos funciones separadas justamente por esto.
  const pagadoCentavos = totalDePagosEnCentavos(
    pagos.map((p) => ({
      montoCentavos: dineroEnCentavos(p.monto),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(p.cotizacion),
    })),
  )
  const faltanCentavos = totalCentavos - pagadoCentavos
  const cierra = hayCarrito && faltanCentavos === 0

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex-1">
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="buscar">Buscar artículo</Label>
          <Input
            id="buscar"
            ref={buscador}
            autoFocus
            autoComplete="off"
            value={busqueda}
            onChange={(e) => alCambiarBusqueda(e.target.value)}
            onKeyDown={alTeclearEnBuscador}
            placeholder="Nombre o código"
          />
        </div>

        {resultados.length > 0 && (
          <ul className="mb-6 divide-y rounded-md border">
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
                  <span className="tabular-nums">
                    {formatearPrecio(a.precio)}
                    {/* Un servicio muestra —, nunca 0: el motor no le descuenta
                        stock, y un cero ahí se leería como faltante. */}
                    <span className="ml-3 text-muted-foreground">
                      {a.esProducto ? formatearCantidad(a.stock) : '—'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Buscá un artículo para empezar la venta.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Artículo</th>
                <th className="w-24 text-right">Cantidad</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const cantidadMilesimas = cantidadEnMilesimas(l.cantidad)
                const invalida = Number.isNaN(cantidadMilesimas)
                const quedaria = aMilesimas(l.stock) - cantidadMilesimas
                return (
                  <tr key={l.articuloId} className="border-b">
                    <td className="py-2">
                      {l.descripcion}
                      {/* Antes que el aviso de stock: una cantidad que no se
                          entiende ni siquiera se puede evaluar contra el
                          stock (`quedaria` también sería NaN). */}
                      {invalida && (
                        <span className="ml-2 text-destructive">cantidad inválida</span>
                      )}
                      {/* Se advierte y NO se bloquea: el motor permite vender
                          sin stock a propósito, y la pantalla no puede ser más
                          estricta que el motor sin volverse mentirosa. */}
                      {!invalida && l.esProducto && quedaria < 0 && (
                        <span className="ml-2 text-destructive">sin stock suficiente</span>
                      )}
                    </td>
                    <td>
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={l.cantidad}
                        onChange={(e) =>
                          actualizarCarrito((p) =>
                            p.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                          )
                        }
                        aria-label={`Cantidad de ${l.descripcion}`}
                      />
                    </td>
                    <td className="text-right tabular-nums">{formatearPrecio(l.precio)}</td>
                    <td className="text-right tabular-nums">
                      {invalida
                        ? '—'
                        : formatearPrecio(
                            deCentavos(subtotalEnCentavos(cantidadMilesimas, aCentavos(l.precio))),
                          )}
                    </td>
                    <td className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => actualizarCarrito((p) => p.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${l.descripcion}`}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Card className="md:w-80">
        <CardHeader>
          <CardTitle>Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-2xl tabular-nums">{formatearPrecio(deCentavos(totalCentavos))}</p>

          <form action={accion} className="flex flex-col gap-4">
            <input type="hidden" name="clave" value={clave} />
            <input
              type="hidden"
              name="items"
              value={JSON.stringify(
                lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
              )}
            />
            <div className="flex flex-col gap-3">
              {pagos.map((p, i) => (
                <FilaDePago
                  key={i}
                  pago={p}
                  indice={i}
                  cotizacionInicial={cotizacionInicial}
                  onCambiar={(cambio) => cambiarPago(i, cambio)}
                  onQuitar={() => setPagos((p2) => p2.filter((_, j) => j !== i))}
                  puedeQuitar={pagos.length > 1}
                />
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setPagos((p) => [
                    ...p,
                    {
                      medio: 'EFECTIVO',
                      moneda: 'ARS',
                      monto: deCentavos(Math.max(0, faltanCentavos)),
                      cotizacion: '1',
                      recibido: '',
                    },
                  ])
                }
              >
                Agregar pago
              </Button>
            </div>

            {/* `!Number.isNaN` primero: un monto a medio tipear (una coma de
                más, una letra) deja `faltanCentavos` en NaN, y `faltanCentavos
                > 0` da falso ahí, así que sin esta guarda se cae a la rama de
                "Sobran" y se imprime "Sobran $ NaN" — un cartel sin sentido
                para un estado que ya deja el botón apagado. `role="status"`
                porque el cartel aparece y cambia de texto sin que nadie lo
                mire, y es la única pista de por qué el botón sigue
                apagado. */}
            {!Number.isNaN(faltanCentavos) && faltanCentavos !== 0 && hayCarrito && (
              <p role="status" className="text-sm tabular-nums text-destructive">
                {faltanCentavos > 0
                  ? `Faltan ${formatearPrecio(deCentavos(faltanCentavos))}`
                  : `Sobran ${formatearPrecio(deCentavos(-faltanCentavos))}`}
              </p>
            )}

            <input
              type="hidden"
              name="pagos"
              value={JSON.stringify(
                // `recibido` NO viaja: es una ayuda de pantalla para calcular
                // el vuelto, y lo que entra a la caja es el monto.
                pagos.map((p) => ({
                  medio: p.medio,
                  moneda: p.moneda,
                  monto: p.monto,
                  cotizacion: p.cotizacion,
                })),
              )}
            />

            {estado.error && (
              <Alert variant="destructive">
                <AlertDescription>{estado.error}</AlertDescription>
              </Alert>
            )}
            {/* Sólo mientras `ventaProcesada` siga siendo ésta: en cuanto el
                carrito cambia (ver `actualizarCarrito`) el cartel se apaga,
                para que no quede colgado mientras se arma la venta
                siguiente. */}
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

            <Button type="submit" disabled={!cierra || cobrando}>
              {cobrando ? 'Cobrando…' : 'Cobrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
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
  cotizacionInicial,
  onCambiar,
  onQuitar,
  puedeQuitar,
}: {
  pago: Pago
  indice: number
  cotizacionInicial: string | null
  onCambiar: (cambio: Partial<Pago>) => void
  onQuitar: () => void
  puedeQuitar: boolean
}) {
  // El vuelto sólo tiene sentido calculado en pesos: `formatearPrecio` está
  // cableado a ARS, así que un vuelto en dólares saldría formateado como si
  // fueran pesos (US$20 de vuelto se leería "$ 20,00"). En dólares el vuelto
  // no se calcula así de todos modos, así que el campo directamente no se
  // ofrece.
  const mostrarVuelto = pago.medio === 'EFECTIVO' && pago.moneda === 'ARS'

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex gap-2">
        <select
          aria-label={`Medio del pago ${indice + 1}`}
          className="h-8 flex-1 rounded-md border px-3 text-sm"
          value={pago.medio}
          onChange={(e) => onCambiar({ medio: e.target.value as Pago['medio'] })}
        >
          <option value="EFECTIVO">Efectivo</option>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="TARJETA_DEBITO">Débito</option>
          <option value="TARJETA_CREDITO">Crédito</option>
        </select>
        <select
          aria-label={`Moneda del pago ${indice + 1}`}
          className="h-8 w-24 rounded-md border px-3 text-sm"
          value={pago.moneda}
          onChange={(e) => {
            const moneda = e.target.value as Pago['moneda']
            onCambiar({
              moneda,
              // Un pago en pesos lleva cotización 1 SIEMPRE; uno en dólares
              // arranca con la última que usó el local.
              cotizacion: moneda === 'ARS' ? '1' : (cotizacionInicial ?? '1'),
            })
          }}
        >
          <option value="ARS">$</option>
          <option value="USD">US$</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`monto-${indice}`}>Monto</Label>
        <Input
          id={`monto-${indice}`}
          inputMode="decimal"
          className="text-right tabular-nums"
          value={pago.monto}
          onChange={(e) => onCambiar({ monto: e.target.value })}
        />
      </div>
      {pago.moneda === 'USD' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`cot-${indice}`}>Cotización</Label>
          <Input
            id={`cot-${indice}`}
            inputMode="decimal"
            className="text-right tabular-nums"
            value={pago.cotizacion}
            onChange={(e) => onCambiar({ cotizacion: e.target.value })}
          />
        </div>
      )}
      {mostrarVuelto && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`rec-${indice}`}>Con cuánto paga (opcional)</Label>
          <Input
            id={`rec-${indice}`}
            inputMode="decimal"
            className="text-right tabular-nums"
            value={pago.recibido}
            onChange={(e) => onCambiar({ recibido: e.target.value })}
          />
          {pago.recibido.trim() !== '' &&
            dineroEnCentavos(pago.recibido) > dineroEnCentavos(pago.monto) && (
              <p className="text-sm tabular-nums">
                Vuelto:{' '}
                {formatearPrecio(
                  deCentavos(dineroEnCentavos(pago.recibido) - dineroEnCentavos(pago.monto)),
                )}
              </p>
            )}
        </div>
      )}
      {puedeQuitar && (
        <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
          Quitar pago
        </Button>
      )}
    </div>
  )
}
