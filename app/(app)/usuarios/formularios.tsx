'use client'

import { useActionState, useEffect, useState } from 'react'
import { UserPlus, ShieldCheck } from 'lucide-react'
import { altaEmpleado, type EstadoUsuarios } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ChipRol } from './chip-rol'
import { ChipEstadoUsuario } from './chip-estado'
import { AvisoClaveGenerada } from './aviso-clave'
import { FilaAcciones, type UsuarioDeFila } from './fila-acciones'
import { PermisosDeUsuario } from './permisos-dialogo'
import type { Permiso } from '@/lib/permisos/catalogo'
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
  children,
  accesorio,
}: {
  /** El botón "Agregar persona" del Topbar (page.tsx, hallazgo I3 de la
   *  review final) apunta a `#alta`: esta card es su único destino posible. */
  id?: string
  titulo: string
  children: React.ReactNode
  /** Lo que va a la derecha del título, dentro del mismo encabezado — hoy sin
   *  uso en esta pantalla, pero deja el mismo hueco que ya usa
   *  servicio-tecnico/page.tsx para su leyenda de orden. */
  accesorio?: React.ReactNode
}) {
  return (
    <div id={id} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
        {accesorio}
      </div>
      {children}
    </div>
  )
}

/**
 * "El equipo del local" (design/arandano.pen, nodo `swCOr`): la tabla con
 * chips de rol y estado, más las acciones por fila. `usuarioActualId` decide
 * qué fila es "uno mismo" (ver fila-acciones.tsx).
 */
function CardEquipo({
  usuarios,
  usuarioActualId,
  permisosPorUsuario,
  onClaveGenerada,
}: {
  usuarios: UsuarioDeFila[]
  usuarioActualId: string
  permisosPorUsuario: Record<string, Permiso[]>
  onClaveGenerada: (info: { nombre: string; clave: string }) => void
}) {
  return (
    <CardConEncabezado titulo="El equipo del local">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead className="h-auto py-[11px] pr-[7px] pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Persona
            </TableHead>
            <TableHead className="h-auto w-[112px] px-[7px] py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Rol
            </TableHead>
            <TableHead className="h-auto w-[118px] px-[7px] py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Estado
            </TableHead>
            <TableHead className="h-auto w-[140px] px-[7px] py-[11px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Permisos
            </TableHead>
            <TableHead className="h-auto w-[180px] py-[11px] pr-[18px] pl-[7px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="py-[11px] pr-[7px] pl-[18px]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{u.nombre}</span>
                  <span className="text-[11px] text-muted-foreground">{u.email}</span>
                </div>
              </TableCell>
              <TableCell className="px-[7px] py-[11px]">
                <ChipRol rol={u.rol} />
              </TableCell>
              <TableCell className="px-[7px] py-[11px]">
                <ChipEstadoUsuario desactivado={u.desactivadoEn !== null} />
              </TableCell>
              <TableCell className="px-[7px] py-[11px]">
                {/* Un dueño no lleva switches: puede todo por construcción, y
                    un diálogo con los seis prendidos y trabados sería ruido. */}
                {u.rol === 'EMPLEADO' && (
                  <PermisosDeUsuario usuario={u} permisos={permisosPorUsuario[u.id] ?? []} />
                )}
              </TableCell>
              <TableCell className="py-[11px] pr-[18px] pl-[7px] text-right">
                <FilaAcciones
                  usuario={u}
                  esUnoMismo={u.id === usuarioActualId}
                  onClaveGenerada={onClaveGenerada}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
          "Empleado" a propósito, que es el default más común. */}
      <form action={accion} className="flex flex-col gap-[14px] p-[18px]">
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
        <Button type="submit" disabled={pendiente} className="h-[38px] rounded-[9px]">
          <UserPlus aria-hidden="true" className="size-[15px]" />
          {pendiente ? 'Agregando…' : 'Agregar al equipo'}
        </Button>
      </form>
    </CardConEncabezado>
  )
}

/**
 * "Dos reglas que el sistema no deja romper" (design/arandano.pen, nodo
 * `U7ROu`): texto fijo, pero NO inventado — las dos reglas existen de verdad
 * en `lib/usuarios/administrar.ts` (el lock del último dueño en
 * `desactivar()`, y el `session.deleteMany` de `resetearClave()`). Esta card
 * no las reimplementa, sólo las cuenta.
 *
 * Consultado en vivo con el MCP de Pencil: a diferencia de los otros dos
 * títulos de card de esta pantalla, este título usa `$ar-font` (13px/700),
 * NO `$ar-display` — el relevamiento escrito lo agrupaba con los otros dos,
 * pero el `.pen` manda. Por eso no importa `estilos.tituloDeCard` acá.
 */
function CardReglas() {
  return (
    <div className="flex flex-col gap-[9px] rounded-2xl border bg-card p-[18px]">
      <p className="text-[13px] font-bold text-foreground">Dos reglas que el sistema no deja romper</p>
      <div className="flex gap-[9px]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-primary" />
        <p className="text-xs leading-[1.45] text-foreground-soft">
          Nunca puede quedar el local sin un dueño activo.
        </p>
      </div>
      <div className="flex gap-[9px]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[14px] shrink-0 text-primary" />
        <p className="text-xs leading-[1.45] text-foreground-soft">
          Resetear una contraseña cierra todas las sesiones de esa persona — incluida la tuya, si te la
          cambiás a vos.
        </p>
      </div>
    </div>
  )
}

/**
 * El cuerpo entero de /usuarios (design/arandano.pen, nodo `NQhvT`), en
 * cliente: el bloque "Clave generada" tiene que vivir en un solo lugar sin
 * importar si lo disparó el alta o el reseteo de una fila, y eso pide un
 * estado compartido por encima de ambos — algo que un Server Component no
 * puede sostener.
 */
export function CuerpoUsuarios({
  usuarios,
  usuarioActualId,
  permisosPorUsuario,
}: {
  usuarios: UsuarioDeFila[]
  usuarioActualId: string
  permisosPorUsuario: Record<string, Permiso[]>
}) {
  const [claveGenerada, setClaveGenerada] = useState<{ nombre: string; clave: string } | null>(null)

  return (
    <div className="flex gap-4 p-6">
      <div className="flex flex-1 flex-col gap-4">
        <CardEquipo
          usuarios={usuarios}
          usuarioActualId={usuarioActualId}
          permisosPorUsuario={permisosPorUsuario}
          onClaveGenerada={setClaveGenerada}
        />
        {claveGenerada && <AvisoClaveGenerada nombre={claveGenerada.nombre} clave={claveGenerada.clave} />}
      </div>
      <div className="flex w-[360px] flex-col gap-4">
        <AltaDeEmpleado onClaveGenerada={setClaveGenerada} />
        <CardReglas />
      </div>
    </div>
  )
}
