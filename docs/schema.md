# Diagrama de la base de datos

> **Generado por `scripts/generar-erd.sh` desde el DDL que produce
> `prisma migrate diff`. No editar a mano**: el hook de pre-commit y el paso 3
> de `deploy.sh` regeneran y frenan si este archivo no coincide.
>
> Los nombres y los tipos son los de Postgres, porque salen del SQL que
> efectivamente crea la base.
>
> **Lo que este diagrama NO muestra son las policies de RLS**, que son lo que
> aísla un tenant de otro. Viven en el SQL escrito a mano de las migraciones, no
> en el schema, así que `migrate diff` no las ve. El modelo de aislamiento está
> explicado en `docs/superpowers/specs/2026-08-04-schema-nucleo-design.md`.

```mermaid
erDiagram
  accounts {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text account_id
    text provider_id
    text access_token "opcional"
    text refresh_token "opcional"
    text id_token "opcional"
    timestamptz(3) access_token_expira_en "opcional"
    timestamptz(3) refresh_token_expira_en "opcional"
    text scope "opcional"
    text password "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  articulos {
    uuid id PK
    uuid tenant_id FK "único junto a sku"
    text sku "único junto a tenant_id"
    text nombre
    tipo_articulo tipo
    decimal(12,2) precio
    decimal(12,3) stock
    timestamptz(3) desactivado_en "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  clientes {
    uuid id PK
    uuid tenant_id FK
    text nombre
    text telefono "opcional"
    text email "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  movimientos_stock {
    uuid id PK
    uuid tenant_id FK
    uuid articulo_id FK
    decimal(12,3) delta
    decimal(12,2) costo_unitario "opcional"
    motivo_movimiento motivo
    uuid venta_id FK "opcional"
    uuid usuario_id FK
    text nota "opcional"
    timestamptz(3) creado_en
  }
  pagos {
    uuid id PK
    uuid tenant_id FK
    uuid venta_id FK
    medio_pago medio
    moneda moneda
    decimal(12,2) monto
    decimal(12,4) cotizacion
    timestamptz(3) creado_en
  }
  sessions {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text token UK
    timestamptz(3) expira_en
    text ip "opcional"
    text user_agent "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  tenant_modules {
    uuid tenant_id PK, FK
    modulo modulo PK
    timestamptz(3) activado_en
  }
  tenants {
    uuid id PK
    text subdominio UK
    text nombre
    estado_tenant estado
    integer proximo_numero_venta
    integer proximo_sku_articulo
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  users {
    uuid id PK
    uuid tenant_id FK "único junto a email"
    text nombre
    text email "único junto a tenant_id"
    rol_usuario rol
    boolean email_verificado
    text imagen "opcional"
    timestamptz(3) desactivado_en "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  venta_items {
    uuid id PK
    uuid tenant_id FK
    uuid venta_id FK
    uuid articulo_id FK
    text descripcion
    decimal(12,3) cantidad
    decimal(12,2) precio_unitario
  }
  ventas {
    uuid id PK
    uuid tenant_id FK "único junto a numero"
    integer numero "único junto a tenant_id"
    uuid cliente_id FK "opcional"
    uuid usuario_id FK
    decimal(12,2) total
    timestamptz(3) anulada_en "opcional"
    uuid anulada_por_id FK "opcional"
    timestamptz(3) creado_en
  }
  verifications {
    uuid id PK
    uuid tenant_id FK
    text identifier
    text value
    timestamptz(3) expira_en
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  articulos ||--o{ movimientos_stock : "ON DELETE RESTRICT"
  articulos ||--o{ venta_items : "ON DELETE RESTRICT"
  clientes |o--o{ ventas : "ON DELETE RESTRICT"
  tenants ||--o{ accounts : "ON DELETE CASCADE"
  tenants ||--o{ articulos : "ON DELETE CASCADE"
  tenants ||--o{ clientes : "ON DELETE CASCADE"
  tenants ||--o{ movimientos_stock : "ON DELETE CASCADE"
  tenants ||--o{ pagos : "ON DELETE CASCADE"
  tenants ||--o{ sessions : "ON DELETE CASCADE"
  tenants ||--o{ tenant_modules : "ON DELETE CASCADE"
  tenants ||--o{ users : "ON DELETE CASCADE"
  tenants ||--o{ venta_items : "ON DELETE CASCADE"
  tenants ||--o{ ventas : "ON DELETE CASCADE"
  tenants ||--o{ verifications : "ON DELETE CASCADE"
  users |o--o{ ventas : "ON DELETE RESTRICT"
  users ||--o{ accounts : "ON DELETE CASCADE"
  users ||--o{ movimientos_stock : "ON DELETE RESTRICT"
  users ||--o{ sessions : "ON DELETE CASCADE"
  users ||--o{ ventas : "ON DELETE RESTRICT"
  ventas |o--o{ movimientos_stock : "ON DELETE RESTRICT"
  ventas ||--o{ pagos : "ON DELETE CASCADE"
  ventas ||--o{ venta_items : "ON DELETE CASCADE"
```

## Enums

- **estado_tenant**: `TRIAL`, `ACTIVO`, `SUSPENDIDO`
- **medio_pago**: `EFECTIVO`, `TRANSFERENCIA`, `TARJETA_DEBITO`, `TARJETA_CREDITO`
- **modulo**: `ORDENES_DE_TRABAJO`, `TURNOS`, `GASTRONOMIA`
- **moneda**: `ARS`, `USD`
- **motivo_movimiento**: `VENTA`, `ANULACION_VENTA`, `AJUSTE`, `INGRESO`
- **rol_usuario**: `DUENO`, `EMPLEADO`
- **tipo_articulo**: `PRODUCTO`, `SERVICIO`

## Índices no únicos

- **accounts**: `accounts_tenant_id_user_id_idx` sobre (`tenant_id`, `user_id`)
- **clientes**: `clientes_tenant_id_idx` sobre (`tenant_id`)
- **movimientos_stock**: `movimientos_stock_tenant_id_articulo_id_idx` sobre (`tenant_id`, `articulo_id`)
- **movimientos_stock**: `movimientos_stock_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **pagos**: `pagos_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **sessions**: `sessions_tenant_id_user_id_idx` sobre (`tenant_id`, `user_id`)
- **venta_items**: `venta_items_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **ventas**: `ventas_tenant_id_creado_en_idx` sobre (`tenant_id`, `creado_en`)
- **verifications**: `verifications_tenant_id_identifier_idx` sobre (`tenant_id`, `identifier`)
