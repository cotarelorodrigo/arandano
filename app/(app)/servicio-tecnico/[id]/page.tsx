import { notFound } from 'next/navigation'
import { User, Smartphone, Phone } from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { cn } from '@/lib/utils'
import { formatearFecha, formatearPrecio, montoSinSigno } from '@/lib/formato/mostrar'
import {
  TRANSICIONES,
  NOMBRE_ESTADO,
  ESTADO_VISUAL,
} from '@/lib/ordenes-de-trabajo/estados'
import { fechaCorta, diasEnElLocal } from '@/lib/ordenes-de-trabajo/antiguedad'
import { esUuid } from '@/lib/uuid'
import { moverEstado, diagnosticar, anular } from '../acciones'
import { FichaDeOrden, PanelEstado, FormularioDiagnostico } from '../formularios'
import type { EstadoOrden } from '@/generated/prisma/client'
import estilos from '../tipografia.module.css'

export const dynamic = 'force-dynamic'

/**
 * Los botones de "MOVER A" del paño de estado: las transiciones legales desde
 * el estado actual, NINGUNA si la orden está anulada. `TRANSICIONES` (lib/
 * ordenes-de-trabajo/estados.ts) ya sabe cuáles son legales por estado; acá se
 * le suma la otra razón por la que hoy no se puede mover una orden, que el
 * grafo no puede expresar porque anular es una COLUMNA aparte
 * (`OrdenDeTrabajo.anuladaEn`), no un estado — ver el comentario de
 * `anularOrden` en lib/ordenes-de-trabajo/operaciones.ts. Sin este guard, una
 * orden anulada en `EN_REPARACION` seguiría ofreciendo "Listo"/"Presupuestado"
 * aunque `anularOrden` los rechace igual (`ORDEN_ANULADA`): esconder el botón
 * acá no reemplaza esa revalidación del servidor, sólo evita ofrecer algo que
 * ya se sabe que va a fallar.
 */
export function transicionesDisponibles(
  estado: EstadoOrden,
  anulada: boolean,
): readonly EstadoOrden[] {
  return anulada ? [] : TRANSICIONES[estado]
}

// 'en-CA' y formatToParts, no 'es-AR' con `.format()` directo: con sólo
// día+mes (sin año) el locale es-AR no siempre respeta month:'2-digit' y da
// "15/8" en vez de "15/08" (mismo hallazgo que ya dejó anotado
// formatearFechaMovimiento en app/(app)/inventario/historial.tsx).
const FECHA_EVENTO = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

const HORA_EVENTO = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'America/Argentina/Buenos_Aires',
})

/**
 * "15/08 · 09:12" (design/arandano.pen, nodo `ryTHh`, meta de un evento de la
 * bitácora): día y mes con cero a la izquierda, sin año, unidos a la hora con
 * " · ". Copiada y no importada de `formatearFechaMovimiento`
 * (app/(app)/inventario/historial.tsx), que arma exactamente lo mismo: son
 * dos pantallas de dos módulos que no tienen por qué conocerse, mismo
 * criterio que ya dejó anotado `ventanaDePaginas`.
 */
export function fechaYHoraDelEvento(v: Date): string {
  const partes = FECHA_EVENTO.formatToParts(v)
  const dia = partes.find((p) => p.type === 'day')?.value ?? ''
  const mes = partes.find((p) => p.type === 'month')?.value ?? ''
  return `${dia}/${mes} · ${HORA_EVENTO.format(v)}`
}

/**
 * "Pasó a En reparación" / "Equipo recibido" (design/arandano.pen, títulos de
 * evento de la bitácora, p. ej. nodo `EPH3Q` / `GWLWL`): el evento de
 * apertura (`desde === null`) no dice "Pasó a Recibido" — mismo criterio que
 * ya resolvía el código antes de este ciclo (`[id]/page.tsx`, `e.desde ===
 * null ? 'Recibido' : ...`), sólo que ahora "Equipo recibido" es el título
 * completo y no una palabra suelta.
 */
