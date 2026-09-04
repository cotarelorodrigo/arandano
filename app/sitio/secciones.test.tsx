import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Modulos, Rubros, Planes, Cierre } from './secciones'
import { MODULOS, NUCLEO, PLANES, RUBROS, loQueFalta } from './datos'


vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/secciones.tsx'), 'utf8')

describe('Módulos', () => {
  const html = () => renderToStaticMarkup(<Modulos />)

  it('trae su título y su bajada', () => {
    expect(html()).toContain('Un núcleo, tres módulos, rubros ilimitados')
    expect(html()).toContain('un rubro nuevo es un archivo de configuración, no desarrollo')
  })

  it('lista las ocho piezas del núcleo', () => {
    const salida = html()
    for (const pieza of NUCLEO) expect(salida).toContain(pieza)
  })

  it('el estado de cada módulo sale del dato', () => {
    const salida = html()
    expect(salida.match(/Disponible/g)).toHaveLength(1)
    expect(salida.match(/En camino/g)).toHaveLength(2)
    for (const modulo of MODULOS) {
      expect(salida).toContain(modulo.titulo)
      expect(salida).toContain(modulo.detalle)
    }
  })

  /**
   * El estado se ve antes de leerse: el módulo construido es una card de papel
   * con borde, los dos que no todavía se quedan sobre el fondo hundido. El
   * chip sigue siendo el rótulo, pero deja de ser la ÚNICA señal.
   */
  it('los módulos que no están se ven distintos, no sólo se rotulan distinto', () => {
    const salida = html()
    expect(salida).toContain('bg-secondary')
    expect(salida).toContain('border bg-card')
  })

  /**
   * El núcleo era una de las tres superficies de --marca de la página.
   * docs/sistema-de-diseno.md prohíbe dos en secciones consecutivas, y Planes
   * y Cierre lo eran. Ahora el núcleo se distingue por FORMA —una banda a todo
   * el ancho contra tres paneles en tercios— y no por color.
   */
  describe('el núcleo ya no es un paño de marca', () => {
    it('no pinta ninguna superficie con --marca', () => {
      expect(html()).not.toContain('var(--marca)')
    })

    it('y con el paño se fue el único color crudo de la landing', () => {
      expect(fuente()).not.toContain('#FFFFFF1A')
      expect(fuente()).not.toMatch(/bg-\[#[0-9A-Fa-f]{6,8}\]/)
    })
  })
})

describe('Rubros', () => {
  const html = () => renderToStaticMarkup(<Rubros />)

  it('trae su título, su bajada y la salida para el rubro que falta', () => {
    const salida = html()
    expect(salida).toContain('Tu rubro ya está adentro')
    expect(salida).toContain('¿No está el tuyo? Se agrega sin desarrollo.')
  })

  it('lista los doce rubros', () => {
    const salida = html()
    expect(RUBROS).toHaveLength(12)
    for (const rubro of RUBROS) expect(salida).toContain(rubro.titulo)
  })

  /**
   * Doce tarjetas idénticas era el kit de cards en su peor versión, y encima
   * no describía lo que la sección hace: nadie lee los doce rubros, se busca
   * el propio. Un índice se recorre con el ojo; doce cards hay que leerlas.
   */
  it('es un índice y no una grilla de tarjetas', () => {
    const salida = html()
    expect(salida).toContain('<ul')
    expect(salida.match(/<li/g)).toHaveLength(12)
    // Filas separadas por una línea, no doce cajas con radio propio.
    expect(salida).not.toContain('rounded-[13px]')
    expect(salida).toContain('border-b')
  })

  /**
   * La contradicción que este rediseño cierra: cuatro rubros anunciaban
   * "Núcleo + Turnos" bajo un título que dice "Tu rubro ya está adentro",
   * mientras la sección de arriba decía que Turnos está En camino. Un dueño de
   * peluquería leía que su rubro ya estaba, y no estaba.
   */
  describe('dice lo que todavía no está', () => {
    it('avisa en cada rubro que espera un módulo', () => {
      const salida = html()
      const esperan = RUBROS.filter((rubro) => loQueFalta(rubro.modulos).length > 0)
      expect(esperan.length).toBeGreaterThan(0)
      expect(salida.match(/, en camino/g)).toHaveLength(esperan.length)
    })

    it('nombra el módulo que falta, no un aviso genérico', () => {
      expect(html()).toContain('Turnos, en camino')
      expect(html()).toContain('Gastronomía, en camino')
    })

    it('no avisa nada en un rubro que funciona hoy', () => {
      // "Celulares y servicio técnico" activa Órdenes de trabajo, que está
      // construido: ese rubro anda entero y no puede llevar el aviso.
      const salida = html()
      const desde = salida.indexOf('Celulares y servicio técnico')
      const hasta = salida.indexOf('Kiosco y autoservicio')
      expect(salida.slice(desde, hasta)).not.toContain('en camino')
    })
  })
})

describe('Planes', () => {
  const html = () => renderToStaticMarkup(<Planes />)

  it('trae su título y su bajada', () => {
    expect(html()).toContain('Precios claros, en pesos')
    expect(html()).toContain('El plan limita capacidad, no rubro.')
  })

  it('muestra los cuatro planes con su precio', () => {
    const salida = html()
    for (const plan of PLANES) {
      expect(salida).toContain(plan.nombre)
      expect(salida).toContain(plan.precio ?? plan.textoSinPrecio ?? '')
    }
  })

  it('uno solo lleva Más elegido', () => {
    expect(html().match(/Más elegido/g)).toHaveLength(1)
  })

  it('Premium invita a hablar, el resto a probar', () => {
    const salida = html()
    expect(salida.match(/Probar 5 días/g)).toHaveLength(3)
    expect(salida).toContain('Hablemos')
  })

  /**
   * El destacado era la tercera superficie de --marca, y dejaba a Planes y
   * Cierre como dos secciones violetas consecutivas. Ahora se distingue con un
   * contorno de --primary: un contorno no es una superficie, así que la regla
   * de "una superficie de marca por sección" queda intacta.
   */
  it('el plan destacado se marca con contorno, no con un paño violeta', () => {
    const salida = html()
    expect(salida).not.toContain('var(--marca)')
    expect(salida).toContain('ring-primary')
  })

  /**
   * La plata se escribe como adentro del producto: el mismo rol `importe` de
   * la banda del total del punto de venta, con el signo aparte. Antes el
   * precio era un string con el signo pegado, tipografiado como un titular, y
   * la misma página escribía la plata de dos maneras distintas.
   */
  it('el monto usa el rol tipográfico de la plata, con el signo aparte', () => {
    expect(fuente()).toContain("from '@/components/importe.module.css'")
    expect(fuente()).toContain('importe.signo')
    expect(html()).toContain('$')
  })
})

describe('Cierre', () => {
  const html = (whatsapp = '5491155555555') =>
    renderToStaticMarkup(<Cierre whatsapp={whatsapp}>{<p>el formulario</p>}</Cierre>)

  it('renderiza el formulario que le pasan', () => {
    expect(html()).toContain('el formulario')
  })

  /**
   * Decía "El alta es instantánea" y prometía "elegís el rubro y en dos
   * minutos tenés tu local cargado". Ninguna de las dos era cierta: el
   * registro público está apagado y el formulario tiene UN campo, que guarda
   * `rubro: null`. No hay ningún rubro que elegir ni ningún alta de dos
   * minutos.
   */
  describe('promete lo que el producto hace', () => {
    it('no dice que el alta es instantánea', () => {
      expect(html()).not.toContain('El alta es instantánea')
      expect(html()).not.toContain('dos minutos')
    })

    it('no dice que se elige el rubro, porque el formulario no lo pide', () => {
      expect(html()).not.toContain('elegís el rubro')
    })

    it('dice lo que sí pasa', () => {
      const salida = html()
      expect(salida).toContain('Probalo con tu propio local')
      expect(salida).toContain('Te escribimos')
      expect(salida).toContain('Sin tarjeta')
    })
  })

  // El soporte por WhatsApp sólo se promete si hay número: en producción
  // WHATSAPP_CONTACTO vino vacío durante todo este tiempo, así que la página
  // prometía un canal que no mostraba por ningún lado.
  it('sólo promete soporte por WhatsApp si hay número', () => {
    expect(html('5491155555555')).toContain('soporte es por WhatsApp')
    // La bajada nombra WhatsApp igual —"Dejanos tu WhatsApp o tu mail"—, que
    // es correcto: lo que no se puede prometer sin número es el SOPORTE.
    expect(html('')).not.toContain('soporte es por WhatsApp')
    expect(html('')).toContain('Dejanos tu WhatsApp')
  })

  it('es la superficie de marca de su sección', () => {
    expect(fuente()).toContain('estilos.franja')
  })
})
