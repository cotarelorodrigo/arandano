import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarProvider } from '@/components/ui/sidebar'

/**
 * Lo que ve quien carga un artículo cuando el alta FALLA.
 *
 * React 19 resetea los campos no controlados de un `<form action>` cuando la
 * action termina, salga bien o mal. Sin nada más, un error vaciaba nombre,
 * precio, cantidad y SKU: la pantalla quedaba igual que después de guardar, y
 * el cartel rojo —debajo de "Datos del artículo", fuera de la vista en el
 * teléfono— no lo leía nadie. mundopcell lo reportó así (2026-09-15): "la
 * página se resetea como si se hubiera guardado, pero en inventario no
 * aparece". La salida es la del login (`app/login/acciones.ts`): la action
 * devuelve lo tipeado y los campos lo usan de `defaultValue`, que es el valor
 * al que React los restaura.
 *
 * Archivo aparte de `formularios.test.tsx` porque necesita un `useActionState`
 * que devuelva un estado elegido: el render estático no puede disparar la
 * action, y mockear `react` ahí alcanzaría a todos los casos de ese archivo.
 */
const estado = vi.hoisted(() => ({
  actual: { error: null, aviso: null } as Record<string, unknown>,
}))

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  const useActionState = () => [estado.actual, () => {}, false]
  return { ...real, default: { ...real, useActionState }, useActionState }
})
vi.mock('./acciones', () => ({
  altaArticulo: vi.fn(),
  guardarArticulo: vi.fn(),
  bajaArticulo: vi.fn(),
  reactivarArticuloAccion: vi.fn(),
  ingresarMercaderia: vi.fn(),
  corregirPorConteo: vi.fn(),
  exportarHistorialCsv: vi.fn(),
  borrarArticuloAccion: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

async function renderAlta() {
  const { FormularioDeAlta } = await import('./formularios')
  return renderToStaticMarkup(
    <SidebarProvider>
      <FormularioDeAlta proximoSku="A-0043" arbol={[]} puedeCostos />
    </SidebarProvider>,
  )
}

/** Si el radio de ese tipo sale marcado, sin depender del orden de atributos. */
function marcado(html: string, tipo: string): boolean {
  const tag = html.match(new RegExp(`<input[^>]*value="${tipo}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`no hay radio con value="${tipo}"`)
  return /\schecked(="")?[\s/>]/.test(tag)
}

/** El `value` que el HTML le da al input con ese `name`, o null si no tiene. */
function valorDe(html: string, name: string): string | null {
  const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`no hay input con name="${name}"`)
  return tag.match(/value="([^"]*)"/)?.[1] ?? null
}

const VALORES = {
  tipo: 'PRODUCTO',
  nombre: 'Motorola Edge 50',
  sku: 'MOTO-50',
  precio: '350000',
  stockInicial: '1',
  costoUnitario: '280000',
  facturaProveedor: 'A 0001-00023456',
}

describe('FormularioDeAlta después de un error', () => {
  it('los campos vuelven con lo que se había tipeado', async () => {
    estado.actual = { error: 'algo salió mal', aviso: null, valores: VALORES }
    const html = await renderAlta()
    expect(valorDe(html, 'nombre')).toBe('Motorola Edge 50')
    expect(valorDe(html, 'sku')).toBe('MOTO-50')
    expect(valorDe(html, 'precio')).toBe('350000')
    expect(valorDe(html, 'stockInicial')).toBe('1')
    expect(valorDe(html, 'costoUnitario')).toBe('280000')
    expect(valorDe(html, 'facturaProveedor')).toBe('A 0001-00023456')
  })

  // El radio también es no controlado: sin esto, un error con Servicio elegido
  // lo devolvía a Producto mientras el estado seguía diciendo Servicio.
  it('el tipo elegido vuelve marcado', async () => {
    estado.actual = { error: 'algo salió mal', aviso: null, valores: { ...VALORES, tipo: 'SERVICIO' } }
    const html = await renderAlta()
    expect(marcado(html, 'SERVICIO')).toBe(true)
    expect(marcado(html, 'PRODUCTO')).toBe(false)
  })

  it('sin valores (el alta salió bien) los campos quedan vacíos', async () => {
    estado.actual = { error: null, aviso: 'Artículo creado con el código A-0043.' }
    const html = await renderAlta()
    expect(valorDe(html, 'nombre') ?? '').toBe('')
    expect(valorDe(html, 'precio') ?? '').toBe('')
    expect(marcado(html, 'PRODUCTO')).toBe(true)
    expect(marcado(html, 'SERVICIO')).toBe(false)
  })

})

/**
 * El aviso por toast. El cartel inline vive debajo de "Datos del artículo" y
 * el botón arriba (Topbar) o en un pie fijo (teléfono): con la card de stock
 * en medio, el error existía y nadie lo leía. Un toast se ve esté donde esté
 * la persona. Se ata por fuente porque el render estático no puede disparar
 * la action — mismo criterio que abm-categorias.test.tsx.
 */
describe('FormularioDeAlta avisa por toast', () => {
  const fuente = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
  const alta = fuente.slice(
    fuente.indexOf('export function FormularioDeAlta'),
    fuente.indexOf('export function FichaDeArticulo'),
  )

  // En el handler que recibe el resultado, no en un efecto sobre el estado: la
  // lección del ABM de categorías (2026-08-24) es que un toast colgado del
  // ciclo de vida de un componente se pierde con él.
  it('el toast se lanza en el handler que ejecuta altaArticulo', () => {
    expect(alta).toMatch(
      /useActionState\(\s*async[\s\S]{0,200}await altaArticulo\([\s\S]{0,400}toast\.error\(/,
    )
    expect(alta).not.toMatch(/useEffect\(/)
  })

  // Un error dice qué corregir: si se va solo a los cuatro segundos, se lleva
  // la instrucción. El éxito no hay que releerlo.
  it('el error no se descarta solo y el éxito sí', () => {
    const error = alta.slice(alta.indexOf('toast.error('))
    expect(error.slice(0, error.indexOf(')'))).toContain('duration: Infinity')
    const exito = alta.slice(alta.indexOf('toast.success('))
    expect(exito.slice(0, exito.indexOf(')'))).not.toContain('duration')
  })

  // Clave estable: dos submits fallidos seguidos reemplazan el aviso en vez de
  // apilar dos copias del mismo texto.
  it('los dos toasts comparten una clave estable', () => {
    expect(alta).toMatch(/toast\.error\([^)]*id: 'alta-articulo'/)
    expect(alta).toMatch(/toast\.success\([^)]*id: 'alta-articulo'/)
  })
})
