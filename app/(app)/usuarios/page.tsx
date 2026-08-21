import { Encabezado } from '@/components/shell/encabezado'
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { AltaDeEmpleado, AccionesDeUsuario } from './formularios'

export const dynamic = 'force-dynamic'

export default async function Usuarios() {
  const sesion = await exigirDuenio()
  const usuarios = await prismaParaTenant(sesion.tenant.id).user.findMany({
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, email: true, rol: true, desactivadoEn: true },
  })

  // Contado en memoria y no con un `count` aparte: la lista completa ya está
  // acá, y sumar una consulta nueva por un número que sale de lo que ya se
  // trajo sería duplicar el viaje a la base.
  const duenosActivos = usuarios.filter((u) => u.rol === 'DUENO' && !u.desactivadoEn).length

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
      <main className="p-6">
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
      </main>
    </>
  )
}
