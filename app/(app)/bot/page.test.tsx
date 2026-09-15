import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BotDelLocal } from '@/lib/bot/administrar'

const exigirPermiso = vi.fn()
vi.mock('@/lib/permisos/guarda', () => ({
  exigirPermiso: (permiso: string) => exigirPermiso(permiso),
}))

const botDelLocal = vi.fn()
const numerosDisponibles = vi.fn()
const numerosDePruebaDelLocal = vi.fn()
vi.mock('@/lib/bot/administrar', () => ({
  botDelLocal: () => botDelLocal(),
  numerosDisponibles: () => numerosDisponibles(),
  numerosDePruebaDelLocal: () => numerosDePruebaDelLocal(),
}))

const kapsoConfigurado = vi.fn()
vi.mock('@/lib/bot/kapso', () => ({ kapsoConfigurado: () => kapsoConfigurado() }))

const modeloConfigurado = vi.fn()
vi.mock('@/lib/bot/agente', () => ({ modeloConfigurado: () => modeloConfigurado() }))

const respuestasDelMes = vi.fn()
vi.mock('@/lib/bot/limites', () => ({ respuestasDelMes: () => respuestasDelMes() }))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound() }))

// Ver el comentario homónimo de formas-de-pago/page.test.tsx: el provider se
// importa DENTRO de la función porque el beforeEach resetea los módulos.
async function render() {
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  const { default: Pantalla } = await import('./page')
  return renderToStaticMarkup(<SidebarProvider>{await Pantalla()}</SidebarProvider>)
}

const SIN_CONECTAR: BotDelLocal = {
  kapsoCustomerId: null,
  phoneNumberId: null,
  numeroVisible: null,
  conectadoEn: null,
  modo: 'APAGADO',
  aQueSeDedica: '',
  instrucciones: '',
  topeMensual: 1000,
}

const CONECTADO: BotDelLocal = {
  ...SIN_CONECTAR,
  kapsoCustomerId: 'cus_1',
  phoneNumberId: 'pn_1',
  numeroVisible: '+54 9 11 5555 0000',
  conectadoEn: new Date('2026-08-29T12:00:00Z'),
  modo: 'TODOS',
  aQueSeDedica: 'una waflería',
  instrucciones: 'Abrimos de 9 a 18.',
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete process.env.BOT_HABILITADO_EN
  exigirPermiso.mockResolvedValue({
    tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
    subdominio: 'flor',
    usuario: { rol: 'DUENO' },
  })
  botDelLocal.mockResolvedValue(SIN_CONECTAR)
  numerosDisponibles.mockResolvedValue([])
  numerosDePruebaDelLocal.mockResolvedValue([])
  kapsoConfigurado.mockReturnValue(true)
  modeloConfigurado.mockReturnValue(true)
  respuestasDelMes.mockResolvedValue(0)
})

