import { Encabezado } from '@/components/shell/encabezado'
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { contarDuenosActivos } from '@/lib/usuarios/resumen'
import { CuerpoUsuarios } from './formularios'

export const dynamic = 'force-dynamic'

export default async function Usuarios() {
  const sesion = await exigirDuenio()
  const usuarios = await prismaParaTenant(sesion.tenant.id).user.findMany({
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, email: true, rol: true, desactivadoEn: true },
  })

  const duenosActivos = contarDuenosActivos(usuarios)

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
      />
      {/* El cuerpo entero es un único Client Component: el bloque "Clave
          generada" (design/arandano.pen, nodo `SFTGC`) vive fuera de
          cualquier fila y puede dispararlo tanto el alta como el reseteo de
          una fila cualquiera, así que necesita un estado compartido por
          encima de los dos — ver el comentario de CuerpoUsuarios. */}
      <CuerpoUsuarios usuarios={usuarios} usuarioActualId={sesion.usuario.id} />
    </>
  )
}
