import Link from 'next/link'
import { Search } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatearCantidad } from '@/lib/formato/mostrar'
import { ESTADOS, ABIERTOS, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { filtroDelTablero } from '@/lib/ordenes-de-trabajo/buscar'
import { fechaCorta, diasEnElLocal } from '@/lib/ordenes-de-trabajo/antiguedad'
import { ChipEstadoFila } from './chip-estado'
import type { EstadoOrden } from '@/generated/prisma/client'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

export function esEstado(v: string | undefined): v is EstadoOrden {
  return v !== undefined && (ESTADOS as readonly string[]).includes(v)
}

/**
 * El href de una navegación del tablero que preserva la búsqueda vigente.
 * `estado: null` es "sin filtro" (todas las abiertas). El chip "Abiertas" NO
 * pasa por acá — ver el comentario de `FilaDeChips`, donde se arma a mano.
 */
export function hrefTablero({
  busqueda,
  estado,
  pagina,
}: {
  busqueda: string
  estado: EstadoOrden | null
  pagina?: number
}): string {
  const u = new URLSearchParams()
  if (busqueda) u.set('q', busqueda)
  if (estado) u.set('estado', estado)
  if (pagina && pagina > 1) u.set('p', String(pagina))
  const s = u.toString()
  return s ? `/servicio-tecnico?${s}` : '/servicio-tecnico'
}

/**
 * Cuántas órdenes cuenta el chip "Abiertas": la suma de TODOS los estados
 * abiertos, nunca la de lo que el filtro actual muestra en pantalla —si
 * contara lo filtrado, elegir "Listo" pondría el resto en cero y no se
 * podría volver—. Es la decisión ya tomada del módulo que el brief de esta
 * task pide no tocar. Pura y exportada para poder probarla sin base: lo que
 * importa es que ENTREGADO no sume, no cómo llegó el Map.
 */
export function contarAbiertas(cuenta: ReadonlyMap<EstadoOrden, number>): number {
  return ABIERTOS.reduce((a, e) => a + (cuenta.get(e) ?? 0), 0)
}

/**
 * "hoy" / "hace 1 día" / "hace N días" — la secundaria de la columna
 * INGRESÓ (design/arandano.pen, nodo `X4oBSe`: "hace 23 días"). Sin el
 * sufijo "en el local" que sí lleva el subtítulo de /servicio-tecnico/[id]:
 * acá la fila ya está adentro del tablero del local, repetirlo en cada fila
 * sería ruido.
 */
export function rotuloAntiguedad(dias: number): string {
  if (dias === 0) return 'hoy'
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

/**
 * El subtítulo del Topbar (design/arandano.pen, nodo `Flr5I`): "N equipos en
 * el local · el más viejo hace N días". El dato es de ESTA pantalla —el
 * Topbar sólo pinta lo que se le pasa (components/shell/encabezado.tsx)—,
 * así que la cuenta vive acá. El propio comentario que dejó el ciclo
 * anterior en este archivo pedía completarlo "en el ciclo del tablero", que
 * es este.
 *
 * `undefined` con el local vacío o sin ninguna abierta: "0 equipos en el
 * local · el más viejo hace NaN días" es peor que no decir nada, mismo
 * criterio que ya usa /inventario con su propio subtítulo.
 */
export function subtituloDelTablero(abiertas: number, diasDelMasViejo: number | null): string | undefined {
  if (abiertas === 0 || diasDelMasViejo === null) return undefined
  const equipos = abiertas === 1 ? '1 equipo' : `${abiertas} equipos`
  const antiguedad =
    diasDelMasViejo === 0
      ? 'el más viejo, hoy'
      : diasDelMasViejo === 1
        ? 'el más viejo hace 1 día'
        : `el más viejo hace ${diasDelMasViejo} días`
  return `${equipos} en el local · ${antiguedad}`
}

/**
 * Qué palabra usa el resumen de rango del pie del listado, según si se está
 * mirando el default (abiertas), un chip puntual, o una búsqueda sin chip
 * (que alcanza a todas, entregadas y anuladas incluidas).
 */
export function etiquetaDelConjunto(
  filtro: EstadoOrden | null,
  buscandoEnTodas: boolean,
  total: number,
): string {
  if (buscandoEnTodas) return total === 1 ? 'orden' : 'órdenes'
  if (filtro) return total === 1 ? `orden «${NOMBRE_ESTADO[filtro]}»` : `órdenes «${NOMBRE_ESTADO[filtro]}»`
  return total === 1 ? 'orden abierta' : 'órdenes abiertas'
}

/** "1–18 de 18 órdenes abiertas" (design/arandano.pen, nodo `CpIri`). */
export function rotuloDeRango(
  desde: number,
  hasta: number,
  total: number,
  filtro: EstadoOrden | null,
  buscandoEnTodas: boolean,
): string {
  return `${formatearCantidad(String(desde))}–${formatearCantidad(String(hasta))} de ${formatearCantidad(
    String(total),
  )} ${etiquetaDelConjunto(filtro, buscandoEnTodas, total)}`
}

/**
 * "Las entregadas no se listan por defecto" (design/arandano.pen, nodo
 * `acCj8`) — sólo tiene sentido en el default exacto que la maqueta dibuja:
 * sin chip y sin búsqueda. Con un chip puntual o buscando en todas, la
 * frase deja de ser cierta (ya se está viendo, o se puede ver, alguna
 * entregada), y no hay ningún texto que la reemplace: la maqueta no
 * promete una nota para cada estado posible del pie.
 */
export function notaDelConjunto(filtro: EstadoOrden | null, buscandoEnTodas: boolean): string | null {
  return filtro === null && !buscandoEnTodas ? 'Las entregadas no se listan por defecto' : null
}

/**
 * Hasta 5 números de página centrados en `actual`, recortados a `[1, total]`.
 *
 * Copiado de `app/(app)/ventas/page.tsx` / `app/(app)/inventario/page.tsx`
 * (mismo nombre, mismo cuerpo): es chico y autocontenido, y esta task no es
 * el ciclo que extrae el duplicado a un lib compartido — mismo criterio que
 * ya dejó anotado /inventario.
 */
export function ventanaDePaginas(actual: number, total: number): number[] {
  if (total <= 0) return []
  const tam = Math.min(5, total)
  const inicioCentrado = actual - Math.floor(tam / 2)
  const fin = Math.min(total, Math.max(tam, inicioCentrado + tam - 1))
  const inicio = fin - tam + 1
  const out: number[] = []
  for (let n = inicio; n <= fin; n++) out.push(n)
  return out
}

/**
 * La celda ESTADO de una fila del listado (hallazgo I5 de la review final):
 * anulada primero, en neutro —la orden conserva el estado que tenía, anular
 * es una columna y no un estado, así que pintar el chip de color de ese
 * estado (por ejemplo, "Listo" en verde) mentiría sobre una orden que ya no
 * está viva—; viva, el chip de color e ícono de `ChipEstadoFila`. Extraída a
 * su propio componente EXPORTADO y no dejada como el ternario inline que
 * había antes: ese ternario tenía un test cuyo nombre prometía "no usa el
 * chip de color" pero cuyo cuerpo sólo comprobaba `toContain('o.anuladaEn ?')`
 * —una mutación que igualaba las dos ramas seguía en verde—, y una función
 * que se puede renderizar de verdad con `renderToStaticMarkup` es lo que
 * permite probar QUÉ se pinta, no que el código tenga forma de ternario.
 */
export function CeldaDeEstado({ estado, anulada }: { estado: EstadoOrden; anulada: boolean }) {
  if (anulada) {
    return (
      <Badge className="h-auto gap-[5px] border-transparent bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-muted-foreground">
        Anulada ({NOMBRE_ESTADO[estado]})
      </Badge>
    )
  }
  return <ChipEstadoFila estado={estado} />
}

/**
 * Un chip de la fila de filtro (design/arandano.pen, nodo `G5b3dG`): "Abiertas"
 * y los nueve estados. Dos variables visuales, no una por estado —a
 * diferencia de `ChipEstadoFila`, que sí varía por estado—: si está
 * SELECCIONADO (fill sólido `--primary`, texto blanco) y si su conteo es
 * CERO (todo en `--muted-foreground`). Seleccionado gana siempre sobre cero:
 * la maqueta no dibuja un chip seleccionado en cero, pero elegir "mostrame
 * lo que estoy mirando" importa más que "está vacío".
 *
 * El texto blanco sobre `--primary` sale de `Badge` (su variante `default`,
 * components/ui/badge.tsx) por `asChild`, y no de escribir la clase de
 * Tailwind para "el texto que va sobre --primary" acá: ese token —el que
 * shadcn usa para pintar el botón de acción— sólo puede nombrarse dentro de
 * components/ui/ (test/sistema-de-diseno.test.ts, "nadie toma [ese token]
 * por 'el color claro'"). Badge ya lo trae adentro; este archivo no
 * necesita repetirlo.
 */
function ChipDeFiltro({
  href,
  rotulo,
  cuenta,
  seleccionado,
}: {
  href: string
  rotulo: string
  cuenta: number
  seleccionado: boolean
}) {
  if (seleccionado) {
    return (
      <Badge
        asChild
        className="h-auto gap-[7px] rounded-full border-transparent px-3 py-[7px] text-xs font-semibold"
      >
        <Link href={href} aria-current="true">
          {rotulo}
          <span className={cn(estilos.archivo, 'text-xs font-bold')} style={{ color: 'var(--marca-soft)' }}>
            {formatearCantidad(String(cuenta))}
          </span>
        </Link>
      </Badge>
    )
  }

  const cero = cuenta === 0
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-[7px] rounded-full border border-input bg-card px-3 py-[7px] text-xs font-medium',
        cero ? 'text-muted-foreground' : 'text-foreground-soft',
      )}
    >
      {rotulo}
      <span
        className={cn(estilos.archivo, 'text-xs font-bold', cero ? 'text-muted-foreground' : 'text-foreground')}
      >
        {formatearCantidad(String(cuenta))}
      </span>
    </Link>
  )
}

