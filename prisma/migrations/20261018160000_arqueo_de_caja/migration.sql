-- CreateEnum
CREATE TYPE "tipo_movimiento_caja" AS ENUM ('INGRESO', 'EGRESO', 'RETIRO');

-- AlterTable
ALTER TABLE "cajas" ADD COLUMN     "contado_ars" DECIMAL(12,2),
ADD COLUMN     "contado_usd" DECIMAL(12,2),
ADD COLUMN     "esperado_ars" DECIMAL(12,2),
ADD COLUMN     "esperado_usd" DECIMAL(12,2),
ADD COLUMN     "nota_cierre" TEXT,
ADD COLUMN     "retirado_ars" DECIMAL(12,2),
ADD COLUMN     "retirado_usd" DECIMAL(12,2),
ADD COLUMN     "saldo_inicial_usd" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "movimientos_de_caja" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "caja_id" UUID NOT NULL,
    "tipo" "tipo_movimiento_caja" NOT NULL,
    "moneda" "moneda" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "nota" TEXT,
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_de_caja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_de_caja_tenant_id_caja_id_idx" ON "movimientos_de_caja"("tenant_id", "caja_id");

-- AddForeignKey
ALTER TABLE "movimientos_de_caja" ADD CONSTRAINT "movimientos_de_caja_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_de_caja" ADD CONSTRAINT "movimientos_de_caja_caja_id_fkey" FOREIGN KEY ("caja_id") REFERENCES "cajas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_de_caja" ADD CONSTRAINT "movimientos_de_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lo que Prisma no sabe declarar en el schema.
--
-- Red debajo de la validación de la aplicación, no en su lugar: el formulario
-- dice qué corregir (lib/caja/movimientos.ts, lib/caja/abrir-cerrar.ts) y esto
-- sólo impide que un bug guarde un movimiento en cero o negativo —el sentido lo
-- da `tipo`, nunca el signo, así que un monto negativo sería un egreso escrito
-- de una segunda manera— o un arqueo con plata negativa en el cajón. Mismo
-- criterio que los CHECK de 20261018130100_plan_canje y de
-- 20261018150100_cotizacion_del_dolar.
--
-- `esperado_*` NO lleva CHECK, a propósito: es una cuenta, no algo que alguien
-- tipeó, y un egreso mayor que lo que había da un esperado negativo que el
-- arqueo tiene que mostrar tal cual en vez de rechazar el cierre.
--
-- `saldo_inicial_usd` sí, igual que debería tenerlo `saldo_inicial` (que no lo
-- tiene desde su migración; sumárselo ahora es un cambio sobre datos ya
-- escritos y queda fuera de este ciclo aditivo).
ALTER TABLE "movimientos_de_caja" ADD CONSTRAINT "movimientos_de_caja_monto_check"
  CHECK ("monto" > 0);
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_saldo_inicial_usd_check"
  CHECK ("saldo_inicial_usd" >= 0);
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_arqueo_no_negativo_check"
  CHECK (
    ("contado_ars" IS NULL OR "contado_ars" >= 0) AND
    ("contado_usd" IS NULL OR "contado_usd" >= 0) AND
    ("retirado_ars" IS NULL OR "retirado_ars" >= 0) AND
    ("retirado_usd" IS NULL OR "retirado_usd" >= 0)
  );

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
--
-- Que la tabla sea append-only NO lo dice esta migración sino
-- scripts/setup-db-roles.sh (REVOKE UPDATE, DELETE), igual que
-- cotizaciones_del_dolar: los privilegios del rol de la app viven ahí, en un
-- solo lugar.
ALTER TABLE "movimientos_de_caja" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "movimientos_de_caja" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
