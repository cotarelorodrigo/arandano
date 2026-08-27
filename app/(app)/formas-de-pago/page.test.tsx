import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import type { PlanVisible } from '@/lib/planes/consultar'

// Mismo patrón que app/(app)/layout.test.tsx: la sesión y la consulta son
// detalle de otros módulos (lib/permisos/guarda.test.ts, lib/planes/*), y acá
// sólo importa QUÉ renderiza la pantalla con unos planes dados. `precioConPlan`
// y `Prisma.Decimal` NO se mockean: el ejemplo derivado es justamente lo que
// este archivo tiene que ver salir bien.
const exigirPermiso = vi.fn()
vi.mock('@/lib/permisos/guarda', () => ({
  exigirPermiso: (permiso: string) => exigirPermiso(permiso),
}))

const planesDelTenant = vi.fn()
vi.mock('@/lib/planes/consultar', () => ({
  planesDelTenant: (tenantId: string, opciones?: unknown) => planesDelTenant(tenantId, opciones),
}))

// Los controles del cliente (diálogo, acciones de fila) no aportan nada acá y
// arrastran Radix y sonner al render. Se dejan como marcadores para poder
// afirmar que la pantalla los coloca.
vi.mock('./formularios', async (original) => {
  const real = await original<typeof import('./formularios')>()
  return { ...real, DialogoDePlan: () => <span>DIALOGO</span> }
})

async function render() {
  const { default: FormasDePago } = await import('./page')
  return renderToStaticMarkup(await FormasDePago())
}

const PLAN: PlanVisible = {
  id: '00000000-0000-4000-8000-000000000001',
  nombre: 'Crédito 3 cuotas',
  medio: 'TARJETA_CREDITO',
  cuotas: 3,
  porcentaje: '40',
  orden: 3,
  desactivadoEn: null,
}

describe('/formas-de-pago', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirPermiso.mockReset()
    planesDelTenant.mockReset()
    exigirPermiso.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'DUENO' },
      subdominio: 'prueba',
    })
    planesDelTenant.mockResolvedValue([PLAN])
  })

  // La pantalla exige el permiso además de cada action: sin esto, un empleado
  // sin PLANES_PAGO vería la tabla entera aunque no pudiera tocar nada.
  it('exige PLANES_PAGO antes de mostrar nada', async () => {
    await render()
    expect(exigirPermiso).toHaveBeenCalledWith('PLANES_PAGO')
  })

  // Los dados de baja son parte del historial del local y hay que poder
  // reactivarlos desde acá: si la pantalla los pidiera sin ellos, la
  // reactivación no tendría fila desde dónde dispararse.
  it('pide también los planes dados de baja', async () => {
    await render()
    expect(planesDelTenant).toHaveBeenCalledWith('un-id', { incluirDesactivados: true })
  })

  /**
   * El caso central de la pantalla: un `+40 %` en una celda no le dice nada a
   * nadie a las 8 de la mañana, y "$10.000 se cobra $14.000" sí. El número lo
   * calcula `precioConPlan` de verdad —no está mockeada—, que es la misma
   * función que después usa el motor de ventas: si las dos se separaran, la
   * pantalla prometería un precio distinto del que se cobra.
   */
  it('deriva el ejemplo del artículo de referencia con el porcentaje del plan', async () => {
    const html = await render()
    expect(html).toContain('14.000')
    expect(html).toContain('10.000')
  })

  it('un porcentaje negativo abarata el ejemplo, no lo encarece', async () => {
    planesDelTenant.mockResolvedValue([{ ...PLAN, nombre: 'Contado', porcentaje: '-10' }])
    const html = await render()
    expect(html).toContain('9.000')
  })

  it('muestra el nombre del plan, su medio y sus cuotas', async () => {
    const html = await render()
    expect(html).toContain('Crédito 3 cuotas')
    // El rótulo de `lib/ventas/medios.ts`, no el valor del enum.
    expect(html).toContain('Crédito')
    expect(html).not.toContain('TARJETA_CREDITO')
  })

  it('sin planes muestra qué está pasando, no una tabla vacía', async () => {
    planesDelTenant.mockResolvedValue([])
    const html = await render()
    expect(html).toContain('Todavía no hay planes')
    expect(html).toContain('precio de lista')
  })

  // El subtítulo cuenta las dos mitades: cuáles se ofrecen hoy en el mostrador
  // y cuáles quedaron guardados.
  it('el subtítulo separa activos de dados de baja', async () => {
    planesDelTenant.mockResolvedValue([
      PLAN,
      { ...PLAN, id: 'otro', nombre: 'Viejo', desactivadoEn: new Date() },
    ])
    const html = await render()
    expect(html).toContain('1 plan activo')
    expect(html).toContain('1 dado de baja')
  })

  it('sin ninguno dado de baja no dice nada de bajas', async () => {
    const html = await render()
    expect(html).toContain('1 plan activo')
    expect(html).not.toContain('dado de baja')
  })

  it('coloca el disparador del alta en el Topbar', async () => {
    expect(await render()).toContain('DIALOGO')
  })
})

/**
 * Lo que el render no puede ver: que el ejemplo salga de un número FIJO y no
 * del precio de un artículo del catálogo. Con un artículo real, la columna
 * cambiaría cada vez que alguien le toca el precio a ese artículo, sin que el
 * plan haya cambiado en nada.
 */
describe('el artículo de referencia', () => {
  const FUENTE = readFileSync('app/(app)/formas-de-pago/page.tsx', 'utf8')

  it('es una constante de $10.000, no una consulta al catálogo', () => {
    expect(FUENTE).toContain("const EJEMPLO = new Prisma.Decimal('10000')")
    // Y no sale de la base: la pantalla no abre Prisma por su cuenta ni toca
    // el inventario. `planesDelTenant` es su única consulta.
    expect(FUENTE).not.toContain('prismaParaTenant')
    expect(FUENTE).not.toContain('inventario')
  })
})
