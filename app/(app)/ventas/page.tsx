import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearPrecio, formatearFecha, formatearCantidad } from '@/lib/formato/mostrar'

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

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * La fecha del query string, o hoy.
 *
 * Chequea el `Date` construido y no sólo la forma de los dígitos: `2026-13-45`
 * pasa cualquier regex de `\d{4}-\d{2}-\d{2}` y después da un `Invalid Date`
 * que Prisma rechaza sin que nadie lo atrape — un 500 servido desde algo que
 * alguien tipeó en la barra de direcciones. Es el mismo criterio que el clamp
 * de `?p`: lo malformado cae al default, no explota.
 */
function fechaOhoy(valor: string | undefined, hoy: string): string {
  if (!valor || !ES_FECHA.test(valor)) return hoy
  return Number.isNaN(inicioDelDia(valor).getTime()) ? hoy : valor
}

/**
 * `YYYY-MM-DD` → "13 de agosto de 2026".
 *
 * Con el huso declarado, por lo mismo que `hoyEnArgentina`: sin él, el
 * `Date` de medianoche argentina se formatea en UTC y muestra el día anterior.
 */
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(iso))
}

/**
 * Un tile del resumen del período.
 *
 * Van sobre --card y no sobre el fondo: es la superficie elevada que ya define
 * el sistema, y es lo que los separa del listado de abajo sin sumar un borde.
 */
function Tile({ rotulo, valor, pie }: { rotulo: string; valor: string; pie?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[10px] font-medium tracking-[0.1em] text-primary uppercase">
        {rotulo}
      </div>
      {/* tabular-nums en los tres, no sólo en el de plata: los tiles están uno
          al lado del otro y un dígito de ancho variable los descalza entre sí. */}
      <div className="mt-0.5 text-2xl tracking-tight tabular-nums">{valor}</div>
      {pie && <div className="mt-0.5 text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  )
}

export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string }>
}) {
  const sesion = await exigirSesion()
  const { desde, hasta, p = '1' } = await searchParams

  const hoy = hoyEnArgentina()
  // Una fecha malformada cae en hoy en vez de romper el `new Date`, igual que
  // el clamp de `?p` del listado de inventario: un query string escrito a mano
  // no puede servir un 500.
  const dDesde = fechaOhoy(desde, hoy)
  const dHasta = fechaOhoy(hasta, hoy)
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)

  const donde = {
    creadoEn: {
      gte: inicioDelDia(dDesde),
      // El día "hasta" entra entero: se corta al inicio del siguiente.
      lt: new Date(inicioDelDia(dHasta).getTime() + 24 * 60 * 60 * 1000),
    },
  }

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [ventas, total, suma, anuladas] = await Promise.all([
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
    // Se cuentan las anuladas y NO las cobradas: cobradas = total - anuladas es
    // aritmética sobre dos números que ya vienen de la misma transacción, así
    // que no puede dar una suma que no cierre contra el listado.
    prisma.venta.count({ where: { ...donde, anuladaEn: { not: null } } }),
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
        <div>
          <h1 className="text-xl font-medium">Ventas</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {dDesde === dHasta ? fechaLarga(dDesde) : `${fechaLarga(dDesde)} — ${fechaLarga(dHasta)}`}
            {/* El conteo sólo si hay algo que contar, igual que el subtítulo de
                /inventario y por la misma razón: un "· 0 ventas" arriba del
                "No hay ventas en ese período" es ruido al lado de un texto de
                vacío que ya lo dice. Dos pantallas del mismo ciclo no pueden
                contestar distinto la misma pregunta. */}
            {total > 0 && (
              <>
                {' · '}
                {total === 1 ? '1 venta' : `${formatearCantidad(String(total))} ventas`}
              </>
            )}
          </p>
        </div>
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

      {/* Sobre `total`, que es el período, y NO sobre `ventas.length`, que es la
          página: los tres números que muestran estos tiles —total, suma y
          anuladas— salen de agregados sin paginar. Colgados de la página, un
          `/ventas?p=5` sobre un período de una sola página los hacía
          desaparecer, cuando lo que resumen sigue estando ahí. */}
      {total > 0 && (
        /* gap-px sobre bg-border: las líneas entre tiles son el fondo que se
           ve por las juntas, no tres bordes que haya que hacer coincidir.
           w-max para que los tiles midan lo que necesitan y no se estiren a
           lo ancho de la pantalla, que los dejaría vacíos por dentro. */
        <div className="mb-6 grid w-max grid-cols-3 gap-px overflow-hidden rounded-lg bg-border">
          <Tile
            rotulo="Total del período"
            valor={formatearPrecio((suma._sum.total ?? '0').toString())}
            pie="sin contar las anuladas"
          />
          {/* Los conteos con el mismo formateo de miles que la plata de al lado:
              un local que cruza las mil ventas en el período existe, y "1000"
              al lado de "$ 412.850,00" se lee como un número mal impreso. */}
          <Tile rotulo="Ventas cobradas" valor={formatearCantidad(String(total - anuladas))} />
          <Tile rotulo="Anuladas" valor={formatearCantidad(String(anuladas))} />
        </div>
      )}

      {ventas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {/* Los dos vacíos no son el mismo vacío, y desde que los tiles cuelgan
              del período hay que distinguirlos: con `total > 0` la página quedó
              fuera de rango (`?p` se clampea a [1, 1.000.000], no a `paginas`),
              y decir "no hay ventas en ese período" arriba de un tile que dice
              17 sería contradecirse en la misma pantalla. */}
          {total === 0 ? (
            'No hay ventas en ese período.'
          ) : (
            <>
              Esa página no tiene ventas.{' '}
              {/* Con el enlace y no sólo con el texto: cuando el período entra en
                  una sola página, `paginas > 1` es falso y la paginación de abajo
                  no se dibuja, así que sin esto la pantalla queda sin salida. */}
              <Link href={conPagina(1)} className="underline">
                Volver a la primera
              </Link>
              .
            </>
          )}
        </p>
      ) : (
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
                    responder qué pasó, y esconderlas sería tapar la respuesta.
                    Chip y no texto suelto: en una columna de una sola palabra,
                    la forma se lee antes que el color, y quien no distingue el
                    rojo igual ve que una fila está marcada. */}
                <td>
                  {v.anuladaEn ? (
                    <span className="inline-flex rounded-md border border-destructive px-2.5 py-0.5 text-[11px] text-destructive">
                      Anulada
                    </span>
                  ) : (
                    <span className="inline-flex rounded-md bg-muted px-2.5 py-0.5 text-[11px]">
                      Cobrada
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
