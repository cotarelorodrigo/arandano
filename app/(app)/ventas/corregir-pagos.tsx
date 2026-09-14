'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CircleAlert, Info, Pencil, Plus } from 'lucide-react'
import { corregirPagos } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
// Todos de VALOR y todos seguros: `centavos.ts`, `cruce.ts`, `correccion.ts`,
// `medios.ts` y `gramatica.ts` no importan Prisma ni llegan a `lib/db.ts`, que
// es lo que arrastraría `pg` al bundle del navegador y tiraría abajo la
// compilación entera. Lo vigila test/limite-cliente-servidor.test.ts.
import {
  aCentavos, cotizacionEnDiezMilesimas, deCentavos, dineroEnCentavos,
  montoEntregadoEnCentavos, porcentajeEnMilesimas, recargoEnCentavos,
  totalesDePagosEnCentavos, type FilaDePagoCentavos, type TotalesEnCentavos,
} from '@/lib/ventas/centavos'
import { cotizacionParaElCruce } from '@/lib/ventas/cruce'
import { TOPE_NOTA_DE_CORRECCION } from '@/lib/ventas/correccion'
import { MEDIOS, ROTULO_MEDIO } from '@/lib/ventas/medios'
import { aDecimalCanonico, ErrorDeFormato } from '@/lib/formato/gramatica'
import { formatearPrecio, precioEnSuMoneda } from '@/lib/formato/mostrar'
// De TIPO y no de valor: `lib/planes/consultar.ts` importa Prisma. Mismo caso
// que en `app/(app)/vender/punto-de-venta.tsx`.
import type { PlanVisible } from '@/lib/planes/consultar'
import estilos from './tipografia.module.css'

/**
 * Un pago tal como llega desde el servidor para PRECARGAR el diálogo.
 *
 * `base` y no `monto`, y la diferencia importa: `Pago.monto` es lo que entró a
 * la caja —base más recargo, y en la moneda que se entregó—, mientras que la
 * base es lo que ese pago cubre de la MERCADERÍA a precio de lista, que es lo
 * único que el motor valida contra los dos totales. La reconstruye
 * `baseDePagoGuardado` (app/(app)/ventas/[id]/page.tsx) del lado del servidor,
 * con `Decimal`, y llega acá ya canónica.
 */
export type PagoParaCorregir = {
  medio: (typeof MEDIOS)[number]
  moneda: 'ARS' | 'USD'
  cubre: 'ARS' | 'USD'
  base: string
  cotizacion: string
  planId: string | null
}

/** Lo mismo, con una clave estable para que React no confunda dos filas al
 *  quitar una del medio. La clave es sólo de la pantalla: no viaja. */
type FilaEditable = PagoParaCorregir & { clave: string }

/** El centinela de "sin plan" del `Select`: Radix reserva la cadena vacía para
 *  "sin selección" y un `SelectItem` con `value=""` tira en runtime. Mismo
 *  mecanismo y mismo motivo que en `/vender`. */
const SIN_PLAN = 'sin-plan'

/**
 * Lo que falta (positivo) o sobra (negativo) en cada moneda, en centavos.
 *
 * Sale del MISMO espejo en enteros que usa `/vender`
 * (`totalesDePagosEnCentavos`, `lib/ventas/centavos.ts`), que a su vez espeja
 * caso por caso a `totalesDePagos` del motor: así el diálogo **no puede** decir
 * que cierra mientras el servidor lo rechaza con `PAGOS_NO_CIERREN`. Las dos
 * monedas se miden por separado y no se compensan, igual que en
 * `exigirQueCierren`: una venta que cierra en pesos y no en dólares es tan
 * inválida como la que no cierra a secas.
 */
export function faltanteEnCentavos(
  filas: FilaDePagoCentavos[],
  totales: TotalesEnCentavos,
): TotalesEnCentavos {
  const cubierto = totalesDePagosEnCentavos(filas)
  return { ars: totales.ars - cubierto.ars, usd: totales.usd - cubierto.usd }
}

