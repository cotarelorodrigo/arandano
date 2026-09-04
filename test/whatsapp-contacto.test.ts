import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * El número de WhatsApp del negocio, en los compose versionados.
 *
 * POR QUÉ ESTO NECESITA UN TEST. `WHATSAPP_CONTACTO` falla ABIERTO y en
 * silencio: sin valor, `app/sitio/formulario.tsx` simplemente no dibuja el link
 * a `wa.me`, la pantalla de gracias tampoco, y el Cierre deja de ofrecer
 * soporte. La página no rompe — se queda con un camino de contacto menos y
 * nadie se entera. Eso es exactamente lo que pasó en producción hasta el
 * rediseño de la landing: `compose.prod.yml` lo declaraba en `""` mientras la
 * letra chica prometía "soporte por WhatsApp".
 *
 * El otro modo de falla es más chico y más fácil de cometer: escribirlo como se
 * dice en voz alta. `wa.me` quiere dígitos pelados, así que `+54 9 11
 * 3267-2973` produce un link roto que igual se dibuja, que es peor que no
 * dibujarlo.
 */
const COMPOSE = ['docker/compose.prod.yml', 'docker/compose.dev.yml']

function valorDe(archivo: string): string {
  const texto = readFileSync(path.join(process.cwd(), archivo), 'utf8')
  const linea = texto.match(/^\s*WHATSAPP_CONTACTO:\s*"?([^"\n]*)"?\s*$/m)
  expect(linea, `${archivo} ya no declara WHATSAPP_CONTACTO`).not.toBeNull()
  return (linea?.[1] ?? '').trim()
}

describe('WHATSAPP_CONTACTO', () => {
  it('lo declaran los dos compose que sirven la landing', () => {
    for (const archivo of COMPOSE) expect(() => valorDe(archivo)).not.toThrow()
  })

  it('producción tiene número', () => {
    // Los otros dos stacks (stage y ensayo) no lo declaran a propósito: el
    // barrido de scripts/smoke.sh corre contra stage y no debe depender de un
    // número real. El que no puede quedar vacío es el que ven los clientes.
    expect(
      valorDe('docker/compose.prod.yml'),
      'producción sin número deja la landing con un solo camino de contacto, ' +
        'y el Cierre prometiendo un soporte que no muestra',
    ).not.toBe('')
  })

  it('está escrito como lo quiere wa.me: sólo dígitos', () => {
    for (const archivo of COMPOSE) {
      const valor = valorDe(archivo)
      if (valor === '') continue
      expect(
        valor,
        `${archivo} tiene "${valor}". wa.me quiere dígitos pelados — sin "+", ` +
          `sin espacios y sin guiones —, y un link mal formado se dibuja igual.`,
      ).toMatch(/^\d{8,15}$/)
    }
  })

  it('empieza por el código de país, no por un 0 ni por un 15', () => {
    const valor = valorDe('docker/compose.prod.yml')
    expect(valor.startsWith('0'), 'wa.me no lleva el 0 de larga distancia').toBe(false)
    expect(valor.startsWith('15'), 'wa.me no lleva el 15 del celular').toBe(false)
  })

  it('el ejemplo del repo queda vacío, para que nadie lo copie sin pensar', () => {
    const ejemplo = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8')
    expect(ejemplo).toMatch(/^WHATSAPP_CONTACTO=\s*$/m)
  })
})