/**
 * La fila de chips de filtro completa: "Abiertas" más un chip por estado, en
 * el orden que design/arandano.pen dibuja —`ESTADOS`, que desde este ciclo
 * termina en ENTREGADO (ver su comentario en lib/ordenes-de-trabajo/
 * estados.ts)—.
 */
export function FilaDeChips({
  abiertas,
  cuenta,
  filtro,
  buscandoEnTodas,
  busqueda,
}: {
  abiertas: number
  cuenta: Partial<Record<EstadoOrden, number>>
  filtro: EstadoOrden | null
  buscandoEnTodas: boolean
  busqueda: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* "Abiertas" no pasa por hrefTablero: promete volver al tablero por
          defecto, y ese default no lleva búsqueda — arrastrar `q` dejaría el
          href idéntico a la URL actual durante una búsqueda, un chip que no
          hace nada. Decisión ya tomada del módulo, de antes de este rediseño. */}
      <ChipDeFiltro
        href="/servicio-tecnico"
        rotulo="Abiertas"
        cuenta={abiertas}
        seleccionado={filtro === null && !buscandoEnTodas}
      />
      {ESTADOS.map((e) => (
        <ChipDeFiltro
          key={e}
          href={hrefTablero({ busqueda, estado: e })}
          rotulo={NOMBRE_ESTADO[e]}
          cuenta={cuenta[e] ?? 0}
          seleccionado={filtro === e}
        />
      ))}
    </div>
  )
}

