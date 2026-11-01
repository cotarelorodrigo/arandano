-- AlterTable
ALTER TABLE "ordenes_de_trabajo" ADD COLUMN     "costo" DECIMAL(12,2),
ADD COLUMN     "entregada_en" TIMESTAMPTZ(3),
ADD COLUMN     "monto_cobrado" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "ordenes_de_trabajo_tenant_id_estado_entregada_en_idx" ON "ordenes_de_trabajo"("tenant_id", "estado", "entregada_en");

-- Backfill: toda orden que alguna vez pasó a ENTREGADO toma la fecha de su
-- último paso a ENTREGADO, para que el tablero por mes no la deje afuera.
--
-- No sólo las que HOY están en ENTREGADO: la card de plata y guardarPlata leen
-- `entregada_en IS NOT NULL` como "ya pasó por Entregado", y una orden
-- reabierta por garantía se entregó. Filtrando por estado, quedaba sin fecha y
-- no se le podía cargar lo cobrado.
--
-- `entregada_en IS NULL` lo hace idempotente: si un deploy rollbackea a una
-- imagen anterior después de esta migración, las órdenes que el código viejo
-- entregue quedan sin fecha, y el arreglo es volver a correr este UPDATE sin
-- pisar las que ya la tienen (docs/contexto/proximos-pasos.md). Los marcadores
-- son para que test/plata-backfill.test.ts corra este SQL y no una copia.
-- >>> BACKFILL
UPDATE ordenes_de_trabajo o
SET entregada_en = e.ultima
FROM (
  SELECT orden_id, max(creado_en) AS ultima
  FROM eventos_orden WHERE hasta = 'ENTREGADO' GROUP BY orden_id
) e
WHERE e.orden_id = o.id AND o.entregada_en IS NULL;
-- <<< BACKFILL
