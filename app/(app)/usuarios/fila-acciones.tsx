'use client'

import { useActionState, useEffect, useState } from 'react'
import { nuevaClave, baja, alta, type EstadoUsuarios } from './acciones'
import { Input } from '@/components/ui/input'

// Mismo motivo que en formularios.tsx: acciones.ts es 'use server' y sólo
// puede exportar funciones async.
const INICIAL: EstadoUsuarios = { error: null, aviso: null, claveGenerada: null }

// Ronda de arreglos 1 (Menor 4): el separador "·" (formularios.tsx, celda
// Acciones de CardEquipo) quedó a 10px como pide el nodo `hfAYV`, pero el
// texto que lo sigue seguía en 12 (text-xs) — la maqueta dibuja "· Cambiar
// clave" uniforme a 10 en el teléfono. `lg:text-xs` repone el tamaño de
// escritorio de siempre.
const ENLACE =
  'text-[10px] lg:text-xs font-semibold text-primary hover:underline disabled:pointer-events-none disabled:opacity-50'

/**
 * El formulario inline de "Cambiar clave" (design/arandano.pen no lo dibuja:
 * el frame es un estado de reposo y sólo muestra el link "Cambiar clave" —
 * ver la regla de lectura del `.pen` del brief de esta task). Un click abre
 * esto en su lugar, mismo criterio que `FormularioDeApertura` en
 * `app/(app)/vender/caja.tsx` para "abrir caja": la maqueta no dibuja la
 * interacción, pero silenciarla no es instrucción de sacarla.
 *
 * Presentacional y sin su propio useActionState: así se puede renderizar
 * DIRECTO en un test con cualquier `pendiente`, sin simular el click que la
 * abre (este harness no tiene jsdom — ver vitest.config.mts).
 */
export function FormularioCambiarClave({
  usuarioId,
  nombre,
  accion,
  pendiente,
  onCancelar,
}: {
  usuarioId: string
  nombre: string
  accion: (datos: FormData) => void
  pendiente: boolean
  onCancelar: () => void
}) {
  return (
    <form action={accion} className="flex items-center justify-end gap-2">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <input type="hidden" name="nombre" value={nombre} />
      <Input
        name="clave"
        type="text"
        minLength={8}
        required
        autoFocus
        placeholder="Nueva contraseña"
        className="h-8 w-[150px] text-xs"
      />
      <button type="submit" disabled={pendiente} className={ENLACE}>
        {pendiente ? 'Guardando…' : 'Guardar'}
      </button>
      <button type="button" onClick={onCancelar} className="text-xs font-semibold text-muted-foreground hover:underline">
        Cancelar
      </button>
    </form>
  )
}

/**
 * El mensaje de error de una acción de fila (alta/baja/cambio de clave), como
 * su propio componente presentacional — igual que `AvisoClaveGenerada` en
 * `aviso-clave.tsx`. Separado así, y no un `<p>` inline dentro de
 * `FilaAcciones`, es lo que permite testearlo sin simular el submit que
 * dispara el error vía `useActionState` (este harness no tiene jsdom).
 *
 * `role="alert"` a mano — I2 de la review final del cierre—: esta celda no
 * usa `<Alert>` de shadcn (que lo trae por default), así que perderlo al
 * armar el marcado a mano es exactamente el defecto que `aviso-clave.tsx` ya
 * dejó anotado dos veces antes en este mismo rediseño ("cambiar de
 * componente sin repetirlo"). La tercera vez fue este archivo, tres líneas
 * más allá del bloque que sí se cuidó.
 */
export function ErrorDeFila({ mensaje }: { mensaje: string }) {
  return (
    <p role="alert" className="text-[11px] font-medium text-destructive">
      {mensaje}
    </p>
  )
}

