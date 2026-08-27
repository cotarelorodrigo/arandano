import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { esUuid } from '@/lib/uuid'
import { ImprimirAlCargar } from './imprimir'
import { CuerpoDelTicket } from './cuerpo'

export const dynamic = 'force-dynamic'

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // Mismo guard que el detalle, y hace falta igual acá: un id sin forma de uuid
  // lo rechaza Prisma antes de consultar, y eso es un 500 en vez de un 404.
  if (!esUuid(id)) notFound()

  const prisma = prismaParaTenant(sesion.tenant.id)

  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      numero: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true, danosVisibles: true, creadoEn: true,
      cliente: { select: { nombre: true, telefono: true } },
      recibidaPor: { select: { nombre: true } },
    },
  })
  if (!orden) notFound()

  return (
    <>
      {/* Task 9 del ciclo móvil (design/arandano.pen, frame `kNPwE`): esta
          pantalla no tenía ningún encabezado antes de este ciclo, en
          ninguna de las dos maquetas — sumarlo es la novedad, no una
          regresión de aspecto en escritorio (spec
          `docs/superpowers/specs/2026-08-26-movil-design.md`, §6: "Suma el
          Topbar con printer"). `print:hidden` porque el componente no puede
          entrar al área imprimible: es la misma clase que ya usa el bloque
          de impresión de esta pantalla (ver ticket.module.css, la regla
          `@media print` que oculta el shell entero) para separar lo que se
          ve en pantalla de lo que sale por la impresora. */}
      <div className="print:hidden">
        <Encabezado
          titulo={`Ticket #${orden.numero}`}
          subtitulo="80 mm · dos copias en una impresión"
          atras={`/servicio-tecnico/${id}`}
          accionMovil={{
            icono: Printer,
            etiqueta: 'Imprimir',
            href: `/servicio-tecnico/${id}/ticket`,
            tono: 'accion',
          }}
        />
      </div>
      <ImprimirAlCargar />
      {/* La geometría de excepción del plan (Cuerpo: padding [16,44], gap 14,
          centrado) sólo tiene efecto en el teléfono: `lg:contents` la
          disuelve en escritorio (nunca existió ahí, y no hay que fingir que
          sí) y `print:contents` la disuelve al imprimir, así que el papel de
          80mm sale exactamente con el mismo margen y el mismo `.hoja`/
          `.corte` de siempre — `display: contents` borra la caja del
          envoltorio sin tocar ni reordenar a sus hijos. Ningún cambio acá
          toca cuerpo.tsx ni ticket.module.css. */}
      <div className="flex flex-col items-center gap-[14px] px-[44px] py-4 print:contents lg:contents">
        <CuerpoDelTicket orden={orden} local={sesion.tenant.nombre} />
      </div>
    </>
  )
}
