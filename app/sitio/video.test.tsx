import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Video } from './video'
import { buscarYReproducir, etiquetaDeTiempo } from './reproductor'
import { CAPITULOS, VIDEO } from './datos'

const html = () => renderToStaticMarkup(<Video />)
const publico = (archivo: string) => readFileSync(path.join(process.cwd(), 'public', archivo))

/**
 * Lee las cajas de primer nivel de un MP4 y la duración de su `mvhd`.
 *
 * El copy de la sección ("en 36 segundos", el chip, los minutos de cada
 * capítulo) describe un archivo concreto. Si alguien reemplaza el video por
 * otro más largo o más corto, el texto miente sin que nada lo note: por eso
 * el test lee la duración del archivo mismo y no de una constante.
 */
function cajasDelMp4(datos: Buffer) {
  const cajas: { tipo: string; desde: number; tamano: number }[] = []
  let pos = 0
  while (pos + 8 <= datos.length) {
    let tamano = datos.readUInt32BE(pos)
    const tipo = datos.toString('latin1', pos + 4, pos + 8)
    if (tamano === 1) tamano = Number(datos.readBigUInt64BE(pos + 8))
    cajas.push({ tipo, desde: pos, tamano })
    if (tamano === 0) break
    pos += tamano
  }
  return cajas
}

function duracionDelMp4(datos: Buffer): number {
  const mvhd = datos.indexOf('mvhd', 0, 'latin1')
  const version = datos[mvhd + 4]
  // v0: creación(4) modificación(4) timescale(4) duración(4); v1: 8/8/4/8.
  if (version === 1) {
    const escala = datos.readUInt32BE(mvhd + 4 + 4 + 16)
    return Number(datos.readBigUInt64BE(mvhd + 4 + 4 + 20)) / escala
  }
  const escala = datos.readUInt32BE(mvhd + 4 + 4 + 8)
  return datos.readUInt32BE(mvhd + 4 + 4 + 12) / escala
}

describe('etiquetaDeTiempo', () => {
  it('escribe minutos y segundos con dos cifras, redondeando', () => {
    expect(etiquetaDeTiempo(8.4)).toBe('0:08')
    expect(etiquetaDeTiempo(14.9)).toBe('0:15')
    expect(etiquetaDeTiempo(36)).toBe('0:36')
    expect(etiquetaDeTiempo(124)).toBe('2:04')
  })
})

describe('el archivo del video', () => {
  const mp4 = publico(VIDEO.src)

  it('dura lo que dice el copy', () => {
    expect(Math.round(duracionDelMp4(mp4))).toBe(VIDEO.segundos)
  })

  it('cada capítulo empieza adentro del video, y en orden', () => {
    const desdes = CAPITULOS.map((c) => c.desde)
    expect(desdes).toEqual([...desdes].sort((a, b) => a - b))
    for (const desde of desdes) expect(desde).toBeLessThan(VIDEO.segundos)
  })

  // Con el índice (`moov`) al final, el navegador tiene que pedir el final del
  // archivo antes de poder mostrar un cuadro: el click en play espera.
  it('trae el índice antes de los datos, para arrancar sin bajarlo entero', () => {
    const tipos = cajasDelMp4(mp4).map((c) => c.tipo)
    expect(tipos.indexOf('moov')).toBeGreaterThan(-1)
    expect(tipos.indexOf('moov')).toBeLessThan(tipos.indexOf('mdat'))
  })

  it('el póster es 16:9, como el reproductor, y no se recorta', () => {
    const png = publico(VIDEO.poster)
    const ancho = png.readUInt32BE(16)
    const alto = png.readUInt32BE(20)
    expect(ancho / alto).toBeCloseTo(16 / 9, 2)
  })
})

describe('la sección Video', () => {
  it('es el ancla del link "Video" del Nav', () => {
    expect(html()).toMatch(/<section id="video"/)
  })

  it('pinta la franja de marca desde su módulo, no en línea', () => {
    expect(html()).not.toContain('background-color:var(--marca)')
    const css = readFileSync(path.join(process.cwd(), 'app/sitio/video.module.css'), 'utf8')
    expect(css).toMatch(/\.franja\s*\{\s*background-color:\s*var\(--marca\)/)
  })

  it('el título dice la duración real del video', () => {
    expect(html()).toContain(`Mirá cómo funciona, en ${VIDEO.segundos} segundos`)
  })

  it('el H2 es 26/700 en el teléfono y 38/700 en escritorio, sin tracking', () => {
    const h2 = html().match(/<h2 class="([^"]+)"/)?.[1] ?? ''
    for (const clase of ['text-[26px]', 'leading-[1.15]', 'font-bold', 'lg:text-[38px]', 'lg:leading-[1.12]']) {
      expect(h2.split(' ')).toContain(clase)
    }
    expect(h2).not.toContain('tracking')
  })

  it('la bajada tiene una versión por ancho, como la maqueta', () => {
    const salida = html()
    expect(salida).toMatch(
      /<span class="lg:hidden">Una venta, el cobro con factura ARCA y el bot de WhatsApp, de punta a punta\.<\/span>/,
    )
    expect(salida).toMatch(
      /<span class="hidden lg:inline">Una venta que descuenta el stock, el cobro con factura ARCA, la caja en pesos y dólares y el bot de WhatsApp, de punta a punta\. Sin registrarte y sin dejar un dato\.<\/span>/,
    )
  })

  it('la letra chica recuerda que el punto de venta del héroe es la app', () => {
    expect(html()).toContain(
      'El video no reemplaza la prueba: el punto de venta de arriba es la app de verdad.',
    )
  })
})