/**
 * La confirmación de "Baja"/"Reactivar", en texto — el chip Activo/Desactivado
 * ya cambia como feedback visual, pero eso no le sirve a quien usa lector de
 * pantalla y no ve la fila repintarse. `baja`/`alta` (acciones.ts) devuelven
 * este texto desde antes de este ciclo (`aviso: 'Usuario desactivado.'` /
 * `'Usuario reactivado.'`), pero ninguna pantalla lo renderizaba: `Resultado`
 * (formularios.tsx) sí sabe pintar `estado.aviso`, pero sólo lo invocan como
 * `{estado.error && <Resultado estado={estado} />}` en el alta, así que su
 * rama de aviso quedaba muerta en todo el archivo (hallazgo de la review
 * final, "efecto colateral" de I2). `role="status"` y no "alert": es una
 * confirmación, no un error — no compite por la atención inmediata de quien
 * usa lector de pantalla de la misma forma.
 */
export function AvisoDeFila({ mensaje }: { mensaje: string }) {
  return (
    <p role="status" className="text-[11px] text-muted-foreground">
      {mensaje}
    </p>
  )
}

// El tipo lleva email y rol aunque esta celda no los use: es el mismo objeto
// que ya trae la fila entera (CardEquipo, en formularios.tsx, es quien
// pinta esos dos), y separar un tipo más angosto sólo para esta celda
// obligaría a armar un objeto nuevo en cada fila en vez de pasar `u` tal
// cual.
export type UsuarioDeFila = {
  id: string
  nombre: string
  email: string
  rol: 'DUENO' | 'EMPLEADO'
  desactivadoEn: Date | null
}

/**
 * La celda ACCIONES de una fila (design/arandano.pen, nodos `LVeZs`/`Cx80U`
 * "Cambiar clave", `vlz8y` "Cambiar clave · Baja", `aypZl` "Reactivar"):
 *
 * - Desactivado: sólo "Reactivar" — no tiene sentido resetear la clave de
 *   alguien que hoy no puede entrar.
 * - Activo y no sos vos: "Cambiar clave" y "Baja", separados por un " · "
 *   igual que la maqueta (un solo texto ahí, partido acá en dos controles
 *   independientes porque disparan acciones distintas).
 * - Activo y sos vos (`esUnoMismo`): sólo "Cambiar clave" — desactivarte a vos
 *   mismo no se ofrece nunca, la regla del último dueño ya lo bloquearía en
 *   el servidor pero un botón que siempre falla es peor que ningún botón.
 *
 * La maqueta muestra "Cambiar clave" a secas en las DOS filas de dueño del
 * ejemplo y "Cambiar clave · Baja" sólo en la fila de la empleada activa —
 * pero esconder "Baja" para todo dueño quitaría una capacidad que hoy existe
 * (cualquier dueño puede dar de baja a OTRO dueño, y el servidor ya impide
 * dejar el local sin ninguno activo) sin que el brief lo pida de forma
 * explícita, y además dejaría sin forma de ejercitar esa regla desde la
 * pantalla — justo lo que el checklist de tests de esta task exige poder
 * mostrar. Se interpretó como variedad ilustrativa del mockup, no como una
 * regla de "los dueños no se dan de baja desde acá", y "Baja" queda
 * disponible para cualquier fila activa que no sea la propia.
 *
 * `items-start lg:items-end` (Task 10 del ciclo móvil): en el teléfono esta
 * celda se funde en la misma línea que los chips de rol y estado
 * (formularios.tsx, `CardEquipo`), leída de izquierda a derecha — alinearla
 * a la derecha ahí la separaría de los chips en vez de seguirlos. En
 * escritorio sigue siendo su propia columna "Acciones", alineada a la
 * derecha como siempre.
 */
