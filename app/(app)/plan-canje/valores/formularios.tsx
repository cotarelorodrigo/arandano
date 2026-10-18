'use client'

import { useRef, useState, useTransition } from 'react'
import { Battery, Info, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { precioEnSuMoneda } from '@/lib/formato/mostrar'
import { rotuloDeRango, type MonedaDeCanje } from '@/lib/canje/calculo'
import type { ModeloVisible, RangoVisible } from '@/lib/canje/consultar'
import {
  altaDeRango, bajaDeModelo, bajaDeRango, cambioDeMoneda, edicionDeRango,
  guardadoDeModelo, usoDeRangosSugeridos, type EstadoCanje,
} from './acciones'
import estilos from '../tipografia.module.css'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en formas-de-pago, usuarios e inventario.
const INICIAL: EstadoCanje = { error: null, aviso: null }

/** El prefijo de los campos de valor de una fila. TIENE que coincidir con el
 *  de `acciones.ts`, que no lo puede exportar (es 'use server'); el test de
 *  esta pantalla los ata leyendo los dos archivos. */
export const PREFIJO_VALOR = 'valor:'

/** Cuánto queda armado un "Borrar" antes de desarmarse solo. Lo mismo que el
 *  doble toque de "Todos" en /bot: un segundo toque de hace un rato no tiene
 *  por qué seguir confirmando algo. */
const MS_CONFIRMACION = 3000

/**
 * Lanza el toast que corresponda, con el resultado ya en la mano. Es una
 * función normal y no un `useEffect` sobre `useActionState`, por la lección
 * que dejaron el ABM de categorías y /formas-de-pago (ver `avisar` allá): las
 * filas se desmontan con cada `revalidatePath`, y un efecto se va con ellas.
 * Los errores no se auto-descartan: dicen qué corregir.
 */
function avisar(resultado: EstadoCanje, clave: string): EstadoCanje {
  if (resultado.error) toast.error(resultado.error, { id: clave, duration: Infinity })
  else if (resultado.aviso) toast.success(resultado.aviso, { id: clave })
  return resultado
}

type Accion = (estado: EstadoCanje, datos: FormData) => Promise<EstadoCanje>

/**
 * Ejecutar una action con el "en curso" de `useTransition` y no de un
 * `useState` propio, por lo mismo que `DialogoDePlan`: las actions RECHAZAN
 * lo que no es corregible —`forbidden()` incluido, alcanzable si el dueño le
 * revoca `CANJE_VALORES` a alguien con la pantalla abierta—, y un
 * `setPendiente(false)` escrito después del `await` se saltearía y dejaría el
 * control trabado para siempre.
 */
function useEjecutar() {
  const [enCurso, empezar] = useTransition()
  const ejecutar = (accion: Accion, datos: FormData, clave: string, alSalirBien?: () => void) => {
    if (enCurso) return
    empezar(async () => {
      const r = avisar(await accion(INICIAL, datos), clave)
      if (!r.error) alSalirBien?.()
    })
  }
  return [enCurso, ejecutar] as const
}

const ENLACE =
  'text-xs font-semibold text-primary hover:underline disabled:pointer-events-none disabled:opacity-50'
const ENLACE_PELIGRO =
  'text-xs font-semibold text-destructive hover:underline disabled:pointer-events-none disabled:opacity-50'
const ROTULO = 'text-[11px] font-semibold text-foreground-soft'
const ENCABEZADO_COLUMNA =
  'h-auto py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase'

/**
 * Un "Borrar" que pide un segundo toque.
 *
 * Sin diálogo: un diálogo por fila es mucho aparato para algo que se hace de a
 * uno. Pero sin confirmación tampoco, porque borrar un modelo o un rango se
 * lleva todos sus valores y no hay papelera. El primer toque arma ("¿Borrar
 * con sus valores?"), el segundo borra; a los tres segundos se desarma solo.
 * El timer se arma en el handler y no en un efecto.
 */
function BotonDeBorrar({ alConfirmar, enCurso }: { alConfirmar: () => void; enCurso: boolean }) {
  const [armado, setArmado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <button
      type="button"
      disabled={enCurso}
      className={ENLACE_PELIGRO}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current)
        if (armado) {
          setArmado(false)
          alConfirmar()
          return
        }
        setArmado(true)
        timer.current = setTimeout(() => setArmado(false), MS_CONFIRMACION)
      }}
    >
      {enCurso ? 'Borrando…' : armado ? '¿Borrar con sus valores?' : 'Borrar'}
    </button>
  )
}