describe('/bot', () => {
  it('exige el permiso BOT antes de renderizar nada', async () => {
    await render()
    expect(exigirPermiso).toHaveBeenCalledWith('BOT')
  })

  it('sin número conectado invita a conectarlo y no muestra el consumo', async () => {
    const html = await render()
    expect(html).toContain('Sin conectar')
    expect(html).toContain('Conectá el WhatsApp del local')
    expect(html, 'mostró el consumo de un bot que no está conectado').not.toContain('Este mes')
  })

  it('conectado muestra el número, el estado y el consumo del mes', async () => {
    botDelLocal.mockResolvedValue(CONECTADO)
    respuestasDelMes.mockResolvedValue(37)
    const html = await render()
    expect(html).toContain('+54 9 11 5555 0000')
    expect(html).toContain('Contestando')
    expect(html).toContain('Este mes')
    expect(html).toContain('37')
    expect(html).toContain('de 1000')
  })

  /**
   * El caso que protege el gate entero: `scripts/smoke.sh` barre esta ruta
   * contra `arandano-stage`, que no tiene credenciales de Kapso. Si la pantalla
   * tirara sin la variable, TODO deploy haría rollback por una feature que
   * nadie está usando todavía.
   */
  it('lleva a la pantalla a qué se dedica el local, para poder editarlo', async () => {
    botDelLocal.mockResolvedValue(CONECTADO)
    expect(await render()).toContain('una waflería')
  })

  it('sin credenciales de Kapso renderiza igual y lo avisa', async () => {
    kapsoConfigurado.mockReturnValue(false)
    const html = await render()
    expect(html).toContain('todavía no está configurada en este servidor')
    expect(html, 'ofreció conectar sin integración configurada').not.toContain(
      'Conectar mi WhatsApp',
    )
  })

  /**
   * Igual de importante: si Kapso está caído, la pantalla tampoco puede tirar.
   * Sólo se consulta mientras falta conectar, y el error se traga.
   */
  it('si Kapso no responde, la pantalla sigue en pie', async () => {
    botDelLocal.mockResolvedValue({ ...SIN_CONECTAR, kapsoCustomerId: 'cus_1' })
    numerosDisponibles.mockRejectedValue(new Error('ECONNREFUSED'))
    const html = await render()
    expect(html).toContain('Conectá el WhatsApp del local')
  })

  it('ofrece confirmar el número que Kapso reporta', async () => {
    botDelLocal.mockResolvedValue({ ...SIN_CONECTAR, kapsoCustomerId: 'cus_1' })
    numerosDisponibles.mockResolvedValue([
      { phoneNumberId: 'pn_9', numeroVisible: '+54 9 11 4444 0000', wabaId: null },
    ])
    const html = await render()
    expect(html).toContain('Encontramos tu número')
    expect(html).toContain('+54 9 11 4444 0000')
    expect(html).toContain('Es este, conectalo')
  })

  /**
   * Un empleado con BOT ve la pantalla entera —para eso tiene el permiso— pero
   * no puede conectar ni desconectar: eso mueve la identidad de WhatsApp del
   * local y una relación con un tercero.
   */
  it('un empleado con BOT ve la pantalla pero no el botón de conectar', async () => {
    exigirPermiso.mockResolvedValue({
      tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
      subdominio: 'flor',
      usuario: { rol: 'EMPLEADO' },
    })
    const html = await render()
    expect(html).toContain('Conectá el WhatsApp del local')
    expect(html).toContain('El número lo conecta el dueño del local.')
    expect(html, 'un empleado vio el disparador de conexión').not.toContain(
      'Conectar mi WhatsApp',
    )
  })

  it('un empleado con BOT tampoco ve Desconectar', async () => {
    exigirPermiso.mockResolvedValue({
      tenant: { id: 'tenant-1', nombre: 'Celulares Flor' },
      subdominio: 'flor',
      usuario: { rol: 'EMPLEADO' },
    })
    botDelLocal.mockResolvedValue(CONECTADO)
    const html = await render()
    expect(html).toContain('+54 9 11 5555 0000')
    expect(html).not.toContain('Desconectar')
  })

  it('sin modelo configurado avisa que no puede responder todavía', async () => {
    botDelLocal.mockResolvedValue(CONECTADO)
    modeloConfigurado.mockReturnValue(false)
    expect(await render()).toContain('Falta configurar el modelo')
  })

  it('al llegar al tope lo dice', async () => {
    botDelLocal.mockResolvedValue(CONECTADO)
    respuestasDelMes.mockResolvedValue(1000)
    expect(await render()).toContain('Llegaste al tope del mes')
  })

  /**
   * El gate del rollout, y por qué es 404 y no 403.
   *
   * `BOT_HABILITADO_EN` existe para probar el bot en producción con un solo
   * local real. Que la pestaña no se dibuje no alcanza: un dueño tiene el
   * permiso BOT sin fila en `usuario_permisos`, así que tipear /bot lo dejaría
   * entrar igual.
   *
   * `notFound()` y no `forbidden()`: para ese local la pantalla no existe
   * todavía: un 403 anunciaría que existe algo a lo que vale la pena volver.
   */
  it('en un local fuera de la lista, la pantalla no existe', async () => {
    process.env.BOT_HABILITADO_EN = 'wafflespro'
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })

  it('en el local de la lista, la pantalla abre normalmente', async () => {
    process.env.BOT_HABILITADO_EN = 'flor'
    expect(await render()).toContain('Conectá el WhatsApp del local')
    expect(notFound).not.toHaveBeenCalled()
  })

  /**
   * El caso que protege el gate de deploy: `arandano-stage` no declara la
   * variable, y `scripts/smoke.sh` barre esta ruta exigiendo 200.
   */
  it('sin la variable declarada, la pantalla abre en cualquier local', async () => {
    expect(await render()).toContain('Conectá el WhatsApp del local')
    expect(notFound).not.toHaveBeenCalled()
  })

  describe('el modo del bot', () => {
    it('ofrece los tres modos con el actual marcado', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      const html = await render()
      expect(html).toContain('Apagado')
      expect(html).toContain('Sólo prueba')
      expect(html).toContain('Todos')
      // En modo single, Radix renderiza cada ítem como un <button role="radio">
      // con aria-checked: el elegido es el único en "true".
      expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*>Sólo prueba<\/button>/)
      expect(html).not.toMatch(/<button[^>]*aria-checked="true"[^>]*>Todos<\/button>/)
    })

    it('en prueba el encabezado dice En prueba', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      expect(await render()).toContain('En prueba')
    })

    it('apagado el encabezado dice Apagado y la leyenda explica que no contesta', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'APAGADO' })
      const html = await render()
      expect(html).toContain('+54 9 11 5555 0000 · Apagado')
      expect(html).toContain('No le contesta a nadie. Los mensajes quedan guardados.')
    })

    it('en prueba sin números avisa que no le contesta a nadie', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue([])
      expect(await render()).toContain(
        'Todavía no cargaste ningún número de prueba: no le contesta a nadie.',
      )
    })

    it('en prueba con números dice a quién contesta', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue([
        { id: 'n1', digitos: '1122334455', ultimoMensajeEn: null },
      ])
      expect(await render()).toContain('Contesta sólo a los números de prueba.')
    })

    it('sin número conectado no ofrece el modo ni consulta los números de prueba', async () => {
      const html = await render()
      expect(html).not.toContain('Sólo prueba')
      expect(numerosDePruebaDelLocal).not.toHaveBeenCalled()
    })
  })
})
