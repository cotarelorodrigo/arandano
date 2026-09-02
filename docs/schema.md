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
>
> **Tampoco muestra los índices únicos escritos a mano en una migración**, por
> el mismo motivo: `migrate diff` compara contra `schema.prisma`, no contra el
> SQL de `prisma/migrations/`. Hoy son dos, y los dos son índices únicos
> PARCIALES que sostienen una invariante que el schema no puede expresar:
>
> - `cajas_una_abierta_por_tenant` (`WHERE cerrada_en IS NULL`) — no hay dos
>   turnos abiertos a la vez.
> - `categorias_raiz_unica_por_tenant` (`WHERE padre_id IS NULL`) — no hay dos
>   categorías raíz con el mismo nombre. El `@@unique` que sí está en el schema
>   lleva `padre_id` adentro, y en Postgres NULL <> NULL, así que a las raíces
>   no las alcanza.
>
> Ninguno de los dos aparece en ninguna parte de este documento.

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
    text categoria "opcional"
    uuid categoria_id FK "opcional"
    decimal(12,2) precio
    moneda moneda
    boolean lleva_serie
    decimal(12,3) stock
    timestamptz(3) desactivado_en "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  bots_de_whatsapp {
    uuid id PK
    uuid tenant_id FK, UK
    text kapso_customer_id "opcional"
    text phone_number_id UK "opcional"
    text numero_visible "opcional"
    text waba_id "opcional"
    text webhook_id "opcional"
    text webhook_secreto "opcional"
    timestamptz(3) conectado_en "opcional"
    boolean activo
    text instrucciones
    integer tope_mensual
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  cajas {
    uuid id PK
    uuid tenant_id FK
    timestamptz(3) abierta_en
    uuid abierta_por_id FK
    decimal(12,2) saldo_inicial
    timestamptz(3) cerrada_en "opcional"
    uuid cerrada_por_id FK "opcional"
    timestamptz(3) creado_en
  }
  categorias {
    uuid id PK
    uuid tenant_id FK "único junto a padre_id, nombre"
    text nombre "único junto a tenant_id, padre_id"
    uuid padre_id FK "opcional; único junto a tenant_id, nombre"
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
  conversaciones_bot {
    uuid id PK
    uuid tenant_id FK "único junto a wa_id"
    text wa_id "único junto a tenant_id"
    text kapso_conversacion_id "opcional"
    text nombre_contacto "opcional"
    timestamptz(3) creado_en
    timestamptz(3) ultimo_mensaje_en
  }
  eventos_orden {
    uuid id PK
    uuid tenant_id FK
    uuid orden_id FK
    estado_orden desde "opcional"
    estado_orden hasta
    text nota "opcional"
    uuid usuario_id FK
    timestamptz(3) creado_en
  }
  leads {
    uuid id PK
    text nombre "opcional"
    text email "opcional"
    text whatsapp "opcional"
    text rubro "opcional"
    text mensaje "opcional"
    timestamptz(3) creado_en
  }
  mensajes_bot {
    uuid id PK
    uuid tenant_id FK "único junto a wamid"
    uuid conversacion_id FK
    direccion_mensaje direccion
    text texto
    text wamid "opcional; único junto a tenant_id"
    motivo_sin_respuesta motivo "opcional"
    text error "opcional"
    timestamptz(3) creado_en
  }
  movimientos_stock {
    uuid id PK
    uuid tenant_id FK
    uuid articulo_id FK
    decimal(12,3) delta
    decimal(12,2) costo_unitario "opcional"
    motivo_movimiento motivo
    uuid venta_id FK "opcional"
    uuid unidad_id FK "opcional"
    uuid usuario_id FK
    text nota "opcional"
    timestamptz(3) creado_en
  }
  ordenes_de_trabajo {
    uuid id PK
    uuid tenant_id FK "único junto a numero; único junto a clave_idempotencia"
    integer numero "único junto a tenant_id"
    text clave_idempotencia "opcional; único junto a tenant_id"
    uuid cliente_id FK
    uuid recibida_por_id FK
    estado_orden estado
    text equipo_marca
    text equipo_modelo
    text equipo_serie "opcional"
    text clave_desbloqueo "opcional"
    text falla_declarada
    text accesorios "opcional"
    text danos_visibles "opcional"
    text diagnostico "opcional"
    decimal(12,2) monto_estimado "opcional"
    timestamptz(3) anulada_en "opcional"
    uuid anulada_por_id FK "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  pagos {
    uuid id PK
    uuid tenant_id FK
    uuid venta_id FK
    medio_pago medio
    moneda moneda
    moneda cubre
    decimal(12,2) monto
    decimal(12,4) cotizacion
    uuid plan_de_pago_id FK "opcional"
    decimal(12,2) recargo
    timestamptz(3) creado_en
  }
  planes_de_pago {
    uuid id PK
    uuid tenant_id FK "único junto a medio, nombre"
    text nombre "único junto a tenant_id, medio"
    medio_pago medio "único junto a tenant_id, nombre"
    integer cuotas
    decimal(6,3) recargo_porcentaje
    integer orden
    timestamptz(3) desactivado_en "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
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
    integer proximo_numero_orden
    decimal(12,2) cotizacion_usd "opcional"
    timestamptz(3) cotizacion_usd_en "opcional"
    timestamptz(3) creado_en
    timestamptz(3) actualizado_en
  }
  unidades_articulo {
    uuid id PK
    uuid tenant_id FK
    uuid articulo_id FK
    text imei
    timestamptz(3) ingresada_en
    uuid ingresada_por_id FK
    uuid venta_id FK "opcional"
    timestamptz(3) baja_en "opcional"
    text baja_nota "opcional"
    uuid baja_por_id FK "opcional"
    timestamptz(3) creado_en
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
  usuario_permisos {
    uuid tenant_id PK, FK
    uuid usuario_id PK, FK
    permiso permiso PK
    timestamptz(3) otorgado_en
  }
  venta_items {
    uuid id PK
    uuid tenant_id FK
    uuid venta_id FK
    uuid articulo_id FK
    text descripcion
    decimal(12,3) cantidad
    decimal(12,2) precio_unitario
    moneda moneda
  }
  ventas {
    uuid id PK
    uuid tenant_id FK "único junto a numero; único junto a clave_idempotencia"
    integer numero "único junto a tenant_id"
    text clave_idempotencia "opcional; único junto a tenant_id"
    uuid cliente_id FK "opcional"
    uuid usuario_id FK
    decimal(12,2) total
    decimal(12,2) recargo
    decimal(12,2) total_usd
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
  articulos ||--o{ unidades_articulo : "ON DELETE RESTRICT"
  articulos ||--o{ venta_items : "ON DELETE RESTRICT"
  categorias |o--o{ articulos : "ON DELETE RESTRICT"
  categorias |o--o{ categorias : "ON DELETE RESTRICT"
  clientes |o--o{ ventas : "ON DELETE RESTRICT"
  clientes ||--o{ ordenes_de_trabajo : "ON DELETE RESTRICT"
  conversaciones_bot ||--o{ mensajes_bot : "ON DELETE CASCADE"
  ordenes_de_trabajo ||--o{ eventos_orden : "ON DELETE CASCADE"
  planes_de_pago |o--o{ pagos : "ON DELETE RESTRICT"
  tenants ||--o{ accounts : "ON DELETE CASCADE"
  tenants ||--o{ articulos : "ON DELETE CASCADE"
  tenants ||--o{ cajas : "ON DELETE CASCADE"
  tenants ||--o{ categorias : "ON DELETE CASCADE"
  tenants ||--o{ clientes : "ON DELETE CASCADE"
  tenants ||--o{ conversaciones_bot : "ON DELETE CASCADE"
  tenants ||--o{ eventos_orden : "ON DELETE CASCADE"
  tenants ||--o{ mensajes_bot : "ON DELETE CASCADE"
  tenants ||--o{ movimientos_stock : "ON DELETE CASCADE"
  tenants ||--o{ ordenes_de_trabajo : "ON DELETE CASCADE"
  tenants ||--o{ pagos : "ON DELETE CASCADE"
  tenants ||--o{ planes_de_pago : "ON DELETE CASCADE"
  tenants ||--o{ sessions : "ON DELETE CASCADE"
  tenants ||--o{ tenant_modules : "ON DELETE CASCADE"
  tenants ||--o{ unidades_articulo : "ON DELETE CASCADE"
  tenants ||--o{ users : "ON DELETE CASCADE"
  tenants ||--o{ usuario_permisos : "ON DELETE CASCADE"
  tenants ||--o{ venta_items : "ON DELETE CASCADE"
  tenants ||--o{ ventas : "ON DELETE CASCADE"
  tenants ||--o{ verifications : "ON DELETE CASCADE"
  tenants ||--o| bots_de_whatsapp : "ON DELETE CASCADE"
  unidades_articulo |o--o{ movimientos_stock : "ON DELETE RESTRICT"
  users |o--o{ cajas : "ON DELETE RESTRICT"
  users |o--o{ ordenes_de_trabajo : "ON DELETE RESTRICT"
  users |o--o{ unidades_articulo : "ON DELETE RESTRICT"
  users |o--o{ ventas : "ON DELETE RESTRICT"
  users ||--o{ accounts : "ON DELETE CASCADE"
  users ||--o{ cajas : "ON DELETE RESTRICT"
  users ||--o{ eventos_orden : "ON DELETE RESTRICT"
  users ||--o{ movimientos_stock : "ON DELETE RESTRICT"
  users ||--o{ ordenes_de_trabajo : "ON DELETE RESTRICT"
  users ||--o{ sessions : "ON DELETE CASCADE"
  users ||--o{ unidades_articulo : "ON DELETE RESTRICT"
  users ||--o{ usuario_permisos : "ON DELETE CASCADE"
  users ||--o{ ventas : "ON DELETE RESTRICT"
  ventas |o--o{ movimientos_stock : "ON DELETE RESTRICT"
  ventas |o--o{ unidades_articulo : "ON DELETE RESTRICT"
  ventas ||--o{ pagos : "ON DELETE CASCADE"
  ventas ||--o{ venta_items : "ON DELETE CASCADE"
```

## Enums

- **direccion_mensaje**: `ENTRANTE`, `SALIENTE`
- **estado_orden**: `RECIBIDO`, `EN_DIAGNOSTICO`, `PRESUPUESTADO`, `APROBADO`, `EN_REPARACION`, `LISTO`, `ENTREGADO`, `SIN_REPARACION`, `RECHAZADO`
- **estado_tenant**: `TRIAL`, `ACTIVO`, `SUSPENDIDO`
- **medio_pago**: `EFECTIVO`, `TRANSFERENCIA`, `TARJETA_DEBITO`, `TARJETA_CREDITO`
- **modulo**: `ORDENES_DE_TRABAJO`, `TURNOS`, `GASTRONOMIA`
- **moneda**: `ARS`, `USD`
- **motivo_movimiento**: `VENTA`, `ANULACION_VENTA`, `AJUSTE`, `INGRESO`
- **motivo_sin_respuesta**: `BOT_APAGADO`, `TOPE_MENSUAL`, `TOPE_CONVERSACION`, `SIN_TEXTO`, `SIN_MODELO`
- **permiso**: `ARTICULOS_CREAR`, `ARTICULOS_EDITAR`, `COSTOS`, `CATEGORIAS`, `VENTAS_ANULAR`, `ORDENES_ANULAR`, `PLANES_PAGO`, `BOT`
- **rol_usuario**: `DUENO`, `EMPLEADO`
- **tipo_articulo**: `PRODUCTO`, `SERVICIO`

## Índices no únicos

- **accounts**: `accounts_tenant_id_user_id_idx` sobre (`tenant_id`, `user_id`)
- **articulos**: `articulos_tenant_id_categoria_id_idx` sobre (`tenant_id`, `categoria_id`)
- **cajas**: `cajas_tenant_id_abierta_en_idx` sobre (`tenant_id`, `abierta_en`)
- **categorias**: `categorias_tenant_id_padre_id_idx` sobre (`tenant_id`, `padre_id`)
- **clientes**: `clientes_tenant_id_idx` sobre (`tenant_id`)
- **conversaciones_bot**: `conversaciones_bot_tenant_id_ultimo_mensaje_en_idx` sobre (`tenant_id`, `ultimo_mensaje_en`)
- **eventos_orden**: `eventos_orden_tenant_id_orden_id_creado_en_idx` sobre (`tenant_id`, `orden_id`, `creado_en`)
- **mensajes_bot**: `mensajes_bot_tenant_id_conversacion_id_creado_en_idx` sobre (`tenant_id`, `conversacion_id`, `creado_en`)
- **mensajes_bot**: `mensajes_bot_tenant_id_direccion_creado_en_idx` sobre (`tenant_id`, `direccion`, `creado_en`)
- **movimientos_stock**: `movimientos_stock_tenant_id_articulo_id_idx` sobre (`tenant_id`, `articulo_id`)
- **movimientos_stock**: `movimientos_stock_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **ordenes_de_trabajo**: `ordenes_de_trabajo_tenant_id_cliente_id_idx` sobre (`tenant_id`, `cliente_id`)
- **ordenes_de_trabajo**: `ordenes_de_trabajo_tenant_id_estado_creado_en_idx` sobre (`tenant_id`, `estado`, `creado_en`)
- **pagos**: `pagos_tenant_id_moneda_creado_en_idx` sobre (`tenant_id`, `moneda`, `creado_en`)
- **pagos**: `pagos_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **planes_de_pago**: `planes_de_pago_tenant_id_medio_idx` sobre (`tenant_id`, `medio`)
- **sessions**: `sessions_tenant_id_user_id_idx` sobre (`tenant_id`, `user_id`)
- **unidades_articulo**: `unidades_articulo_tenant_id_articulo_id_idx` sobre (`tenant_id`, `articulo_id`)
- **unidades_articulo**: `unidades_articulo_tenant_id_imei_idx` sobre (`tenant_id`, `imei`)
- **venta_items**: `venta_items_tenant_id_venta_id_idx` sobre (`tenant_id`, `venta_id`)
- **ventas**: `ventas_tenant_id_creado_en_idx` sobre (`tenant_id`, `creado_en`)
- **verifications**: `verifications_tenant_id_identifier_idx` sobre (`tenant_id`, `identifier`)