/** Los dos bordes de un rango, para el alta y la edición. `type="text"` con
 *  `inputMode="numeric"`: el servidor acepta "85 %" con el signo, y un input
 *  numérico lo rechazaría antes de llegar. */
function CamposDeRango({ rango, pendiente, sufijo }: { rango?: RangoVisible; pendiente: boolean; sufijo: string }) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-[5px]">
        <Label htmlFor={`minimo-${sufijo}`} className={ROTULO}>Desde (%)</Label>
        <Input
          id={`minimo-${sufijo}`} name="minimo" inputMode="numeric" autoComplete="off" required
          defaultValue={rango?.minimo} placeholder="85" disabled={pendiente}
          className="h-9 w-[72px] rounded-[9px] tabular-nums"
        />
      </div>
      <div className="flex flex-col gap-[5px]">
        <Label htmlFor={`maximo-${sufijo}`} className={ROTULO}>Hasta (%)</Label>
        <Input
          id={`maximo-${sufijo}`} name="maximo" inputMode="numeric" autoComplete="off" required
          defaultValue={rango?.maximo} placeholder="89" disabled={pendiente}
          className="h-9 w-[72px] rounded-[9px] tabular-nums"
        />
      </div>
    </div>
  )
}

/** Una fila de la lista de rangos: el rótulo, o los dos bordes para editar. */
function FilaDeRango({ rango }: { rango: RangoVisible }) {
  const [editando, setEditando] = useState(false)
  const [enCurso, ejecutar] = useEjecutar()
  const clave = `rango-${rango.id}`

  if (editando) {
    return (
      <form
        className="flex flex-wrap items-end gap-3 px-[18px] py-[11px]"
        onSubmit={(e) => {
          e.preventDefault()
          // El FormData se arma ACÁ: después del primer await,
          // `e.currentTarget` ya es null.
          const datos = new FormData(e.currentTarget)
          ejecutar(edicionDeRango, datos, `${clave}-edicion`, () => setEditando(false))
        }}
      >
        <input type="hidden" name="id" value={rango.id} />
        <CamposDeRango rango={rango} pendiente={enCurso} sufijo={rango.id} />
        <div className="flex items-center gap-3 pb-2">
          <Button type="submit" size="sm" disabled={enCurso}>{enCurso ? 'Guardando…' : 'Guardar'}</Button>
          <button type="button" className={ENLACE} onClick={() => setEditando(false)} disabled={enCurso}>
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 px-[18px] py-[11px]">
      <span className="text-sm font-medium text-foreground tabular-nums">{rotuloDeRango(rango)}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={ENLACE} onClick={() => setEditando(true)} disabled={enCurso}>
          Editar
        </button>
        <span aria-hidden="true" className="text-xs text-muted-foreground">·</span>
        <BotonDeBorrar
          enCurso={enCurso}
          alConfirmar={() => {
            const datos = new FormData()
            datos.set('id', rango.id)
            ejecutar(bajaDeRango, datos, `${clave}-baja`)
          }}
        />
      </div>
    </div>
  )
}

function AltaDeRango() {
  const [enCurso, ejecutar] = useEjecutar()
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t px-[18px] py-[13px]"
      onSubmit={(e) => {
        e.preventDefault()
        const formulario = e.currentTarget
        ejecutar(altaDeRango, new FormData(formulario), 'rango-alta', () => formulario.reset())
      }}
    >
      <CamposDeRango pendiente={enCurso} sufijo="alta" />
      <div className="pb-0.5">
        <Button type="submit" size="sm" variant="outline" disabled={enCurso}>
          <Plus aria-hidden="true" className="size-[14px]" />
          {enCurso ? 'Agregando…' : 'Agregar rango'}
        </Button>
      </div>
    </form>
  )
}

/**
 * Qué se ve sin ningún rango: la oferta de los sugeridos.
 *
 * Con un botón y no cargados solos al abrir la pantalla: un GET que escribe es
 * una sorpresa, y el local que no hace canje no los necesita (spec, decisión 3).
 */
