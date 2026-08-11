import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearPrecio, formatearFecha } from '@/lib/formato/mostrar'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

/**
 * El día de hoy en Buenos Aires, como `YYYY-MM-DD`.
 *
 * El servidor está en Ashburn: `new Date()` a las 22:00 de Buenos Aires ya es
 * el día siguiente en UTC, así que "las ventas de hoy" mostraría las de mañana
 * y ninguna de las de la tarde. El huso va declarado, igual que en
 * `formatearFecha`.
 */
function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** `YYYY-MM-DD` al instante en que ese día empieza en Buenos Aires (UTC-3). */
function inicioDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`)
}

export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string }>
}) {
  const sesion = await exigirSesion()
  const { desde, hasta, p = '1' } = await searchParams

  const hoy = hoyEnArgentina()
  const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
  // Una fecha malformada cae en hoy en vez de romper el `new Date`, igual que
  // el clamp de `?p` del listado de inventario: un query string escrito a mano
  // no puede servir un 500.
  const dDesde = desde && ES_FECHA.test(desde) ? desde : hoy
  const dHasta = hasta && ES_FECHA.test(hasta) ? hasta : hoy
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)

  const donde = {
    creadoEn: {
      gte: inicioDelDia(dDesde),
      // El día "hasta" entra entero: se corta al inicio del siguiente.
      lt: new Date(inicioDelDia(dHasta).getTime() + 24 * 60 * 60 * 1000),
    },
  }

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [ventas, total, suma] = await Promise.all([
    prisma.venta.findMany({
      where: donde,
      orderBy: { numero: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
        usuario: { select: { nombre: true } },
      },
    }),
    prisma.venta.count({ where: donde }),
    // El total del período NO suma las anuladas: una venta anulada no es plata
    // que entró. Se dice en pantalla para que nadie tenga que deducirlo.
    prisma.venta.aggregate({ where: { ...donde, anuladaEn: null }, _sum: { total: true } }),
  ])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conPagina = (n: number) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (n > 1) u.set('p', String(n))
    return `/ventas?${u.toString()}`
  }

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-medium">Ventas</h1>
        <Button asChild size="sm">
          <Link href="/vender">Vender</Link>
        </Button>
      </div>

      {/* method="get": anda sin JavaScript y una URL con el rango se comparte. */}
      <form method="get" className="mb-6 flex items-end gap-3">
        <div className="flex flex-col gap-2">
          <label htmlFor="desde" className="text-sm font-medium">Desde</label>
          <Input id="desde" name="desde" type="date" defaultValue={dDesde} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="hasta" className="text-sm font-medium">Hasta</label>
          <Input id="hasta" name="hasta" type="date" defaultValue={dHasta} />
        </div>
        <Button type="submit" size="sm" variant="secondary">Filtrar</Button>
      </form>

      {ventas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay ventas en ese período.
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2">Número</th>
                <th scope="col">Fecha</th>
                <th scope="col">Vendió</th>
                <th scope="col" className="text-right">Total</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className="border-b">
                  <td className="py-2">
                    <Link href={`/ventas/${v.id}`} className="underline">#{v.numero}</Link>
                  </td>
                  <td>{formatearFecha(v.creadoEn)}</td>
                  <td>{v.usuario.nombre}</td>
                  <td className="text-right tabular-nums">{formatearPrecio(v.total.toString())}</td>
                  {/* Las anuladas se MUESTRAN: el historial tiene que poder
                      responder qué pasó, y esconderlas sería tapar la respuesta. */}
                  <td className={v.anuladaEn ? 'text-destructive' : undefined}>
                    {v.anuladaEn ? 'Anulada' : 'Cobrada'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 text-sm tabular-nums">
            Total del período, sin contar las anuladas:{' '}
            <span className="font-medium">
              {formatearPrecio((suma._sum.total ?? '0').toString())}
            </span>
          </p>
        </>
      )}

      {paginas > 1 && (
        <nav aria-label="Paginación" className="mt-6 flex items-center gap-4 text-sm">
          {pagina > 1 && <Link href={conPagina(pagina - 1)} className="underline">← Anterior</Link>}
          <span className="text-muted-foreground">Página {pagina} de {paginas}</span>
          {pagina < paginas && <Link href={conPagina(pagina + 1)} className="underline">Siguiente →</Link>}
        </nav>
      )}
    </main>
  )
}