describe('el reproductor', () => {
  const video = () => html().match(/<video [^>]*>/)?.[0] ?? ''

  it('no baja nada hasta el click', () => {
    expect(video()).toContain('preload="none"')
    expect(video()).toContain(`src="${VIDEO.src}"`)
    expect(video()).toContain(`poster="${VIDEO.poster}"`)
  })

  it('reproduce en línea en el iPhone, y trae los controles nativos debajo de la capa', () => {
    // Los atributos de HTML no distinguen mayúsculas: React escribe playsInline.
    expect(video()).toMatch(/ playsinline=""/i)
    expect(video()).toContain('controls=""')
  })

  it('la capa es un botón que nombra la duración', () => {
    const salida = html()
    expect(salida).toMatch(
      new RegExp(`<button type="button" data-video-capa="" aria-label="Reproducir el video de presentación: ${VIDEO.segundos} segundos, sin audio"`),
    )
  })

  it('el póster de la capa es decorativo', () => {
    expect(html()).toContain(`<img src="${VIDEO.poster}" alt=""`)
  })

  it('el botón de play mide 56 px en el teléfono y 80 en escritorio', () => {
    expect(html()).toMatch(/class="[^"]*\bsize-14\b[^"]*\blg:size-20\b/)
  })

  it('el chip de duración tiene una versión por ancho', () => {
    const salida = html()
    expect(salida).toContain('<span class="lg:hidden">0:36 · sin audio</span>')
    expect(salida).toContain('<span class="hidden lg:inline">0:36 · sin audio, todo se lee en pantalla</span>')
  })

  it('sin JavaScript se van la capa y los capítulos, y quedan los controles nativos', () => {
    expect(html()).toMatch(
      /<noscript><style>\[data-video-capa\],\[data-video-capitulos\]\{display:none!important\}<\/style><\/noscript>/,
    )
  })
})

describe('los capítulos', () => {
  const botones = () => [...html().matchAll(/<button type="button" data-capitulo="[^"]*"[^>]*>([\s\S]*?)<\/button>/g)]

  it('son cuatro, en el orden del video, con su minuto', () => {
    expect(botones().map((b) => b[1].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ''))).toEqual([
      'Vender · 0:08',
      'Cobrar y facturar · 0:15',
      'Bot de WhatsApp · 0:20',
      'Tu rubro · 0:26',
    ])
  })

  it('cada uno lleva su ícono', () => {
    const iconos = botones().map((b) => b[1].match(/lucide-([a-z-]+)/)?.[1])
    expect(iconos).toEqual(['shopping-cart', 'wallet', 'bot', 'store'])
  })

  // El padding es el del .pen (12 y 7/13) menos el borde de 1 px, que en
  // Pencil va por dentro y en el navegador suma: así la pastilla mide 29.
  it('son filas de 40 px en el teléfono y pastillas de 29 en escritorio', () => {
    const clases = html().match(/<button type="button" data-capitulo="[^"]*" class="([^"]+)"/)?.[1].split(' ') ?? []
    for (const clase of ['h-10', 'w-full', 'rounded-[10px]', 'px-[11px]', 'text-[13px]', 'lg:h-auto', 'lg:w-auto', 'lg:rounded-full', 'lg:px-3', 'lg:py-[6px]', 'lg:text-xs', 'lg:leading-[15px]']) {
      expect(clases).toContain(clase)
    }
  })

  it('la lista es vertical en el teléfono y una fila en escritorio', () => {
    expect(html()).toMatch(/<div data-video-capitulos="" class="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:gap-2\.5">/)
  })
})

describe('buscarYReproducir', () => {
  function videoFalso(readyState: number) {
    const oyentes: (() => void)[] = []
    return {
      readyState,
      currentTime: 0,
      play: vi.fn(() => Promise.resolve()),
      addEventListener: vi.fn((_tipo: 'loadedmetadata', fn: () => void) => {
        oyentes.push(fn)
      }),
      disparar: () => oyentes.forEach((fn) => fn()),
    }
  }

  it('con los metadatos ya cargados, salta y reproduce', () => {
    const v = videoFalso(1)
    buscarYReproducir(v, 14.9)
    expect(v.currentTime).toBe(14.9)
    expect(v.play).toHaveBeenCalledOnce()
    expect(v.addEventListener).not.toHaveBeenCalled()
  })

  // preload="none": antes del primer click el video no sabe ni cuánto dura, y
  // un currentTime puesto en ese estado Safari lo ignora.
  it('sin metadatos, espera a que lleguen para saltar', () => {
    const v = videoFalso(0)
    buscarYReproducir(v, 19.9)
    expect(v.play).toHaveBeenCalledOnce()
    expect(v.currentTime).toBe(0)
    expect(v.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function), { once: true })
    v.disparar()
    expect(v.currentTime).toBe(19.9)
  })

  it('sin capítulo, reproduce desde donde está', () => {
    const v = videoFalso(0)
    buscarYReproducir(v)
    expect(v.play).toHaveBeenCalledOnce()
    expect(v.addEventListener).not.toHaveBeenCalled()
  })
})
