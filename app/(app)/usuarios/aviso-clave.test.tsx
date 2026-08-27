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

  // Minor 17 de la review final: el .pen (nodo U3uO1I) no pide opacity-85 en
  // este párrafo — --warn ya es un tono apagado por sí solo, y la opacidad
  // encima era una atenuación que nadie diseñó.
  it('el detalle de "se muestra una sola vez" no lleva opacity-85', () => {
    const inicio = html.indexOf('Se muestra una sola vez')
    const apertura = html.lastIndexOf('<p', inicio)
    const etiqueta = html.slice(apertura, html.indexOf('>', apertura))
    expect(etiqueta).not.toContain('opacity-85')
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

  // Task 10 del ciclo móvil (frame `NIyHG`, nodo `ZVVQf`): en el teléfono el
  // botón de copiar es sólo ícono, 34×34 — no el botón de 38px con texto que
  // ya existía en escritorio.
  it('en el teléfono, el botón mide 34×34 (nodo ZVVQf) y el texto "Copiar" queda oculto', () => {
    expect(html).toContain('h-[34px] w-[34px]')
    expect(html).toContain('<span class="hidden lg:inline">Copiar</span>')
  })

  it('en escritorio, el botón sigue siendo el de antes: 38px, con borde y el texto visible', () => {
    expect(html).toContain('lg:h-[38px]')
    expect(html).toContain('lg:border')
    expect(html).toContain('lg:border-input')
  })

  it('el botón lleva aria-label="Copiar": en el teléfono es el único nombre accesible, sin texto visible', () => {
    expect(html).toContain('aria-label="Copiar"')
  })

  // Ronda de arreglos 1 (Importante 2): sólo el botón de copiar había
  // recibido tratamiento móvil — el resto del bloque (nodo `frTpj`) seguía
  // con los valores de escritorio (`SFTGC`) sin `lg:`, así que el teléfono
  // los heredaba tal cual.
  it('el contenedor usa la geometría del teléfono (gap 11, padding 13, radio 14), sin tocar la de escritorio', () => {
    expect(html).toContain('gap-[11px]')
    expect(html).toContain('rounded-[14px]')
    expect(html).toContain('p-[13px]')
    expect(html).toContain('lg:gap-[14px]')
    expect(html).toContain('lg:rounded-2xl')
    expect(html).toContain('lg:p-[18px]')
    expect(html).not.toMatch(/(?<!lg:)gap-\[14px\]/)
    expect(html).not.toMatch(/(?<!lg:)rounded-2xl/)
    expect(html).not.toMatch(/(?<!lg:)p-\[18px\]/)
  })

  it('el círculo del ícono mide 32px en el teléfono, 38px en escritorio (nodo Q0pc6)', () => {
    expect(html).toContain('size-8')
    expect(html).toContain('lg:size-[38px]')
  })

  it('el ícono adentro del círculo mide 16px en el teléfono, 18px en escritorio (nodo qcq6D)', () => {
    expect(html).toContain('size-4 text-warn')
    expect(html).toContain('lg:size-[18px]')
  })
})
