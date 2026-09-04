import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Hero } from './hero'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const html = () => renderToStaticMarkup(<Hero whatsapp="5491155555555" />)
const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/hero.tsx'), 'utf8')

describe('el Hero', () => {
  it('abre con el titular', () => {
    expect(html()).toContain('Todo el local en un solo lugar')
  })

  it('el titular paga el rol de rótulo, con su ancho propio', () => {
    // La única decisión tipográfica expresiva de la página: Archivo condensado
    // al 78%, el registro de un cartel de local. Si alguien lo devuelve a
    // `tipografia.archivo`, el titular pierde lo único que lo distingue de
    // cualquier otro H1.
    expect(fuente()).toContain('tipografia.rotulo')
  })

  it('la bajada nombra lo que el producto hace', () => {
    const salida = html()
    expect(salida).toContain('caja en pesos y dólares')
    expect(salida).toContain('facturación ARCA')
  })

  it('lleva el formulario, con el campo que espera el servidor', () => {
    expect(html()).toContain('name="contacto"')
    expect(html()).toContain('Que me escriban')
  })

  /**
   * La letra chica decía "5 días gratis · sin tarjeta · el alta es
   * instantánea". El registro público está apagado a propósito
   * (`lib/auth/opciones.ts`) y el alta se hace a mano con `npm run
   * tenant:crear`: no hay ninguna alta instantánea. Prometer dos minutos y
   * contestar por WhatsApp al día siguiente quema al primer interesado.
   */
  it('no promete un alta que el producto no hace', () => {
    const salida = html()
    expect(salida).not.toContain('alta es instantánea')
    expect(salida).not.toContain('dos minutos')
  })

  it('dice lo que sí pasa: que alguien escribe', () => {
    expect(html()).toContain('Te escribimos')
    expect(html()).toContain('sin tarjeta')
  })

  /**
   * El cromo de navegador falso —tres puntitos y barra de URL alrededor del
   * carrito— es de las marcas más reconocibles de una landing de plantilla, y
   * peleaba con un carrito que ahora se toca.
   */
  describe('sin la ventana falsa', () => {
    it('no dibuja los tres puntitos de una barra de navegador', () => {
      expect(html()).not.toContain('bg-destructive')
      expect(fuente()).not.toContain('bg-warn')
    })

    it('pero no pierde el dato que vivía ahí', () => {
      // Que cada local abra en su propia dirección es un argumento de venta,
      // no un adorno de ventana: bajó a una línea propia.
      expect(html()).toContain('flor.arandano.app')
      expect(html()).toContain('su propia dirección')
    })

    it('la dirección aparece una sola vez', () => {
      expect(html().match(/flor\.arandano\.app/g)).toHaveLength(1)
    })
  })

  /**
   * El badge "Hecho para el mercado argentino" era un rótulo flotando sobre el
   * titular, y lo que decía ya lo prueba el contenido: facturación ARCA y caja
   * en pesos y dólares no existen en ningún otro mercado.
   */
  it('no lleva un rótulo flotando sobre el titular', () => {
    expect(html()).not.toContain('Hecho para el mercado argentino')
  })

  it('las dos columnas mantienen la proporción de la maqueta', () => {
    // 560:720 del .pen, en fr para que se sostenga cuando el contenedor no
    // llega a 1328. Y sólo desde 1024: abajo es una columna.
    expect(html()).toContain('lg:grid-cols-[7fr_9fr]')
    expect(html()).not.toMatch(/(?<!lg:)grid-cols-\[7fr_9fr\]/)
  })
})