/**
 * El cartel del faltante, o `null` cuando el juego cierra — y ese `null` es
 * además lo que habilita "Guardar".
 *
 * Es UNA sola función para las dos cosas a propósito: con un predicado aparte
 * para el botón y un texto aparte para el chip, los dos pueden terminar
 * diciendo cosas distintas, que en una pantalla de plata significa un botón
 * habilitado sin cartel (o al revés).
 *
 * **El NaN se trata primero y no cae en "sobran".** Un importe a medio tipear
 * deja la cuenta en NaN; `NaN !== 0`, así que sin esta rama el chip diría
 * "Sobran $ NaN" —el único importe de la pantalla sin la guarda que el resto
 * del repo ya aplica por regla escrita— y el botón quedaría deshabilitado por
 * un motivo que el cartel no explica.
 */
export function textoDelChip(faltan: TotalesEnCentavos): string | null {
  if (Number.isNaN(faltan.ars) || Number.isNaN(faltan.usd)) {
    return 'Revisá los importes: hay uno que no se entiende.'
  }
  const partes = (['ARS', 'USD'] as const).flatMap((moneda) => {
    const centavos = moneda === 'ARS' ? faltan.ars : faltan.usd
    if (centavos === 0) return []
    const verbo = centavos > 0 ? 'Faltan' : 'Sobran'
    // `precioEnSuMoneda` y no `formatearPrecio`: el faltante en dólares tiene
    // que decir "US$ 50,00" y no "$ 50,00". Mismo helper que el chip de
    // `/vender`, así que el símbolo sale de un solo lugar.
    return [`${verbo} ${precioEnSuMoneda(deCentavos(Math.abs(centavos)), moneda)}`]
  })
  return partes.length === 0 ? null : partes.join(' · ')
}

/**
 * Si la venta tiene mercadería en las DOS monedas, y entonces hay algo que
 * elegir en el selector de `Cubre`.
 *
 * Es la misma pregunta que `seMuestraCubre` contesta para MOSTRAR un pago ya
 * guardado, con la diferencia que corresponde: allá alcanza con que el pago
 * cubra dólares para que valga la pena aclararlo, y acá lo que se decide es si
 * hay una ELECCIÓN — con un solo total, elegir el otro produciría una venta
 * que no cierra nunca.
 */
export function hayDosTotales(totales: TotalesEnCentavos): boolean {
  return totales.ars !== 0 && totales.usd !== 0
}

/** La fila de la pantalla traducida a la forma en enteros que entiende el
 *  espejo de `lib/ventas/centavos.ts`. */
function aCentavosDeLaFila(fila: PagoParaCorregir): FilaDePagoCentavos {
  return {
    moneda: fila.moneda,
    cubre: fila.cubre,
    baseCentavos: dineroEnCentavos(fila.base),
    cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(fila.cotizacion),
  }
}

/**
 * Lo que hay que cobrar por ESTA fila, en centavos de peso: los pesos que
 * entrega más el recargo de su plan.
 *
 * Con `recargoEnCentavos` y `porcentajeEnMilesimas`, que son el espejo exacto
 * de `recargoDePago` del servidor (`centavos.test.ts` compara las dos
 * aritméticas caso por caso), sobre los PESOS QUE ENTREGA la fila y no sobre
 * la base —que desde el precio en dólares puede estar en dólares—, igual que
 * el motor.
 *
 * Existe porque el campo se rotula "Monto" y muestra la BASE: con un plan, eso
 * no es lo que se le pide a la persona. Es la misma cuenta que
 * `aCobrarDeLaFilaEnCentavos` hace en `/vender`; no se importa de ahí porque
 * traería el punto de venta entero al bundle de esta pantalla, y lo que sí se
 * comparte —que es donde está la aritmética— son las funciones de
 * `lib/ventas/centavos.ts`.
 */
