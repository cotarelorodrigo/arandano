'use client'

import { useState, useTransition } from 'react'
import { CreditCard, Plus, Info } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MEDIOS, ROTULO_MEDIO } from '@/lib/ventas/medios'
import {
  altaDePlan, edicionDePlan, bajaDePlan, reactivacionDePlan, type EstadoPlanes,
} from './acciones'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
import estilos from './tipografia.module.css'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en usuarios, inventario y login.
const INICIAL: EstadoPlanes = { error: null, aviso: null }

/**
 * Un plan tal como lo mira esta pantalla.
 *
 * `porcentaje` viaja CRUDO además de formateado: el formulario de edición
 * necesita el número tal cual está guardado para poder devolverlo sin cambios,
 * y un `+40 %` en el campo no vuelve a parsear. Lo mismo con `ejemplo`, que ya
 * llega calculado y formateado desde el servidor — `precioConPlan` vive del
 * lado de Prisma y no puede cruzar a este archivo.
 */
export type FilaDePlan = {
  id: string
  nombre: string
  rotuloMedio: string
  cuotas: number
  /** El `toString()` del Decimal, para el campo del formulario. */
  porcentaje: string
  /** El mismo número, ya listo para leer: `+40%`, `-10%` (formatearPorcentaje). */
  porcentajeMostrado: string
  orden: number
  /** Lo que sale el artículo de referencia con este plan, ya formateado. */
  ejemplo: string
  desactivado: boolean
}

/**
 * Lanza el toast que corresponda, con el resultado ya en la mano.
 *
 * **Es una función normal, llamada en el mismo handler que ejecuta la acción,
 * y NO un `useEffect` sobre `useActionState`.** Es la lección que dejaron el
 * ABM de categorías y el diálogo de permisos: un efecto está atado al ciclo de
 * vida del componente, y las filas se re-renderizan y se desmontan con cada
 * `revalidatePath` — el aviso quedaba colgado de un componente que dejaba de
 * existir mientras el toast todavía tenía que estar en pantalla. Lanzado acá
 * vive en el store de sonner, fuera de React.
 *
 * **Los errores no se auto-descartan** (`duration: Infinity`): "Ya hay un plan
 * que se llama X" dice qué corregir antes de reintentar, y un aviso que se va
 * solo a los cuatro segundos se lleva justamente la instrucción. Los de éxito
 * sí se van: el plan apareciendo en la tabla ya es la confirmación.
 *
 * **La clave es estable por acción y por plan**, o sonner apila una copia por
 * cada vez que se toca el mismo control.
 *
 * El Toaster ya está montado en el root layout, que es el único lugar donde
 * ningún `revalidatePath` de pantalla lo remonta: acá no se monta otro.
 * `test/toaster.test.ts` lo fija para todo `app/`.
 */
function avisar(resultado: EstadoPlanes, clave: string): EstadoPlanes {
  if (resultado.error) toast.error(resultado.error, { id: clave, duration: Infinity })
  else if (resultado.aviso) toast.success(resultado.aviso, { id: clave })
  return resultado
}

const ENLACE =
  'text-xs font-semibold text-primary hover:underline disabled:pointer-events-none disabled:opacity-50'

