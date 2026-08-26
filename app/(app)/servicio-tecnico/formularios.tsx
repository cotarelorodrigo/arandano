'use client'

import type { ReactNode } from 'react'
import { useActionState, useId, useState } from 'react'
import Link from 'next/link'
import { Search, Check, Printer, EyeOff, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Encabezado } from '@/components/shell/encabezado'
import { cn } from '@/lib/utils'
// Dos módulos y no uno: `ClienteEncontrado` es un import de TIPO desde
// administrar.ts (no arrastra nada), pero `rotuloOrdenesPrevias` tiene que
// venir de rotulos.ts — ese archivo explica largo por qué, con el bug real
// que costó importar la función desde administrar.ts en un Client Component.
import type { ClienteEncontrado } from '@/lib/clientes/administrar'
import { rotuloOrdenesPrevias } from '@/lib/clientes/rotulos'
import { ESTADO_VISUAL } from '@/lib/ordenes-de-trabajo/estados'
import type { EstadoServicio } from './acciones'
// El tipo del enum, no `string`: así el compilador atrapa que la pantalla le
// pase un estado que no existe, en vez de que lo descubra el server action en
// runtime. Es un import de tipo, así que no arrastra nada al bundle del cliente.
import type { EstadoOrden } from '@/generated/prisma/client'
import estilos from './tipografia.module.css'

/**
 * El VALOR del bloque "HACE" del paño de estado (design/arandano.pen, nodo
 * `zxEY5`): "hoy" / "1 día" / "N días", SIN el prefijo "hace" — el rótulo de
 * arriba ("HACE", nodo `r5gSLT`) ya lo dice en su propia línea; repetirlo acá
 * daría "HACE / hace 6 días". Vive acá y no en `[id]/page.tsx` porque
 * `PanelEstado`, su único consumidor, es quien lo necesita — page.tsx sólo
 * calcula el NÚMERO de días (`diasEnElLocal`) y se lo pasa.
 */
export function textoDeAntiguedad(dias: number): string {
  if (dias === 0) return 'hoy'
  return dias === 1 ? '1 día' : `${dias} días`
}

// Vive acá y no en acciones.ts: ese archivo es 'use server' y no puede exportar
// constantes. Ver el comentario allá y test/use-server.test.ts.
export const INICIAL: EstadoServicio = { error: null, aviso: null }

export function Aviso({ estado }: { estado: EstadoServicio }) {
  if (!estado.error && !estado.aviso) return null
  return (
    <Alert variant={estado.error ? 'destructive' : 'default'} className="mt-4">
      <AlertDescription>{estado.error ?? estado.aviso}</AlertDescription>
    </Alert>
  )
}

/**
 * Una card con encabezado en Archivo + contenido (design/arandano.pen, frame
 * `lIt3K`: nodos `fosaH`/`nfs4t`/`u1pjn`/`H6LDCm`, cada uno con el mismo par
 * Encabezado/Contenido). Copiada y no importada desde
 * `app/(app)/inventario/formularios.tsx` (que tiene la misma
 * `CardDelFormulario`): cada pantalla arma la suya, mismo criterio que
 * `ventanaDePaginas` en `page.tsx` de este mismo módulo.
 */
function CardConEncabezado({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-[18px] py-[13px]">
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>{titulo}</h2>
      </div>
      <div className="flex flex-col gap-3 p-[18px]">{children}</div>
    </div>
  )
}

// El <form> real de la recepción es invisible y sólo carga la clave de
// idempotencia (mismo mecanismo que FORM_BAJA_ARTICULO en
// app/(app)/inventario/formularios.tsx). Hace falta: el buscador de cliente
// (design/arandano.pen, nodo `o7KdEy`) necesita SU PROPIO <form> de método
// GET, y un <form> no puede anidar otro — así que ningún campo real de esta
// pantalla puede vivir DENTRO del <form> que dispara `recibirEquipo`. Cada
// input de las cards de más abajo apunta acá con el atributo HTML
// `form={FORM_RECEPCION}`, sin importar dónde queden en el DOM.
const FORM_RECEPCION = 'form-recepcion'

