import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'

// El mock tiene que estar puesto ANTES de importar guardar.ts, y DATABASE_URL
// antes de que lib/db.ts construya el pool: por eso los imports son dinámicos,
// mismo patrón que el resto de los tests con base de este repo.
const notificarLead = vi.fn()
vi.mock('./notificar', () => ({ notificarLead: (l: unknown) => notificarLead(l) }))

let guardarLead: typeof import('./guardar').guardarLead
let owner: Client

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  ;({ guardarLead } = await import('./guardar'))
})

afterAll(async () => {
  await owner.end()
})

async function leerPorMail(email: string) {
  const { rows } = await owner.query('SELECT * FROM leads WHERE email = $1', [email])
  return rows
}

describe('guardarLead', () => {
  it('guarda el lead conectado como la aplicación', async () => {
    notificarLead.mockResolvedValue(undefined)
    await guardarLead({
      nombre: 'Flor',
      email: 'flor@ejemplo.test',
      whatsapp: '+54 9 11 5555 5555',
      rubro: 'celulares',
      mensaje: 'Quiero verlo andando',
    })

    const filas = await leerPorMail('flor@ejemplo.test')
    expect(filas).toHaveLength(1)
    expect(filas[0].nombre).toBe('Flor')
    expect(filas[0].rubro).toBe('celulares')
    expect(filas[0].mensaje).toBe('Quiero verlo andando')
  })

  it('los campos opcionales quedan en NULL', async () => {
    notificarLead.mockResolvedValue(undefined)
    await guardarLead({
      nombre: 'Sin datos',
      email: 'sindatos@ejemplo.test',
      whatsapp: null,
      rubro: 'kiosco',
      mensaje: null,
    })

    const filas = await leerPorMail('sindatos@ejemplo.test')
    expect(filas[0].whatsapp).toBeNull()
    expect(filas[0].mensaje).toBeNull()
  })

  it('avisa después de guardar', async () => {
    notificarLead.mockResolvedValue(undefined)
    await guardarLead({
      nombre: 'Avisado',
      email: 'avisado@ejemplo.test',
      whatsapp: null,
      rubro: 'ferretería',
      mensaje: null,
    })
    expect(notificarLead).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'avisado@ejemplo.test' }),
    )
  })

  // El caso que importa de verdad: nadie puede perder un interesado porque un
  // mensaje no salió. La fila va primero, el aviso después, y si el aviso
  // explota se loguea y se sigue.
  it('si el aviso falla, el lead igual quedó guardado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    notificarLead.mockRejectedValue(new Error('la Cloud API está caída'))

    await expect(
      guardarLead({
        nombre: 'Aviso roto',
        email: 'avisoroto@ejemplo.test',
        whatsapp: null,
        rubro: 'dietética',
        mensaje: null,
      }),
    ).resolves.toBeUndefined()

    expect(await leerPorMail('avisoroto@ejemplo.test')).toHaveLength(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
