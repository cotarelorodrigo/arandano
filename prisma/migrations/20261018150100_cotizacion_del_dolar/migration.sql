-- CreateTable
CREATE TABLE "cotizaciones_del_dolar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "cargada_por_id" UUID NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cotizaciones_del_dolar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cotizaciones_del_dolar_tenant_id_creada_en_idx" ON "cotizaciones_del_dolar"("tenant_id", "creada_en");

-- AddForeignKey
ALTER TABLE "cotizaciones_del_dolar" ADD CONSTRAINT "cotizaciones_del_dolar_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cotizaciones_del_dolar" ADD CONSTRAINT "cotizaciones_del_dolar_cargada_por_id_fkey" FOREIGN KEY ("cargada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo que Prisma no sabe declarar en el schema.
--
-- Red debajo de la validación de la aplicación, no en su lugar: la pantalla
-- dice qué corregir (lib/cotizacion/administrar.ts) y esto sólo impide que un
-- bug guarde un dólar a cero o negativo, que convertiría cualquier precio en
-- nada. Mismo criterio que los CHECK de 20261018130100_plan_canje.
ALTER TABLE "cotizaciones_del_dolar" ADD CONSTRAINT "cotizaciones_del_dolar_valor_check"
  CHECK ("valor" > 0);

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
--
-- Que la tabla sea append-only NO lo dice esta migración sino
-- scripts/setup-db-roles.sh (REVOKE UPDATE, DELETE), igual que ediciones_venta:
-- los privilegios del rol de la app viven ahí, en un solo lugar.
ALTER TABLE "cotizaciones_del_dolar" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "cotizaciones_del_dolar" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