export function aCobrarEnCentavos(fila: PagoParaCorregir, planes: PlanVisible[]): number {
  const entregado = montoEntregadoEnCentavos(aCentavosDeLaFila(fila))
  const plan = planes.find((p) => p.id === fila.planId)
  if (!plan) return entregado
  return entregado + recargoEnCentavos(entregado, porcentajeEnMilesimas(plan.porcentaje))
}

/**
 * Los planes que UNA fila puede elegir: los de su medio, y sólo si entrega
 * pesos.
 *
 * Las dos mitades son la misma regla —no ofrecer lo que el servidor va a
 * rechazar—, con dos códigos distintos del motor detrás: un plan de otro medio
 * es `PLAN_NO_CORRESPONDE` y un plan sobre un pago ENTREGADO en dólares es
 * `PLAN_EN_DOLARES` (`lib/ventas/pagos.ts`). No mira `cubre`, y no es un
 * olvido: un pago en pesos contra el total en dólares lleva su plan sin
 * problema, que es justamente el iPhone financiado en doce cuotas.
 */
export function planesDeLaFila(
  fila: { medio: PagoParaCorregir['medio']; moneda: PagoParaCorregir['moneda'] },
  planes: PlanVisible[],
): PlanVisible[] {
  if (fila.moneda !== 'ARS') return []
  return planes.filter((p) => p.medio === fila.medio)
}

/**
 * El disparador del diálogo, con el diálogo adentro.
 *
 * **Una sola copia sirve a los dos anchos.** El encabezado de la card "Cómo se
 * pagó" (`app/(app)/ventas/[id]/page.tsx`) se renderiza igual en teléfono y en
 * escritorio —no lleva `hidden lg:flex`, a diferencia de las `acciones` de
 * `<Encabezado>`—, así que no hace falta la segunda copia que la regla de las
 * dos copias exige cuando el Topbar esconde la primera.
 *
 * Controlado (`open` + `onOpenChange`) porque el guardado lo cierra por su
 * cuenta, y con `DialogTrigger` igual: el trigger no es sólo quien abre — es lo
 * que Radix usa para devolver el foco al cerrar y para poner el
 * `aria-haspopup`/`aria-expanded`.
 */