export function tituloDeEvento(e: { desde: EstadoOrden | null; hasta: EstadoOrden }): string {
  return e.desde === null ? 'Equipo recibido' : `Pasó a ${NOMBRE_ESTADO[e.hasta]}`
}

function FilaClaveValor({ clave, valor }: { clave: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-[18px] py-[10px] last:border-b-0">
      <span className="text-xs text-muted-foreground">{clave}</span>
      <span className="text-sm font-medium text-foreground">{valor}</span>
    </div>
  )
}

/**
 * Card "Cliente" (design/arandano.pen, nodo `SKFYF`): nombre, teléfono y
 * "Órdenes previas" —acá el VALOR es el número pelado (nodo `ARZ1K`: "3"), no
 * la frase pluralizada del buscador de "Recibir equipo" (`rotuloOrdenesPrevias`,
 * lib/clientes/administrar.ts) — mismo dato, dos redacciones distintas según
 * dónde vive.
 *
 * `cliente._count.ordenes - 1` y no el `_count` pelado (hallazgo I3 de la
 * review final): `Cliente.ordenes` cuenta TODAS las órdenes, la que se está
 * mirando incluida. En el buscador de la recepción eso es exacto —esta orden
 * todavía no existe—, pero acá "Órdenes previas: 1" para un cliente que viene
 * por primera vez era la propia orden contándose a sí misma, y el mostrador
 * veía "3 órdenes previas" en el buscador y "4" un click después para la
 * misma persona. Exportada para poder renderizarla directo con un `_count` de
 * prueba: no había ningún test que la montara, sólo un regex sobre el
 * `select` de la consulta.
 */
