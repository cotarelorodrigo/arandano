'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { buscarClientesDelLocal } from './acciones'
// De TIPO y no de valor: `lib/clientes/administrar.ts` arrastra
// `lib/tenant/transaccion.ts`, y un import de valor desde este archivo cliente
// llevaría `pg` al bundle del navegador (test/limite-cliente-servidor.test.ts).
import type { ClienteEncontrado } from '@/lib/clientes/administrar'
// De valor, y se puede: `lib/clientes/campos.ts` sólo importa módulos puros.
import { TOPE_NOMBRE, TOPE_TELEFONO } from '@/lib/clientes/campos'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * El cliente que se eligió o se está cargando, del lado del navegador.
 *
 * `existente` viene del buscador; `nuevo` es el alta al vuelo, que NO se
 * guarda acá: viaja con la venta (o con "Guardar" en el detalle) y nace en la
 * misma transacción en el servidor. Mientras tanto es sólo lo tipeado.
 */
export type ClienteElegido =
  | { tipo: 'existente'; id: string; nombre: string; telefono: string | null }
  | { tipo: 'nuevo'; nombre: string; telefono: string; aceptaOfertas: boolean }

/**
 * Los dos campos ocultos del cobro (`clienteId`, `clienteNuevo`), a partir de
 * lo elegido.
 *
 * **Sin cliente, los dos vacíos**: `cobrar` (app/(app)/vender/acciones.ts) los
 * lee como "sin cliente" y la venta sale exactamente como antes de que el
 * campo existiera. Pura y exportada para que el test la fije sin DOM.
 */
export function camposOcultosDelCliente(c: ClienteElegido | null): { clienteId: string; clienteNuevo: string } {
  if (c === null) return { clienteId: '', clienteNuevo: '' }
  if (c.tipo === 'existente') return { clienteId: c.id, clienteNuevo: '' }
  return {
    clienteId: '',
    clienteNuevo: JSON.stringify({ nombre: c.nombre, telefono: c.telefono, aceptaOfertas: c.aceptaOfertas }),
  }
}

/**
 * Lo que se tipeó en el buscador, repartido para precargar el alta: si parece
 * un teléfono (casi todo dígitos) va al teléfono; si no, al nombre. Así "Cliente
 * nuevo" después de buscar sin éxito no obliga a tipear lo mismo dos veces.
 */
export function precargaDelAlta(busqueda: string): { nombre: string; telefono: string } {
  const texto = busqueda.trim()
  const digitos = texto.replace(/\D/g, '').length
  const pareceTelefono = digitos >= 6 && digitos >= texto.replace(/\s/g, '').length * 0.7
  return pareceTelefono ? { nombre: '', telefono: texto } : { nombre: texto, telefono: '' }
}

/**
 * El selector de cliente: buscar uno cargado o cargar uno nuevo, en el mismo
 * lugar. Uno solo para el cobro de `/vender` y para "Asignar cliente" en
 * `/ventas/[id]`, por lo mismo que existe `SelectorDeCategoria`: dos copias de
 * la misma interacción divergen en silencio.
 *
 * Controlado (`valor` + `onCambiar`): quien lo usa decide qué hacer con lo
 * elegido —el cobro lo manda en dos campos ocultos, el detalle con un botón—.
 *
 * **Vive adentro del `<form>` del cobro, y eso fija tres reglas que no son
 * prolijidad:**
 *
 * 1. **Todo `<button>` es `type="button"`.** Un botón sin tipo adentro de un
 *    form es un submit: tocar "Cliente nuevo" cobraría la venta.
 *    `elegir-cliente.test.tsx` lo fija sobre la fuente.
 * 2. **Enter en sus campos no envía el cobro.** En un `<input>` de texto,
 *    Enter dispara el envío implícito del form; acá Enter en el buscador
 *    elige el resaltado, y en los campos del alta no hace nada. Y corta la
 *    propagación: el atajo global de Enter de `/vender` se abstiene con el
 *    foco en un INPUT (`puedeDispararCobroDesdeFoco`), pero elegir saca el
 *    INPUT del DOM en el mismo evento y el foco cae en `<body>` — ver el
 *    comentario del `onKeyDown` del buscador. Después de elegir, el foco
 *    queda en `<body>` a propósito: el Enter SIGUIENTE cobra, que es lo que
 *    promete la leyenda "Enter para cobrar".
 * 3. **Esc no le llega al carrito.** El listener global de `/vender` arma el
 *    vaciado con Esc; acá Esc cierra la lista o cancela el alta, y corta la
 *    propagación — el mismo remedio que `detenerEscapeGlobal`
 *    (app/(app)/vender/caja.tsx), escrito acá para no atar este componente a
 *    la pantalla de venta. Con la lista abierta, además, su
 *    `role="listbox"` hace que ese listener se abstenga entero
 *    (`hayOverlayDeRadixAbierto` mira ese rol).
 */