export function CorregirPagos({
  ventaId,
  totalArs,
  totalUsd,
  pagos,
  planes,
  hayPagoSinPorcentaje,
}: {
  ventaId: string
  /** Los dos totales de la MERCADERÍA, ya canónicos (`Decimal.toString()`).
   *  No se tocan: lo que esta pantalla reparte es cómo se pagaron. */
  totalArs: string
  totalUsd: string
  pagos: PagoParaCorregir[]
  /** Los planes VIGENTES del local. Un plan dado de baja no vuelve para cobrar
   *  —el motor lo rechaza igual que a uno inexistente—, así que tampoco se
   *  ofrece. */
  planes: PlanVisible[]
  hayPagoSinPorcentaje: boolean
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil aria-hidden="true" className="size-[14px]" />
          Corregir
        </Button>
      </DialogTrigger>
      {/* Con tope de alto y scroll propio: el cuerpo crece con cada pago, y en
          un teléfono de 390×844 tres pagos ya no entran. Sin esto el diálogo
          se pasa de la pantalla y el botón de guardar queda inalcanzable. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corregir cómo se pagó</DialogTitle>
          <DialogDescription>
            La mercadería no se toca: se corrige con qué se pagó y cómo se repartió. Lo que
            entre tiene que cubrir exactamente el total de la venta.
          </DialogDescription>
        </DialogHeader>
        {/* El cuerpo se monta recién al abrir (Radix desmonta `DialogContent`
            cerrado), así que su estado nace de las props CADA vez: abrir,
            cambiar algo, cerrar sin guardar y volver a abrir muestra lo que
            está guardado y no el borrador de hace un rato. */}
        <CuerpoDeCorreccion
          ventaId={ventaId}
          totalArs={totalArs}
          totalUsd={totalUsd}
          pagos={pagos}
          planes={planes}
          hayPagoSinPorcentaje={hayPagoSinPorcentaje}
          onCerrar={() => setAbierto(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * El cuerpo del diálogo, exportado APARTE del diálogo.
 *
 * No es una separación por prolijidad: `DialogContent` (Radix) sólo se monta
 * cuando el diálogo está abierto, así que un render estático del diálogo
 * cerrado no ve nada de esto — y este repo no tiene jsdom, o sea que no hay
 * forma de abrirlo en un test. Es el mismo motivo por el que `/formas-de-pago`
 * exporta `CamposDePlan` y `/usuarios` exporta `FilasDePermisos`.
 */
export function CuerpoDeCorreccion({
  ventaId,
  totalArs,
  totalUsd,
  pagos,
  planes,
  hayPagoSinPorcentaje,
  onCerrar,
}: {
  ventaId: string
  totalArs: string
  totalUsd: string
  pagos: PagoParaCorregir[]
  planes: PlanVisible[]
  hayPagoSinPorcentaje: boolean
  onCerrar: () => void
}) {
  // El contador de claves arranca donde terminan los pagos que llegaron: así
  // una fila nueva nunca reusa la clave de una que se quitó.
  const proximaClave = useRef(pagos.length)
  const [filas, setFilas] = useState<FilaEditable[]>(() =>
    pagos.map((p, i) => ({ ...p, clave: `pago-${i}` })),
  )
  const [nota, setNota] = useState('')
  const [enCurso, empezar] = useTransition()

  // `aCentavos` y no `dineroEnCentavos`: esto no lo tipeó nadie, es el
  // `toString()` de un `Decimal` que armó el servidor. Mismo criterio que el
  // precio de un artículo en `/vender`.
  const totales: TotalesEnCentavos = { ars: aCentavos(totalArs), usd: aCentavos(totalUsd) }
  const faltan = faltanteEnCentavos(filas.map(aCentavosDeLaFila), totales)
  const chip = textoDelChip(faltan)
  const ofreceCubre = hayDosTotales(totales)

  function cambiar(clave: string, cambio: Partial<PagoParaCorregir>) {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, ...cambio } : f)))
  }

  function agregar() {
    const clave = `pago-${proximaClave.current++}`
    setFilas((actuales) => [
      ...actuales,
      {
        clave,
        medio: 'EFECTIVO',
        moneda: 'ARS',
        // Contra el total que la venta tenga cuando tiene uno solo: con sólo
        // dólares, un pago nuevo que naciera cubriendo pesos apuntaría a un
        // total que vale cero y el selector para corregirlo tampoco se
        // dibuja. Misma regla que `cubrePorDefecto` en `/vender`.
        cubre: totales.ars === 0 && totales.usd !== 0 ? 'USD' : 'ARS',
        base: '',
        cotizacion: '1',
        planId: null,
      },
    ])
  }

  function guardar() {
    if (enCurso || chip !== null) return
    // La clave es por VENTA: dos correcciones seguidas sobre la misma venta
    // actualizan el mismo toast en vez de apilar uno por intento.
    const clave = `correccion-${ventaId}`
    let canonicos
    try {
      // Canónico ANTES de mandarlo: `corregirPagos` construye el `Decimal`
      // directo con lo que reciba, así que un `94.000,50` tipeado en el campo
      // llegaría como texto que `decimal.js` rechaza. La gramática es la MISMA
      // que aplica el servidor cuando cobra (`lib/formato/gramatica.ts`), y la
      // misma por la que ya pasó cada número para poder decir que la venta
      // cierra — así que acá no puede dar otra cosa.
      canonicos = filas.map((f) => ({
        medio: f.medio,
        moneda: f.moneda,
        cubre: f.cubre,
        base: aDecimalCanonico(f.base, 'el monto del pago'),
        cotizacion: aDecimalCanonico(f.cotizacion, 'la cotización'),
        planId: f.planId,
      }))
    } catch (e) {
      // El mensaje de la gramática ya está escrito para que lo lea quien
      // cobra ("escribilo sin separador de miles"), así que se muestra tal
      // cual en vez de traducirlo a algo más vago.
      if (e instanceof ErrorDeFormato) {
        toast.error(e.message, { id: clave, duration: Infinity })
        return
      }
      throw e
    }

    empezar(async () => {
      const resultado = await corregirPagos({ ventaId, pagos: canonicos, nota })
      // El toast se lanza acá, en el MISMO handler que ejecutó la acción y con
      // el resultado en la mano — nunca desde un `useEffect`. Ese patrón es el
      // que hizo desaparecer los avisos del ABM de categorías: el efecto
      // colgaba del ciclo de vida de un componente que `revalidatePath`
      // desmontaba, y el toast se iba con él.
      if (resultado.error) {
        // `Infinity`: el error es accionable —dice qué corregir— y un aviso
        // que se va solo a los cuatro segundos se lleva justamente la
        // instrucción.
        toast.error(resultado.error, { id: clave, duration: Infinity })
        return
      }
      if (resultado.aviso) toast.success(resultado.aviso, { id: clave })
      // Sólo si salió bien: con un error, cerrar haría desaparecer lo que la
      // persona acaba de repartir justo cuando el toast le explica qué
      // corregir.
      onCerrar()
    })
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        guardar()
      }}
    >
      {hayPagoSinPorcentaje && (
        // Un DATO y no una advertencia: no hay nada que la persona tenga que
        // hacer distinto, y pintarlo de rojo haría dudar de una corrección que
        // está bien. Pasa con todo pago cobrado antes de que existiera
        // `Pago.porcentaje` — ahí el motor cae al porcentaje de hoy, y eso es
        // exactamente lo que esta línea dice.
        <p className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-[12px] text-muted-foreground">
          <Info aria-hidden="true" className="mt-px size-[14px] shrink-0" />
          <span>
            Uno de estos pagos se cobró antes de que se guardara el porcentaje del plan. Al
            corregir, se recalcula con el porcentaje de hoy.
          </span>
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {filas.map((fila, indice) => (
          <FilaDeCorreccion
            key={fila.clave}
            fila={fila}
            indice={indice}
            planes={planes}
            ofreceCubre={ofreceCubre}
            puedeQuitar={filas.length > 1}
            onCambiar={(cambio) => cambiar(fila.clave, cambio)}
            onQuitar={() => setFilas((actuales) => actuales.filter((f) => f.clave !== fila.clave))}
          />
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={agregar}>
        <Plus aria-hidden="true" className="size-[15px]" />
        Agregar pago
      </Button>

      {chip !== null && (
        <Badge
          role="status"
          variant="outline"
          className="h-auto w-full justify-start gap-[7px] rounded-[10px] border-transparent bg-destructive-soft px-3 py-[9px] text-xs font-semibold text-destructive"
        >
          <CircleAlert aria-hidden="true" className="size-[14px] shrink-0" />
          <span className={estilos.archivo}>{chip}</span>
        </Badge>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nota-correccion" className="text-[11px] font-semibold text-foreground-soft">
          Por qué se corrige (opcional)
        </Label>
        {/* El MISMO tope que aplica el motor (`TOPE_NOTA_DE_CORRECCION`, una
            sola vez en lib/ventas/correccion.ts): así el corte del control no
            se puede desincronizar del corte real, que es lo que haría que la
            persona vea guardado algo distinto de lo que escribió. */}
        <Textarea
          id="nota-correccion"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={TOPE_NOTA_DE_CORRECCION}
          rows={2}
          placeholder="Se había cargado como efectivo y fue transferencia."
        />
      </div>

      <DialogFooter>
        {/* Deshabilitado mientras el juego no cierre en las DOS monedas, con
            la MISMA función que dibuja el chip: un predicado aparte podría
            decir que sí mientras el cartel dice que no. */}
        <Button type="submit" disabled={enCurso || chip !== null}>
          {enCurso ? 'Guardando…' : 'Guardar la corrección'}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Una fila de pago: qué medio, con qué plan, en qué moneda, contra qué total y
 * por cuánto.
 *
 * **Cada control aparece sólo cuando hay algo que decidir** —el plan si ese
 * medio tiene planes cargados, `Cubre` si la venta tiene los dos totales, la
 * cotización si el pago cruza monedas—, así que un local que no usa nada de
 * esto ve tres controles y nada más. Es el mismo principio con el que entraron
 * los planes de pago y el precio en dólares.
 *
 * **Mobile-first**: los controles se apilan sin prefijo y pasan a fila con
 * `lg:`. Sin `sm:` ni `md:`.
 */
function FilaDeCorreccion({
  fila,
  indice,
  planes,
  ofreceCubre,
  puedeQuitar,
  onCambiar,
  onQuitar,
}: {
  fila: FilaEditable
  indice: number
  planes: PlanVisible[]
  ofreceCubre: boolean
  puedeQuitar: boolean
  onCambiar: (cambio: Partial<PagoParaCorregir>) => void
  onQuitar: () => void
}) {
  // El pago CRUZA cuando lo que entrega no es lo que cubre: ahí —y sólo ahí—
  // hay una conversión, así que hay una cotización que pedir. Cuando no cruza
  // la cotización vale 1 y no entra en ninguna cuenta.
  const cruza = fila.moneda !== fila.cubre
  // Cuando cruza, la base SIEMPRE está en dólares (`baseEnDolaresCentavos` es
  // verdadero en cuanto una de las dos puntas es USD), así que el rótulo puede
  // decir "US$" sin preguntar cuál — y por eso nada divide.
  const etiquetaDelMonto = cruza ? 'Cubre US$' : 'Monto'
  const planesDelMedio = planesDeLaFila(fila, planes)
  const entregado = montoEntregadoEnCentavos(aCentavosDeLaFila(fila))
  const aCobrar = aCobrarEnCentavos(fila, planes)
  // Si el plan de esta fila mueve el número. Un plan al 0 % —o ninguno— deja
  // la fila exactamente como estaría sin planes.
  const elPlanMueveElNumero = !Number.isNaN(aCobrar) && aCobrar !== entregado

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
      <div className="flex items-center gap-2">
        {/* Cambiar el medio LIMPIA el plan, en el mismo cambio de estado: un
            plan de crédito que sobreviva a un cambio a efectivo es el
            PLAN_NO_CORRESPONDE que el motor rechaza, con la pantalla mostrando
            algo que se ve válido. Esconder el selector no alcanza — el
            `planId` viejo seguiría en el estado y viajaría igual. */}
        <Select
          value={fila.medio}
          onValueChange={(medio) =>
            onCambiar({ medio: medio as PagoParaCorregir['medio'], planId: null })
          }
        >
          <SelectTrigger
            aria-label={`Medio del pago ${indice + 1}`}
            className="h-9! flex-1 justify-between rounded-[9px] text-[13px] font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Del catálogo y no de cuatro `<SelectItem>` a mano: `MEDIOS`
                (lib/ventas/medios.ts) está atado al enum del schema, y una
                lista escrita acá se desincronizaría de él. */}
            {MEDIOS.map((m) => (
              <SelectItem key={m} value={m}>
                {ROTULO_MEDIO[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={fila.moneda}
          onValueChange={(valor) => {
            const moneda = valor as PagoParaCorregir['moneda']
            onCambiar({
              moneda,
              // La cotización se rehace con el cruce nuevo: vacía si pasa a
              // cruzar (nunca precargada) y 1 si deja de cruzar, que además es
              // lo que borra una cotización mentirosa. Ver `cotizacionParaElCruce`.
              cotizacion: cotizacionParaElCruce(moneda, fila.cubre),
              // Y limpia el plan, por lo mismo que el selector de al lado: un
              // plan sobre un pago ENTREGADO en dólares es el PLAN_EN_DOLARES
              // que el motor rechaza. En las DOS direcciones, porque un plan
              // que reaparezca solo al volver a pesos es un recargo que nadie
              // volvió a elegir.
              planId: null,
            })
          }}
        >
          <SelectTrigger
            aria-label={`Moneda del pago ${indice + 1}`}
            className="h-9! w-[92px] justify-between rounded-[9px] text-[13px] font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {ofreceCubre && (
        // Con rótulo VISIBLE y no sólo `aria-label`, a diferencia de los otros
        // selectores: "Efectivo" o "US$" se explican solos, y "total en
        // dólares" sin la palabra que lo introduce no dice qué relación tiene
        // con el pago. Juntos se leen como la oración que son.
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-foreground-soft">Cubre</span>
          <Select
            value={fila.cubre}
            onValueChange={(valor) => {
              const cubre = valor as PagoParaCorregir['cubre']
              onCambiar({
                cubre,
                cotizacion: cotizacionParaElCruce(fila.moneda, cubre),
                planId: null,
              })
            }}
          >
            <SelectTrigger
              aria-label={`Cubre del pago ${indice + 1}`}
              className="h-9! flex-1 justify-between rounded-[9px] text-[13px] font-medium"
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

      {planesDelMedio.length > 0 && (
        <Select
          value={fila.planId ?? SIN_PLAN}
          onValueChange={(valor) => onCambiar({ planId: valor === SIN_PLAN ? null : valor })}
        >
          <SelectTrigger
            aria-label={`Plan del pago ${indice + 1}`}
            className="h-9! w-full justify-between rounded-[9px] text-[13px] font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SIN_PLAN}>Precio de lista</SelectItem>
            {planesDelMedio.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex flex-col gap-2 lg:flex-row">
        <CampoDeMonto
          id={`base-${indice}`}
          etiqueta={etiquetaDelMonto}
          valor={fila.base}
          onChange={(v) => onCambiar({ base: v })}
        />
        {cruza && (
          <CampoDeMonto
            id={`cot-${indice}`}
            etiqueta="Cotización"
            valor={fila.cotizacion}
            onChange={(v) => onCambiar({ cotizacion: v })}
          />
        )}
      </div>

      {/* Lo que hay que cobrar por esta fila, SÓLO cuando el plan mueve el
          número: sin plan sería repetir el campo de arriba. El campo se rotula
          "Monto" y muestra la base —lo que el pago cubre de la mercadería a
          precio de lista—, y con un plan eso no es lo que entra a la caja. */}
      {elPlanMueveElNumero && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">A cobrar</span>
          <span className={`${estilos.archivo} text-[13px] font-semibold text-foreground-soft`}>
            {formatearPrecio(deCentavos(aCobrar))}
          </span>
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

/** Un campo de plata con su rótulo, con el mismo tratamiento que los de
 *  `/vender`: rótulo chico arriba y el importe en Archivo, alineado a la
 *  derecha. `inputMode="decimal"` para que el teléfono abra el teclado
 *  numérico. */
function CampoDeMonto({
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
    <div className="flex flex-1 flex-col gap-1.5">
      <Label htmlFor={id} className="text-[11px] font-semibold text-foreground-soft">
        {etiqueta}
      </Label>
      <Input
        id={id}
        value={valor}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={`${estilos.archivo} h-10 text-right text-[15px] font-semibold`}
      />
    </div>
  )
}