export function FilaAcciones({
  usuario,
  esUnoMismo,
  onClaveGenerada,
}: {
  usuario: UsuarioDeFila
  esUnoMismo: boolean
  /** Sube el resultado al padre: el bloque "Clave generada" vive UNA sola
   *  vez, fuera de cualquier fila (design/arandano.pen, nodo `SFTGC`), así
   *  que la fila que lo produjo no puede pintarlo ella misma. */
  onClaveGenerada: (info: { nombre: string; clave: string }) => void
}) {
  const desactivado = usuario.desactivadoEn !== null
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [estadoClave, accionClave, claveEnCurso] = useActionState(nuevaClave, INICIAL)
  const [estadoBaja, accionBaja, bajaEnCurso] = useActionState(baja, INICIAL)
  const [estadoAlta, accionAlta, altaEnCurso] = useActionState(alta, INICIAL)

  // El formulario se cierra AJUSTANDO EL ESTADO DURANTE EL RENDER, no en un
  // efecto: react-hooks/set-state-in-effect (el mismo lint que ya esquiva
  // punto-de-venta.tsx, ver su comentario sobre `ventaProcesada`) rechaza un
  // setState propio y síncrono en el cuerpo de un efecto. El guard contra
  // `ultimaClaveVista` es lo que evita el loop: sin él, cada render volvería
  // a comparar contra el mismo `estadoClave.claveGenerada` y a llamar
  // `setCambiandoClave` de nuevo.
  const [ultimaClaveVista, setUltimaClaveVista] = useState(estadoClave.claveGenerada)
  if (estadoClave.claveGenerada !== ultimaClaveVista) {
    setUltimaClaveVista(estadoClave.claveGenerada)
    if (estadoClave.claveGenerada) setCambiandoClave(false)
  }

  // Subir el resultado al padre SÍ va en un efecto: a diferencia de
  // `setCambiandoClave` de arriba (estado PROPIO), `onClaveGenerada` es
  // `setClaveGenerada` de CuerpoUsuarios —actualizar el estado de OTRO
  // componente durante el render de éste es justo lo que un efecto existe
  // para evitar (React lo rechaza directo: "Cannot update a component while
  // rendering a different component").
  useEffect(() => {
    if (estadoClave.claveGenerada) onClaveGenerada(estadoClave.claveGenerada)
    // onClaveGenerada no entra a la lista de dependencias: es un setter de
    // estado del padre, estable entre renders — agregarla dispararía el
    // linter de exhaustive-deps por una referencia que en la práctica nunca
    // cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoClave])

  if (desactivado) {
    return (
      <div className="flex flex-col items-start gap-1 lg:items-end">
        <form action={accionAlta}>
          <input type="hidden" name="usuarioId" value={usuario.id} />
          <button type="submit" disabled={altaEnCurso} className={ENLACE}>
            {altaEnCurso ? 'Reactivando…' : 'Reactivar'}
          </button>
        </form>
        {estadoAlta.error && <ErrorDeFila mensaje={estadoAlta.error} />}
        {estadoAlta.aviso && <AvisoDeFila mensaje={estadoAlta.aviso} />}
      </div>
    )
  }

  if (cambiandoClave) {
    return (
      <FormularioCambiarClave
        usuarioId={usuario.id}
        nombre={usuario.nombre}
        accion={accionClave}
        pendiente={claveEnCurso}
        onCancelar={() => setCambiandoClave(false)}
      />
    )
  }

  return (
    <div className="flex flex-col items-start gap-1 lg:items-end">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setCambiandoClave(true)} className={ENLACE}>
          Cambiar clave
        </button>
        {!esUnoMismo && (
          <>
            {/* Mismo tamaño que ENLACE (arriba): el "·" entre "Cambiar
                clave" y "Baja" es parte del mismo texto uniforme a 10px que
                dibuja la maqueta en el teléfono. */}
            <span aria-hidden="true" className="text-[10px] text-muted-foreground lg:text-xs">
              ·
            </span>
            <form action={accionBaja}>
              <input type="hidden" name="usuarioId" value={usuario.id} />
              <button type="submit" disabled={bajaEnCurso} className={ENLACE}>
                {bajaEnCurso ? 'Dando de baja…' : 'Baja'}
              </button>
            </form>
          </>
        )}
      </div>
      {estadoClave.error && <ErrorDeFila mensaje={estadoClave.error} />}
      {estadoBaja.error && <ErrorDeFila mensaje={estadoBaja.error} />}
      {estadoBaja.aviso && <AvisoDeFila mensaje={estadoBaja.aviso} />}
    </div>
  )
}
