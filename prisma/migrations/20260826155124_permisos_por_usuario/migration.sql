-- CreateEnum
CREATE TYPE "permiso" AS ENUM ('ARTICULOS_CREAR', 'ARTICULOS_EDITAR', 'COSTOS', 'CATEGORIAS', 'VENTAS_ANULAR', 'ORDENES_ANULAR');

-- CreateTable
CREATE TABLE "usuario_permisos" (
    "tenant_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "permiso" "permiso" NOT NULL,
    "otorgado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_permisos_pkey" PRIMARY KEY ("tenant_id","usuario_id","permiso")
);

-- AddForeignKey
ALTER TABLE "usuario_permisos" ADD CONSTRAINT "usuario_permisos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_permisos" ADD CONSTRAINT "usuario_permisos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "usuario_permisos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "usuario_permisos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
