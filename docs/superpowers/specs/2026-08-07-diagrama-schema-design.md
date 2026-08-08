# Spec: el diagrama de la base de datos, generado y verificado

Fecha: 2026-08-07 (revisado el mismo día — ver *Por qué esta es la segunda versión*)

Un ERD de la base en Mermaid, generado desde el **DDL que produce Prisma** y
verificado por el hook de pre-commit y por `deploy.sh`, de modo que no pueda
quedar desactualizado sin que algo frene.

## Por qué generado, y no escrito

Un diagrama ER dibujado a mano se desactualiza a la primera columna que alguien
agregue sin acordarse de abrirlo, y un diagrama desactualizado es peor que
ninguno: se le cree.

No es una precaución teórica en este proyecto. El ciclo de `deploy.sh` terminó
con tres defectos de la misma familia, todos encontrados en review: un
comentario que afirmaba que `--force-recreate` alcanzaba a las dependencias (la
causa real era otra), otro que afirmaba que el residuo de una regex sólo podía
sobre-disparar (podía sub-disparar, con cinco casos ejecutados que lo probaron),
y un runbook que citaba `git diff --quiet` como el mecanismo del árbol limpio —
justo la familia de chequeo que ese ciclo tuvo que abandonar porque no ve
archivos sin trackear. Cada uno costó una ronda.

## Por qué esta es la segunda versión

La primera versión generaba el ERD parseando `prisma/schema.prisma` con un
parser propio. Se implementó y se llevó por **cuatro rondas de review**. Cada
ronda cerró sus hallazgos y encontró otros de la misma familia: formas que
Prisma acepta y el parser interpretaba mal, casi siempre en silencio y con
código de salida 0.

Una muestra de lo que aparecía, todo verificado contra Prisma:

- `@@id(name: "x", fields: [a, b])` rendía la tabla **sin clave primaria**.
- `@@id ([a, b])` —con un espacio antes del paréntesis, que Prisma acepta—
  también.
- Un `@@unique` compuesto salía como `UK` por columna, afirmando que `email` era
  único solo cuando el schema dice que la unicidad es por tenant.
- Valores de enum con `@map` mostraban la etiqueta de Prisma y no la de
  Postgres.
- `@@map("mi\ttabla")` terminaba nombrando una tabla inexistente.

Lo decisivo no fue ninguno de esos bugs: fue que **los cuatro reviewers usaron
`prisma migrate diff` como árbitro de la verdad**. Cada vez que había que
decidir si el diagrama mentía, la respuesta salía de preguntarle a Prisma qué
SQL genera. Estábamos parseando la gramática de Prisma para deducir algo que
Prisma ya dice.

Así que el diagrama pasa a generarse de ahí. El parser anterior queda en la rama
`worktree-diagrama-schema`, sin mergear, por si alguna vez sirve de referencia.

## El insumo, medido

`npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`,
verificado sobre este repo con Prisma 7.9.1:

- **No necesita base de datos.** Sale en 0, offline.
- **Tarda 1,4 segundos.** Barato para el hook de pre-commit, que es la condición
  que `CLAUDE.md` le pone a lo que puede vivir ahí.
- **Es determinístico**: mismo hash entre corridas. Sin eso la verificación no
  serviría.
- **Trae todo ya resuelto**, en los nombres y tipos de Postgres:

```sql
CREATE TYPE "estado_tenant" AS ENUM ('TRIAL', 'ACTIVO', 'SUSPENDIDO');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "subdominio" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE INDEX "clientes_tenant_id_idx" ON "clientes"("tenant_id");

ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Cada cosa que la primera versión tenía que deducir, acá está escrita: los
nombres mapeados, los tipos nativos, la PK compuesta, la diferencia entre un
índice único y uno común, y el `ON DELETE`. No hay `@@map` que resolver, ni
campos de vuelta de relación que filtrar —en SQL no existen—, ni tipos que
derivar, ni un `@@unique` compuesto que interpretar: `ON "users"("tenant_id",
"email")` no admite dos lecturas.

**Sigue siendo parseo**, y eso hay que decirlo. Pero es una gramática chica,
regular y generada por una máquina: Prisma emite una columna por línea, entrecomilla
todos los identificadores, y usa comillas simples sólo en literales. La lección
de la primera versión se conserva entera: **negarse antes que omitir, y nunca
emitir una afirmación falsa sobre la base**.

## Decisiones tomadas

1. **La fuente es el DDL, no el schema.** Por lo anterior. El documento se llama
   "diagrama de la base de datos" y ahora se genera de lo que efectivamente crea
   la base, que es más honesto que deducirlo.
2. **Un efecto de Prisma acepta el diagrama tal como Prisma lo genere.** Si
   Prisma emitiera SQL equivocado, el diagrama lo reflejaría fielmente. Es
   correcto: el diagrama debe describir lo que hay, no lo que quisimos.
3. **Se cae el nombre del modelo de Prisma.** La primera versión lo ponía como
   comentario (`%% tenants = Tenant`). El DDL no lo conoce, y buscarlo aparte
   volvería a meter el parseo del schema por la ventana. Quien necesite el mapeo
   tiene `schema.prisma`.
4. **La lib sigue siendo pura**: entra texto DDL, sale texto Mermaid. Lo que
   cambia es que el efecto —invocar a Prisma— vive en el script y no en la lib.
   Los tests siguen corriendo en milisegundos sobre DDL de fixture, y de hecho
   más fácil, porque el DDL de fixture se puede generar una vez con Prisma y
   pegar.
5. **El archivo es 100 % generado**, con un banner que lo dice. Un archivo mitad
   generado y mitad escrito pierde la mitad escrita en la próxima regeneración.
6. **Se verifica en dos lugares**, igual que las migraciones destructivas: el
   hook de pre-commit y `deploy.sh`.

## Qué muestra el diagrama

Un bloque `erDiagram` con las entidades y sus relaciones, más una lista de enums
debajo.

**Por cada tabla**: el nombre tal como está en el `CREATE TABLE`, y una fila por
columna. Mermaid da cuatro ranuras por atributo —tipo, nombre, claves y un
comentario— y eso decide dónde va cada cosa:

- **tipo**: el que dice el DDL, en minúsculas (`uuid`, `text`,
  `timestamptz(3)`, `numeric(12,2)`), o el nombre del enum cuando la columna lo
  usa.
- **claves**: `PK` de la `CONSTRAINT ... PRIMARY KEY`, `FK` de un
  `ADD CONSTRAINT ... FOREIGN KEY`, `UK` sólo cuando existe un
  `CREATE UNIQUE INDEX` **de una sola columna** sobre ella.
- **comentario**: `opcional` cuando la columna no lleva `NOT NULL`, y la
  pertenencia a un índice único compuesto (`único junto a tenant_id`). Un `UK`
  pelado sobre una columna de un índice compuesto sería falso, y Mermaid no
  tiene marcador de nullable, así que las dos cosas van acá.

**Por cada FK**: una línea con cardinalidad y el `ON DELETE` que dice el DDL. Es
uno-a-uno cuando las columnas de la FK están cubiertas por un índice único, y
uno-a-muchos si no — y eso ahora se lee del SQL en vez de inferirse.

**Los enums** van en una sección aparte, con el nombre y las etiquetas reales
del `CREATE TYPE`. Mermaid no tiene enums en `erDiagram`, y meterlos como
entidades falsas mentiría sobre qué tablas hay.

**Los índices no únicos** se listan por tabla, en texto, fuera del bloque. Sin
eso un lector puede concluir que `clientes` no tiene ninguno.

**Lo que el diagrama NO muestra, y lo dice en su encabezado**: las policies de
RLS. `migrate diff` no las emite porque no están en el schema — viven en el SQL
escrito a mano de las migraciones — y son lo más importante de este diseño. El
encabezado enlaza a
`docs/superpowers/specs/2026-08-04-schema-nucleo-design.md`, donde está
explicado el modelo de aislamiento.

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `scripts/lib/erd-comun.sh` | DDL → Mermaid. Función pura. |
| `scripts/tests/test-erd-comun.sh` | Unitarios de la lib, con DDL de fixture. |
| `scripts/generar-erd.sh` | Los efectos: invocar a Prisma, escribir, o comparar. |
| `docs/schema.md` | La salida. Generada, versionada, nunca editada a mano. |

`scripts/generar-erd.sh` toma la ruta del schema y la de salida por argumento.
Un modo `--verificar` regenera en memoria y compara contra el archivo
versionado, saliendo distinto de cero e imprimiendo el diff si difieren.

**Si `prisma migrate diff` falla o emite algo que la lib no entiende, se
refuse.** Nunca se escribe un diagrama parcial: un `docs/schema.md` incompleto
pasaría la verificación describiendo una base que no existe.

## Dónde se verifica

**En `.githooks/pre-commit`**, junto al chequeo de migraciones destructivas, y
sólo si el commit toca `prisma/schema.prisma` o `docs/schema.md`. Cuesta 1,4
segundos y no levanta ninguna base, que es la condición que `CLAUDE.md` le pone
a lo que puede vivir en un hook.

**Debe comparar el contenido STAGEADO, no el del working tree.** El chequeo de
migraciones destructivas que está arriba en el mismo archivo ya lee con
`git show ":$archivo"`, y por una razón: si alguien edita el schema, regenera el
diagrama y hace `git add` sólo del schema, el working tree coincide consigo
mismo y el hook pasaría — dejando entrar el commit que el hook existe para
frenar.

**En `deploy.sh`, dentro del paso 3**, que hoy es "schema.prisma y migraciones
sincronizados" y pasa a ser "schema, migraciones y diagrama". Va adentro del
paso que ya existe y no como paso nuevo: son la misma pregunta —¿el repo es
coherente consigo mismo?— y agregar un paso 17 obligaría a renumerar los
dieciséis por una verificación de documentación. Y porque `--no-verify` existe.

## Testing

**Unitarios de la lib**, con DDL de fixture generado con Prisma y pegado:

- Una tabla con PK simple, una con PK compuesta.
- Una columna sin `NOT NULL`: marcada opcional.
- Un `CREATE UNIQUE INDEX` de una columna: `UK`. Uno compuesto: la nota, y
  **ningún `UK` pelado**.
- Un `CREATE INDEX` común: no confundido con el único, y listado aparte.
- Una FK con `ON DELETE CASCADE`: la línea con su cardinalidad y su etiqueta.
- Una FK cubierta por un índice único: uno-a-uno.
- Un `CREATE TYPE ... AS ENUM`: nombre y etiquetas reales.
- Un `DEFAULT` que contiene un paréntesis o una comilla: no rompe el parseo.
- Un identificador con un espacio o un carácter que Mermaid no acepta: **se
  refuse**, no se emite un diagrama que no renderiza.
- DDL que la lib no entiende: se refuse, con el fragmento en el mensaje.

**Y una aserción contra el DDL real del repo**, que es la que atrapa una
regresión el día que alguien agregue un modelo con una forma que los fixtures no
cubren.

Los tests se enganchan solos: `scripts/tests/correr-todos.sh` levanta todo
`test-*.sh` por glob, y `npm test` lo corre antes de vitest.

**El chequeo de render con Mermaid queda fuera de la suite**, que tiene que
seguir corriendo en milisegundos y sin red. Se hace a mano una vez, cuando se
genera el primer diagrama, y se anota en el reporte.

## Fuera de alcance

- **Renderizar una imagen.** Mermaid en texto se ve solo en GitHub y diffea
  limpio; un PNG no hace ninguna de las dos cosas.
- **El nombre del modelo de Prisma.** Ver *Decisiones tomadas*, punto 3.
- **Mostrar las policies de RLS.** `migrate diff` no las ve. Si alguna vez se
  quisiera, habría que leer el SQL escrito a mano de las migraciones, que es
  otro parser y otro spec.
- **Los schemas de los módulos.** Cuando existan `modules/<nombre>/`, habrá que
  decidir si `migrate diff` los toma juntos o si el diagrama se parte. No se
  resuelve hoy: no hay un segundo schema que lo ejercite.
- **Documentar el modelo de aislamiento.** Ya está en el spec del schema del
  núcleo; `docs/schema.md` lo enlaza en vez de repetirlo.
