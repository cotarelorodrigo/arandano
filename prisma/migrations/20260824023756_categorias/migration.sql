-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "categoria_id" UUID;

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "padre_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categorias_tenant_id_padre_id_idx" ON "categorias"("tenant_id", "padre_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_tenant_id_padre_id_nombre_key" ON "categorias"("tenant_id", "padre_id", "nombre");

-- CreateIndex
CREATE INDEX "articulos_tenant_id_categoria_id_idx" ON "articulos"("tenant_id", "categoria_id");

-- AddForeignKey
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_padre_id_fkey" FOREIGN KEY ("padre_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La otra mitad de la unicidad. El índice que generó Prisma es
-- (tenant_id, padre_id, nombre), y en Postgres NULL <> NULL: dos RAÍCES
-- llamadas "Celulares" en el mismo tenant lo pasan sin chistar, porque su
-- padre_id es NULL en las dos y NULL nunca es igual a nada. Este índice
-- parcial es lo único que las frena.
--
-- Y tiene que ser un índice y no un chequeo de aplicación, por lo mismo que
-- "una sola caja abierta por tenant": dos pestañas creando la misma categoría
-- en el mismo segundo pasan las dos por cualquier `if` previo. La base es el
-- único lugar donde la carrera no existe.
CREATE UNIQUE INDEX "categorias_raiz_unica_por_tenant"
  ON "categorias" ("tenant_id", "nombre")
  WHERE "padre_id" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "categorias" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "categorias" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

-- >>> BACKFILL
-- Convierte el texto libre de articulos.categoria en filas del árbol y engancha
-- cada artículo a la suya.
--
-- **El CTE `nombres` se repite en las tres sentencias**, en vez de
-- materializarse una vez en una tabla temporal. No es descuido: un `DROP TABLE`
-- acá haría que el analizador de migraciones destructivas (.githooks/pre-commit,
-- y el mismo chequeo en el paso 4 de deploy.sh) frene el commit. Un CTE
-- repetido es feo; un hook desactivado con --no-verify para poder commitear es
-- peor, porque después queda desactivado para la migración que sí borraba algo.
--
-- **La regla de parseo es la misma que `partirCategoria`** en
-- lib/inventario/categorias.ts: partir por el middot, trimear cada segmento,
-- DESCARTAR los vacíos, y de lo que queda el primero es la raíz y el resto
-- —unido de nuevo— es la hija. De ahí salen todos los bordes sin escribir
-- ninguno aparte: "· Samsung" da la raíz Samsung porque el segmento vacío se
-- cae, y "A · B · C" da A > "B · C" porque el tercer nivel se pliega en vez de
-- tirarse. `WITH ORDINALITY … ORDER BY i` porque el orden de `unnest` no está
-- garantizado sin él, y acá el orden ES el significado: el primer segmento es
-- el rubro y el segundo la marca.
--
-- **Idempotente entero**: las dos inserciones van con ON CONFLICT DO NOTHING y
-- el UPDATE toca sólo las filas que todavía tienen categoria_id NULL. Correrlo
-- de nuevo no duplica ninguna rama ni mueve ningún artículo ya enganchado — y
-- eso importa porque un deploy se puede reintentar.

-- Las raíces.
WITH nombres AS (
  SELECT DISTINCT a.tenant_id, s.segs[1] AS raiz
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
SELECT gen_random_uuid(), n.tenant_id, n.raiz, NULL, now(), now()
  FROM nombres n
ON CONFLICT DO NOTHING;

-- Las hijas, colgadas de la raíz que la sentencia de arriba dejó lista.
WITH nombres AS (
  SELECT DISTINCT
         a.tenant_id,
         s.segs[1] AS raiz,
         nullif(array_to_string(s.segs[2:], ' · '), '') AS hija
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
SELECT gen_random_uuid(), n.tenant_id, n.hija, p.id, now(), now()
  FROM nombres n
  JOIN categorias p
    ON p.tenant_id = n.tenant_id AND p.nombre = n.raiz AND p.padre_id IS NULL
 WHERE n.hija IS NOT NULL
ON CONFLICT DO NOTHING;

-- Y cada artículo apuntando a su hoja — o a su raíz, si el texto no traía
-- marca. El LEFT JOIN de la hija es lo que hace ese coalesce: con `hija` NULL
-- no matchea ninguna fila, así que queda el id de la raíz.
WITH nombres AS (
  SELECT DISTINCT
         a.tenant_id,
         a.categoria,
         s.segs[1] AS raiz,
         nullif(array_to_string(s.segs[2:], ' · '), '') AS hija
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
UPDATE articulos a
   SET categoria_id = coalesce(h.id, p.id)
  FROM nombres n
  JOIN categorias p
    ON p.tenant_id = n.tenant_id AND p.nombre = n.raiz AND p.padre_id IS NULL
  LEFT JOIN categorias h
    ON h.tenant_id = n.tenant_id AND h.padre_id = p.id AND h.nombre = n.hija
 WHERE a.tenant_id = n.tenant_id
   AND a.categoria = n.categoria
   AND a.categoria_id IS NULL;
-- <<< BACKFILL
