import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { BASE, urlSuperusuario } from './postgres-efimero'

describe('Postgres efímero de los tests', () => {
  it('acepta conexiones y es la base descartable, no la de dev', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        'SELECT current_database() AS db, current_setting($1) AS version',
        ['server_version'],
      )
      expect(rows[0].db).toBe(BASE)
      // Paranoia deliberada: si esto alguna vez apunta a dev, los tests
      // borrarían trabajo en curso de alguien.
      expect(rows[0].db).not.toBe('arandano_dev')
      expect(rows[0].version.startsWith('17')).toBe(true)
    } finally {
      await cliente.end()
    }
  })
})
