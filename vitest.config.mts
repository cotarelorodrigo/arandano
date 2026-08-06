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
    globalSetup: ['./test/global-setup.ts'],
    // Todos los archivos de test comparten UNA sola base efímera. En paralelo
    // se pisarían los datos entre sí, y peor: los tests de roles cambian
    // atributos del rol que otros archivos están usando en ese momento. El
    // costo es tiempo de pared; la alternativa es intermitencia, que en el gate
    // de deploy se lee como "los tests son flaky" y termina en que se ignoran.
    fileParallelism: false,
    // Levantar el contenedor y esperar al servidor definitivo se lleva la mayor
    // parte de este presupuesto.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
})
