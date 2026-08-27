'use client'

import { useActionState, useEffect, useState } from 'react'
import { UserPlus, ShieldCheck } from 'lucide-react'
import { altaEmpleado, type EstadoUsuarios } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChipRol } from './chip-rol'
import { ChipEstadoUsuario } from './chip-estado'
import { AvisoClaveGenerada } from './aviso-clave'
import { FilaAcciones, type UsuarioDeFila } from './fila-acciones'
import estilos from './tipografia.module.css'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en app/login/formulario.tsx.
const INICIAL: EstadoUsuarios = { error: null, aviso: null, claveGenerada: null }

/** Avisos simples (error de la action, o una confirmación de texto plano
 *  como "Usuario reactivado."): el `Alert` de shadcn, que ya trae
 *  `role="alert"`. El aviso de clave generada NO pasa por acá — tiene su
 *  propio componente ámbar, ver aviso-clave.tsx. */
function Resultado({ estado }: { estado: EstadoUsuarios }) {
  if (estado.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{estado.error}</AlertDescription>
      </Alert>
    )
  }
  if (estado.aviso) {
    return (
      <Alert>
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
    )
  }
  return null
}

/**
 * Una card con encabezado en Archivo + contenido (design/arandano.pen, nodos
 * `swCOr`/`G7FEq`, cada uno con el mismo par Encabezado/Contenido). Copiada y
 * no importada de otra pantalla: cada una arma la suya, mismo criterio que
 * `CardConEncabezado` en servicio-tecnico/formularios.tsx y
 * `CardDelFormulario` en inventario/formularios.tsx.
 */