export function SinRangos() {
  const [enCurso, ejecutar] = useEjecutar()
  return (
    <div className="flex flex-col items-start gap-3 px-[18px] py-[18px]">
      <p className="text-xs leading-[1.5] text-foreground-soft">
        Todavía no hay rangos. Los sugeridos son 100 %, 90–99 %, 85–89 %, 80–84 % y menos de 80 %;
        después se pueden cambiar, borrar o agregar otros.
      </p>
      <Button
        type="button"
        size="sm"
        disabled={enCurso}
        onClick={() => ejecutar(usoDeRangosSugeridos, new FormData(), 'rangos-sugeridos')}
      >
        {enCurso ? 'Cargando…' : 'Usar los rangos sugeridos'}
      </Button>
    </div>
  )
}

/** La card de los rangos: las columnas de la tabla, administradas aparte. */
export function CardDeRangos({ rangos }: { rangos: RangoVisible[] }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Rangos de batería</h2>
      </div>
      {rangos.length === 0 ? (
        <SinRangos />
      ) : (
        <div className="flex flex-col divide-y">
          {rangos.map((r) => (
            <FilaDeRango key={r.id} rango={r} />
          ))}
        </div>
      )}
      <AltaDeRango />
    </div>
  )
}

const NOMBRE_MONEDA: Record<MonedaDeCanje, string> = { USD: 'dólares', ARS: 'pesos' }

/**
 * La moneda de toda la tabla, con el aviso ANTES de confirmar: cambiarla no
 * convierte los valores —la tabla es lo que el dueño escribió, y la cotización
 * del local es la de hoy (ver `ConfiguracionDeCanje` en el schema)—, así que
 * un 400 en dólares pasa a ser $ 400. Un diálogo y no el doble toque de
 * "Borrar": acá hay algo que explicar antes, no sólo algo que confirmar.
 */
