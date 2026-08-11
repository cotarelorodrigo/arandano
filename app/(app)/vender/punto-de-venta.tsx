'use client'

import { useActionState, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import {
  aCentavos, aMilesimas, deCentavos, deMilesimas, subtotalEnCentavos, totalEnCentavos,
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

/**
 * Lo que la persona tipeó, en milésimas.
 *
 * Normaliza la coma a punto porque `aMilesimas` sólo parte por punto y la
 * pantalla MUESTRA las cantidades con coma (`formatearCantidad`): sin esto,
 * alguien tipea el separador que la interfaz le acabó de mostrar y el total
 * entero se vuelve NaN. El servidor sí acepta la coma (`aDecimal`), así que
 * esto alinea al cliente con él y no al revés.
 *
 * Devuelve NaN si no es un número — el llamador lo trata.
 */
function cantidadEnMilesimas(texto: string): number {
  return aMilesimas(texto.trim().replace(',', '.') || '0')
}

export function PuntoDeVenta() {
  const [estado, accion, cobrando] = useActionState(cobrar, INICIAL)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ArticuloVendible[]>([])
  // Una clave por venta. Se renueva al cobrar bien, así que la venta siguiente
  // es otra; mientras tanto, todo reintento del mismo carrito manda la misma.
  const [clave, setClave] = useState(() => crypto.randomUUID())
  // La última venta ya procesada por la limpieza de abajo, para no repetirla
  // en cada render.
  const [ventaProcesada, setVentaProcesada] = useState<string | null>(null)
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

  // Al cobrar bien: carrito vacío y clave nueva, calculado durante el render
  // en vez de en un efecto — es el patrón que React documenta para "ajustar
  // estado cuando cambia otro estado" (comparar contra la última venta ya
  // procesada), y el único que este lint acepta para un setState síncrono.
  if (estado.venta && estado.venta.id !== ventaProcesada) {
    setVentaProcesada(estado.venta.id)
    setLineas([])
    setBusqueda('')
    setResultados([])
    setClave(crypto.randomUUID())
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

  const enCentavos = lineas.map((l) => ({
    cantidadMilesimas: cantidadEnMilesimas(l.cantidad),
    precioCentavos: aCentavos(l.precio),
  }))
  const totalCentavos = totalEnCentavos(enCentavos)
  const hayLineaInvalida = enCentavos.some((l) => Number.isNaN(l.cantidadMilesimas))
  const hayCarrito = lineas.length > 0 && totalCentavos > 0 && !hayLineaInvalida

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
            {/* Un solo pago, en efectivo y por el total: el caso del 90%. La
                Task 7 lo convierte en una lista editable. */}
            <input
              type="hidden"
              name="pagos"
              value={JSON.stringify([
                {
                  medio: 'EFECTIVO',
                  moneda: 'ARS',
                  monto: deCentavos(totalCentavos),
                  cotizacion: '1',
                },
              ])}
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

            <Button type="submit" disabled={!hayCarrito || cobrando}>
              {cobrando ? 'Cobrando…' : 'Cobrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
