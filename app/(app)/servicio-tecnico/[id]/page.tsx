import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { formatearFecha, formatearPrecio } from '@/lib/formato/mostrar'
import { TRANSICIONES, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { moverEstado, diagnosticar, anular } from '../acciones'
import { FormularioEstado, FormularioDiagnostico, FormularioAnular } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function DetalleDeOrden({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  const prisma = prismaParaTenant(sesion.tenant.id)

  // findFirst y no findUnique: con un id que no tiene forma de uuid, findUnique
  // tira un error crudo de Prisma —un 500— en vez de no encontrar nada.
  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      id: true, numero: true, estado: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true, danosVisibles: true,
      diagnostico: true, montoEstimado: true,
      anuladaEn: true, creadoEn: true,
      cliente: { select: { nombre: true, telefono: true } },
      recibidaPor: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      eventos: {
        orderBy: { creadoEn: 'asc' },
        select: {
          id: true, desde: true, hasta: true, nota: true, creadoEn: true,
          usuario: { select: { nombre: true } },
        },
      },
    },
  })
  if (!orden) notFound()

  const anulada = orden.anuladaEn !== null

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Orden #{orden.numero} · {NOMBRE_ESTADO[orden.estado]}
        </h1>
        <Button asChild variant="secondary">
          <Link href={`/servicio-tecnico/${orden.id}/ticket`}>Reimprimir ticket</Link>
        </Button>
      </div>

      {anulada ? (
        <p className="mt-3 text-sm">
          Anulada por {orden.anuladaPor?.nombre ?? 'alguien'} el{' '}
          {formatearFecha(orden.anuladaEn!)}.
        </p>
      ) : null}

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-medium">Cliente</h2>
          <p>{orden.cliente.nombre}</p>
          {orden.cliente.telefono ? (
            // tel: y no texto suelto: es el gesto que se hace cuando el equipo
            // queda listo, y desde el teléfono llama con un toque.
            <a href={`tel:${orden.cliente.telefono}`} className="text-sm underline">
              {orden.cliente.telefono}
            </a>
          ) : null}
        </div>
        <div>
          <h2 className="font-medium">Equipo</h2>
          <p>
            {orden.equipoMarca} {orden.equipoModelo}
          </p>
          {orden.equipoSerie ? (
            <p className="font-mono text-sm text-muted-foreground">{orden.equipoSerie}</p>
          ) : null}
          {orden.claveDesbloqueo ? (
            <p className="text-sm">Clave: {orden.claveDesbloqueo}</p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <h2 className="font-medium">Falla declarada</h2>
          <p className="whitespace-pre-wrap">{orden.fallaDeclarada}</p>
          {orden.accesorios ? <p className="text-sm">Accesorios: {orden.accesorios}</p> : null}
          {orden.danosVisibles ? (
            <p className="text-sm">Daños visibles: {orden.danosVisibles}</p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            Recibido por {orden.recibidaPor.nombre} el {formatearFecha(orden.creadoEn)}
          </p>
        </div>
      </section>

      {!anulada ? (
        <>
          <section className="mt-8">
            <h2 className="font-medium">Mover la orden</h2>
            <div className="mt-3">
              <FormularioEstado
                accion={moverEstado}
                ordenId={orden.id}
                siguientes={TRANSICIONES[orden.estado]}
                nombres={NOMBRE_ESTADO}
              />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-medium">Diagnóstico y presupuesto</h2>
            <div className="mt-3">
              <FormularioDiagnostico
                accion={diagnosticar}
                ordenId={orden.id}
                diagnostico={orden.diagnostico ?? ''}
                montoEstimado={orden.montoEstimado ? String(orden.montoEstimado) : ''}
              />
            </div>
            {orden.montoEstimado ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Presupuestado: {formatearPrecio(String(orden.montoEstimado))}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="mt-8">
        <h2 className="font-medium">Qué pasó</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {orden.eventos.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">{formatearFecha(e.creadoEn)}</span>{' '}
              {e.desde === null
                ? 'Recibido'
                : `${NOMBRE_ESTADO[e.desde]} → ${NOMBRE_ESTADO[e.hasta]}`}{' '}
              <span className="text-muted-foreground">· {e.usuario.nombre}</span>
              {e.nota ? <span className="block text-muted-foreground">{e.nota}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {/* Sólo el dueño. La action lo reexige con exigirDuenio: esconder el
          botón no es un permiso, es una comodidad. */}
      {sesion.usuario.rol === 'DUENO' && !anulada ? (
        <section className="mt-8 border-t pt-4">
          <FormularioAnular accion={anular} ordenId={orden.id} />
        </section>
      ) : null}
    </main>
  )
}
