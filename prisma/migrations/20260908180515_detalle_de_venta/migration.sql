-- El detalle de una venta: texto libre para el dato de entrega.
--
-- Aditiva e inerte: nullable, sin default, cero DROP y cero renombres. El
-- código anterior no la escribe por ningún camino y no la lee por ninguno, así
-- que la imagen vieja lee cualquier fila que esta migración pueda producir sin
-- enterarse de que la columna existe. Por eso viaja en el mismo deploy que la
-- UI: lo que expand/contract exige no es la migración en un deploy aparte, es
-- que el schema nuevo soporte la versión anterior del código.
ALTER TABLE "ventas" ADD COLUMN "detalle" TEXT;
