'use client'

import { useState, useTransition } from 'react'
import { Download, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
// De valor, y se puede: `lib/clientes/campos.ts` sólo importa módulos puros.
import { TOPE_EMAIL, TOPE_NOMBRE, TOPE_NOTAS, TOPE_TELEFONO } from '@/lib/clientes/campos'
import {
  altaDeCliente, bajaDeCliente, edicionDeCliente, exportarClientes, type EstadoClientes,
} from './acciones'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en formas-de-pago y plan-canje.
const INICIAL: EstadoClientes = { error: null, aviso: null }

/**
 * Lanza el toast que corresponda, con el resultado ya en la mano. Una función
 * llamada en el mismo handler que ejecuta la acción y NO un efecto sobre
 * `useActionState`, por la lección que ya dejó escrita `/formas-de-pago`: el
 * aviso no puede depender de que el componente que lo lanzó siga montado
 * después del `revalidatePath`. Los errores no se van solos —dicen qué
 * corregir—; los de éxito sí.
 */
function avisar(resultado: EstadoClientes, clave: string): EstadoClientes {
  if (resultado.error) toast.error(resultado.error, { id: clave, duration: Infinity })
  else if (resultado.aviso) toast.success(resultado.aviso, { id: clave })
  return resultado
}

const ROTULO = 'text-[11px] font-semibold text-foreground-soft'

function Campo({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-[5px]">{children}</div>
}

/** Un cliente tal como lo editan la ficha y el alta: todo texto, sin `Date`. */
export type ClienteEditable = {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  notas: string | null
  aceptaOfertas: boolean
}

/**
 * Los campos del alta y de la ficha, sin lo que los rodea.
 *
 * **Separados del diálogo**, con el mismo motivo que `CamposDePlan` en
 * `/formas-de-pago`: `DialogContent` sólo se monta abierto, así que un
 * `renderToStaticMarkup` del diálogo cerrado nunca vería estos campos.
 *
 * `prefijo` para los `id`: la ficha y el diálogo de alta no conviven en la
 * misma pantalla, pero el diálogo del escritorio y el del teléfono sí (dos
 * instancias montadas en paralelo, como en `/formas-de-pago`).
 *
 * "Acepta ofertas" es un checkbox nativo, como el filtro de `/inventario`:
 * llega al `FormData` como "1" tildado y no llega destildado, y así lo lee
 * `camposDe` en acciones.ts.
 */
export function CamposDeCliente({
  cliente,
  pendiente,
  prefijo,
}: {
  cliente?: ClienteEditable
  pendiente: boolean
  prefijo: string
}) {
  return (
    <div className="flex flex-col gap-[14px]">
      {cliente && <input type="hidden" name="id" value={cliente.id} />}
      <Campo>
        <Label htmlFor={`${prefijo}-nombre`} className={ROTULO}>
          Nombre
        </Label>
        <Input
          id={`${prefijo}-nombre`}
          name="nombre"
          required
          autoComplete="off"
          maxLength={TOPE_NOMBRE}
          defaultValue={cliente?.nombre}
          placeholder="Ana Pérez"
          disabled={pendiente}
          className="h-10 rounded-[9px]"
        />
      </Campo>
      <div className="flex flex-col gap-[14px] sm:flex-row">
        <Campo>
          <Label htmlFor={`${prefijo}-telefono`} className={ROTULO}>
            Teléfono
          </Label>
          <Input
            id={`${prefijo}-telefono`}
            name="telefono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={TOPE_TELEFONO}
            defaultValue={cliente?.telefono ?? ''}
            placeholder="11 2233-4455"
            disabled={pendiente}
            className="h-10 rounded-[9px]"
          />
        </Campo>
        <Campo>
          <Label htmlFor={`${prefijo}-email`} className={ROTULO}>
            Email
          </Label>
          <Input
            id={`${prefijo}-email`}
            name="email"
            type="email"
            autoComplete="off"
            maxLength={TOPE_EMAIL}
            defaultValue={cliente?.email ?? ''}
            placeholder="ana@gmail.com"
            disabled={pendiente}
            className="h-10 rounded-[9px]"
          />
        </Campo>
      </div>
      <Campo>
        <Label htmlFor={`${prefijo}-notas`} className={ROTULO}>
          Notas
        </Label>
        <Textarea
          id={`${prefijo}-notas`}
          name="notas"
          rows={3}
          maxLength={TOPE_NOTAS}
          defaultValue={cliente?.notas ?? ''}
          placeholder="Prefiere que le escriban a la tarde"
          disabled={pendiente}
        />
      </Campo>
      <label className="flex items-start gap-2 text-[13px] text-foreground">
        <input
          type="checkbox"
          name="aceptaOfertas"
          value="1"
          defaultChecked={cliente?.aceptaOfertas ?? false}
          disabled={pendiente}
          className="mt-0.5 size-[15px] shrink-0 rounded-[4px] border-input accent-primary"
        />
        <span>
          Acepta que le mandemos ofertas
          <span className="block text-[11px] text-muted-foreground">
            Marcalo sólo si el cliente dijo que sí. Sin esto, no entra en la lista de ofertas.
          </span>
        </span>
      </label>
    </div>
  )
}

/**
 * "Cliente nuevo": el alta en un diálogo, desde el Topbar. Dos instancias
 * montadas en paralelo —escritorio y la ranura derecha del teléfono—, igual que
 * "Plan nuevo" en `/formas-de-pago`; en cada ancho se ve una sola.
 */
export function DialogoDeClienteNuevo({ movil = false }: { movil?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, empezar] = useTransition()

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        {movil ? (
          // La ranura derecha del teléfono, con el tono de acción: es LA
          // acción de esta pantalla. `controlMovil` y no `accionMovil` porque
          // abrir un diálogo no es navegar (ver CONSUMIDORES_LEGITIMOS en
          // test/sistema-de-diseno.test.ts).
          <button
            type="button"
            aria-label="Cliente nuevo"
            className={`${CLASES_RANURA_MOVIL} bg-primary text-primary-foreground`}
          >
            <Plus aria-hidden="true" className="size-[19px]" />
          </button>
        ) : (
          <Button>
            <Plus aria-hidden="true" className="size-[15px]" />
            Cliente nuevo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Un cliente nuevo</DialogTitle>
          <DialogDescription>
            Lo normal es cargarlo al cobrar, en Vender. Acá es para el que no compró todavía.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (enCurso) return
            // El FormData se arma ACÁ: después del primer await,
            // `e.currentTarget` ya es null.
            const datos = new FormData(e.currentTarget)
            empezar(async () => {
              const resultado = avisar(await altaDeCliente(INICIAL, datos), 'cliente-alta')
              // Sólo si salió bien: con un teléfono repetido, cerrar se
              // llevaría lo tipeado justo cuando el aviso dice qué corregir.
              if (!resultado.error) setAbierto(false)
            })
          }}
        >
          <CamposDeCliente pendiente={enCurso} prefijo={movil ? 'alta-movil' : 'alta'} />
          <DialogFooter className="mt-5">
            <Button type="submit" disabled={enCurso}>
              {enCurso ? 'Guardando…' : 'Cargar el cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Los datos editables de la ficha, con su "Guardar". */
export function FormularioDeLaFicha({ cliente }: { cliente: ClienteEditable }) {
  const [enCurso, empezar] = useTransition()
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (enCurso) return
        const datos = new FormData(e.currentTarget)
        empezar(async () => {
          avisar(await edicionDeCliente(INICIAL, datos), `cliente-${cliente.id}-edicion`)
        })
      }}
    >
      <CamposDeCliente cliente={cliente} pendiente={enCurso} prefijo="ficha" />
      <Button type="submit" disabled={enCurso} className="self-start">
        {enCurso ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </form>
  )
}

/**
 * Borrar, con confirmación en dos toques sobre el mismo botón —el mismo
 * mecanismo que `AnularVenta`—. Sólo se dibuja para el dueño (la action lo
 * re-exige).
 *
 * **Con historia no se ofrece el botón**: se dice por qué. Un botón que va a
 * fallar siempre es una puerta pintada; el mensaje es el mismo que daría el
 * servidor. La action igual lo vuelve a chequear, por la carrera de una venta
 * asignada mientras la ficha estaba abierta.
 */
export function BorrarCliente({ clienteId, historia }: { clienteId: string; historia: string | null }) {
  const [confirmando, setConfirmando] = useState(false)
  const [enCurso, empezar] = useTransition()

  if (historia !== null) {
    return (
      <p className="text-[13px] leading-[1.5] text-muted-foreground">
        Tiene {historia}: no se puede borrar. Si no querés escribirle más, destildá «Acepta que le
        mandemos ofertas».
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] leading-[1.5] text-muted-foreground">
        No tiene compras ni órdenes: si se cargó por error, se puede borrar. No se deshace.
      </p>
      <Button
        type="button"
        variant={confirmando ? 'destructive' : 'outline'}
        disabled={enCurso}
        className="self-start"
        onClick={() => {
          if (!confirmando) {
            setConfirmando(true)
            return
          }
          const datos = new FormData()
          datos.set('id', clienteId)
          empezar(async () => {
            // En el éxito la action redirige al listado y esto no vuelve.
            const r = avisar(await bajaDeCliente(INICIAL, datos), `cliente-${clienteId}-baja`)
            if (r.error) setConfirmando(false)
          })
        }}
      >
        {enCurso ? 'Borrando…' : confirmando ? 'Tocá de nuevo para borrar' : 'Borrar cliente'}
      </Button>
    </div>
  )
}

/**
 * "Exportar CSV", sólo para el dueño, con la búsqueda y el filtro del listado.
 * El BOM va en el Blob y no en el texto de la action, como en los otros dos
 * CSV (`BotonDeExportar` del dashboard): sin él, Excel en Windows rompe cada
 * "ó" de un nombre.
 */
export function BotonExportarClientes({ texto, soloAceptanOfertas }: { texto: string; soloAceptanOfertas: boolean }) {
  const [exportando, setExportando] = useState(false)

  async function exportar() {
    setExportando(true)
    try {
      const csv = await exportarClientes({ texto, soloAceptanOfertas })
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = soloAceptanOfertas ? 'clientes-aceptan-ofertas.csv' : 'clientes.csv'
      // Insertado en el DOM: Safari no descarga un <a download> suelto.
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      toast.error('No se pudo exportar. Probá de nuevo.', { id: 'clientes-csv', duration: Infinity })
    } finally {
      setExportando(false)
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={exportar} disabled={exportando} className="h-10">
      <Download aria-hidden="true" className="size-[15px]" />
      {exportando ? 'Exportando…' : 'Exportar CSV'}
    </Button>
  )
}
