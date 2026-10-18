import Link from 'next/link'
import { ChevronRight, Contact, Search } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exigirSesion } from '@/lib/auth/sesion'
import { clientesDelListado, type ClienteDelListado } from '@/lib/clientes/consultar'
import { formatearFechaCorta } from '@/lib/formato/mostrar'
import { BotonExportarClientes, DialogoDeClienteNuevo } from './formularios'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

/**
 * Cuántos clientes muestra el listado de una vez. Sin paginar a propósito: el
 * listado es para encontrar a alguien, y para eso está el buscador. Pasado el
 * tope, la pantalla lo dice ("Se ven los primeros 200 de 640: buscá para
 * encontrar al resto") en vez de cortar en silencio. El CSV no tiene tope.
 */
export const TOPE_DEL_LISTADO = 200

/** Un cliente del listado, ya resuelto a texto: lo que `ListadoDeClientes`
 *  recibe, sin `Date` cruzando a un fixture de test. */
export type FilaDeCliente = {
  id: string
  nombre: string
  /** Teléfono y email juntos, el que haya: "11 2233-4455 · ana@gmail.com". */
  contacto: string | null
  aceptaOfertas: boolean
  compras: string
  alta: string
  ultimaCompra: string | null
}

export function filaDeCliente(c: ClienteDelListado): FilaDeCliente {
  const contacto = [c.telefono, c.email].filter((x): x is string => !!x).join(' · ')
  return {
    id: c.id,
    nombre: c.nombre,
    contacto: contacto === '' ? null : contacto,
    aceptaOfertas: c.aceptaOfertas,
    compras: c.compras === 1 ? '1 compra' : `${c.compras} compras`,
    alta: formatearFechaCorta(c.creadoEn),
    ultimaCompra: c.ultimaCompra ? formatearFechaCorta(c.ultimaCompra) : null,
  }
}

/**
 * Lo que la pantalla le dice a quien la mira, según qué haya: vacío sin
 * clientes, vacío con un filtro que no encontró a nadie, o el aviso del tope.
 */
export function avisoDelListado(f: {
  mostrados: number
  total: number
  filtrando: boolean
}): string | null {
  if (f.total === 0 && !f.filtrando) return null
  if (f.total === 0) return 'Nadie coincide con la búsqueda.'
  if (f.mostrados < f.total) {
    return `Se ven los primeros ${f.mostrados} de ${f.total}: buscá para encontrar al resto.`
  }
  return null
}

/**
 * La fila de filtros: el buscador y "Aceptan ofertas" en un `<form method="get">`
 * propio con su "Buscar", por el mismo motivo escrito en `FiltrosDeInventario`
 * (app/(app)/inventario/page.tsx): un checkbox solo no dispara nada al
 * tildarlo, y sin submit explícito el filtro sólo se aplicaba con Enter en el
 * buscador. Nativo, no el `Checkbox` de shadcn: funciona sin JavaScript.
 *
 * "Exportar CSV" al lado, sólo para el dueño, con la búsqueda y el filtro ya
 * APLICADOS (los de la URL, no lo que esté tipeado sin buscar): exporta lo que
 * la pantalla muestra.
 */
export function FiltrosDeClientes({
  busqueda,
  soloOfertas,
  puedeExportar,
}: {
  busqueda: string
  soloOfertas: boolean
  puedeExportar: boolean
}) {
  return (
    <div className="flex flex-col gap-[10px] lg:flex-row lg:items-center">
      <form method="get" className="flex flex-col gap-[10px] lg:flex-1 lg:flex-row lg:items-center">
        <div className="relative lg:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            name="q"
            defaultValue={busqueda}
            aria-label="Buscar por nombre, teléfono o email"
            placeholder="Buscar por nombre, teléfono o email"
            className="h-10 w-full rounded-[9px] border-input bg-card pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-[10px] lg:contents">
          <label className="flex h-10 flex-1 items-center gap-2 rounded-[9px] border border-input bg-card px-[13px] text-[13px] font-normal text-foreground-soft lg:flex-initial">
            <input
              type="checkbox"
              name="ofertas"
              value="1"
              defaultChecked={soloOfertas}
              className="size-[15px] rounded-[4px] border-input accent-primary"
            />
            Aceptan ofertas
          </label>
          <Button type="submit" size="sm" variant="secondary" className="h-10">
            Buscar
          </Button>
        </div>
      </form>
      {puedeExportar && <BotonExportarClientes texto={busqueda} soloAceptanOfertas={soloOfertas} />}
    </div>
  )
}

