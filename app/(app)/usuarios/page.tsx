import { Encabezado } from '@/components/shell/encabezado'
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { contarDuenosActivos } from '@/lib/usuarios/resumen'
import { AltaDeEmpleado, AccionesDeUsuario } from './formularios'

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
      <div className="p-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Nombre</th>
              <th>Mail</th>
              <th>Rol</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="py-2">{u.nombre}</td>
                <td>{u.email}</td>
                <td>{u.rol === 'DUENO' ? 'Dueño' : 'Empleado'}</td>
                <td>{u.desactivadoEn ? 'Desactivado' : 'Activo'}</td>
                <td>
                  <AccionesDeUsuario
                    usuarioId={u.id}
                    desactivado={u.desactivadoEn !== null}
                    esUnoMismo={u.id === sesion.usuario.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AltaDeEmpleado />
      </div>
    </>
  )
}
