import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { firmaValida } from '@/lib/bot/firma'

const SECRETO = 'el-secreto-de-este-local'
const firmar = (cuerpo: string, secreto = SECRETO) =>
  createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')

describe('la firma del webhook de Kapso', () => {
  const cuerpo = '{"phone_number_id":"123","message":{"id":"wamid.1"}}'

  it('acepta un cuerpo firmado con el secreto de este local', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo), SECRETO)).toBe(true)
  })

  it('rechaza la firma de otro secreto', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, 'el-secreto-del-local-de-al-lado'), SECRETO)).toBe(false)
  })

  /**
   * El caso que justifica que el handler lea `request.text()` y nunca
   * `JSON.stringify(await request.json())`: el mismo JSON con otro espaciado es
   * otro cuerpo para HMAC. Si alguien "arregla" una firma que no valida
   * comparando contra lo reserializado, la verificación pasa a no verificar nada.
   */
  it('se calcula sobre los BYTES, no sobre el JSON: el mismo objeto con otro espaciado no vale', () => {
    const reserializado = JSON.stringify(JSON.parse(cuerpo), null, 2)
    expect(reserializado).not.toBe(cuerpo)
    expect(firmaValida(reserializado, firmar(cuerpo), SECRETO)).toBe(false)
  })

  it('un cuerpo alterado no valida', () => {
    expect(firmaValida(cuerpo.replace('123', '999'), firmar(cuerpo), SECRETO)).toBe(false)
  })

  it('falla cerrado sin header y sin secreto', () => {
    expect(firmaValida(cuerpo, null, SECRETO)).toBe(false)
    expect(firmaValida(cuerpo, firmar(cuerpo), null)).toBe(false)
    expect(firmaValida(cuerpo, '', SECRETO)).toBe(false)
  })

  /**
   * `timingSafeEqual` TIRA si los buffers no miden lo mismo, y el header lo
   * controla quien manda el request. Sin el hasheo previo, un header de un
   * carácter sería una excepción no capturada adentro del handler en vez de un
   * 404 — o sea, una forma de distinguir desde afuera un secreto configurado de
   * uno que no.
   */
  it('una firma de largo raro devuelve false y no lanza', () => {
    for (const raro of ['a', 'x'.repeat(500), '💥', '0'.repeat(63)]) {
      expect(() => firmaValida(cuerpo, raro, SECRETO)).not.toThrow()
      expect(firmaValida(cuerpo, raro, SECRETO)).toBe(false)
    }
  })
})
