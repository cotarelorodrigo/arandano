'use client'

import type { ReactNode } from 'react'
import { useActionState, useId, useState } from 'react'
import Link from 'next/link'
import { Search, Check, Printer, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Encabezado } from '@/components/shell/encabezado'
import { cn } from '@/lib/utils'
import { rotuloOrdenesPrevias, type ClienteEncontrado } from '@/lib/clientes/administrar'
import type { EstadoServicio } from './acciones'
// El tipo del enum, no `string`: así el compilador atrapa que la pantalla le
// pase un estado que no existe, en vez de que lo descubra el server action en
// runtime. Es un import de tipo, así que no arrastra nada al bundle del cliente.
import type { EstadoOrden } from '@/generated/prisma/client'
import estilos from './tipografia.module.css'

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
                      onFocus={() => setClienteId('')}
                    />
                  </div>
                </div>
              </div>
            </CardConEncabezado>

            <CardConEncabezado titulo="2 · Equipo">
              <div className="flex gap-[10px]">
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-marca`}>Marca</Label>
                  <Input id={`${id}-marca`} name="equipoMarca" form={FORM_RECEPCION} required />
                </div>
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-modelo`}>Modelo</Label>
                  <Input id={`${id}-modelo`} name="equipoModelo" form={FORM_RECEPCION} required />
                </div>
              </div>
              <div className="flex gap-[10px]">
                <div className="flex flex-1 flex-col gap-[5px]">
                  <Label htmlFor={`${id}-serie`}>IMEI o número de serie</Label>
                  <Input id={`${id}-serie`} name="equipoSerie" form={FORM_RECEPCION} />
                </div>
                <div className="flex w-[190px] flex-col gap-[5px]">
                  <Label htmlFor={`${id}-clave`}>Clave de desbloqueo</Label>
                  <Input id={`${id}-clave`} name="claveDesbloqueo" form={FORM_RECEPCION} />
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
                <Label htmlFor={`${id}-falla`}>Falla declarada por el cliente</Label>
                <Textarea
                  id={`${id}-falla`}
                  name="fallaDeclarada"
                  form={FORM_RECEPCION}
                  required
                  className="h-24"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <Label htmlFor={`${id}-acc`}>Accesorios entregados</Label>
                <Input
                  id={`${id}-acc`}
                  name="accesorios"
                  form={FORM_RECEPCION}
                  placeholder="cargador, funda, chip"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <Label htmlFor={`${id}-danos`}>Daños visibles</Label>
                <Input id={`${id}-danos`} name="danosVisibles" form={FORM_RECEPCION} />
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

export function FormularioEstado({
  accion,
  ordenId,
  siguientes,
  nombres,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  siguientes: readonly EstadoOrden[]
  nombres: Record<EstadoOrden, string>
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  if (siguientes.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta orden no se puede mover más.</p>
  }

  return (
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
        <Input id={`${id}-nota`} name="nota" placeholder="qué pasó" />
      </div>
      {/* Un botón por transición LEGAL, y el valor viaja en el botón: así no
          hay un desplegable donde se pueda elegir un salto que el servidor va
          a rechazar. El servidor lo revalida igual. */}
      <div className="flex flex-wrap gap-2">
        {siguientes.map((s) => (
          <Button key={s} type="submit" name="hasta" value={s} variant="secondary" disabled={pendiente}>
            {nombres[s]}
          </Button>
        ))}
      </div>
      <Aviso estado={estado} />
    </form>
  )
}

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
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-diag`}>Diagnóstico</Label>
        <textarea
          id={`${id}-diag`}
          name="diagnostico"
          rows={3}
          defaultValue={diagnostico}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div>
        <Label htmlFor={`${id}-monto`}>Monto estimado</Label>
        <Input id={`${id}-monto`} name="montoEstimado" inputMode="decimal" defaultValue={montoEstimado} />
      </div>
      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar diagnóstico'}
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}

export function FormularioAnular({
  accion,
  ordenId,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  return (
    <form action={ejecutar}>
      <input type="hidden" name="ordenId" value={ordenId} />
      <Button type="submit" variant="ghost" disabled={pendiente}>
        Anular esta orden
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}
