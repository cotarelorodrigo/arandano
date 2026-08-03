import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Todo el repo, no sólo lib/. `npm test` es la primera etapa del gate de
    // deploy, y un glob acotado a un directorio no hace fallar los tests de
    // afuera: los vuelve INVISIBLES, que es peor. Con modules/<nombre>/ como
    // lugar donde va a vivir el código de cada módulo (ver CLAUDE.md), un
    // include atado a lib/ dejaría fuera del gate a todos los módulos futuros
    // sin decir una palabra. vitest ya excluye node_modules por defecto.
    include: ['**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
})
