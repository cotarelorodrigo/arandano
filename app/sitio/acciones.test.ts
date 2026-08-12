import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'

const estado = vi.hoisted(() => ({ ip: '' }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': estado.ip }),
}))

let enviarLead: typeof import('./acciones').enviarLead
let owner: Client

// Propio del test y no importado del action: ese archivo es 'use server' y sólo
// puede exportar funciones async (test/use-server.test.ts).
const INICIAL = { error: null, enviado: false }

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  ;({ enviarLead } = await import('./acciones'))
})

afterAll(async () => {
  await owner.end()
})

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData()
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

const COMPLETO = {
  nombre: 'Flor',
  email: 'flor-action@ejemplo.test',
  whatsapp: '+54 9 11 5555 5555',
  rubro: 'celulares',
  mensaje: 'Quiero verlo',
}

async function contarPorMail(email: string): Promise<number> {
  const { rows } = await owner.query('SELECT count(*)::int AS n FROM leads WHERE email = $1', [email])
  return rows[0].n
}

describe('enviarLead', () => {
  it('guarda el lead y lo marca enviado', async () => {
    estado.ip = '10.0.0.1'
    const r = await enviarLead(INICIAL, formulario(COMPLETO))
    expect(r).toEqual({ error: null, enviado: true })
    expect(await contarPorMail('flor-action@ejemplo.test')).toBe(1)
  })

  // La respuesta es la MISMA que la del envío bueno: un bot que recibe un error
  // aprende a esquivarlo. Lo que cambia es que no se guarda nada.
  it('el honeypot no guarda y contesta lo mismo', async () => {
    estado.ip = '10.0.0.2'
    const r = await enviarLead(
      INICIAL,
      formulario({ ...COMPLETO, email: 'bot@ejemplo.test', 'sitio-web': 'http://spam.test' }),
    )
    expect(r).toEqual({ error: null, enviado: true })
    expect(await contarPorMail('bot@ejemplo.test')).toBe(0)
  })

  it('sin nombre no guarda y explica qué falta', async () => {
    estado.ip = '10.0.0.3'
    const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, nombre: '', email: 'sinnombre@ejemplo.test' }))
    expect(r.enviado).toBe(false)
    expect(r.error).toMatch(/nombre/i)
    expect(await contarPorMail('sinnombre@ejemplo.test')).toBe(0)
  })

  it('un mail sin arroba no guarda', async () => {
    estado.ip = '10.0.0.4'
    const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'no-es-un-mail' }))
    expect(r.enviado).toBe(false)
    expect(r.error).toMatch(/mail/i)
  })

  it('el sexto envío desde la misma IP se corta', async () => {
    estado.ip = '10.0.0.5'
    for (let i = 0; i < 5; i++) {
      const r = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: `tanda${i}@ejemplo.test` }))
      expect(r.enviado).toBe(true)
    }
    const sexto = await enviarLead(INICIAL, formulario({ ...COMPLETO, email: 'sexto@ejemplo.test' }))
    expect(sexto.enviado).toBe(false)
    expect(sexto.error).toMatch(/varios mensajes/i)
    expect(await contarPorMail('sexto@ejemplo.test')).toBe(0)
  })
})
