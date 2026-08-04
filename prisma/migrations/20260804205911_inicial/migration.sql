-- CreateEnum
CREATE TYPE "estado_tenant" AS ENUM ('TRIAL', 'ACTIVO', 'SUSPENDIDO');

-- CreateEnum
CREATE TYPE "modulo" AS ENUM ('ORDENES_DE_TRABAJO', 'TURNOS', 'GASTRONOMIA');

-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('DUENO', 'EMPLEADO');

-- CreateEnum
CREATE TYPE "tipo_articulo" AS ENUM ('PRODUCTO', 'SERVICIO');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "subdominio" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "estado_tenant" NOT NULL DEFAULT 'TRIAL',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "modulo" "modulo" NOT NULL,
    "activado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id","modulo")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "rol_usuario" NOT NULL DEFAULT 'EMPLEADO',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "email" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "tipo_articulo" NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "articulos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdominio_key" ON "tenants"("subdominio");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "clientes_tenant_id_idx" ON "clientes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "articulos_tenant_id_sku_key" ON "articulos"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Tres piezas de la expresión, ninguna decorativa:
--   * el segundo argumento `true` de current_setting hace que una GUC sin
--     setear devuelva NULL en vez de tirar error;
--   * el nullif evita que una cadena vacía llegue al cast y lo haga explotar;
--   * como NULL = uuid da NULL, y NULL no es true, SIN GUC NO PASA NINGUNA
--     FILA. Falla cerrado, que es la única forma aceptable de fallar acá.
--
-- El WITH CHECK explícito asegura que la intención queda legible: protección
-- tanto en lectura como en escritura. Para policies FOR ALL sin él, Postgres
-- reutiliza USING para ambas, pero queremos que sea explícito para que un
-- futuro refactor a policies por comando no cambie el significado.
--
-- Las policies van SIN cláusula TO: nombrar un rol adentro las ataría a que
-- ese rol exista antes que la tabla, y un CREATE POLICY que nombra un rol
-- inexistente hace salir a pg_restore con 1 y deja la policy sin crear. Está
-- reproducido y documentado en scripts/verify-backup.sh.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "tenants" FOR ALL
  USING      ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "tenant_modules" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "users" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "clientes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "clientes" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "articulos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "articulos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
