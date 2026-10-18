-- CreateTable
CREATE TABLE "rangos_de_bateria" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "minimo" INTEGER NOT NULL,
    "maximo" INTEGER NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rangos_de_bateria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_de_canje" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modelos_de_canje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valores_de_canje" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "modelo_id" UUID NOT NULL,
    "rango_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "valores_de_canje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_de_canje" (
    "tenant_id" UUID NOT NULL,
    "moneda" "moneda" NOT NULL DEFAULT 'USD',
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "configuraciones_de_canje_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "rangos_de_bateria_tenant_id_idx" ON "rangos_de_bateria"("tenant_id");

-- CreateIndex
CREATE INDEX "modelos_de_canje_tenant_id_idx" ON "modelos_de_canje"("tenant_id");

-- CreateIndex
CREATE INDEX "valores_de_canje_tenant_id_idx" ON "valores_de_canje"("tenant_id");

-- CreateIndex
CREATE INDEX "valores_de_canje_rango_id_idx" ON "valores_de_canje"("rango_id");

-- CreateIndex
CREATE UNIQUE INDEX "valores_de_canje_modelo_id_rango_id_key" ON "valores_de_canje"("modelo_id", "rango_id");

-- AddForeignKey
ALTER TABLE "rangos_de_bateria" ADD CONSTRAINT "rangos_de_bateria_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelos_de_canje" ADD CONSTRAINT "modelos_de_canje_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valores_de_canje" ADD CONSTRAINT "valores_de_canje_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valores_de_canje" ADD CONSTRAINT "valores_de_canje_modelo_id_fkey" FOREIGN KEY ("modelo_id") REFERENCES "modelos_de_canje"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valores_de_canje" ADD CONSTRAINT "valores_de_canje_rango_id_fkey" FOREIGN KEY ("rango_id") REFERENCES "rangos_de_bateria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_de_canje" ADD CONSTRAINT "configuraciones_de_canje_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lo que Prisma no sabe declarar en el schema.
--
-- El nombre del modelo es único por local SIN distinguir mayúsculas: "iphone
-- 14" e "iPhone 14" son el mismo equipo, y dos filas harían que el vendedor
-- elija entre dos precios para lo mismo. Un índice de expresión, como el
-- parcial de `categorias` (20260824023756_categorias): `migrate diff` no lo ve y
-- por eso no lo pide borrar. lib/canje/administrar.ts chequea antes, para poder
-- decir con qué nombre choca; éste es el que gana la carrera entre dos altas
-- simultáneas.
CREATE UNIQUE INDEX "modelos_de_canje_tenant_id_nombre_sin_mayusculas_key"
  ON "modelos_de_canje" ("tenant_id", lower("nombre"));

-- Redes debajo de la validación de la aplicación, no en su lugar: la pantalla
-- dice qué corregir y estas sólo impiden que un bug guarde algo imposible. Un
-- rango fuera de 0–100 o al revés no describe ninguna batería, y un valor
-- negativo sería el local cobrándole al cliente por llevarse su equipo.
ALTER TABLE "rangos_de_bateria" ADD CONSTRAINT "rangos_de_bateria_limites_check"
  CHECK ("minimo" >= 0 AND "minimo" <= "maximo" AND "maximo" <= 100);
ALTER TABLE "valores_de_canje" ADD CONSTRAINT "valores_de_canje_valor_check"
  CHECK ("valor" >= 0);

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "rangos_de_bateria" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "rangos_de_bateria" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "modelos_de_canje" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "modelos_de_canje" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "valores_de_canje" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "valores_de_canje" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "configuraciones_de_canje" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "configuraciones_de_canje" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