export default async function ServicioTecnico({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; estado?: string }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', estado } = await searchParams

  const busqueda = q.trim()
  // Truncado y con techo, igual que /inventario: `?p=2.3` daría un skip con
  // decimales y `?p=1e300` uno fuera del rango de un Int, y Prisma rechaza los
  // dos con un error que nadie atrapa — o sea un 500 desde un query string.
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const filtro = esEstado(estado) ? estado : null

  const prisma = prismaParaTenant(sesion.tenant.id)
  // Por defecto las abiertas; buscando, todas —incluidas las entregadas y las
  // anuladas—. El porqué, largo, vive en lib/ordenes-de-trabajo/buscar.ts, que
  // es también donde el buscador recorta el número para que un IMEI no tire
  // abajo la consulta.
  const donde = filtroDelTablero(busqueda, filtro)

  const [ordenes, total, porEstado, masViejo] = await Promise.all([
    prisma.ordenDeTrabajo.findMany({
      where: donde,
      // La MÁS VIEJA PRIMERO, al revés que /ventas. En ventas lo último es lo
      // que importa; acá lo que duele es el equipo que lleva tres semanas en el
      // estante.
      orderBy: { creadoEn: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        numero: true,
        estado: true,
        equipoMarca: true,
        equipoModelo: true,
        // La columna EQUIPO lleva el IMEI como secundaria (design/arandano.pen,
        // nodo `OMn73`): sin este campo la fila no lo podía mostrar.
        equipoSerie: true,
        creadoEn: true,
        // Para rotular la fila: con la búsqueda alcanzando a las anuladas, una
        // fila sin marca no se distingue de una viva.
        anuladaEn: true,
        // La columna CLIENTE lleva el teléfono como secundaria (nodo
        // `n5eXN0`): antes sólo se pedía el nombre.
        cliente: { select: { nombre: true, telefono: true } },
      },
    }),
    prisma.ordenDeTrabajo.count({ where: donde }),
    // Los contadores hablan de TODAS las órdenes vivas, no de lo que el filtro
    // muestra: si contaran lo filtrado, elegir "Listo" pondría el resto en cero
    // y no se podría volver.
    prisma.ordenDeTrabajo.groupBy({
      by: ['estado'],
      where: { anuladaEn: null },
      _count: { _all: true },
    }),
    // El subtítulo del Topbar ("N equipos en el local · el más viejo hace N
    // días"): el equipo abierto más viejo. Mismo conjunto —abiertas, no
    // anuladas— que "abiertas" cuenta más abajo, para que las dos cifras del
    // subtítulo hablen del mismo grupo de órdenes.
    prisma.ordenDeTrabajo.aggregate({
      where: { anuladaEn: null, estado: { in: [...ABIERTOS] } },
      _min: { creadoEn: true },
    }),
  ])

  const cuenta = new Map(porEstado.map((f) => [f.estado, f._count._all]))
  // El chip sin filtro cuenta las ABIERTAS y no la suma de todos los estados:
  // es el que devuelve al listado por defecto, así que su número tiene que ser
  // el de ese listado. Por eso se suma sobre ABIERTOS y no sobre `cuenta`.
  const abiertas = contarAbiertas(cuenta)
  const cuentaPorEstado = Object.fromEntries(cuenta) as Partial<Record<EstadoOrden, number>>
  const diasDelMasViejo = masViejo._min.creadoEn ? diasEnElLocal(masViejo._min.creadoEn) : null
  // Cuando se busca sin chip, el listado se sale de los chips: no hay ninguno
  // que esté "actual", y decirlo evita que el resultado parezca filtrado.
  const buscandoEnTodas = busqueda !== '' && filtro === null
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const desde = (pagina - 1) * POR_PAGINA + 1
  const hasta = Math.min(pagina * POR_PAGINA, total)

  return (
    <>
      <Encabezado
        titulo="Servicio Técnico"
        subtitulo={subtituloDelTablero(abiertas, diasDelMasViejo)}
        acciones={
          <Button asChild>
            <Link href="/servicio-tecnico/nuevo">Recibir un equipo</Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <FilaDeChips
          abiertas={abiertas}
          cuenta={cuentaPorEstado}
          filtro={filtro}
          buscandoEnTodas={buscandoEnTodas}
          busqueda={busqueda}
        />

        {/* Buscador (design/arandano.pen, nodo `xzSwb`): SIN botón "Buscar" a
            propósito. Es un solo campo de texto: Enter alcanza para
            submitearlo, sin JavaScript, porque un <form> con un único input
            de texto lo hace nativo — al revés que el checkbox "Ver
            desactivados" de /inventario, que sí necesita un botón explícito
            porque tildarlo solo no dispara nada. La Ayuda de al lado (nodo
            `GR38Q`) es PERMANENTE y distinta del aviso condicional de más
            abajo: ésta explica siempre qué alcanza el buscador; el de abajo
            avisa una vez que ya se está buscando en todas las órdenes, con
            un link para volver — algo que la maqueta no dibuja pero que
            sigue haciendo falta (su silencio no es instrucción de sacarlo). */}
        <form action="/servicio-tecnico" className="flex items-center gap-[10px]">
          {filtro ? <input type="hidden" name="estado" value={filtro} /> : null}
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={busqueda}
              aria-label="Buscar por número, cliente, modelo o IMEI"
              placeholder="Número, cliente, modelo o IMEI"
              className="h-10 rounded-[9px] border-input bg-card pl-9 text-sm"
            />
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Buscar alcanza también a las entregadas y anuladas
          </span>
        </form>

        {buscandoEnTodas ? (
          <p className="text-sm text-muted-foreground">
            Buscando «{busqueda}» en todas las órdenes, incluidas las entregadas y las anuladas.{' '}
            <Link href="/servicio-tecnico" className="underline">
              Volver a las abiertas
            </Link>
          </p>
        ) : null}

        {/* El listado, dentro de su propia card (design/arandano.pen, nodo
            `j6hWoH`) — antes era un <ul> suelto en la pantalla. */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
            <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Equipos en el local</h2>
            <span className="text-xs font-semibold text-primary">
              Ordenadas por antigüedad · la más vieja primero
            </span>
          </div>

          {ordenes.length === 0 ? (
            <p className="p-[18px] text-sm text-muted-foreground">
              {buscandoEnTodas
                ? `No apareció ninguna orden con «${busqueda}».`
                : 'No hay equipos que mostrar con estos filtros.'}
            </p>
          ) : (
            <>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="h-auto w-[78px] px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Orden
                    </TableHead>
                    <TableHead className="h-auto px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Equipo
                    </TableHead>
                    <TableHead className="h-auto w-[190px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Cliente
                    </TableHead>
                    <TableHead className="h-auto w-[150px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Ingresó
                    </TableHead>
                    <TableHead className="h-auto w-[170px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Estado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenes.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell
                        className={cn(
                          estilos.archivo,
                          'p-[11px] px-[7px] pl-[18px] text-sm font-bold text-primary',
                        )}
                      >
                        <Link href={`/servicio-tecnico/${o.id}`}>#{o.numero}</Link>
                      </TableCell>
                      <TableCell className="p-[11px] px-[7px] whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">
                            {o.equipoMarca} {o.equipoModelo}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {o.equipoSerie ? `IMEI ${o.equipoSerie}` : 'Sin IMEI'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="p-[11px] px-[7px] whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{o.cliente.nombre}</span>
                          <span className="text-[11px] text-muted-foreground">{o.cliente.telefono ?? '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="p-[11px] px-[7px]">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{fechaCorta(o.creadoEn)}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {rotuloAntiguedad(diasEnElLocal(o.creadoEn))}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="p-[11px] px-[7px] pr-[18px] text-right">
                        <CeldaDeEstado estado={o.estado} anulada={o.anuladaEn !== null} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Paginación (nodo `kF1ZK`): rango + nota cuando entra en una
                  sola página —el estado que la maqueta dibuja—, y números de
                  página en vez de la nota cuando no entra. La maqueta no
                  muestra este segundo caso (18 órdenes de un tope de 50 nunca
                  paginan), pero omitir la navegación de verdad dejaría sin
                  forma de llegar a una orden más allá de la primera página —
                  la pregunta ante el silencio del .pen es qué pierde el
                  producto si se saca, no si el archivo lo dibuja. */}
              <nav
                aria-label="Paginación"
                className="mt-auto flex items-center justify-between border-t px-[18px] py-3"
              >
                <span className="text-xs text-muted-foreground">
                  {rotuloDeRango(desde, hasta, total, filtro, buscandoEnTodas)}
                </span>
                {paginas > 1 ? (
                  <div className="flex items-center gap-[6px]">
                    {ventanaDePaginas(pagina, paginas).map((n) =>
                      n === pagina ? (
                        <Button
                          key={n}
                          type="button"
                          aria-current="page"
                          size="icon-sm"
                          className={cn(estilos.archivo, 'size-[30px] rounded-lg text-[13px] font-semibold')}
                        >
                          {n}
                        </Button>
                      ) : (
                        <Button
                          key={n}
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={cn(
                            estilos.archivo,
                            'size-[30px] rounded-lg text-[13px] font-semibold text-foreground-soft',
                          )}
                        >
                          <Link href={hrefTablero({ busqueda, estado: filtro, pagina: n })}>{n}</Link>
                        </Button>
                      ),
                    )}
                  </div>
                ) : (
                  notaDelConjunto(filtro, buscandoEnTodas) && (
                    <span className="text-[11px] text-muted-foreground">
                      {notaDelConjunto(filtro, buscandoEnTodas)}
                    </span>
                  )
                )}
              </nav>
            </>
          )}
        </div>
      </div>
    </>
  )
}