export function CardDeMoneda({ moneda }: { moneda: MonedaDeCanje }) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, ejecutar] = useEjecutar()
  const otra: MonedaDeCanje = moneda === 'USD' ? 'ARS' : 'USD'
  const ejemplo = `${precioEnSuMoneda('400', moneda)} pasa a ser ${precioEnSuMoneda('400', otra)}`

  return (
    <div className="flex flex-col gap-[9px] rounded-2xl border bg-card p-[18px]">
      <h2 className={`${estilos.tituloDeCard} text-foreground`}>Moneda de la tabla</h2>
      <p className="text-xs leading-[1.45] text-foreground-soft">
        Todos los valores están en <strong>{NOMBRE_MONEDA[moneda]}</strong>. Si el equipo que se vende
        está en la otra moneda, la calculadora pide la cotización del dólar.
      </p>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogTrigger asChild>
          <button type="button" className={`${ENLACE} self-start`}>
            Pasar la tabla a {NOMBRE_MONEDA[otra]}
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Pasar la tabla a {NOMBRE_MONEDA[otra]}?</DialogTitle>
            <DialogDescription>
              Los números no se convierten: {ejemplo}. Si los valores cambian, hay que cargarlos de nuevo
              fila por fila.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              disabled={enCurso}
              onClick={() => {
                const datos = new FormData()
                datos.set('moneda', otra)
                ejecutar(cambioDeMoneda, datos, 'canje-moneda', () => setAbierto(false))
              }}
            >
              {enCurso ? 'Cambiando…' : `Sí, pasar a ${NOMBRE_MONEDA[otra]}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Una fila de la tabla en modo edición: el nombre y una celda por rango,
 * todas en el MISMO formulario aunque vivan en celdas distintas.
 *
 * El `<form>` vive en la última celda y los inputs de las demás se le asocian
 * con el atributo `form` — un `<form>` no puede envolver un `<tr>`, y partir
 * la fila en varios formularios rompería lo que esta pantalla promete: la fila
 * se guarda ENTERA, en una transacción (`guardarModelo`). `new FormData(form)`
 * incluye los elementos asociados por `form=`, no sólo los descendientes.
 *
 * `modelo` ausente = la fila de alta, al pie de la tabla.
 */
export function FilaEditable({
  modelo,
  rangos,
  alTerminar,
}: {
  modelo?: ModeloVisible
  rangos: RangoVisible[]
  alTerminar: () => void
}) {
  const [enCurso, ejecutar] = useEjecutar()
  const idForm = `fila-${modelo?.id ?? 'nueva'}`

  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell className="py-[9px] pr-[7px] pl-[18px]">
        <Input
          form={idForm} name="nombre" required autoComplete="off" aria-label="Modelo"
          defaultValue={modelo?.nombre} placeholder="iPhone 14" disabled={enCurso}
          className="h-9 w-[160px] rounded-[9px]"
        />
      </TableCell>
      {rangos.map((r) => (
        <TableCell key={r.id} className="px-[7px] py-[9px] text-right">
          {/* type="text" y no "number": acepta coma decimal y punto de miles
              (1.250,50), que un input numérico rechaza según el locale del
              navegador. La gramática vive en el servidor. Vacía = "no se
              toma ese equipo en ese rango". */}
          <Input
            form={idForm} name={`${PREFIJO_VALOR}${r.id}`} inputMode="decimal" autoComplete="off"
            aria-label={`Valor con ${rotuloDeRango(r)} de batería`}
            defaultValue={modelo?.valores[r.id] ?? ''} disabled={enCurso}
            className="ml-auto h-9 w-[96px] rounded-[9px] text-right tabular-nums"
          />
        </TableCell>
      ))}
      <TableCell className="py-[9px] pr-[18px] pl-[7px] text-right">
        <form
          id={idForm}
          className="flex items-center justify-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const datos = new FormData(e.currentTarget)
            ejecutar(guardadoDeModelo, datos, `${idForm}-guardado`, alTerminar)
          }}
        >
          <input type="hidden" name="id" value={modelo?.id ?? ''} />
          <Button type="submit" size="sm" disabled={enCurso}>
            {enCurso ? 'Guardando…' : 'Guardar'}
          </Button>
          <button type="button" className={ENLACE} onClick={alTerminar} disabled={enCurso}>
            Cancelar
          </button>
        </form>
      </TableCell>
    </TableRow>
  )
}

function FilaDeModelo({
  modelo,
  rangos,
  moneda,
  alEditar,
}: {
  modelo: ModeloVisible
  rangos: RangoVisible[]
  moneda: MonedaDeCanje
  alEditar: () => void
}) {
  const [enCurso, ejecutar] = useEjecutar()
  return (
    <TableRow>
      <TableCell className="py-[11px] pr-[7px] pl-[18px]">
        <span className="text-sm font-medium text-foreground">{modelo.nombre}</span>
      </TableCell>
      {rangos.map((r) => {
        const valor = modelo.valores[r.id]
        return (
          <TableCell key={r.id} className="px-[7px] py-[11px] text-right text-[13px] tabular-nums">
            {/* Vacía se dice, no se deja en blanco: "—" es "no se toma", y un
                blanco se lee como "falta cargar". */}
            {valor === undefined ? (
              <span className="text-muted-foreground" title="No se toma ese equipo en ese rango">—</span>
            ) : (
              precioEnSuMoneda(valor, moneda)
            )}
          </TableCell>
        )
      })}
      <TableCell className="py-[11px] pr-[18px] pl-[7px] text-right">
        <div className="flex items-center justify-end gap-2">
          <button type="button" className={ENLACE} onClick={alEditar} disabled={enCurso}>
            Editar
          </button>
          <span aria-hidden="true" className="text-xs text-muted-foreground">·</span>
          <BotonDeBorrar
            enCurso={enCurso}
            alConfirmar={() => {
              const datos = new FormData()
              datos.set('id', modelo.id)
              ejecutar(bajaDeModelo, datos, `modelo-${modelo.id}-baja`)
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * La tabla como el dueño ya la piensa: **modelos en filas, rangos en
 * columnas, el valor en cada celda**. Es la forma que permite actualizar todos
 * los valores de un modelo en un solo gesto cuando cambia el precio.
 *
 * Una sola fila en edición por vez (`editando`): dos filas abiertas con
 * "Guardar" cada una se prestan a guardar una y creer que se guardaron las
 * dos. La de alta es una fila más, al pie, con el mismo formulario.
 */
export function TablaDeValores({
  moneda,
  rangos,
  modelos,
}: {
  moneda: MonedaDeCanje
  rangos: RangoVisible[]
  modelos: ModeloVisible[]
}) {
  // `null` = ninguna; 'nueva' = la fila de alta; si no, el id del modelo.
  const [editando, setEditando] = useState<string | null>(null)
  const terminar = () => setEditando(null)

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className={`${ENCABEZADO_COLUMNA} pr-[7px] pl-[18px]`}>Modelo</TableHead>
            {rangos.map((r) => (
              <TableHead key={r.id} className={`${ENCABEZADO_COLUMNA} px-[7px] text-right`}>
                {rotuloDeRango(r)}
              </TableHead>
            ))}
            <TableHead className={`${ENCABEZADO_COLUMNA} pr-[18px] pl-[7px] text-right`}>Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {modelos.map((m) =>
            editando === m.id ? (
              <FilaEditable key={m.id} modelo={m} rangos={rangos} alTerminar={terminar} />
            ) : (
              <FilaDeModelo key={m.id} modelo={m} rangos={rangos} moneda={moneda} alEditar={() => setEditando(m.id)} />
            ),
          )}
          {editando === 'nueva' && <FilaEditable rangos={rangos} alTerminar={terminar} />}
        </TableBody>
      </Table>
      {modelos.length === 0 && editando !== 'nueva' && (
        <p className="px-[18px] pt-4 text-xs text-muted-foreground">
          Todavía no hay modelos. Cada uno es una fila: su nombre y lo que se paga en cada rango.
        </p>
      )}
      {editando !== 'nueva' && (
        <div className="px-[18px] py-[13px]">
          <Button type="button" size="sm" variant="outline" onClick={() => setEditando('nueva')}>
            <Plus aria-hidden="true" className="size-[14px]" />
            Agregar modelo
          </Button>
        </div>
      )}
    </>
  )
}

/** Sin rangos no hay columnas, y una tabla de modelos sin columnas no dice
 *  nada: se dice qué hacer primero. */
function SinColumnas() {
  return (
    <div className="flex flex-col items-center gap-2 px-[18px] py-12 text-center">
      <Battery aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Primero, los rangos de batería</p>
      <p className="max-w-[420px] text-xs leading-[1.5] text-muted-foreground">
        Cada rango es una columna de la tabla. Cargá los sugeridos o los tuyos y después agregá los
        modelos que toma el local.
      </p>
    </div>
  )
}

/** Lo que esta pantalla decide y no se deduce mirando la tabla. */
function CardComoFunciona() {
  return (
    <div className="flex flex-col gap-[9px] rounded-2xl border bg-card p-[18px]">
      <p className="text-[13px] font-bold text-foreground">Cómo se usa esto</p>
      {[
        'Una celda vacía quiere decir que el local no toma ese equipo con esa batería: la calculadora dice "sin cotización". Un cero sí es un valor.',
        'Los rangos no se pueden pisar entre sí, pero puede haber huecos: un porcentaje que no cae en ningún rango tampoco se cotiza.',
        'Los vendedores ven esta tabla a través de la calculadora, sin poder cambiarla.',
      ].map((texto) => (
        <div key={texto} className="flex gap-[9px]">
          <Info aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-primary" />
          <p className="text-xs leading-[1.45] text-foreground-soft">{texto}</p>
        </div>
      ))}
    </div>
  )
}

/** El cuerpo entero de /plan-canje/valores. */
export function CuerpoValores({
  moneda,
  rangos,
  modelos,
}: {
  moneda: MonedaDeCanje
  rangos: RangoVisible[]
  modelos: ModeloVisible[]
}) {
  return (
    // Se apila en el teléfono con `flex-col` y recién en `lg:` va en fila, por
    // el colapso que ya documenta /formas-de-pago: con `flex` sin prefijo, la
    // card de la derecha de ancho fijo se come todo el encogimiento y la
    // tabla queda en cero de ancho a 390 px. La tabla scrollea adentro de su
    // card (el `overflow-x-auto` que shadcn le pone a `<Table>`).
    <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-[18px] py-[13px]">
          <h2 className={`${estilos.tituloDeCard} text-foreground`}>Lo que se paga por cada usado</h2>
        </div>
        {rangos.length === 0 ? (
          <SinColumnas />
        ) : (
          <TablaDeValores moneda={moneda} rangos={rangos} modelos={modelos} />
        )}
      </div>
      <div className="flex flex-col gap-3 lg:w-[340px] lg:gap-4">
        <CardDeRangos rangos={rangos} />
        <CardDeMoneda moneda={moneda} />
        <CardComoFunciona />
      </div>
    </div>
  )
}
