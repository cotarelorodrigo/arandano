import { describe, it, expect } from 'vitest'
import { MODULOS, NUCLEO, PLANES, RUBROS, loQueFalta, moduloPorClave, queActiva } from './datos'

/**
 * El contenido de la landing, probado como dato y no como marcado.
 *
 * Lo que más importa acá es el caso de la contradicción: hasta el rediseño,
 * cuatro rubros anunciaban "Núcleo + Turnos" con letra chica que no decía
 * nada, mientras la sección de arriba decía que Turnos está En camino. El
 * texto se deriva ahora de `MODULOS`, así que la contradicción es
 * estructuralmente imposible — y estos casos lo fijan para que un ciclo futuro
 * no vuelva a escribir la frase a mano.
 */
describe('los datos de la landing', () => {
  it('el núcleo tiene las ocho piezas de la maqueta', () => {
    expect(NUCLEO).toHaveLength(8)
    expect(NUCLEO).toContain('Caja ARS/USD')
    expect(NUCLEO).toContain('Facturación ARCA')
  })

  it('hay tres módulos y uno solo está construido', () => {
    expect(MODULOS).toHaveLength(3)
    expect(MODULOS.filter((modulo) => modulo.estado === 'Disponible')).toHaveLength(1)
    expect(moduloPorClave('ordenes').estado).toBe('Disponible')
  })

  it('hay doce rubros', () => {
    expect(RUBROS).toHaveLength(12)
  })

  it('cinco rubros funcionan con el núcleo solo', () => {
    expect(RUBROS.filter((rubro) => rubro.modulos.length === 0)).toHaveLength(5)
  })

  describe('qué activa cada rubro', () => {
    it('sin módulos dice sólo Núcleo', () => {
      expect(queActiva([])).toBe('Núcleo')
    })

    it('con módulos los enumera', () => {
      expect(queActiva(['ordenes'])).toBe('Núcleo + Órdenes de trabajo')
      expect(queActiva(['turnos', 'ordenes'])).toBe('Núcleo + Turnos + Órdenes de trabajo')
    })

    it('sale de MODULOS y no de un texto escrito a mano', () => {
      // Si alguien renombra un módulo, el texto del rubro lo sigue solo. Es lo
      // que impide que las dos secciones se desincronicen otra vez.
      for (const rubro of RUBROS) {
        for (const clave of rubro.modulos) {
          expect(queActiva(rubro.modulos)).toContain(moduloPorClave(clave).titulo)
        }
      }
    })
  })

  describe('lo que le falta a un rubro', () => {
    it('un rubro de núcleo solo no espera nada', () => {
      expect(loQueFalta([])).toEqual([])
    })

    it('un rubro de órdenes de trabajo funciona hoy, entero', () => {
      expect(loQueFalta(['ordenes'])).toEqual([])
    })

    it('un rubro de turnos declara que Turnos no está', () => {
      expect(loQueFalta(['turnos']).map((modulo) => modulo.titulo)).toEqual(['Turnos'])
    })

    // El invariante que cierra el agujero: NINGÚN rubro puede decir que anda
    // hoy si alguno de sus módulos está en camino.
    it('ningún rubro se presenta como completo si le falta un módulo', () => {
      for (const rubro of RUBROS) {
        const enCamino = rubro.modulos.filter(
          (clave) => moduloPorClave(clave).estado === 'En camino',
        )
        expect(
          loQueFalta(rubro.modulos).length,
          `"${rubro.titulo}" activa ${enCamino.length} módulo(s) en camino y la ` +
            `página no lo está diciendo.`,
        ).toBe(enCamino.length)
      }
    })

    it('hoy son cinco los rubros que esperan algo', () => {
      // Cuatro de Turnos (peluquería, veterinaria, taller, consultorio) más
      // bar y cafetería, que espera Gastronomía. Cuando Turnos se entregue,
      // este número baja solo y este caso avisa que hay que actualizarlo.
      expect(RUBROS.filter((rubro) => loQueFalta(rubro.modulos).length > 0)).toHaveLength(5)
    })
  })

  describe('los planes', () => {
    it('son cuatro, con los precios de la maqueta', () => {
      expect(PLANES.map((plan) => plan.precio)).toEqual(['24.900', '44.900', '79.900', null])
    })

    it('sólo Premium no lleva número, y dice qué va en su lugar', () => {
      const premium = PLANES.at(-1)
      expect(premium?.precio).toBeNull()
      expect(premium?.textoSinPrecio).toBe('A medida')
    })

    it('los precios no traen el signo pegado', () => {
      // El `$` se dibuja aparte, con su propio rol tipográfico, igual que en la
      // banda del total del punto de venta. Un signo adentro del string
      // volvería a romper esa unidad sin que nada avise.
      for (const plan of PLANES) {
        expect(plan.precio ?? '').not.toContain('$')
      }
    })

    /**
     * La escalera es acumulativa: cada plan lista lo que AGREGA y hereda el
     * resto con "Todo lo del X". Estos casos existen porque mover una feature
     * de escalón —el bot bajó a Negocio, ARCA subió a Profesional— es
     * exactamente cuando las dos listas se desincronizan sin que nada avise.
     */
    describe('la escalera', () => {
      const porNombre = (nombre: string) => PLANES.find((plan) => plan.nombre === nombre)!

      it('cada plan hereda el anterior en vez de repetirlo', () => {
        expect(porNombre('Negocio').incluye).toContain('Todo lo del Básico')
        expect(porNombre('Profesional').incluye).toContain('Todo lo del Negocio')
      })

      it('el bot entra en Negocio y Profesional no lo repite', () => {
        expect(porNombre('Negocio').incluye).toContain('Bot de WhatsApp')
        expect(porNombre('Profesional').incluye).not.toContain('Bot de WhatsApp')
      })

      it('la facturación ARCA entra recién en Profesional', () => {
        expect(porNombre('Básico').incluye).not.toContain('Facturación ARCA')
        expect(porNombre('Negocio').incluye).not.toContain('Facturación ARCA')
        expect(porNombre('Profesional').incluye).toContain('Facturación ARCA')
      })

      it('ningún plan promete el bot de Instagram, que no existe', () => {
        // El ciclo del bot construyó WhatsApp y dejó Instagram para más
        // adelante (CLAUDE.md). Prometerlo en una tabla de precios es una
        // promesa comercial, no una aspiración de roadmap.
        for (const plan of PLANES) {
          for (const item of plan.incluye) expect(item).not.toContain('Instagram')
        }
      })

      it('el detalle de cada plan no contradice lo que incluye', () => {
        // "Un local, una persona" convivió un rato con "3 usuarios". Un
        // subtítulo que dice lo contrario que la lista de abajo es de las
        // cosas que nadie relee al cambiar un número.
        expect(porNombre('Básico').detalle).not.toContain('una persona')
      })

      it('la cantidad de usuarios sube con el plan', () => {
        expect(porNombre('Básico').incluye).toContain('3 usuarios')
        expect(porNombre('Negocio').incluye).toContain('5 usuarios')
        expect(porNombre('Profesional').incluye).toContain('15 usuarios')
      })
    })

    it('uno solo está destacado', () => {
      expect(PLANES.filter((plan) => plan.destacado)).toHaveLength(1)
      expect(PLANES.find((plan) => plan.destacado)?.nombre).toBe('Profesional')
    })
  })
})
