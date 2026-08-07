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
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? '',
    // shadowDatabaseUrl es lo que en Prisma 7 reemplazó al flag
    // `--shadow-database-url` de `prisma migrate diff --from-migrations`: la
    // versión nueva del CLI ya no lo acepta por línea de comandos, sólo por
    // config (ver `prisma migrate diff --help`). deploy.sh la usa para el
    // paso de schema-vs-migraciones (CLAUDE.md, bloqueante #9), apuntándola a
    // la misma shadow database efímera que ya levanta para eso.
    //
    // `|| undefined` y no `?? ''` como el de arriba: acá SÍ importa la
    // distinción con "sin setear". `migrate dev` (el uso normal en dev) sabe
    // arreglárselas sin esta variable, creando y destruyendo su propia shadow
    // database temporal — pasarle un string vacío en vez de dejarla ausente
    // podría hacer que intente conectarse a él en lugar de auto-gestionarla.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
})