/**
 * El listado: una fila por cliente, enlazada a su ficha.
 *
 * Filas y no `<Table>`: en el teléfono una tabla de seis columnas scrollea de
 * costado adentro de su card (la deuda de `/formas-de-pago`, entrada 22 del
 * documento de correcciones del .pen); una fila que apila nombre y contacto a
 * la izquierda y compras a la derecha entra en 390 px sin scroll y en
 * escritorio sigue leyéndose como una lista de contactos.
 *
 * "Acepta ofertas" es un chip chico al lado del nombre, sólo cuando es sí: el
 * filtro de arriba ya da la lista completa, y un "No" en cada fila sería ruido
 * en la mayoría.
 */
export function ListadoDeClientes({ filas, aviso }: { filas: FilaDeCliente[]; aviso: string | null }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Clientes del local</h2>
      </div>
      {filas.length === 0 && aviso === null ? (
        <SinClientes />
      ) : (
        <>
          {aviso && <p className="border-b px-[14px] py-2.5 text-xs text-muted-foreground lg:px-[18px]">{aviso}</p>}
          <ul className="flex flex-col divide-y">
            {filas.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clientes/${c.id}`}
                  className="flex items-center gap-3 px-[14px] py-[11px] transition-colors hover:bg-muted/50 lg:px-[18px]"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{c.nombre}</span>
                      {c.aceptaOfertas && (
                        <span className="shrink-0 rounded-full bg-ok-soft px-2 py-px text-[10px] font-semibold text-ok">
                          Acepta ofertas
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{c.contacto ?? 'Sin teléfono ni email'}</span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                    <span className="text-[13px] font-medium text-foreground tabular-nums">{c.compras}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {c.ultimaCompra ? `Última ${c.ultimaCompra}` : `Alta ${c.alta}`}
                    </span>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Qué se ve sin ningún cliente: lo que dice dónde nacen. */
export function SinClientes() {
  return (
    <div className="flex flex-col items-center gap-2 px-[18px] py-12 text-center">
      <Contact aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Todavía no hay clientes</p>
      <p className="max-w-[420px] text-xs leading-[1.5] text-muted-foreground">
        Se cargan solos al cobrar: en Vender, el campo «Cliente» del cobro. También al recibir un
        equipo en Servicio Técnico, o con «Cliente nuevo».
      </p>
    </div>
  )
}

/**
 * /clientes: quienes le compraron al local, para buscarlos, corregirlos y
 * exportarlos. **El cliente nace al cobrar** (spec 2026-10-18-clientes-design.md,
 * "El principio"); esta pantalla no es donde se los carga en el día a día.
 *
 * **Cualquier usuario con sesión** la ve y la usa; "Exportar CSV" (y borrar, en
 * la ficha) sólo el dueño, y las actions lo re-exigen.
 *
 * `q` y `ofertas` en la URL, como el buscador de `/inventario`: la búsqueda se
 * comparte por link y sobrevive a un F5.
 */
export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; ofertas?: string | string[] }>
}) {
  const sesion = await exigirSesion()
  const params = await searchParams
  // Un parámetro repetido llega como lista: se toma el primero en vez de
  // romper la pantalla.
  const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''
  const busqueda = primero(params.q).trim()
  const soloOfertas = primero(params.ofertas) === '1'

  const { clientes, total } = await clientesDelListado(
    sesion.tenant.id,
    { texto: busqueda, soloAceptanOfertas: soloOfertas },
    TOPE_DEL_LISTADO,
  )
  const filtrando = busqueda !== '' || soloOfertas

  return (
    <>
      <Encabezado
        titulo="Clientes"
        subtitulo={filtrando ? `${total} encontrados` : total === 1 ? '1 cliente' : `${total} clientes`}
        acciones={<DialogoDeClienteNuevo />}
        controlMovil={<DialogoDeClienteNuevo movil />}
      />
      <div className="flex flex-col gap-3 p-[14px] lg:gap-4 lg:p-6">
        <FiltrosDeClientes
          busqueda={busqueda}
          soloOfertas={soloOfertas}
          puedeExportar={sesion.usuario.rol === 'DUENO'}
        />
        <ListadoDeClientes
          filas={clientes.map(filaDeCliente)}
          aviso={avisoDelListado({ mostrados: clientes.length, total, filtrando })}
        />
      </div>
    </>
  )
}
