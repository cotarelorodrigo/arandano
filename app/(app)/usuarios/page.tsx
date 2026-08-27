import { UserPlus } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { contarDuenosActivos } from '@/lib/usuarios/resumen'
import type { Permiso } from '@/lib/permisos/catalogo'
import { CuerpoUsuarios } from './formularios'

export const dynamic = 'force-dynamic'

export default async function Usuarios() {
  const sesion = await exigirDuenio()
  const usuarios = await prismaParaTenant(sesion.tenant.id).user.findMany({
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, email: true, rol: true, desactivadoEn: true },
  })

  const duenosActivos = contarDuenosActivos(usuarios)

  // Una sola consulta para todas las filas, no una por empleado: la tabla ya
  // trajo la lista entera, y N consultas más sobre un pool de 5 conexiones es
  // justo lo que no hay que hacer en una pantalla de listado.
  const filas = await prismaParaTenant(sesion.tenant.id).usuarioPermiso.findMany({
    select: { usuarioId: true, permiso: true },
  })
  const permisosPorUsuario = new Map<string, Permiso[]>()
  for (const f of filas) {
    permisosPorUsuario.set(f.usuarioId, [
      ...(permisosPorUsuario.get(f.usuarioId) ?? []),
      f.permiso as Permiso,
    ])
  }

  return (
    <>
      <Encabezado
        titulo="Usuarios"
        subtitulo={
          <>
            {usuarios.length === 1 ? '1 persona' : `${usuarios.length} personas`}
            {' · '}
            {duenosActivos === 1 ? '1 dueño activo' : `${duenosActivos} dueños activos`}
          </>
        }
        // "Agregar persona" (design/arandano.pen, nodo `tr89h`): consultado en
        // vivo, hallazgo I3 de la review final — el Topbar de esta pantalla no
        // lo tenía, sin que ninguna nota declarara por qué. No es redundante
        // con "Agregar al equipo" de la card de Alta: la maqueta dibuja los
        // dos, y éste es el que se ve sin scrollear cuando la tabla del equipo
        // es larga. Sin condicional de rol: exigirDuenio() ya restringe TODA
        // esta pantalla al dueño, a diferencia de /inventario, donde el botón
        // del Topbar sí lo necesita porque la pantalla la ve cualquiera.
        // `<a href="#alta">` y no un botón con JS: la maqueta no dibuja la
        // interacción, sólo el control, y un ancla a la card de Alta
        // (formularios.tsx, id="alta") alcanza sin sumar estado de cliente acá.
        acciones={
          <Button asChild>
            <a href="#alta">
              <UserPlus aria-hidden="true" className="size-[15px]" />
              Agregar persona
            </a>
          </Button>
        }
        // Task 10 del ciclo móvil (frame `NIyHG`, nodo `GZz1a`): el mismo
        // destino que el botón de arriba, ahora como la ranura de un solo
        // toque del teléfono. Tono 'accion' porque el botón CREA algo —mismo
        // criterio que /inventario y /servicio-tecnico—, y el mismo
        // `href="#alta"` que ya prueba el caso de arriba.
        accionMovil={{ icono: UserPlus, etiqueta: 'Agregar persona', href: '#alta', tono: 'accion' }}
      />
      {/* El cuerpo entero es un único Client Component: el bloque "Clave
          generada" (design/arandano.pen, nodo `SFTGC`) vive fuera de
          cualquier fila y puede dispararlo tanto el alta como el reseteo de
          una fila cualquiera, así que necesita un estado compartido por
          encima de los dos — ver el comentario de CuerpoUsuarios. */}
      <CuerpoUsuarios
        usuarios={usuarios}
        usuarioActualId={sesion.usuario.id}
        permisosPorUsuario={Object.fromEntries(permisosPorUsuario)}
      />
    </>
  )
}