export function CardCliente({
  cliente,
}: {
  cliente: { nombre: string; telefono: string | null; _count: { ordenes: number } }
}) {
  const ordenesPrevias = cliente._count.ordenes - 1
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-[18px] py-[13px]">
        <User aria-hidden="true" className="size-4 text-primary" />
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Cliente</h2>
      </div>
      <div className="flex flex-col">
        <FilaClaveValor clave="Nombre" valor={cliente.nombre} />
        <FilaClaveValor clave="Teléfono" valor={cliente.telefono ?? '—'} />
        <FilaClaveValor clave="Órdenes previas" valor={ordenesPrevias} />
      </div>
      {/* Sin teléfono no hay a dónde llamar: el botón entero desaparece, no
          queda deshabilitado sin explicación. */}
      {cliente.telefono ? (
        <div className="p-[14px]">
          <Button asChild variant="outline" className="w-full">
            {/* tel: y no texto suelto: es el gesto que se hace cuando el
                equipo queda listo, y desde el teléfono llama con un toque. */}
            <a href={`tel:${cliente.telefono}`}>
              <Phone aria-hidden="true" className="size-[15px]" />
              Llamar al cliente
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Card "Equipo" (design/arandano.pen, nodo `vZVtJ`): cuatro filas, SIN
 * "Daños visibles" — el campo sigue en el schema y en el ticket, pero esta
 * card de la maqueta enumera cuatro filas exactas y no cinco. No es el
 * silencio de una interacción que un frame estático no puede dibujar (la
 * pregunta "qué pierde el producto si se saca"): acá el `.pen` sí dibuja el
 * card entero, completo, con cuatro filas — omitirlo es la decisión, no un
 * hueco del relevamiento.
 */
function CardEquipo({
  orden,
}: {
  orden: {
    equipoMarca: string
    equipoModelo: string
    equipoSerie: string | null
    claveDesbloqueo: string | null
    accesorios: string | null
  }
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center gap-2 border-b px-[18px] py-[13px]">
        <Smartphone aria-hidden="true" className="size-4 text-primary" />
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Equipo</h2>
      </div>
      <div className="flex flex-col">
        <FilaClaveValor clave="Marca y modelo" valor={`${orden.equipoMarca} ${orden.equipoModelo}`} />
        <FilaClaveValor clave="IMEI" valor={orden.equipoSerie ?? '—'} />
        <FilaClaveValor clave="Clave" valor={orden.claveDesbloqueo ?? '—'} />
        <FilaClaveValor clave="Accesorios" valor={orden.accesorios ?? '—'} />
      </div>
    </div>
  )
}

/**
 * Card "Falla declarada y diagnóstico" (design/arandano.pen, nodo `jZGjj`):
 * fusiona lo que antes de este ciclo eran dos `<section>` separadas. La cita
 * (lo que dijo el cliente) es de sólo lectura y se muestra siempre; el
 * formulario de diagnóstico —editable— se apaga con la orden anulada, mismo
 * criterio que ya regía antes de este ciclo (la sección entera desaparecía).
 *
 * Exportada (hallazgo I2 de la review final): así se puede renderizar directo
 * con un `Prisma.Decimal` real y comprobar el FORMATO del presupuesto, en vez
 * de sólo `grep`ear el fuente.
 */
export function CardFallaYDiagnostico({
  orden,
  anulada,
}: {
  orden: {
    id: string
    fallaDeclarada: string
    diagnostico: string | null
    montoEstimado: Prisma.Decimal | null
  }
  anulada: boolean
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-[18px] py-[13px]">
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Falla declarada y diagnóstico</h2>
      </div>
      <div className="flex flex-col gap-[14px] p-[18px]">
        <div className="flex flex-col gap-[6px] border-l-[3px] border-input py-0.5 pl-[14px]">
          <span className="text-[10px] font-bold tracking-[1px] text-muted-foreground">
            LO QUE DIJO EL CLIENTE
          </span>
          <p className="text-[13px] leading-[1.5] whitespace-pre-wrap text-foreground">
            {orden.fallaDeclarada}
          </p>
        </div>

        {!anulada ? (
          <FormularioDiagnostico
            accion={diagnosticar}
            ordenId={orden.id}
            diagnostico={orden.diagnostico ?? ''}
            // Formateado a la argentina ("145.000,00", el texto exacto del
            // nodo `XuSfC` del .pen) y no el `String(Decimal)` crudo que daba
            // "145000" — hallazgo I2 de la review final: decimal.js poda los
            // ceros de cola, así que el presupuesto se veía como un número
            // pelado. `montoSinSigno(formatearPrecio(...))` reusa el mismo
            // formateador que ya usa el resto del producto para pesos, sin el
            // "$" adelante: el campo ya dice "Presupuesto" por su rótulo, y
            // `aDecimalOpcional` acepta el formato argentino completo de
            // vuelta (MILES_Y_DECIMALES en lib/formato/gramatica.ts), así que
            // el round-trip no se rompe.
            montoEstimado={
              orden.montoEstimado ? montoSinSigno(formatearPrecio(orden.montoEstimado.toString())) : ''
            }
          />
        ) : null}
      </div>
    </div>
  )
}

export type EventoDeBitacora = {
  id: string
  desde: EstadoOrden | null
  hasta: EstadoOrden
  nota: string | null
  creadoEn: Date
  usuario: { nombre: string }
}

/**
 * "Qué pasó" (design/arandano.pen, nodo `h78lmp`): timeline vertical, MÁS
 * NUEVA PRIMERO —al revés que el `orderBy: 'asc'` de antes de este ciclo—,
 * con ícono y color por tipo de evento salidos de `ESTADO_VISUAL` (lib/
 * ordenes-de-trabajo/estados.ts), el mismo mapeo que ya usan el chip del
 * tablero y el de la fila. El evento de apertura de la maqueta ("Equipo
 * recibido", nodo `zYVdY`) lo pinta verde (ok-soft/ok) en vez del muted que
 * `ESTADO_VISUAL.RECIBIDO` usa en todos los demás lugares — la propia
 * maqueta no es consistente consigo misma ahí (relevamiento, §9.2), y este
 * componente usa el mapeo real y no la excepción de ese único nodo: el
 * brief de esta task pide explícitamente reusar `ESTADO_VISUAL` entero, no
 * bifurcarlo para un solo evento.
 */
export function Bitacora({ eventos }: { eventos: EventoDeBitacora[] }) {
  return (
    // Fluida en el teléfono (Task 9 del ciclo móvil, frame `B3noN`): sin
    // altura ni scroll propios, se estira con el resto del cuerpo. `lg:h-full`
    // y `lg:overflow-y-auto` la vuelven a lo de hoy en escritorio, donde se
    // empareja con la columna vecina.
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card lg:h-full">
      <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Qué pasó</h2>
        <span className="text-xs font-semibold text-primary">Append-only</span>
      </div>
      <div className="flex flex-col px-[18px] pt-4 lg:flex-1 lg:overflow-y-auto">
        {eventos.map((e, i) => {
          const esUltimo = i === eventos.length - 1
          const { Icono, clase } = ESTADO_VISUAL[e.hasta]
          return (
            <div key={e.id} className="flex gap-3">
              <div className="flex w-[26px] shrink-0 flex-col items-center">
                <span
                  className={cn(
                    'flex size-[26px] shrink-0 items-center justify-center rounded-full',
                    clase,
                  )}
                >
                  <Icono aria-hidden="true" className="size-[13px]" />
                </span>
                {!esUltimo ? <span className="w-[2px] flex-1 bg-border" /> : null}
              </div>
              <div className="flex flex-1 flex-col gap-[3px] pb-5">
                <span className="text-[13px] font-semibold text-foreground">{tituloDeEvento(e)}</span>
                {e.nota ? (
                  <span className="text-xs leading-[1.45] text-foreground-soft">{e.nota}</span>
                ) : null}
                <span className="text-[11px] text-muted-foreground">
                  {fechaYHoraDelEvento(e.creadoEn)} · {e.usuario.nombre}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default async function DetalleDeOrden({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // El mismo guard que /ventas/[id] y /inventario/[id]: Prisma tipa el
  // parámetro por columna, así que un id sin forma de uuid lo rechaza antes de
  // consultar —con findFirst igual que con findUnique— y eso, en un server
  // component, es un 500 desde la barra de direcciones.
  if (!esUuid(id)) notFound()

  const prisma = prismaParaTenant(sesion.tenant.id)
  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      id: true, numero: true, estado: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true,
      // NO se pide danosVisibles: la card "Equipo" de este rediseño enumera
      // cuatro filas exactas —sin una quinta para daños visibles, ver el
      // comentario de CardEquipo— y ningún otro lugar del cuerpo lo muestra.
      // El campo sigue vivo en el schema y en el ticket (que hace su propia
      // consulta, en ticket/page.tsx); acá dejaría de usarse.
      diagnostico: true, montoEstimado: true,
      anuladaEn: true, creadoEn: true,
      // Órdenes previas (Task 3 del ciclo): mismo dato que
      // buscarClientes, pedido acá con su propio `_count` porque esta
      // consulta viene de ordenDeTrabajo.findFirst y no de cliente.findMany.
      cliente: { select: { nombre: true, telefono: true, _count: { select: { ordenes: true } } } },
      // NO se pide recibidaPor: es siempre el mismo usuario que firma el
      // evento de apertura de la bitácora (crearOrden asigna el mismo
      // usuarioId a los dos), así que "quién recibió" ya sale de ahí
      // (Bitacora, el evento más viejo) sin repetir la consulta.
      anuladaPor: { select: { nombre: true } },
      eventos: {
        // MÁS NUEVO PRIMERO (design/arandano.pen, §9.3) — al revés que antes
        // de este ciclo. `id` desempata: `creado_en` es la hora de INICIO de
        // transacción, así que dos eventos escritos en la misma transacción
        // (el de apertura, junto con la orden) podrían compartir timestamp;
        // `id` es uuid(7), ordenable por tiempo. Mismo cuidado que ya toma
        // `/inventario/[id]` con MovimientoStock.
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        select: {
          id: true, desde: true, hasta: true, nota: true, creadoEn: true,
          usuario: { select: { nombre: true } },
        },
      },
    },
  })
  if (!orden) notFound()

  const anulada = orden.anuladaEn !== null
  const dias = diasEnElLocal(orden.creadoEn)
  // El evento más reciente es, por invariante, el que trajo la orden a su
  // estado ACTUAL (cambiarEstado escribe el evento y el nuevo estado en la
  // misma transacción — lib/ordenes-de-trabajo/operaciones.ts), así que
  // "hace cuánto está en este estado" es "hace cuánto pasó ese evento", no
  // "hace cuánto se recibió el equipo" (que es lo que ya dice el subtítulo
  // del Topbar). `eventos[0]` porque ahora vienen ordenados MÁS NUEVO
  // PRIMERO; el `?? orden.creadoEn` es sólo un piso defensivo — crearOrden
  // siempre deja un evento de apertura, así que `eventos` nunca debería venir
  // vacío.
  const diasEnEstado = diasEnElLocal(orden.eventos[0]?.creadoEn ?? orden.creadoEn)
  const siguientes = transicionesDisponibles(orden.estado, anulada)
  const esDuenio = sesion.usuario.rol === 'DUENO'

  return (
    <FichaDeOrden
      titulo={`Orden #${orden.numero} · ${orden.equipoMarca} ${orden.equipoModelo}`}
      subtitulo={
        <>
          Ingresó el {fechaCorta(orden.creadoEn)}
          {' · '}
          {dias === 0 ? 'hoy' : dias === 1 ? 'hace 1 día en el local' : `hace ${dias} días en el local`}
        </>
      }
      ordenId={orden.id}
      anulada={anulada}
      esDuenio={esDuenio}
      accionAnular={anular}
      columnaIzquierda={
        <>
          {/* Hallazgo M6 de la review final: un `<p>` en `--muted-foreground`
              —el color más apagado de la paleta— era lo menos visible del
              cuerpo para el estado "esta orden ya no está viva", que es
              justamente lo primero que hay que ver. `/ventas/[id]` ya
              resuelve el mismo caso (venta anulada) con este mismo par
              `Alert`/`bg-destructive-soft` (`notaDeAnulacion`,
              `app/(app)/ventas/[id]/page.tsx`); acá se reusa el patrón en vez
              de inventar uno nuevo para el mismo estado del mismo producto.
              El `.pen` no modela una orden anulada (el relevamiento lo dice),
              así que no hay nada que este cambio contradiga. */}
          {anulada ? (
            <Alert className="rounded-2xl bg-destructive-soft px-4 py-4">
              <AlertDescription className="text-[11px] leading-[1.45] text-destructive opacity-85">
                Anulada por {orden.anuladaPor?.nombre ?? 'alguien'} el {formatearFecha(orden.anuladaEn!)}.
              </AlertDescription>
            </Alert>
          ) : null}

          <PanelEstado
            accion={moverEstado}
            ordenId={orden.id}
            estado={orden.estado}
            siguientes={siguientes}
            nombres={NOMBRE_ESTADO}
            diasEnEstado={diasEnEstado}
          />

          <div className="flex gap-4">
            <CardCliente cliente={orden.cliente} />
            <CardEquipo orden={orden} />
          </div>

          <CardFallaYDiagnostico orden={orden} anulada={anulada} />
        </>
      }
      columnaDerecha={<Bitacora eventos={orden.eventos} />}
    />
  )
}
