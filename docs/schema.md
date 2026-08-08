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
  articulos {
    uuid id PK
    uuid tenant_id FK "único junto a sku"
    text sku "único junto a tenant_id"
    text nombre
    tipo_articulo tipo
    decimal(12,2) precio
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
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  users {
    uuid id PK
    uuid tenant_id FK "único junto a email"
    text nombre
    text email "único junto a tenant_id"
    rol_usuario rol
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  tenants ||--o{ articulos : "ON DELETE CASCADE"
  tenants ||--o{ clientes : "ON DELETE CASCADE"
  tenants ||--o{ tenant_modules : "ON DELETE CASCADE"
  tenants ||--o{ users : "ON DELETE CASCADE"
```

## Enums

- **estado_tenant**: `TRIAL`, `ACTIVO`, `SUSPENDIDO`
- **modulo**: `ORDENES_DE_TRABAJO`, `TURNOS`, `GASTRONOMIA`
- **rol_usuario**: `DUENO`, `EMPLEADO`
- **tipo_articulo**: `PRODUCTO`, `SERVICIO`

## Índices no únicos

- **clientes**: `clientes_tenant_id_idx` sobre (`tenant_id`)
