-- A qué se dedica el local, para que el prompt del bot no lo afirme por él.
--
-- Aditiva e inerte: el default '' reproduce exactamente el comportamiento
-- anterior —la primera oración del prompt sigue diciendo "un comercio en
-- Argentina"— así que la imagen vieja lee cualquier fila que esta migración
-- pueda producir sin enterarse de que la columna existe. Por eso viaja en el
-- mismo deploy que la UI: lo que expand/contract exige no es la migración en un
-- deploy aparte, es que el schema nuevo soporte la versión anterior del código.
ALTER TABLE "bots_de_whatsapp" ADD COLUMN "a_que_se_dedica" TEXT NOT NULL DEFAULT '';