function CardConEncabezado({
  id,
  titulo,
  tituloClassName,
  plano,
  children,
  accesorio,
}: {
  /** El botón "Agregar persona" del Topbar (page.tsx, hallazgo I3 de la
   *  review final) apunta a `#alta`: esta card es su único destino posible. */
  id?: string
  titulo: string
  /** Ronda de arreglos 1: `CardReglas` paga una cara distinta de las otras
   *  dos cards (ver tipografia.module.css) — sin esta prop, la única forma
   *  de dársela hubiera sido duplicar el header entero a mano, en vez de
   *  reusar el mismo padding [12,14]/[13,18] mobile-first que ya vale para
   *  las tres. Default `estilos.tituloDeCard`, el de siempre. */
  tituloClassName?: string
  /**
   * Ronda de arreglos 2 (Crítico): a diferencia de `swCOr`/`G7FEq` ("El
   * equipo del local"/"Agregar a alguien"), cuyo nodo de ESCRITORIO ya tiene
   * el mismo header separado por borde que el teléfono, el nodo de
   * escritorio de "Dos reglas" (`U7ROu`) es un frame PLANO: título y los dos
   * puntos como hermanos directos, `gap:9`/`padding:18`, sin sub-frame de
   * encabezado ni borde interno — sólo el `stroke` exterior de la card
   * entera. Reusar este componente tal cual (como hizo la Ronda 1) le pegó
   * el `border-b` y el padding [13,18] del header a una card que en
   * escritorio nunca los tuvo.
   *
   * `plano` reconstruye ese frame plano SÓLO a partir de `lg:`, sin tocar el
   * teléfono (que sí quiere el header separado, igual que las otras dos
   * cards): en escritorio cancela el borde (`lg:border-b-0`) y reparte el
   * padding vertical entre el header (`lg:pt-[18px] lg:pb-0`, para que
   * empiece los 18px de arriba) y el gap del contenedor raíz
   * (`lg:gap-[9px]`, para el salto entre título y el primer punto) — el
   * contenido, del lado de quien llama, tiene que hacer lo mismo del otro
   * lado (`lg:pt-0`), ver `CardReglas`. Sin esta prop (default), el
   * comportamiento de "El equipo del local"/"Agregar a alguien" no cambia:
   * siguen con `lg:py-[13px]` y su borde, igual que siempre.
   */
  plano?: boolean
  children: React.ReactNode
  /** Lo que va a la derecha del título, dentro del mismo encabezado — hoy sin
   *  uso en esta pantalla, pero deja el mismo hueco que ya usa
   *  servicio-tecnico/page.tsx para su leyenda de orden. */
  accesorio?: React.ReactNode
}) {
  return (
    <div
      id={id}
      className={`flex flex-col overflow-hidden rounded-2xl border bg-card ${plano ? 'lg:gap-[9px]' : ''}`}
    >
      {/* Mobile-first (Task 10 del ciclo móvil, nodos `nd3Fx`/`Q5UJWP`/`SgnAN`
          del frame `NIyHG`): padding [12,14] en el teléfono; el de escritorio
          (13/18) es el que ya tenía este header para las dos cards que NO
          pasan `plano` — sin tocar. */}
      <div
        className={`flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] ${
          plano ? 'lg:border-b-0 lg:pt-[18px] lg:pb-0' : 'lg:py-[13px]'
        }`}
      >
        <h2 className={`${tituloClassName ?? estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
        {accesorio}
      </div>
      {children}
    </div>
  )
}

/**
 * "El equipo del local" (design/arandano.pen, nodo `swCOr` en escritorio,
 * `u1UYe` en el frame móvil `NIyHG`): el patrón grid + `display:contents` de
 * la Task 4 (ver el docblock de `Listado` en app/(app)/ventas/page.tsx),
 * exportado para poder renderizarlo suelto en un test (Task 10, lección 1 del
 * brief: "extraé el listado como componente puro y renderizable").
 * `usuarioActualId` decide qué fila es "uno mismo" (ver fila-acciones.tsx).
 *
 * Anchuras del grid de escritorio: las mismas que declaraban los
 * `<TableHead>` de antes — sin ancho propio (1fr) para Persona, 112/118/180
 * para Rol/Estado/Acciones.
 *
 * A diferencia de app/(app)/servicio-tecnico/page.tsx (que tiene que
 * DUPLICAR su chip de estado porque el orden de columnas de escritorio no
 * coincide con el orden que el teléfono necesita), acá no hace falta
 * duplicar nada: el orden de escritorio —Persona, Rol, Estado, Acciones— YA
 * es el orden que pide el teléfono (nombre+mail, chip de rol, chip de
 * estado, acciones). Rol, Estado y Acciones se agrupan en un envoltorio
 * `lg:contents` propio (nodo `hfAYV`, "Chips": rol + estado + acciones en su
 * propia línea, `alignItems: center`) que se disuelve en escritorio en sus
 * tres celdas de siempre.
 *
 * El avatar (nodos `daaCM`/`f70Wo` para dueños, `qeoqq`/`he7DG` para
 * empleados) es enteramente nuevo y sólo existe en el teléfono (`lg:hidden`):
 * el escritorio nunca mostró un avatar en la columna Persona y no puede
 * empezar a mostrarlo ahora ("el escritorio no puede cambiar de aspecto"). La
 * inicial es la primera letra del nombre — no es un dato nuevo, sólo recorta
 * uno que `User` ya trae.
 */
export function CardEquipo({
  usuarios,
  usuarioActualId,
  onClaveGenerada,
}: {
  usuarios: UsuarioDeFila[]
  usuarioActualId: string
  onClaveGenerada: (info: { nombre: string; clave: string }) => void
}) {
  return (
    <CardConEncabezado titulo="El equipo del local">
      <div role="table" className="grid grid-cols-1 lg:grid-cols-[1fr_112px_118px_180px]">
        <div role="row" className="hidden lg:contents">
          <div role="columnheader" className="bg-muted py-[11px] pr-[7px] pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Persona
          </div>
          <div role="columnheader" className="bg-muted px-[7px] py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Rol
          </div>
          <div role="columnheader" className="bg-muted px-[7px] py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Estado
          </div>
          <div role="columnheader" className="bg-muted py-[11px] pr-[18px] pl-[7px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Acciones
          </div>
        </div>

        {usuarios.map((u) => (
          <div
            key={u.id}
            role="row"
            className="group flex items-center gap-[10px] border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
          >
            {/* Avatar: sólo en el teléfono, ver el docblock de arriba. */}
            <div
              aria-hidden="true"
              className={`flex size-[34px] shrink-0 items-center justify-center rounded-full lg:hidden ${
                u.rol === 'DUENO' ? 'bg-accent text-primary' : 'bg-muted text-foreground-soft'
              }`}
            >
              <span className={`${estilos.archivo} text-[14px] font-semibold`}>
                {u.nombre.trim().charAt(0).toUpperCase()}
              </span>
            </div>

            {/* "Datos+chips": se disuelve en escritorio en las celdas
                Persona, Rol, Estado y Acciones — ver el docblock. */}
            <div className="flex min-w-0 flex-1 flex-col gap-[3px] lg:contents">
              <div
                role="cell"
                className="lg:border-b lg:py-[11px] lg:pr-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{u.nombre}</span>
                  <span className="text-[11px] text-muted-foreground">{u.email}</span>
                </div>
              </div>

              {/* "Chips" (nodo `hfAYV`): rol + estado + acciones, en su
                  propia línea en el teléfono; disuelto en escritorio, donde
                  vuelven a ser las celdas Rol (112px), Estado (118px) y
                  Acciones (180px) de siempre. */}
              <div className="flex flex-wrap items-center gap-1.5 lg:contents">
                <div
                  role="cell"
                  className="lg:border-b lg:px-[7px] lg:py-[11px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <div className="lg:flex lg:h-full lg:items-center">
                    <ChipRol rol={u.rol} />
                  </div>
                </div>
                <div
                  role="cell"
                  className="lg:border-b lg:px-[7px] lg:py-[11px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <div className="lg:flex lg:h-full lg:items-center">
                    <ChipEstadoUsuario desactivado={u.desactivadoEn !== null} />
                  </div>
                </div>
                <div
                  role="cell"
                  className="lg:border-b lg:py-[11px] lg:pr-[18px] lg:pl-[7px] lg:text-right lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  {/* El separador "·" (nodo `hfAYV` > "Acciones": "·
                      Cambiar clave", "· Cambiar clave · Baja", "·
                      Reactivar") es cosmético pero el .pen lo dibuja en las
                      TRES filas del ejemplo — manda sobre el checklist de la
                      task, que no lo mencionaba. Sólo en el teléfono
                      (`lg:hidden`): en escritorio esta celda nunca llevó
                      separador. */}
                  <div className="flex items-center gap-1 lg:h-full lg:justify-end">
                    <span aria-hidden="true" className="text-[10px] text-muted-foreground lg:hidden">
                      ·
                    </span>
                    <FilaAcciones
                      usuario={u}
                      esUnoMismo={u.id === usuarioActualId}
                      onClaveGenerada={onClaveGenerada}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </CardConEncabezado>
  )
}

/**
 * "Agregar a alguien" (design/arandano.pen, nodo `G7FEq`): el rol pasa de
 * `<select>` nativo a un control segmentado (ToggleGroup de shadcn, agregado
 * en el Step 1 de esta task) — la maqueta pide dos pastillas
 * Empleado/Dueño, no un desplegable.
 *
 * `onClaveGenerada` sube el resultado al mismo lugar que las filas de la
 * tabla: el bloque ámbar vive una sola vez, debajo de "El equipo del local",
 * sin importar si lo disparó un alta o un reseteo.
 */
export function AltaDeEmpleado({
  onClaveGenerada,
}: {
  onClaveGenerada: (info: { nombre: string; clave: string }) => void
}) {
  const [estado, accion, pendiente] = useActionState(altaEmpleado, INICIAL)
  const [rol, setRol] = useState<'EMPLEADO' | 'DUENO'>('EMPLEADO')

  // En un efecto y no durante el render: llamar a onClaveGenerada (que es
  // setClaveGenerada del padre, ver CuerpoUsuarios) directo en el cuerpo del
  // componente actualizaría el estado de OTRO componente a mitad del render
  // de éste — exactamente lo que un efecto existe para evitar. Mismo
  // mecanismo que fila-acciones.tsx usa para el mismo problema.
  useEffect(() => {
    if (estado.claveGenerada) onClaveGenerada(estado.claveGenerada)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  return (
    <CardConEncabezado id="alta" titulo="Agregar a alguien">
      {/* Sin reset manual: desde React 19, un <form action={...}> resetea los
          campos no controlados por su cuenta cuando la action termina bien,
          así que nombre/mail/clave no quedan pegados tras un alta exitosa. El
          rol SÍ es controlado (useState) y no lo toca ese reset — se deja en
          "Empleado" a propósito, que es el default más común.
          Mobile-first (Task 10, nodo `rodaD` del frame `NIyHG`): gap 12,
          padding 14 en el teléfono; el de escritorio (gap 14, padding 18) es
          el que ya tenía este formulario. */}
      <form action={accion} className="flex flex-col gap-3 p-[14px] lg:gap-[14px] lg:p-[18px]">
        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="nombre" className="text-[11px] font-semibold text-foreground-soft">
            Nombre y apellido
          </Label>
          <Input id="nombre" name="nombre" required className="h-10 rounded-[9px]" />
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="email" className="text-[11px] font-semibold text-foreground-soft">
            Mail
          </Label>
          <Input id="email" name="email" type="email" required className="h-10 rounded-[9px]" />
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label className="text-[11px] font-semibold text-foreground-soft">Rol</Label>
          <input type="hidden" name="rol" value={rol} />
          <ToggleGroup
            type="single"
            value={rol}
            onValueChange={(valor) => {
              // Radix manda '' al declickear el ítem ya seleccionado — un
              // toggle de un solo valor nunca puede quedar en "ninguno", así
              // que un valor vacío se ignora en vez de vaciar `rol`.
              if (valor === 'EMPLEADO' || valor === 'DUENO') setRol(valor)
            }}
            className="w-full gap-0.5 rounded-[10px] bg-muted p-[3px]"
          >
            <ToggleGroupItem
              value="EMPLEADO"
              className="flex-1 rounded-lg text-xs font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground"
            >
              Empleado
            </ToggleGroupItem>
            <ToggleGroupItem
              value="DUENO"
              className="flex-1 rounded-lg text-xs font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground"
            >
              Dueño
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="clave" className="text-[11px] font-semibold text-foreground-soft">
            Contraseña inicial
          </Label>
          {/* minLength 8 acompaña al chequeo del servidor, no lo reemplaza: la
              validación del navegador se saltea con dos clicks. */}
          <Input
            id="clave"
            name="clave"
            type="text"
            minLength={8}
            required
            placeholder="mínimo 8 caracteres"
            className="h-10 rounded-[9px]"
          />
        </div>
        {estado.error && <Resultado estado={estado} />}
        {/* Ronda de arreglos 1 (Importante 3, nodo `FDeDS`): alto 48/radio
            11/gap 8 en el teléfono; `lg:gap-1.5` repone el `gap-1.5` que el
            botón ya traía de fábrica (`size: 'default'` de Button, ver
            components/ui/button.tsx) y que un `gap-2` suelto sin `lg:`
            hubiera pisado también en escritorio. */}
        <Button
          type="submit"
          disabled={pendiente}
          className="h-12 gap-2 rounded-[11px] lg:h-[38px] lg:gap-1.5 lg:rounded-[9px]"
        >
          <UserPlus aria-hidden="true" className="size-[15px]" />
          {pendiente ? 'Agregando…' : 'Agregar al equipo'}
        </Button>
      </form>
    </CardConEncabezado>
  )
}

/**
 * "Dos reglas que el sistema no deja romper" (design/arandano.pen, nodo
 * `U7ROu` en escritorio, `gfLvS` en el frame móvil `NIyHG`): texto fijo,
 * pero NO inventado — las dos reglas existen de verdad en
 * `lib/usuarios/administrar.ts` (el lock del último dueño en `desactivar()`,
 * y el `session.deleteMany` de `resetearClave()`). Esta card no las
 * reimplementa, sólo las cuenta.
 *
 * Consultado en vivo con el MCP de Pencil: a diferencia de los otros dos
 * títulos de card de esta pantalla, este título usa `$ar-font` (13px/700) en
 * ESCRITORIO, NO `$ar-display` — el relevamiento escrito lo agrupaba con los
 * otros dos, pero el `.pen` manda.
 *
 * Ronda de arreglos 1 (Importante 1) del ciclo móvil: esta card había
 * quedado como un bloque plano, sin un solo `lg:`, mientras el nodo móvil la
 * rediseña entera — encabezado separado por borde (mismo padding [12,14]
 * mobile-first que ya usan "El equipo del local" y "Agregar a alguien", de
 * ahí que ahora SÍ reuse `CardConEncabezado`) + Contenido (gap 12, padding
 * 14). El título usa `estilos.tituloDeReglas` —no `estilos.tituloDeCard`—
 * porque el teléfono INVIERTE la excepción de arriba: en `NIyHG` este mismo
 * título paga Archivo/14/600, y el `@media` de ese módulo es lo que lo
 * revierte a 13/700 sin Archivo en escritorio, sin tocar lo que ya había
 * (ver el comentario del propio módulo). El ícono también invierte color y
 * tamaño respecto de escritorio: `$ar-ok`/15px en el teléfono,
 * `$ar-primary`/14px en escritorio (sin cambios ahí).
 *
 * Exportada, mismo criterio que `CardEquipo`: un componente puro y
 * renderizable sin Prisma ni sesión.
 */
export function CardReglas() {
  return (
    <CardConEncabezado
      titulo="Dos reglas que el sistema no deja romper"
      tituloClassName={estilos.tituloDeReglas}
      // Ronda de arreglos 2 (Crítico): `plano` reconstruye el frame plano de
      // escritorio (`U7ROu`) — ver el comentario de la prop en
      // CardConEncabezado para el porqué completo.
      plano
    >
      {/* `lg:pt-0`: el `lg:pt-[18px]` del header (con `plano`) más el
          `lg:gap-[9px]` del contenedor raíz ya ponen los 18px de arriba del
          título y los 9px de salto hasta acá — un `lg:pt-[18px]` propio acá
          sumaría un padding de más que el frame `U7ROu` no tiene. */}
      <div className="flex flex-col gap-3 p-[14px] lg:gap-[9px] lg:px-[18px] lg:pt-0 lg:pb-[18px]">
        <div className="flex gap-[9px]">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-[15px] shrink-0 text-ok lg:size-[14px] lg:text-primary"
          />
          <p className="text-xs leading-[1.45] text-foreground-soft">
            Nunca puede quedar el local sin un dueño activo.
          </p>
        </div>
        <div className="flex gap-[9px]">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-[15px] shrink-0 text-ok lg:size-[14px] lg:text-primary"
          />
          <p className="text-xs leading-[1.45] text-foreground-soft">
            Resetear una contraseña cierra todas las sesiones de esa persona — incluida la tuya, si te la
            cambiás a vos.
          </p>
        </div>
      </div>
    </CardConEncabezado>
  )
}

/**
 * El cuerpo entero de /usuarios (design/arandano.pen, nodo `NQhvT` en
 * escritorio, `k7F13E` en el frame móvil `NIyHG`), en cliente: el bloque
 * "Clave generada" tiene que vivir en un solo lugar sin importar si lo
 * disparó el alta o el reseteo de una fila, y eso pide un estado compartido
 * por encima de ambos — algo que un Server Component no puede sostener.
 *
 * Mobile-first (Task 10 del ciclo móvil): en escritorio esto son dos
 * columnas (Equipo+Aviso a la izquierda, Alta+Reglas a la derecha, 360px
 * fijos) — sin cambios. Pero `k7F13E` dibuja las CUATRO piezas como
 * hermanas directas, una sola lista con gap 12 uniforme, y en un orden
 * distinto: el Aviso va PRIMERO, antes que "El equipo del local" —al
 * revés que en escritorio, donde vive debajo de la tabla, en la misma
 * columna—.
 *
 * **Por qué `order-N` y no simplemente apilar las dos columnas de
 * escritorio con `flex-col lg:flex-row`** (que es lo que el checklist de la
 * task, literal, sólo pedía para Alta+Reglas): apilar las columnas TAL CUAL
 * habría dejado dos defectos frente a `k7F13E` — el Aviso en el orden de
 * escritorio (después de la tabla, adentro de la columna de Equipo) en vez
 * de primero, y un gap MEZCLADO (16px entre Equipo y Aviso, heredado del
 * `gap-4` interno de esa columna, contra 12px entre el resto de las piezas).
 * Esto no es capricho ni sobre-ingeniería: es lo que el `.pen` dibuja, y acá
 * "el `.pen` manda" —incluso sobre la propia lista de casos de la task,
 * que es un resumen y no el límite—.
 *
 * El mecanismo es el mismo `contents` (sin `lg:`) + `order-N`/`lg:order-none`
 * que ya usa `FichaDeArticulo` (app/(app)/inventario/formularios.tsx, ver su
 * comentario) para este problema exacto — no es una técnica nueva inventada
 * para esta pantalla, es el patrón ya establecido en el repo: los dos
 * envoltorios de columna llevan `contents` a secas, así que en CUALQUIER
 * ancho menor a `lg` se disuelven y sus hijos pasan a ser ítems planos del
 * flex-col de afuera —de ahí que el gap-3 de afuera quede uniforme entre las
 * cuatro piezas, sin el 16px mezclado del párrafo de arriba—; `lg:flex
 * lg:flex-col` los vuelve a armar en columna recién en escritorio. Cada
 * pieza lleva el `order-N` que le toca en el teléfono (Aviso=1, Equipo=2,
 * Alta=3, Reglas=4) sin tocar su lugar real en el DOM, que sigue siendo el
 * de escritorio (Equipo antes que Aviso, Alta antes que Reglas) —
 * `lg:order-none` cancela el reorden ahí, así que escritorio no cambia de
 * aspecto.
 */
export function CuerpoUsuarios({
  usuarios,
  usuarioActualId,
}: {
  usuarios: UsuarioDeFila[]
  usuarioActualId: string
}) {
  const [claveGenerada, setClaveGenerada] = useState<{ nombre: string; clave: string } | null>(null)

  return (
    <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
      <div className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4">
        <div className="order-2 lg:order-none">
          <CardEquipo usuarios={usuarios} usuarioActualId={usuarioActualId} onClaveGenerada={setClaveGenerada} />
        </div>
        {claveGenerada && (
          <div className="order-1 lg:order-none">
            <AvisoClaveGenerada nombre={claveGenerada.nombre} clave={claveGenerada.clave} />
          </div>
        )}
      </div>
      <div className="contents lg:flex lg:flex-col lg:w-[360px] lg:shrink-0 lg:gap-4">
        <div className="order-3 lg:order-none">
          <AltaDeEmpleado onClaveGenerada={setClaveGenerada} />
        </div>
        <div className="order-4 lg:order-none">
          <CardReglas />
        </div>
      </div>
    </div>
  )
}
