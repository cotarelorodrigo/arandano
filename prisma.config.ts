import { defineConfig } from 'prisma/config'

// MIGRATE_DATABASE_URL y no DATABASE_URL: el CLI migra con el rol dueño de las
// tablas. La app nunca lee este archivo — se conecta por el driver adapter con
// el pool de lib/db.ts —, así que no existe la combinación de variables en la
// que la app termine conectada como owner.
//
// El `?? ''` está para que `prisma generate` funcione sin la variable puesta
// (generar no se conecta a nada). Los comandos que sí se conectan fallan con
// una URL vacía, que es un error claro y no un destino equivocado.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? '' },
})