function Campo({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[5px]">{children}</div>
}

const ROTULO = 'text-[11px] font-semibold text-foreground-soft'

/**
 * Los campos del alta y de la edición, sin el `Dialog` que los rodea.
 *
 * **Separado del diálogo a propósito**, con el mismo motivo que
 * `FilasDePermisos` en `/usuarios`: `DialogContent` (Radix) sólo se monta
 * cuando el diálogo está abierto, así que un `renderToStaticMarkup` del
 * diálogo cerrado nunca vería estos campos y probarlos contra el diálogo
 * completo daría un falso negativo en vez de un bug real.
 *
 * `plan` presente = edición. Las dos diferencias son deliberadas:
 *
 * - **El medio no se edita**, se muestra. Cambiar de medio es dar de baja y
 *   crear otro: el medio define contra qué pagos sirve el plan, y moverlo
 *   dejaría las ventas viejas apuntando a un plan que ya no describe cómo se
 *   cobraron.
 * - **El orden sólo aparece en la edición.** En el alta sale de las cuotas
 *   —3 cuotas antes que 12, sin que nadie ordene nada— y un campo más para
 *   confirmar ese default sería una pregunta sin respuesta interesante.
 */
export function CamposDePlan({ plan, pendiente }: { plan?: FilaDePlan; pendiente: boolean }) {
  return (
    <div className="flex flex-col gap-[14px]">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <Campo>
        <Label htmlFor="nombre" className={ROTULO}>
          Cómo se llama
        </Label>
        <Input
          id="nombre"
          name="nombre"
          required
          autoComplete="off"
          defaultValue={plan?.nombre}
          placeholder="Crédito 3 cuotas"
          disabled={pendiente}
          className="h-10 rounded-[9px]"
        />
      </Campo>

      {plan ? (
        <Campo>
          <span className={ROTULO}>Forma de pago</span>
          <p className="text-[13px] text-foreground">
            {plan.rotuloMedio}
            <span className="text-muted-foreground">
              {' '}
              — para cambiarla, dale de baja a este plan y creá otro.
            </span>
          </p>
        </Campo>
      ) : (
        <Campo>
          <Label htmlFor="medio" className={ROTULO}>
            Forma de pago
          </Label>
          {/* `name` en el <Select> y no en un campo aparte: Radix monta un
              <select> nativo escondido con ese nombre, que es lo que hace que
              el medio llegue al FormData. Mismo cableado que los selectores de
              categoría del alta de artículos. El trigger visible es un
              <button>, así que esto NO funciona sin JavaScript — el diálogo
              que lo rodea tampoco, ver DialogoDePlan. */}
          <Select name="medio" defaultValue="TARJETA_CREDITO" disabled={pendiente}>
            <SelectTrigger id="medio" className="h-10 w-full rounded-[9px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEDIOS.map((m) => (
                <SelectItem key={m} value={m}>
                  {ROTULO_MEDIO[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
      )}

      <div className="flex gap-[14px]">
        <Campo>
          <Label htmlFor="cuotas" className={ROTULO}>
            En cuántas cuotas
          </Label>
          {/* min/max acompañan al chequeo del servidor, no lo reemplazan: la
              validación del navegador se saltea con dos clicks. */}
          <Input
            id="cuotas"
            name="cuotas"
            type="number"
            min={1}
            max={120}
            step={1}
            required
            defaultValue={plan?.cuotas ?? 1}
            disabled={pendiente}
            className="h-10 rounded-[9px]"
          />
        </Campo>
        <Campo>
          <Label htmlFor="porcentaje" className={ROTULO}>
            Cuánto recarga (%)
          </Label>
          {/* type="text" y no "number": el campo acepta coma decimal —13,755—
              y un input numérico la rechaza según el locale del navegador, que
              no es el del local. La gramática vive en el servidor. */}
          <Input
            id="porcentaje"
            name="porcentaje"
            type="text"
            inputMode="decimal"
            required
            autoComplete="off"
            defaultValue={plan?.porcentaje}
            placeholder="40"
            disabled={pendiente}
            className="h-10 rounded-[9px]"
          />
        </Campo>
      </div>
      <p className="text-[11px] text-muted-foreground">
        En negativo es un descuento: <strong>-10</strong> es el precio de contado.
      </p>

      {plan && (
        <Campo>
          <Label htmlFor="orden" className={ROTULO}>
            En qué orden aparece
          </Label>
          <Input
            id="orden"
            name="orden"
            type="number"
            step={1}
            required
            defaultValue={plan.orden}
            disabled={pendiente}
            className="h-10 rounded-[9px]"
          />
        </Campo>
      )}
    </div>
  )
}

/**
 * El diálogo de alta (sin `plan`) o de edición (con él).
 *
 * **Sin `useActionState` y sin `<form action={…}>`**: el submit se maneja a
 * mano para poder avisar con el resultado en la mano (ver `avisar`) y para
 * cerrar el diálogo sólo si salió bien — con un nombre repetido, cerrarlo
 * haría desaparecer lo que la persona escribió justo cuando el toast le
 * explica que lo corrija.
 *
 * **Pero el "en curso" sale de `useTransition` y no de un `useState` propio**,
 * igual que el diálogo de permisos de `/usuarios`. No es cosmético: las
 * actions de este archivo **rechazan** todo lo que no sea corregible
 * —`forbidden()` incluido, que es alcanzable acá mismo si un dueño le revoca
 * `PLANES_PAGO` a alguien que tiene el diálogo abierto—, y con un
 * `setPendiente(false)` escrito a mano después del `await`, un rechazo se
 * saltea esa línea y deja el diálogo trabado para siempre: todos los campos
 * deshabilitados, el botón clavado en "Guardando…" y ni un toast, porque
 * `avisar` tampoco llegó a correr. React limpia su bandera cuando la
 * transición termina, se haya resuelto o rechazado, así que el agujero no
 * existe — y el rechazo llega al error boundary en vez de perderse.
 *
 * El costo es que esta pantalla **necesita JavaScript**. Acá ya era así: el
 * diálogo es de Radix y el `Select` del medio tampoco funciona sin JS — es el
 * mismo trade-off que ya aceptaron `/vender` y el alta de artículos.
 */
export function DialogoDePlan({ plan, movil = false }: { plan?: FilaDePlan; movil?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, empezar] = useTransition()

  const clave = plan ? `plan-${plan.id}-edicion` : 'plan-alta'

  // Controlado (`open` + `onOpenChange`) porque el submit lo cierra por su
  // cuenta, y con `DialogTrigger` igual: el trigger no es sólo quien abre — es
  // lo que Radix usa para devolver el foco al cerrar y para poner el
  // aria-haspopup/aria-expanded. Un <button> suelto con onClick abre igual y
  // deja el foco en el body, que sobre un producto que se opera con teclado no
  // es un detalle.
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        {plan ? (
          <button type="button" className={ENLACE}>
            Editar
          </button>
        ) : movil ? (
          // La copia del teléfono: la ranura derecha del Topbar, que
          // `<Encabezado>` sólo puede llenar con `controlMovil` —un diálogo
          // trae estado propio, no es un link—. Sin ella, "Plan nuevo"
          // desaparecía del teléfono sin reaparecer en ningún lado: la regla
          // que el ciclo del teléfono aplicó cinco veces (CLAUDE.md). Es una
          // SEGUNDA instancia del mismo diálogo, montada en paralelo, igual
          // que los dos `PanelDeCategorias` de /inventario — en cada ancho se
          // ve una sola.
          <button
            type="button"
            aria-label="Plan nuevo"
            className={`${CLASES_RANURA_MOVIL} bg-primary text-primary-foreground`}
          >
            <Plus aria-hidden="true" className="size-[19px]" />
          </button>
        ) : (
          <Button className="hidden lg:inline-flex">
            <Plus aria-hidden="true" className="size-[15px]" />
            Plan nuevo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{plan ? `Editar "${plan.nombre}"` : 'Un plan nuevo'}</DialogTitle>
          <DialogDescription>
            El recargo cae sólo sobre la parte que se pague así. La mercadería siempre se
            registra a precio de lista.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (enCurso) return
            // El FormData se arma ACÁ y no adentro de la transición: después
            // del primer await, `e.currentTarget` ya es null.
            const datos = new FormData(e.currentTarget)
            empezar(async () => {
              const resultado = avisar(
                await (plan ? edicionDePlan : altaDePlan)(INICIAL, datos),
                clave,
              )
              // Sólo si salió bien: con un nombre repetido, cerrar haría
              // desaparecer lo que la persona escribió justo cuando el toast le
              // explica que lo corrija.
              if (!resultado.error) setAbierto(false)
            })
          }}
        >
          <CamposDePlan plan={plan} pendiente={enCurso} />
          <DialogFooter className="mt-5">
            <Button type="submit" disabled={enCurso}>
              {enCurso ? 'Guardando…' : plan ? 'Guardar cambios' : 'Crear el plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * La celda de acciones de una fila: "Editar · Baja", o "Reactivar".
 *
 * Sin `<form>` y sin menú desplegable: las dos acciones mandan un solo campo
 * —el id— y la pantalla ya necesita JavaScript por el diálogo, así que un form
 * no compraría nada. La baja es LÓGICA, así que no hay nada irreversible que
 * confirmar: si se dio de baja de más, "Reactivar" está en la misma celda.
 *
 * `useTransition` por lo mismo que `DialogoDePlan` (ver su comentario): un
 * rechazo de la action —un `forbidden()` por un permiso revocado, o un bug de
 * verdad— dejaba el botón clavado en "Dando de baja…" para siempre. Y de paso
 * saca el `void` con el que se disparaba cada acción, que descartaba el rechazo
 * en vez de dejarlo llegar a ningún lado.
 */
export function AccionesDeFila({ plan }: { plan: FilaDePlan }) {
  const [enCurso, empezar] = useTransition()

  const ejecutar = (
    accion: (estado: EstadoPlanes, datos: FormData) => Promise<EstadoPlanes>,
    sufijo: string,
  ) => {
    if (enCurso) return
    const datos = new FormData()
    datos.set('id', plan.id)
    empezar(async () => {
      avisar(await accion(INICIAL, datos), `plan-${plan.id}-${sufijo}`)
    })
  }

  if (plan.desactivado) {
    return (
      <button
        type="button"
        disabled={enCurso}
        onClick={() => ejecutar(reactivacionDePlan, 'reactivacion')}
        className={ENLACE}
      >
        {enCurso ? 'Reactivando…' : 'Reactivar'}
      </button>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <DialogoDePlan plan={plan} />
      <span aria-hidden="true" className="text-xs text-muted-foreground">
        ·
      </span>
      <button
        type="button"
        disabled={enCurso}
        onClick={() => ejecutar(bajaDePlan, 'baja')}
        className={ENLACE}
      >
        {enCurso ? 'Dando de baja…' : 'Baja'}
      </button>
    </div>
  )
}

const ENCABEZADO_COLUMNA =
  'h-auto py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase'

/**
 * La tabla de planes.
 *
 * **La columna del ejemplo es la que hace legible al porcentaje.** Un `+40 %`
 * en una celda no le dice nada a nadie a las 8 de la mañana; "un artículo de
 * $10.000 se cobra $14.000" sí. El número se calcula en el servidor con
 * `precioConPlan` —la misma función que después usa la ficha del artículo— así
 * que la pantalla no puede decir un precio distinto del que el mostrador cobra.
 */
export function TablaDePlanes({ planes, ejemploBase }: { planes: FilaDePlan[]; ejemploBase: string }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="bg-muted hover:bg-muted">
          <TableHead className={`${ENCABEZADO_COLUMNA} pr-[7px] pl-[18px]`}>Plan</TableHead>
          <TableHead className={`${ENCABEZADO_COLUMNA} w-[120px] px-[7px]`}>Forma de pago</TableHead>
          <TableHead className={`${ENCABEZADO_COLUMNA} w-[80px] px-[7px]`}>Cuotas</TableHead>
          <TableHead className={`${ENCABEZADO_COLUMNA} w-[100px] px-[7px] text-right`}>Recarga</TableHead>
          <TableHead className={`${ENCABEZADO_COLUMNA} w-[170px] px-[7px] text-right`}>
            {ejemploBase} se cobra
          </TableHead>
          <TableHead className={`${ENCABEZADO_COLUMNA} w-[170px] pr-[18px] pl-[7px] text-right`}>
            Acciones
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {planes.map((p) => (
          <TableRow key={p.id} className={p.desactivado ? 'text-muted-foreground' : undefined}>
            <TableCell className="py-[11px] pr-[7px] pl-[18px]">
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{p.nombre}</span>
                {p.desactivado && (
                  <span className="text-[11px] text-muted-foreground">
                    Dado de baja: no se ofrece en el mostrador
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="px-[7px] py-[11px] text-[13px]">{p.rotuloMedio}</TableCell>
            <TableCell className="px-[7px] py-[11px] text-[13px]">{p.cuotas}</TableCell>
            <TableCell className="px-[7px] py-[11px] text-right text-[13px] font-medium tabular-nums">
              {p.porcentajeMostrado}
            </TableCell>
            <TableCell className="px-[7px] py-[11px] text-right text-[13px] tabular-nums">
              {p.ejemplo}
            </TableCell>
            <TableCell className="py-[11px] pr-[18px] pl-[7px] text-right">
              <AccionesDeFila plan={p} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Qué se ve cuando el local todavía no cargó ningún plan.
 *
 * Dice lo que está pasando hoy —todo se cobra a precio de lista— y no sólo
 * "no hay nada": un local que nunca cargue un plan es un caso válido y
 * completo, no un estado a medio configurar.
 */
export function SinPlanes() {
  return (
    <div className="flex flex-col items-center gap-2 px-[18px] py-12 text-center">
      <CreditCard aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Todavía no hay planes</p>
      <p className="max-w-[420px] text-xs leading-[1.5] text-muted-foreground">
        Mientras no haya ninguno, todo se cobra al precio de lista del artículo y el mostrador
        no muestra ningún control de más.
      </p>
    </div>
  )
}

/** Las tres cosas que esta pantalla decide y que no se deducen mirando la
 *  tabla. Texto fijo, pero no inventado: las tres las sostiene el servidor. */
function CardComoFunciona({ ejemploBase }: { ejemploBase: string }) {
  return (
    <div className="flex flex-col gap-[9px] rounded-2xl border bg-card p-[18px]">
      <p className="text-[13px] font-bold text-foreground">Cómo se usa esto</p>
      {[
        `El recargo cae sólo sobre la parte que se pague con ese plan. Lo que entre en efectivo no lo paga.`,
        `Un porcentaje negativo es un descuento: sirve igual para el precio de contado.`,
        `La columna de la derecha muestra qué sale un artículo de ${ejemploBase} con cada plan. Es un ejemplo fijo, no un artículo del catálogo.`,
      ].map((texto) => (
        <div key={texto} className="flex gap-[9px]">
          <Info aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-primary" />
          <p className="text-xs leading-[1.45] text-foreground-soft">{texto}</p>
        </div>
      ))}
    </div>
  )
}

/** El cuerpo entero de /formas-de-pago. */
export function CuerpoFormasDePago({
  planes,
  ejemploBase,
}: {
  planes: FilaDePlan[]
  ejemploBase: string
}) {
  return (
    <div className="flex gap-4 p-6">
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
          <h2 className={`${estilos.tituloDeCard} text-foreground`}>Los planes del local</h2>
        </div>
        {planes.length === 0 ? (
          <SinPlanes />
        ) : (
          <TablaDePlanes planes={planes} ejemploBase={ejemploBase} />
        )}
      </div>
      <div className="flex w-[360px] flex-col gap-4">
        <CardComoFunciona ejemploBase={ejemploBase} />
      </div>
    </div>
  )
}
