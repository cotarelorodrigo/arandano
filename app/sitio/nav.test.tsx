import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Nav, Pie } from './nav'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const BASE = { protocolo: 'https', dominio: 'arandano.app', puerto: '' } as const
const nav = () => renderToStaticMarkup(<Nav base={BASE} />)
const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/nav.tsx'), 'utf8')

describe('el Nav', () => {
  it('trae la marca y los tres links de sección', () => {
    const salida = nav()
    expect(salida).toContain('Arándano')
    expect(salida).toContain('Qué hace')
    expect(salida).toContain('Rubros')
    expect(salida).toContain('Precios')
  })

  it('el llamado a la acción dice Probar 5 días y baja al formulario', () => {
    expect(nav()).toContain('Probar 5 días')
    expect(nav()).toContain('href="#contacto"')
  })

  it('la geometría del botón es la del .pen y no la de size="sm"', () => {
    expect(nav()).toMatch(/h-\[38px\][^"]*gap-\[7px\][^"]*rounded-\[9px\][^"]*px-\[15px\]/)
  })

  it('la barra no lleva borde inferior', () => {
    expect(nav().slice(0, nav().indexOf('</header>'))).not.toContain('border-b')
  })

  it('en reposo ofrece entrar al local sin mostrar el campo', () => {
    expect(nav()).toContain('Entrar a mi local')
    expect(nav()).not.toContain('<input')
  })

  it('la hamburguesa sólo existe abajo de 1024, y el lg:hidden va en el trigger', () => {
    expect(nav()).toMatch(/aria-label="Abrir menú"[^>]*class="[^"]*lg:hidden/)
  })

  it('lo que la fila angosta no muestra reaparece adentro del Sheet', () => {
    // En reposo el Sheet no se renderiza, así que esto se verifica sobre el
    // fuente: los links y la entrada de subdominio tienen que estar ADENTRO
    // del SheetContent, o el teléfono se queda sin navegación.
    const codigo = fuente()
    const desde = codigo.indexOf('<SheetContent')
    const hasta = codigo.indexOf('</SheetContent>')
    expect(desde).toBeGreaterThan(-1)
    const adentro = codigo.slice(desde, hasta)
    expect(adentro).toContain('LINKS_DE_SECCION.map')
    expect(adentro).toContain('<EntradaDeSubdominio')
  })
})

describe('el Pie', () => {
  it('nombra la marca y dónde está', () => {
    expect(renderToStaticMarkup(<Pie whatsapp="" />)).toContain('Arándano, Buenos Aires')
  })

  /**
   * El pie decía "Términos · Privacidad · Estado del servicio" — tres textos
   * planos, sin link, hacia tres páginas que no existen. Es la misma clase de
   * promesa vacía que este ciclo sacó del Hero y del Cierre, y vuelven cuando
   * las páginas existan.
   */
  it('no promete páginas que no existen', () => {
    const salida = renderToStaticMarkup(<Pie whatsapp="5491155555555" />)
    expect(salida).not.toContain('Términos')
    expect(salida).not.toContain('Privacidad')
    expect(salida).not.toContain('Estado del servicio')
  })

  it('ofrece WhatsApp cuando hay número', () => {
    const salida = renderToStaticMarkup(<Pie whatsapp="5491155555555" />)
    expect(salida).toContain('https://wa.me/5491155555555')
    expect(salida).toContain('Escribinos por WhatsApp')
  })

  // El caso de producción hasta este ciclo: WHATSAPP_CONTACTO viene vacío y no
  // puede quedar un wa.me apuntando a la nada.
  it('sin número, no dibuja ningún link roto', () => {
    const salida = renderToStaticMarkup(<Pie whatsapp="" />)
    expect(salida).not.toContain('wa.me')
    expect(salida).not.toContain('WhatsApp')
  })
})