/**
 * Un resultado del buscador de cliente (design/arandano.pen, nodos `w8JWU`
 * SELECCIONADO / `i8yfrS` no seleccionado, dentro de `x0iSE3` "Resultados"):
 * card clickeable con nombre, teléfono y "N órdenes previas" — no un
 * `<select>`. La selección es estado de React (`clienteId` en
 * `FormularioRecepcion`) y no un radio nativo: este componente YA es
 * 'use client' por `useActionState`, así que no hay pureza que preservar, y
 * el estado también es lo que permite deseleccionar al tipear en "Cliente
 * nuevo" (ver `onFocus` más abajo) — algo que un grupo de radios nativo no
 * ofrece sin JavaScript propio de todos modos.
 */
function ResultadoDeCliente({
  cliente,
  seleccionado,
  onSeleccionar,
}: {
  cliente: ClienteEncontrado
  seleccionado: boolean
  onSeleccionar: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSeleccionar}
      aria-pressed={seleccionado}
      className={cn(
        'flex w-full items-center justify-between gap-3 border-b px-[14px] py-[11px] text-left last:border-b-0',
        seleccionado ? 'bg-accent' : 'bg-card hover:bg-muted',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className={cn('text-sm font-semibold', seleccionado ? 'text-primary' : 'text-foreground')}>
          {cliente.nombre}
        </span>
        <span className={cn('text-[11px]', seleccionado ? 'text-primary' : 'text-muted-foreground')}>
          {cliente.telefono ? `${cliente.telefono} · ` : ''}
          {rotuloOrdenesPrevias(cliente.ordenesPrevias)}
        </span>
      </div>
      {/* La tilde SÓLO en el seleccionado (relevamiento, §9.4): el no
          seleccionado no lleva ningún ícono en su lugar. */}
      {seleccionado ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
    </button>
  )
}

/**
 * La recepción entera (design/arandano.pen, frame `lIt3K`): el `<Encabezado>`
 * con sus acciones, el `<form>` invisible que dispara `recibirEquipo`, y las
 * cuatro cards del cuerpo — mismo criterio de "un solo componente" que
 * `FichaDeArticulo` en `/inventario`: el botón "Guardar e imprimir ticket"
 * vive en el Topbar, lejos en el DOM de los campos que dispara, así que sólo
 * un componente que llame una vez a `useActionState` puede repartir
 * `pendiente` a los dos lugares sin que queden desincronizados.
 */
export function FormularioRecepcion({
  accion,
  clientes,
  busquedaCliente,
  claveIdempotencia,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  // Lo que devolvió el buscador de la pantalla, no "los primeros 50": ver el
  // comentario de nuevo/page.tsx.
  clientes: ClienteEncontrado[]
  busquedaCliente: string
  claveIdempotencia: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  // '' = nadie elegido de la lista → se crea un cliente nuevo con lo tipeado
  // más abajo. Estado de React y no un radio nativo: ver el comentario de
  // ResultadoDeCliente.
  const [clienteId, setClienteId] = useState('')
  const id = useId()

  return (
    <>
      <Encabezado
        titulo="Recibir un equipo"
        subtitulo="Queda la orden abierta y sale el ticket con las dos copias"
        acciones={
          <>
            <Button asChild variant="ghost">
              <Link href="/servicio-tecnico">Cancelar</Link>
            </Button>
            <Button type="submit" form={FORM_RECEPCION} disabled={pendiente}>
              <Printer aria-hidden="true" className="size-[15px]" />
              {pendiente ? 'Guardando…' : 'Guardar e imprimir ticket'}
            </Button>
          </>
        }
      />

      {/* Ver el comentario de FORM_RECEPCION más arriba: este <form> no tiene
          ningún campo visible propio, sólo la clave de idempotencia — la
          generó el servidor una vez por carga de la pantalla, y es lo que
          hace que el doble click no imprima dos tickets con números
          distintos para un solo equipo. */}
      <form id={FORM_RECEPCION} action={ejecutar} className="hidden" aria-hidden="true">
        <input type="hidden" name="claveIdempotencia" value={claveIdempotencia} />
      </form>

      <div className="flex flex-col gap-4 p-6">
        <Aviso estado={estado} />

        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-4">
            <CardConEncabezado titulo="1 · Cliente">
              {/* El buscador: <form> de método GET, PROPIO y no anidado en
                  FORM_RECEPCION (un <form> no puede anidar otro). Recarga la
                  pantalla con `?cliente=...`, como antes de este ciclo — el
                  precio es que lo que se haya tipeado del equipo se pierde,
                  y por eso este campo va primero en el cuerpo. */}
              <form action="/servicio-tecnico/nuevo">
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    name="cliente"
                    defaultValue={busquedaCliente}
                    aria-label="Buscar cliente por nombre o teléfono"
                    placeholder="Buscar por nombre o teléfono"
                    className="h-[42px] rounded-[9px] border-input bg-card pl-9 text-sm"
                  />
                </div>
              </form>

              {/* El aviso del precio de buscar (hallazgo I4 de la review
                  final): el comportamiento nunca cambió —este buscador sigue
                  siendo un <form> GET que recarga y descarta lo tipeado del
                  equipo—, pero el ciclo lo sacó de la pantalla y lo dejó sólo
                  en el comentario de arriba. Mismo tratamiento (11px,
                  --muted-foreground) que la ayuda permanente del buscador del
                  tablero (page.tsx, "Buscar alcanza también a las entregadas
                  y anuladas"). El `.pen` calla acá —no dibuja ninguna nota—,
                  pero su silencio no es instrucción de sacarla: es el mismo
                  criterio que ya aplicó bien este ciclo en el tablero. */}
              <p className="text-[11px] text-muted-foreground">
                Buscá primero: al buscar se recarga la pantalla y se pierde lo que hayas cargado del
                equipo.
              </p>

              {/* Un único hidden con el valor de la selección: reemplaza al
                  <select> de antes de este ciclo. */}
              <input type="hidden" name="clienteId" value={clienteId} form={FORM_RECEPCION} />

              {/* Sólo si el buscador de arriba trajo algo. Sin resultados no
                  hay lista que mostrar, y una lista vacía invita a elegir
                  mal. */}
              {clientes.length > 0 ? (
                <div className="flex flex-col overflow-hidden rounded-[10px] border">
                  {clientes.map((c) => (
                    <ResultadoDeCliente
                      key={c.id}
                      cliente={c}
                      seleccionado={clienteId === c.id}
                      onSeleccionar={() => setClienteId(c.id)}
                    />
                  ))}
                </div>
              ) : busquedaCliente ? (
                <p className="text-sm text-muted-foreground">
                  No apareció ningún cliente con «{busquedaCliente}». Cargalo acá abajo como nuevo.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Buscalo arriba si ya vino alguna vez; si es la primera, cargalo acá abajo.
                </p>
              )}

              <div className="flex flex-col gap-[10px] rounded-[10px] bg-background p-[13px]">
                <p className="text-xs font-semibold text-foreground-soft">
                  ¿No aparece? Cargalo acá y se crea con la orden
                </p>
                <div className="flex gap-[10px]">
                  <div className="flex flex-1 flex-col gap-[5px]">
                    <Label htmlFor={`${id}-nombre`} className="text-[11px] font-semibold text-foreground-soft">
                      Nombre
                    </Label>
                    <Input
                      id={`${id}-nombre`}
                      name="clienteNombre"
                      form={FORM_RECEPCION}
                      placeholder="Nombre y apellido"
                      className="h-10 rounded-[9px]"
                      // Tipear acá significa "no, es otro cliente": si había
                      // uno elegido de la lista, se deselecciona solo. Sin
                      // esto, crearOrden ignoraría en silencio lo tipeado acá
                      // —"nunca los dos", ver acciones.ts— y la orden nacía a
                      // nombre de quien había quedado seleccionado antes.
                      onFocus={() => setClienteId('')}
                    />
                  </div>
                  <div className="flex w-[190px] flex-col gap-[5px]">
                    <Label htmlFor={`${id}-tel`} className="text-[11px] font-semibold text-foreground-soft">
                      Teléfono
                    </Label>
                    <Input
                      id={`${id}-tel`}
                      name="clienteTelefono"
                      form={FORM_RECEPCION}
                      inputMode="tel"
                      placeholder="11 0000-0000"
                      className="h-10 rounded-[9px]"
                      onFocus={() => setClienteId('')}
                    />
                  </div>
                </div>
              </div>
            </CardConEncabezado>

            <CardConEncabezado titulo="2 · Equipo">
              <div className="flex gap-[10px]">
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-marca`} className="text-[11px] font-semibold text-foreground-soft">
                    Marca
                  </Label>
                  <Input id={`${id}-marca`} name="equipoMarca" form={FORM_RECEPCION} required className="h-10 rounded-[9px]" />
                </div>
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-modelo`} className="text-[11px] font-semibold text-foreground-soft">
                    Modelo
                  </Label>
                  <Input id={`${id}-modelo`} name="equipoModelo" form={FORM_RECEPCION} required className="h-10 rounded-[9px]" />
                </div>
              </div>
              <div className="flex gap-[10px]">
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-serie`} className="text-[11px] font-semibold text-foreground-soft">
                    IMEI o número de serie
                  </Label>
                  <Input id={`${id}-serie`} name="equipoSerie" form={FORM_RECEPCION} className="h-10 rounded-[9px]" />
                </div>
                <div className="flex w-[190px] flex-col gap-[5px]">
                  <Label htmlFor={`${id}-clave`} className="text-[11px] font-semibold text-foreground-soft">
                    Clave de desbloqueo
                  </Label>
                  <Input id={`${id}-clave`} name="claveDesbloqueo" form={FORM_RECEPCION} className="h-10 rounded-[9px]" />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-[9px] bg-warn-soft p-[11px]">
                <EyeOff aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-warn" />
                {/* Se dice en la pantalla y no sólo en el spec: quien tipea
                    la clave tiene que saber que no va a salir en el papel. */}
                <p className="text-[11px] leading-[1.4] text-warn">
                  La clave queda guardada en la orden pero NO se imprime en el ticket.
                </p>
              </div>
            </CardConEncabezado>
          </div>

          <div className="flex w-[420px] shrink-0 flex-col gap-4">
            <CardConEncabezado titulo="3 · Qué le pasa">
              <div className="flex flex-col gap-[5px]">
                <Label htmlFor={`${id}-falla`} className="text-[11px] font-semibold text-foreground-soft">
                  Falla declarada por el cliente
                </Label>
                <Textarea
                  id={`${id}-falla`}
                  name="fallaDeclarada"
                  form={FORM_RECEPCION}
                  required
                  className="h-24"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <Label htmlFor={`${id}-acc`} className="text-[11px] font-semibold text-foreground-soft">
                  Accesorios entregados
                </Label>
                <Input
                  id={`${id}-acc`}
                  name="accesorios"
                  form={FORM_RECEPCION}
                  placeholder="cargador, funda, chip"
                  className="h-10 rounded-[9px]"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <Label htmlFor={`${id}-danos`} className="text-[11px] font-semibold text-foreground-soft">
                  Daños visibles
                </Label>
                <Input id={`${id}-danos`} name="danosVisibles" form={FORM_RECEPCION} className="h-10 rounded-[9px]" />
              </div>
            </CardConEncabezado>

            <CardConEncabezado titulo="Qué se imprime">
              <ul className="flex flex-col gap-[9px]">
                {[
                  'Dos copias en una sola impresión: la del cliente y la del local.',
                  'La línea de corte va una vez, entre las dos copias.',
                  'El número de orden va grande en las dos.',
                  'La clave de desbloqueo no se imprime.',
                ].map((texto) => (
                  <li key={texto} className="flex items-start gap-[9px]">
                    <Check aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-ok" />
                    <span className="text-xs leading-[1.45] text-foreground-soft">{texto}</span>
                  </li>
                ))}
              </ul>
            </CardConEncabezado>
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Un botón de transición dentro del paño (design/arandano.pen, nodos `qw3KT`
 * Listo / `J0QkFo` Sin reparación / `G13RSW` Rechazado, dentro de `H15q5`
 * "Transiciones"): el PRIMERO de `siguientes` es el camino principal —sólido,
 * blanco sobre el violeta del paño—, el resto es "fantasma" —10% de opacidad
 * blanca sobre el mismo violeta, con borde al 33%—. La regla "primero =
 * principal" sale del propio orden de `TRANSICIONES` (lib/ordenes-de-trabajo/
 * estados.ts): en cada fila, la primera transición ya es la que el spec del
 * módulo documenta como el camino que más se usa (p. ej. `EN_REPARACION`
 * empieza en `LISTO`, no en `SIN_REPARACION`).
 *
 * El ícono es el de `ESTADO_VISUAL[hasta]` — el mismo mapeo que ya pinta el
 * chip del tablero y la bitácora, no uno inventado para este botón.
 */
function BotonDeTransicion({
  hasta,
  nombre,
  principal,
  disabled,
}: {
  hasta: EstadoOrden
  nombre: string
  principal: boolean
  disabled: boolean
}) {
  const { Icono } = ESTADO_VISUAL[hasta]
  return (
    <button
      type="submit"
      name="hasta"
      value={hasta}
      disabled={disabled}
      className={cn(
        'flex h-10 items-center justify-center gap-[7px] rounded-[9px] px-[14px] text-[13px] font-semibold whitespace-nowrap',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--marca-foreground)] disabled:pointer-events-none disabled:opacity-50',
        principal
          ? 'bg-[var(--marca-foreground)] text-[var(--marca)]'
          : 'bg-[color-mix(in_srgb,var(--marca-foreground)_10%,transparent)] text-[var(--marca-foreground)] border border-[color-mix(in_srgb,var(--marca-foreground)_33%,transparent)] hover:bg-[color-mix(in_srgb,var(--marca-foreground)_16%,transparent)]',
      )}
    >
      <Icono aria-hidden="true" className="size-[15px]" />
      {nombre}
    </button>
  )
}

/**
 * El paño "ESTADO ACTUAL" (design/arandano.pen, nodo `Av47M`, 748×183, fill
 * `--marca`): rótulo + estado + tiempo transcurrido arriba, "MOVER A" y los
 * botones de transición abajo. Reemplaza al `<p>` de texto plano que un ciclo
 * anterior bajó al cuerpo esperando exactamente este paño (comentario que
 * vivía en `[id]/page.tsx`).
 *
 * `siguientes` son las que **`TRANSICIONES` devuelve de verdad**, no las que
 * dibuja la maqueta: para `EN_REPARACION` el `.pen` muestra Listo/Sin
 * reparación/Rechazado, y el grafo real de este módulo es Listo/Presupuestado/
 * Sin reparación —sin Rechazado—. Cambiar esos botones sería rediseñar el
 * flujo del negocio, no la pantalla; ver "Las dos decisiones, ya tomadas" del
 * plan de este ciclo.
 */
export function PanelEstado({
  accion,
  ordenId,
  estado,
  siguientes,
  nombres,
  diasEnEstado,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  estado: EstadoOrden
  siguientes: readonly EstadoOrden[]
  nombres: Record<EstadoOrden, string>
  diasEnEstado: number
}) {
  const [estadoAccion, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <div className="flex flex-col gap-3 rounded-2xl p-[18px]" style={{ backgroundColor: 'var(--marca)' }}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-[3px]">
          <span
            className="text-[10px] font-bold tracking-[1.2px]"
            style={{ color: 'var(--marca-soft)' }}
          >
            ESTADO ACTUAL
          </span>
          <span
            className={cn(estilos.archivo, 'text-[26px] font-semibold')}
            style={{ color: 'var(--marca-foreground)' }}
          >
            {nombres[estado]}
          </span>
        </div>
        <div className="flex flex-col items-end gap-[3px]">
          <span
            className="text-[10px] font-bold tracking-[1.2px]"
            style={{ color: 'var(--marca-soft)' }}
          >
            HACE
          </span>
          <span
            className={cn(estilos.archivo, 'text-[20px] font-semibold')}
            style={{ color: 'var(--marca-foreground)' }}
          >
            {textoDeAntiguedad(diasEnEstado)}
          </span>
        </div>
      </div>

      {siguientes.length > 0 ? (
        <form action={ejecutar} className="flex flex-col gap-3">
          <input type="hidden" name="ordenId" value={ordenId} />
          <span
            className="text-[10px] font-bold tracking-[1.2px]"
            style={{ color: 'var(--marca-dim)' }}
          >
            MOVER A
          </span>
          {/* Único escritor de EventoOrden.nota (hallazgo C1 de la review
              final): sin este campo ninguna bitácora nueva puede dejar
              contexto de por qué pasó cada cosa — la maqueta no lo dibuja
              (modela reposo, no la interacción de escribir), pero SÍ dibuja
              notas ya escritas en 4 de los 5 eventos de ejemplo de la
              bitácora, así que las da por existentes. Mismo tratamiento de
              rótulo (11px/600) que ya usa la card "Cliente nuevo" de la
              recepción, con el color adaptado al paño violeta en vez de
              --foreground-soft, que acá sería casi invisible; y el mismo
              tinte translúcido (10%/33% de --marca-foreground) que ya usan
              los botones "fantasma" de este mismo paño para lo que no es el
              camino principal. */}
          <div className="flex flex-col gap-[5px]">
            <Label
              htmlFor={`${id}-nota`}
              className="text-[11px] font-semibold"
              style={{ color: 'var(--marca-dim)' }}
            >
              Nota (opcional)
            </Label>
            <Input
              id={`${id}-nota`}
              name="nota"
              placeholder="qué pasó"
              className="border-[color-mix(in_srgb,var(--marca-foreground)_33%,transparent)] bg-[color-mix(in_srgb,var(--marca-foreground)_10%,transparent)] text-[var(--marca-foreground)] placeholder:text-[color-mix(in_srgb,var(--marca-foreground)_55%,transparent)]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {siguientes.map((s, i) => (
              <BotonDeTransicion
                key={s}
                hasta={s}
                nombre={nombres[s]}
                principal={i === 0}
                disabled={pendiente}
              />
            ))}
          </div>
          {/* Copy visible y no sólo comentario de código: es literalmente lo
              que ya explicaba FormularioEstado antes de este ciclo, ahora en
              pantalla (design/arandano.pen, nodo `m0NPy`). */}
          <p className="text-[11px] leading-[1.45]" style={{ color: 'var(--marca-dim)' }}>
            Sólo aparecen las transiciones legales desde acá. El servidor las vuelve a validar:
            esconder un botón no es una validación.
          </p>
          <Aviso estado={estadoAccion} />
        </form>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--marca-dim)' }}>
          Esta orden no se puede mover más.
        </p>
      )}
    </div>
  )
}

/**
 * "Falla declarada y diagnóstico" (design/arandano.pen, nodo `QbeSO`
 * "Diagnóstico"): fila con el textarea de diagnóstico (flexible) y el
 * presupuesto (190px), alineados abajo (`items-end`) porque el textarea es
 * más alto que el input — y el botón "Guardar diagnóstico", outline, a la
 * derecha (nodo `un4Rv`).
 */
export function FormularioDiagnostico({
  accion,
  ordenId,
  diagnostico,
  montoEstimado,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  diagnostico: string
  montoEstimado: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <form action={ejecutar} className="flex flex-col gap-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-[5px]">
          <Label htmlFor={`${id}-diag`} className="text-[11px] font-semibold text-foreground-soft">
            Diagnóstico del técnico
          </Label>
          <Textarea id={`${id}-diag`} name="diagnostico" defaultValue={diagnostico} className="h-16" />
        </div>
        <div className="flex w-[190px] flex-col gap-[5px]">
          <Label htmlFor={`${id}-monto`} className="text-[11px] font-semibold text-foreground-soft">
            Presupuesto
          </Label>
          <Input
            id={`${id}-monto`}
            name="montoEstimado"
            inputMode="decimal"
            defaultValue={montoEstimado}
            className="h-10 rounded-[9px]"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar diagnóstico'}
        </Button>
      </div>
      <Aviso estado={estado} />
    </form>
  )
}

// Los dos <form> que "Reimprimir ticket" y "Anular orden" disparan desde el
// Topbar (ver el comentario de FichaDeOrden). Reimprimir es sólo un <Link>,
// sin acción de servidor, así que no necesita un id — el único que hace
// falta es el de anular.
const FORM_ANULAR = 'form-anular-orden'

/**
 * "Anular orden" del Topbar, con confirmación en dos pasos (hallazgo M5 de la
 * review final): mismo mecanismo que ya elige `AnularVenta`
 * (app/(app)/ventas/formularios.tsx) para "esto es irreversible pero
 * frecuente" —el patrón que `CLAUDE.md` documenta para ese caso—, y no un
 * `confirm()` del navegador ni una anulación deshacible. Sin esto, el botón
 * quedaba pegado a "Reimprimir ticket" —el que más se aprieta en esta
 * pantalla— y un solo click disparaba algo sin vuelta atrás.
 *
 * El primer render es SIEMPRE el botón sin confirmar: `confirmando` nace en
 * `false` y este componente no tiene forma de empezar armado.
 */
function BotonAnular({ anulando }: { anulando: boolean }) {
  const [confirmando, setConfirmando] = useState(false)

  if (confirmando) {
    return (
      <>
        <Button type="submit" form={FORM_ANULAR} variant="destructive" disabled={anulando}>
          {anulando ? 'Anulando…' : 'Sí, anular'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirmando(false)}>
          Cancelar
        </Button>
      </>
    )
  }

  return (
    // type="button" y SIN form=: a propósito no está atado al <form> de
    // anular. Si lo estuviera, este primer click ya anularía la orden —
    // exactamente lo que este componente existe para no hacer.
    <Button
      type="button"
      variant="outline"
      onClick={() => setConfirmando(true)}
      className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <Ban aria-hidden="true" className="size-[15px]" />
      Anular orden
    </Button>
  )
}

/**
 * La ficha entera de una orden (design/arandano.pen, frame `XVOe5`): el
 * `<Encabezado>` con "Reimprimir ticket" y "Anular orden" en sus acciones, el
 * `<form>` invisible que dispara `anular`, y las dos columnas del cuerpo que
 * `[id]/page.tsx` ya arma (`columnaIzquierda`: paño + Datos + Falla;
 * `columnaDerecha`: la bitácora).
 *
 * Un solo componente y no dos, mismo motivo que `FichaDeArticulo` en
 * `/inventario`: "Anular orden" vive en el Topbar (design/arandano.pen, nodo
 * `ASCfS`), lejos en el DOM del resto del cuerpo, y sólo un componente que
 * llame una vez a `useActionState` puede repartir `pendiente` al botón de
 * arriba sin que quede desincronizado.
 */
export function FichaDeOrden({
  titulo,
  subtitulo,
  ordenId,
  anulada,
  puedeAnular,
  accionAnular,
  columnaIzquierda,
  columnaDerecha,
}: {
  titulo: string
  subtitulo: ReactNode
  ordenId: string
  anulada: boolean
  puedeAnular: boolean
  accionAnular: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  columnaIzquierda: ReactNode
  columnaDerecha: ReactNode
}) {
  const [estadoAnular, ejecutarAnular, anulando] = useActionState(accionAnular, INICIAL)
  // Quien tenga ORDENES_ANULAR, y sólo si no está anulada ya: la action lo
  // revalida con exigirPermiso('ORDENES_ANULAR') y con ORDEN_ANULADA —
  // esconder el botón acá es comodidad, no el permiso real.
  const seOfreceAnular = puedeAnular && !anulada

  return (
    <>
      <Encabezado
        titulo={titulo}
        subtitulo={subtitulo}
        acciones={
          <>
            <Button asChild variant="outline">
              <Link href={`/servicio-tecnico/${ordenId}/ticket`}>
                <Printer aria-hidden="true" className="size-[15px]" />
                Reimprimir ticket
              </Link>
            </Button>
            {seOfreceAnular ? <BotonAnular anulando={anulando} /> : null}
          </>
        }
      />

      {seOfreceAnular ? (
        <form id={FORM_ANULAR} action={ejecutarAnular} className="hidden" aria-hidden="true">
          <input type="hidden" name="ordenId" value={ordenId} />
        </form>
      ) : null}

      <div className="flex flex-col gap-4 p-6">
        <Aviso estado={estadoAnular} />
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-4">{columnaIzquierda}</div>
          <div className="flex w-[380px] shrink-0 flex-col gap-4">{columnaDerecha}</div>
        </div>
      </div>
    </>
  )
}
