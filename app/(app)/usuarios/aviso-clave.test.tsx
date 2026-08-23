import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { AvisoClaveGenerada } from './aviso-clave'

const RUTA = 'app/(app)/usuarios/aviso-clave.tsx'

describe('AvisoClaveGenerada', () => {
  const html = renderToStaticMarkup(<AvisoClaveGenerada nombre="Camila" clave="gato-verde-4471" />)

  it('muestra la clave en texto plano', () => {
    expect(html).toContain('gato-verde-4471')
  })

  it('muestra el nombre de la persona', () => {
    expect(html).toContain('Camila')
  })

  // Las dos frases que el brief marca como lo más importante de la pantalla:
  // la pantalla de ANTES no decía ninguna de las dos.
  it('dice que la clave se muestra una sola vez', () => {
    expect(html).toContain('Se muestra una sola vez')
  })

  it('dice que las sesiones de esa persona se cerraron', () => {
    expect(html).toContain('sesiones abiertas se cerraron')
  })

  it('tiene un botón "Copiar" con ícono', () => {
    expect(html).toContain('Copiar')
    expect(html).toContain('<svg')
  })

  it('se pinta en ámbar (--warn sobre --warn-soft), igual que docs/sistema-de-diseno.md lo documenta', () => {
    expect(html).toMatch(/bg-warn-soft\b/)
    expect(html).toMatch(/text-warn\b/)
  })

  // role="alert": este bloque reemplaza al <Alert> de shadcn, que YA traía
  // ese rol siempre. El brief de esta task avisa que el rediseño perdió
  // role="status"/"alert" dos veces al convertir avisos en otra cosa —acá se
  // verifica que no pasó una tercera.
  it('lleva role="alert"', () => {
    expect(html).toMatch(/role="alert"/)
  })

  // Wiring del botón de copiar: no se puede simular el click sin jsdom (ver
  // vitest.config.mts, environment: 'node'), así que se verifica en el
  // FUENTE que el botón copia la CLAVE y no otra cosa (p. ej. la oración
  // entera). Mutado a mano para confirmar que el regex atrapa un cambio real:
  // reemplazar `.writeText(clave)` por `.writeText('clave')` (un string
  // literal en vez de la variable) rompe este caso.
  it('el botón copia la clave, no el mensaje entero — el cableado, no sólo el ícono', () => {
    const fuente = readFileSync(RUTA, 'utf8')
    expect(fuente).toMatch(/navigator\.clipboard\?\.writeText\(clave\)/)
  })
})