export function ElegirCliente({
  valor,
  onCambiar,
  deshabilitado = false,
}: {
  valor: ClienteElegido | null
  onCambiar: (c: ClienteElegido | null) => void
  deshabilitado?: boolean
}) {
  const id = useId()
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ClienteEncontrado[]>([])
  const [resaltado, setResaltado] = useState(0)
  const [abierta, setAbierta] = useState(false)
  const buscador = useRef<HTMLInputElement>(null)
  // El buscador y su lista, para saber si el foco se fue AFUERA (ver el
  // `onBlur` del contenedor, abajo).
  const zonaDeBusqueda = useRef<HTMLDivElement>(null)
  const nombreNuevo = useRef<HTMLInputElement>(null)
  // La búsqueda vigente, para que la respuesta de una búsqueda vieja no pise la
  // de una más nueva: mismo mecanismo que el buscador de artículos de /vender.
  const vigente = useRef(busqueda)
  useEffect(() => {
    vigente.current = busqueda
  })

  // 200 ms de respiro, igual que el buscador de artículos: lo que separa
  // "tipeando" de "terminó de tipear". El vaciado con el texto vacío vive en
  // `alTipear`, no acá (react-hooks/set-state-in-effect).
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto === '') return
    const t = setTimeout(() => {
      buscarClientesDelLocal(texto).then((r) => {
        if (vigente.current.trim() !== texto) return
        setResultados(r)
        setResaltado(0)
        setAbierta(true)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [busqueda])

  function alTipear(texto: string) {
    setBusqueda(texto)
    if (texto.trim() === '') {
      setResultados([])
      setAbierta(false)
    }
  }

  function elegir(c: ClienteEncontrado) {
    onCambiar({ tipo: 'existente', id: c.id, nombre: c.nombre, telefono: c.telefono })
    setBusqueda('')
    setResultados([])
    setAbierta(false)
  }

  function empezarAlta() {
    onCambiar({ tipo: 'nuevo', ...precargaDelAlta(busqueda), aceptaOfertas: false })
    setBusqueda('')
    setResultados([])
    setAbierta(false)
    // Después del render que monta el campo.
    setTimeout(() => nombreNuevo.current?.focus(), 0)
  }

  function soltar() {
    onCambiar(null)
    setTimeout(() => buscador.current?.focus(), 0)
  }

  // Si quien lo usa vuelve a `null` desde afuera (otro cliente elegido en otra
  // pantalla, un reset), la búsqueda vieja no sobrevive. Ajuste durante el
  // render —el patrón que React documenta para "estado que depende de una
  // prop"—, no un efecto (react-hooks/set-state-in-effect). El reset de
  // /vender después de cobrar no pasa por acá cuando el valor YA era null:
  // ese lo resuelve la `key` que le pone punto-de-venta.tsx.
  const [valorAnterior, setValorAnterior] = useState(valor)
  if (valor !== valorAnterior) {
    setValorAnterior(valor)
    if (valor === null) {
      setBusqueda('')
      setResultados([])
      setAbierta(false)
    }
  }

  const listaVisible = abierta && busqueda.trim() !== ''

  if (valor?.tipo === 'existente') {
    return (
      <div className="flex h-10 items-center gap-2 rounded-[9px] border border-input bg-card px-[13px]">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          <span className="font-medium">{valor.nombre}</span>
          {valor.telefono && <span className="text-muted-foreground"> · {valor.telefono}</span>}
        </span>
        <button
          key="soltar-existente"
          type="button"
          onClick={soltar}
          disabled={deshabilitado}
          aria-label={`Sacar a ${valor.nombre} de la venta`}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    )
  }

  if (valor?.tipo === 'nuevo') {
    const cambiar = (parcial: Partial<Omit<Extract<ClienteElegido, { tipo: 'nuevo' }>, 'tipo'>>) =>
      onCambiar({ ...valor, ...parcial })
    // Enter no envía el cobro (regla 2) y Esc cancela el alta sin llegar al
    // carrito (regla 3).
    const teclas = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        soltar()
      }
    }
    return (
      <div className="flex flex-col gap-2.5 rounded-[9px] border border-input bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground-soft">Cliente nuevo</span>
          <button
            key="cancelar-nuevo"
            type="button"
            onClick={soltar}
            disabled={deshabilitado}
            className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="flex flex-1 flex-col gap-[5px]">
            <Label htmlFor={`${id}-nombre`} className="text-[11px] font-semibold text-foreground-soft">
              Nombre
            </Label>
            <Input
              ref={nombreNuevo}
              id={`${id}-nombre`}
              value={valor.nombre}
              onChange={(e) => cambiar({ nombre: e.target.value })}
              onKeyDown={teclas}
              maxLength={TOPE_NOMBRE}
              autoComplete="off"
              disabled={deshabilitado}
              placeholder="Ana Pérez"
              className="h-10 rounded-[9px] bg-card"
            />
          </div>
          <div className="flex flex-1 flex-col gap-[5px]">
            <Label htmlFor={`${id}-telefono`} className="text-[11px] font-semibold text-foreground-soft">
              Teléfono (opcional)
            </Label>
            <Input
              id={`${id}-telefono`}
              type="tel"
              inputMode="tel"
              value={valor.telefono}
              onChange={(e) => cambiar({ telefono: e.target.value })}
              onKeyDown={teclas}
              maxLength={TOPE_TELEFONO}
              autoComplete="off"
              disabled={deshabilitado}
              placeholder="11 2233-4455"
              className="h-10 rounded-[9px] bg-card"
            />
          </div>
        </div>
        {/* Nativo y no el `Checkbox` de shadcn, como el filtro de /inventario:
            un `<input type="checkbox">` no es un `<button>` (regla 1), y se
            tilda con Espacio sin que Enter haga nada raro. Destildado de
            arranque: el consentimiento se pregunta, no se presume. */}
        <label className="flex items-center gap-2 text-[13px] text-foreground-soft">
          <input
            type="checkbox"
            checked={valor.aceptaOfertas}
            onChange={(e) => cambiar({ aceptaOfertas: e.target.checked })}
            onKeyDown={teclas}
            disabled={deshabilitado}
            className="size-[15px] rounded-[4px] border-input accent-primary"
          />
          Acepta que le mandemos ofertas
        </label>
      </div>
    )
  }

  const idLista = `${id}-resultados`
  const idOpcion = (i: number) => `${id}-opcion-${i}`

  return (
    // La lista se cierra cuando el foco sale de esta zona (review del ciclo).
    // No es cosmética: con la lista montada, su `role="listbox"` hace que el
    // listener global de /vender (`hayOverlayDeRadixAbierto`) se abstenga
    // entero, así que una lista olvidada abierta dejaba sin Enter para cobrar
    // ni Esc para vaciar. `onBlur` de React burbujea (es `focusout`), y el
    // `relatedTarget` dice adónde fue el foco: si fue a un resultado o al
    // "Nuevo" de esta misma zona, no se cierra. Tocar un resultado con el
    // mouse ni siquiera mueve el foco (`onMouseDown` + `preventDefault`), así
    // que elegir sigue funcionando. Tocar afuera saca el foco del buscador, y
    // eso cubre el "click afuera" sin un listener de `pointerdown` propio.
    <div
      ref={zonaDeBusqueda}
      className="relative flex flex-col gap-2"
      onBlur={(e) => {
        if (!zonaDeBusqueda.current?.contains(e.relatedTarget as Node | null)) setAbierta(false)
      }}
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={buscador}
            role="combobox"
            aria-expanded={listaVisible}
            aria-controls={idLista}
            aria-activedescendant={listaVisible && resultados.length > 0 ? idOpcion(resaltado) : undefined}
            aria-label="Buscar cliente por nombre, teléfono o email"
            placeholder="Buscar por nombre o teléfono"
            autoComplete="off"
            value={busqueda}
            disabled={deshabilitado}
            onChange={(e) => alTipear(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Regla 2: nunca el envío implícito del cobro, y tampoco el
                // atajo global. El `stopPropagation` NO sobra: elegir saca este
                // campo del DOM en el mismo evento (React aplica el render de
                // un evento discreto antes de que el evento siga subiendo), así
                // que cuando el Enter llega a `window` el foco ya está en
                // `<body>` y la lista ya no existe — y con eso el atajo de
                // `/vender` cobraría la venta con el mismo Enter que eligió al
                // cliente. Es la familia del bug 86fc106 (un control que
                // cambia debajo del evento que lo tocó).
                e.preventDefault()
                e.stopPropagation()
                if (listaVisible && resultados[resaltado]) elegir(resultados[resaltado])
              } else if (e.key === 'ArrowDown' && resultados.length > 0) {
                e.preventDefault()
                setAbierta(true)
                setResaltado((r) => Math.min(r + 1, resultados.length - 1))
              } else if (e.key === 'ArrowUp' && resultados.length > 0) {
                e.preventDefault()
                setResaltado((r) => Math.max(r - 1, 0))
              } else if (e.key === 'Escape') {
                // Regla 3. Primero cierra la lista; con la lista cerrada,
                // borra lo tipeado. Nunca llega al carrito.
                e.stopPropagation()
                if (listaVisible) setAbierta(false)
                else alTipear('')
              }
            }}
            className="h-10 rounded-[9px] border-input bg-card pl-9 text-sm"
          />
        </div>
        <button
          key="empezar-alta"
          type="button"
          onClick={empezarAlta}
          disabled={deshabilitado}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-[9px] border border-input bg-card px-3 text-[13px] font-semibold text-foreground-soft hover:bg-muted disabled:opacity-50"
        >
          <UserPlus aria-hidden="true" className="size-[15px]" />
          Nuevo
        </button>
      </div>
      {listaVisible && (
        <div
          id={idLista}
          role="listbox"
          aria-label="Clientes encontrados"
          className="flex flex-col overflow-hidden rounded-[9px] border bg-card"
        >
          {resultados.length === 0 ? (
            <p className="px-[13px] py-2.5 text-[13px] text-muted-foreground">
              Nadie con ese nombre o teléfono. Tocá «Nuevo» para cargarlo.
            </p>
          ) : (
            resultados.map((c, i) => (
              <button
                key={c.id}
                id={idOpcion(i)}
                type="button"
                role="option"
                aria-selected={i === resaltado}
                // `onMouseDown` + `preventDefault`: el foco se queda en el
                // buscador, así las flechas y Enter siguen funcionando después
                // de mirar la lista con el mouse.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(c)}
                className={`flex items-baseline justify-between gap-3 px-[13px] py-2 text-left text-sm ${
                  i === resaltado ? 'bg-muted' : 'hover:bg-muted/60'
                }`}
              >
                <span className="min-w-0 truncate font-medium text-foreground">{c.nombre}</span>
                {c.telefono && <span className="shrink-0 text-xs text-muted-foreground">{c.telefono}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
