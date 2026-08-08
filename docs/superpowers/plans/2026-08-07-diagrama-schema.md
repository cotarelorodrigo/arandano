# Diagrama de la base, generado y verificado — Implementation Plan

> **SUPERADO — no ejecutar.** Este plan implementa el ERD parseando
> `prisma/schema.prisma` con un parser propio. Ese enfoque se descartó después
> de cuatro rondas de review: ver *Por qué esta es la segunda versión* en
> `docs/superpowers/specs/2026-08-07-diagrama-schema-design.md`. Lo que se
> implementó genera el diagrama del DDL que produce `prisma migrate diff`.
> Queda como registro de lo que se intentó, no como instrucciones.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un ERD en Mermaid generado desde `prisma/schema.prisma`, verificado por el hook de pre-commit y por `deploy.sh`, de modo que no pueda quedar desactualizado sin que algo frene.

**Architecture:** La lógica de parseo vive en `scripts/lib/erd-comun.sh` como una función pura —entra el texto de un schema, sale el texto Mermaid— implementada con un programa de perl embebido, exactamente la técnica que ya usa `migracion_destructiva` en `scripts/lib/deploy-comun.sh`. `scripts/generar-erd.sh` pone los efectos: lee archivos, escribe la salida, o compara.

**Tech Stack:** bash, perl (ya dependencia dura del repo), Mermaid.

## Global Constraints

Del spec (`docs/superpowers/specs/2026-08-07-diagrama-schema-design.md`) y de `CLAUDE.md`:

- **`scripts/lib/erd-comun.sh` sólo contiene funciones puras**: entra texto, sale texto, no toca Docker, red, git ni disco. Es lo que permite que sus tests corran en milisegundos.
- **`set -euo pipefail`** en los scripts; los archivos de test del repo usan `set -uo pipefail`.
- **Anclar el cwd** (`cd "$(dirname "${BASH_SOURCE[0]}")/.."`) para que funcionen desde cualquier directorio.
- **Comentarios en castellano rioplatense**, explicando el *por qué*. Leer `scripts/lib/deploy-comun.sh` antes de escribir ninguno: el registro de este repo es inusualmente explicativo.
- **Nunca imprimir contraseñas ni contenido de un `.env`.**
- **Salida estable**: las tablas, las columnas y las relaciones se emiten en orden determinístico. Un diff que cambia de orden entre corridas idénticas hace inservible la verificación.
- Mensajes de commit en castellano, terminando con el trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `scripts/lib/erd-comun.sh` | Parseo y emisión. Función pura. |
| `scripts/tests/test-erd-comun.sh` | Unitarios de la lib, con fixtures. |
| `scripts/generar-erd.sh` | Los efectos: leer, escribir, o comparar con `--verificar`. |
| `docs/schema.md` | La salida. Generada, versionada, nunca editada a mano. |
| `.githooks/pre-commit` | Suma la verificación del diagrama. |
| `scripts/deploy.sh` | El paso 3 pasa a cubrir también el diagrama. |

---

### Task 1: La lib de parseo

El corazón. Todo lo que decide qué sale en el diagrama vive acá, en una función pura con tests que corren sin nada.

**Files:**
- Create: `scripts/lib/erd-comun.sh`
- Create: `scripts/tests/test-erd-comun.sh`

**Interfaces:**
- Consumes: `scripts/tests/lib-asserts.sh` (helpers `ok`/`bad`/`check_eq`/`check_true`/`check_false` y los contadores `PASS`/`FAIL`).
- Produces: `erd_desde_schema <texto_del_schema>` → imprime el bloque Mermaid por stdout y devuelve 0; ante cualquier problema imprime un error por stderr y devuelve 1.

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/tests/test-erd-comun.sh`:

```bash
#!/usr/bin/env bash
# Tests unitarios del generador del ERD.
#
# Acá vive todo lo que decide qué dice el diagrama de la base. Corre sin Docker,
# sin red y sin archivos: entra el texto de un schema, sale texto Mermaid.
#
# El caso que más importa es el de los campos de VUELTA de relación
# (`users User[]`): no son columnas, existen sólo del lado de Prisma. Emitirlos
# describiría una tabla que en Postgres no tiene esa columna, y un diagrama que
# miente es peor que no tenerlo, porque se le cree.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/tests/lib-asserts.sh
source scripts/lib/erd-comun.sh

# Un schema mínimo que ejercita cada caso del spec. Se escribe entero acá y no
# se lee de prisma/: un fixture que cambia cuando cambia el schema real no
# prueba lo que dice probar.
FIXTURE=$(cat <<'EOF'
datasource db {
  provider = "postgresql"
}

// Un comentario que menciona algo con forma de campo: nombre String @map("trampa")
// y hasta un @@map("tabla_que_no_existe"). Si el parseo lo toma, el diagrama miente.
enum EstadoCosa {
  ACTIVO
  INACTIVO

  @@map("estado_cosa")
}

model Padre {
  id       String     @id @default(uuid(7)) @db.Uuid
  nombre   String
  estado   EstadoCosa @default(ACTIVO)
  creadoEn DateTime   @default(now()) @map("creado_en") @db.Timestamptz(3)

  hijos Hijo[]

  @@map("padres")
}

model Hijo {
  id       String  @id @default(uuid(7)) @db.Uuid
  padreId  String  @map("padre_id") @db.Uuid
  apodo    String? // opcional a propósito
  precio   Decimal @db.Decimal(12, 2)

  padre Padre @relation(fields: [padreId], references: [id], onDelete: Cascade)

  @@unique([padreId, apodo])
  @@index([padreId])
  @@map("hijos")
}

model Compuesta {
  padreId String @map("padre_id") @db.Uuid
  clave   String

  @@id([padreId, clave])
  @@map("compuestas")
}
EOF
)

SALIDA=$(erd_desde_schema "$FIXTURE")

printf '\n\033[1mnombres: los de Postgres, no los de Prisma\033[0m\n'
check_true "la entidad usa el nombre mapeado"        grep -qE '^\s*padres \{' <<<"$SALIDA"
check_false "no aparece el nombre del modelo como entidad" grep -qE '^\s*Padre \{' <<<"$SALIDA"
check_true "la columna usa el nombre mapeado"        grep -q 'creado_en' <<<"$SALIDA"
check_false "no aparece el nombre del campo de Prisma" grep -q 'creadoEn' <<<"$SALIDA"
# El nombre de Prisma es el que se escribe en el código, así que tiene que estar
# — pero como comentario, que no puede romper el render.
check_true "el modelo de Prisma queda en un comentario" \
  grep -qE '^\s*%% padres = Padre$' <<<"$SALIDA"

printf '\n\033[1mel caso que decide si el diagrama miente\033[0m\n'
# `hijos Hijo[]` en Padre no es una columna de la tabla padres.
check_false "un campo de vuelta de relación NO es columna" grep -q 'hijos Hijo' <<<"$SALIDA"
check_false "ni con el nombre en minúsculas"               grep -qE 'padres \{[^}]*\bhijos\b' <<<"$SALIDA"
# `padre Padre @relation(...)` tampoco: la columna real es padre_id.
check_false "el campo de relación tampoco es columna"      grep -qE '^\s+\w+ padre$' <<<"$SALIDA"
check_true  "la columna real de la FK sí está"             grep -q 'padre_id' <<<"$SALIDA"

printf '\n\033[1mtipos de Postgres\033[0m\n'
check_true "@db.Uuid -> uuid"                    grep -qE 'uuid id PK' <<<"$SALIDA"
check_true "@db.Timestamptz(3) -> timestamptz"   grep -q 'timestamptz(3) creado_en' <<<"$SALIDA"
check_true "@db.Decimal(12, 2) -> numeric(12,2)" grep -q 'numeric(12,2) precio' <<<"$SALIDA"
check_true "String sin @db -> text"              grep -qE 'text nombre' <<<"$SALIDA"
check_true "un enum usa su nombre mapeado"       grep -q 'estado_cosa estado' <<<"$SALIDA"

printf '\n\033[1mclaves y opcionalidad\033[0m\n'
check_true "PK simple"            grep -qE 'uuid id PK' <<<"$SALIDA"
check_true "FK marcada"           grep -qE 'uuid padre_id FK' <<<"$SALIDA"
check_true "PK compuesta: las dos columnas" \
  test "$(grep -cE '(padre_id|clave) PK' <<<"$(sed -n '/compuestas {/,/}/p' <<<"$SALIDA")")" = 2
# Mermaid no tiene marcador de nullable: la opcionalidad va al comentario.
check_true "opcional va en el comentario"  grep -qE 'apodo[^"]*"opcional"' <<<"$SALIDA"
check_false "y no inventa un tipo que no existe en Postgres" grep -q 'text?' <<<"$SALIDA"

printf '\n\033[1mrelaciones\033[0m\n'
check_true "cardinalidad uno-a-muchos"     grep -qE 'padres \|\|--o\{ hijos' <<<"$SALIDA"
check_true "la línea lleva el onDelete"    grep -q 'Cascade' <<<"$SALIDA"
check_false "una tabla sin relación no inventa una" grep -q 'compuestas ||--' <<<"$SALIDA"

printf '\n\033[1menums\033[0m\n'
check_true "el enum aparece con su nombre mapeado" grep -q 'estado_cosa' <<<"$SALIDA"
check_true "y con sus valores"                     grep -q 'ACTIVO' <<<"$SALIDA"
# Meterlos como entidades falsas mentiría sobre qué tablas hay.
check_false "el enum NO es una entidad del ERD" grep -qE '^\s*estado_cosa \{' <<<"$SALIDA"

printf '\n\033[1mcomentarios: la trampa\033[0m\n'
check_false "un @map dentro de un comentario no crea una columna" grep -q 'trampa' <<<"$SALIDA"
check_false "un @@map dentro de un comentario no crea una tabla"  grep -q 'tabla_que_no_existe' <<<"$SALIDA"
# Un // adentro de comillas es parte del valor, no un comentario.
COMILLAS=$(erd_desde_schema 'model A {
  id  String @id
  url String @map("http://ejemplo")
  @@map("aes")
}')
check_true "un // adentro de comillas no abre un comentario" grep -q 'http://ejemplo' <<<"$COMILLAS"

printf '\n\033[1msalida estable\033[0m\n'
# Un diff que cambia de orden entre corridas idénticas vuelve inútil la
# verificación: el hook frenaría commits que no cambiaron nada.
check_eq "dos corridas idénticas dan lo mismo" \
  "$(erd_desde_schema "$FIXTURE" | md5sum)" "$(erd_desde_schema "$FIXTURE" | md5sum)"
check_true "las tablas salen ordenadas alfabéticamente" \
  test "$(grep -oE '^  \w+ \{' <<<"$SALIDA" | tr -d ' {')" = "$(grep -oE '^  \w+ \{' <<<"$SALIDA" | tr -d ' {' | sort)"

printf '\n\033[1mfalla cerrado\033[0m\n'
check_false "un schema vacío es error"        erd_desde_schema ""
check_false "un schema sin ningún modelo es error" erd_desde_schema 'datasource db { provider = "postgresql" }'
check_false "una llave sin cerrar es error"   erd_desde_schema 'model A { id String @id'

# Sin perl no se puede generar, y lo que NO puede pasar es que emita un diagrama
# vacío: docs/schema.md quedaría describiendo una base sin tablas y la
# verificación pasaría en verde. Se prueba con un PATH que de verdad no lo tiene,
# no con una función que lo sombree.
SIN_PERL=$(mktemp -d)
for b in bash date cat printf grep sed; do
  [[ -x "/usr/bin/$b" ]] && ln -sf "/usr/bin/$b" "$SIN_PERL/$b"
  [[ -x "/bin/$b" ]] && ln -sf "/bin/$b" "$SIN_PERL/$b"
done
check_false "sin perl en el PATH, falla en vez de emitir un diagrama vacío" \
  env -i PATH="$SIN_PERL" bash -c "cd '$PWD'; source scripts/lib/erd-comun.sh; erd_desde_schema 'model A {
  id String @id
  @@map(\"aes\")
}'"
rm -rf "$SIN_PERL"

printf '\n\033[1mel schema real del repo\033[0m\n'
# La aserción que atrapa una regresión el día que alguien agregue un modelo con
# una forma que los fixtures no cubren.
REAL=$(erd_desde_schema "$(cat prisma/schema.prisma)")
check_true "las cinco tablas del núcleo están" \
  test "$(grep -cE '^  (tenants|tenant_modules|users|clientes|articulos) \{' <<<"$REAL")" = 5
check_false "ninguna vuelta de relación se coló como columna" \
  grep -qE '^\s+\w+ (modulos|users|clientes|articulos)$' <<<"$REAL"
check_true "las cuatro relaciones hacia tenants están" \
  test "$(grep -cE '^  tenants \|\|--o\{' <<<"$REAL")" = 4
check_true "los cuatro enums están" \
  test "$(grep -cE '^- \*\*(estado_tenant|modulo|rol_usuario|tipo_articulo)\*\*' <<<"$REAL")" = 4

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

```bash
chmod +x scripts/tests/test-erd-comun.sh
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
scripts/tests/test-erd-comun.sh; echo "exit: $?"
```
Expected: falla con `scripts/lib/erd-comun.sh: No such file or directory`.

- [ ] **Step 3: Escribir la lib**

Crear `scripts/lib/erd-comun.sh`:

```bash
#!/usr/bin/env bash
# Genera el ERD de la base a partir de un schema de Prisma.
#
# Sólo funciones PURAS: entra el texto de un schema, sale el texto Mermaid. No
# toca disco, red, git ni Docker. Eso es lo que permite que
# scripts/tests/test-erd-comun.sh corra en milisegundos, y por lo tanto que
# nadie tenga excusa para saltearlo.
#
# El parseo va en un programa de perl embebido y no en bash: es la misma técnica
# que usa migracion_destructiva en deploy-comun.sh, por la misma razón — un
# formato con bloques anidados, comillas y comentarios no se parsea con `grep`
# sin terminar con casos que nadie previó.
#
# Este archivo sólo define funciones. No ejecuta nada al sourcearse.

# log/error propios: esta lib se usa desde generar-erd.sh y desde el hook, que
# no necesariamente sourcean deploy-comun.sh.
erd_error() { printf '%s  ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# Texto de un schema de Prisma -> bloque Mermaid por stdout. 0 si salió; 1 si no.
#
# Falla CERRADO: si el analizador no corre, o corre y no dice nada, devuelve
# error en vez de emitir un diagrama vacío. Un docs/schema.md vacío pasaría la
# verificación en silencio y describiría una base sin tablas.
erd_desde_schema() {
  local schema="${1:-}"

  local programa
  programa=$(cat <<'PERL'
use strict;
use warnings;

my $src = do { local $/; <STDIN> };
die "el schema vino vacío\n" unless defined $src && $src =~ /\S/;

# --- 1. Sacar los comentarios ------------------------------------------------
# Prisma sólo tiene comentarios de línea (`//`). Hay que respetar las comillas:
# un `//` adentro de un @map("http://...") es parte del valor, no un comentario.
# Y el schema de este repo está lleno de comentarios largos que mencionan cosas
# con forma de campo, así que sacarlos mal hace que el diagrama invente columnas.
my $limpio = '';
for my $linea (split /\n/, $src, -1) {
  my ($salida, $en_comillas) = ('', 0);
  for (my $i = 0; $i < length $linea; $i++) {
    my $c = substr($linea, $i, 1);
    if ($c eq '"') { $en_comillas = !$en_comillas }
    elsif (!$en_comillas && $c eq '/' && substr($linea, $i + 1, 1) eq '/') { last }
    $salida .= $c;
  }
  $limpio .= "$salida\n";
}

# --- 2. Qué nombres son modelos y cuáles enums -------------------------------
# Hace falta ANTES de mirar los campos: es lo único que distingue un campo
# escalar de uno de relación.
my %es_modelo = map { $_ => 1 } ($limpio =~ /^\s*model\s+(\w+)\s*\{/gm);
my %es_enum   = map { $_ => 1 } ($limpio =~ /^\s*enum\s+(\w+)\s*\{/gm);
die "el schema no declara ningún modelo\n" unless %es_modelo;

# --- 3. Recorrer los bloques -------------------------------------------------
my (%tabla_de, %enum_de, %columnas, %relaciones, %valores_enum);

my $abiertas = () = $limpio =~ /\{/g;
my $cerradas = () = $limpio =~ /\}/g;
die "llaves desbalanceadas: $abiertas abiertas, $cerradas cerradas\n"
  if $abiertas != $cerradas;

while ($limpio =~ /^\s*(model|enum)\s+(\w+)\s*\{(.*?)^\s*\}/gms) {
  my ($clase, $nombre, $cuerpo) = ($1, $2, $3);

  # El nombre en Postgres. Sin @@map, Prisma usa el del modelo tal cual.
  my ($mapeado) = $cuerpo =~ /^\s*\@\@map\("([^"]+)"\)/m;
  $mapeado //= $nombre;

  if ($clase eq 'enum') {
    $enum_de{$nombre} = $mapeado;
    $valores_enum{$nombre} = [ $cuerpo =~ /^\s*([A-Z][A-Z0-9_]*)\s*$/gm ];
    next;
  }

  $tabla_de{$nombre} = $mapeado;

  # Claves compuestas, antes de los campos: marcan columnas ya vistas.
  my %pk_compuesta;
  if (my ($lista) = $cuerpo =~ /^\s*\@\@id\(\[([^\]]+)\]/m) {
    $pk_compuesta{$_} = 1 for map { s/\s//gr } split /,/, $lista;
  }
  my %uk;
  while ($cuerpo =~ /^\s*\@\@unique\(\[([^\]]+)\]/gm) {
    $uk{$_} = 1 for map { s/\s//gr } split /,/, $1;
  }

  my @cols;
  for my $linea (split /\n/, $cuerpo) {
    next if $linea =~ /^\s*\@\@/;          # atributos de bloque, ya vistos
    next unless $linea =~ /^\s*(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/;
    my ($campo, $tipo, $mod, $resto) = ($1, $2, $3 // '', $4 // '');

    # Campo de VUELTA de relación: existe sólo del lado de Prisma. No es una
    # columna, y emitirlo describiría una tabla que no tiene esa columna.
    next if $es_modelo{$tipo} && $mod eq '[]';

    # Campo de relación: la columna real es la que está en `fields: [...]`,
    # que se recorre aparte. Éste tampoco es una columna.
    if ($es_modelo{$tipo}) {
      my ($campos) = $resto =~ /fields:\s*\[([^\]]+)\]/;
      my ($borrado) = $resto =~ /onDelete:\s*(\w+)/;
      push @{ $relaciones{$nombre} }, {
        hacia    => $tipo,
        campos   => [ map { s/\s//gr } split /,/, ($campos // '') ],
        opcional => ($mod eq '?' ? 1 : 0),
        borrado  => $borrado // 'NoAction',
      };
      next;
    }

    my ($col) = $resto =~ /\@map\("([^"]+)"\)/;
    $col //= $campo;

    push @cols, {
      nombre   => $col,
      tipo     => tipo_postgres($tipo, $resto, \%es_enum, \%enum_de),
      pk       => (($resto =~ /\@id\b/ || $pk_compuesta{$campo}) ? 1 : 0),
      uk       => (($resto =~ /\@unique\b/ || $uk{$campo}) ? 1 : 0),
      fk       => 0,   # se marca abajo, cuando se conocen las relaciones
      opcional => ($mod eq '?' ? 1 : 0),
      campo    => $campo,
    };
  }
  $columnas{$nombre} = \@cols;
}

# Marcar las FK ahora que se conocen las relaciones de cada modelo.
for my $modelo (keys %relaciones) {
  for my $rel (@{ $relaciones{$modelo} }) {
    for my $campo (@{ $rel->{campos} }) {
      $_->{fk} = 1 for grep { $_->{campo} eq $campo } @{ $columnas{$modelo} };
    }
  }
}

# --- 4. Emitir ---------------------------------------------------------------
# Todo ordenado: un diff que cambia de orden entre corridas idénticas haría que
# el hook frene commits que no cambiaron nada.
my @salida = ('```mermaid', 'erDiagram');

for my $modelo (sort { $tabla_de{$a} cmp $tabla_de{$b} } keys %tabla_de) {
  my $tabla = $tabla_de{$modelo};
  push @salida, "  %% $tabla = $modelo";
  push @salida, "  $tabla {";
  for my $c (@{ $columnas{$modelo} }) {
    my @claves;
    push @claves, 'PK' if $c->{pk};
    push @claves, 'FK' if $c->{fk};
    push @claves, 'UK' if $c->{uk} && !$c->{pk};
    my $claves = @claves ? ' ' . join(', ', @claves) : '';
    # Mermaid NO tiene marcador de nullable. Meterlo en el tipo produciría un
    # tipo que no existe en Postgres, así que va al comentario.
    my $nota = $c->{opcional} ? ' "opcional"' : '';
    push @salida, "    $c->{tipo} $c->{nombre}$claves$nota";
  }
  push @salida, '  }';
}

my @lineas_rel;
for my $modelo (sort keys %relaciones) {
  for my $rel (@{ $relaciones{$modelo} }) {
    my $padre = $tabla_de{ $rel->{hacia} } // next;
    my $hijo  = $tabla_de{$modelo};
    # El lado del padre es opcional si la relación lo es; el del hijo es siempre
    # "cero o muchos", que es lo que produce una FK sin unique.
    my $card = $rel->{opcional} ? '|o--o{' : '||--o{';
    push @lineas_rel, "  $padre $card $hijo : \"onDelete: $rel->{borrado}\"";
  }
}
push @salida, sort @lineas_rel;
push @salida, '```';

# Los enums van aparte: Mermaid no los tiene en erDiagram, y meterlos como
# entidades mentiría sobre qué tablas existen en la base.
if (%enum_de) {
  push @salida, '', '## Enums', '';
  for my $e (sort { $enum_de{$a} cmp $enum_de{$b} } keys %enum_de) {
    push @salida, "- **$enum_de{$e}** ($e): "
      . join(', ', map { "`$_`" } @{ $valores_enum{$e} });
  }
}

print join("\n", @salida), "\n";

# Tipo de Prisma + los @db.* -> el tipo que se ve en Postgres. El @db manda
# cuando está: es literalmente lo que Prisma le pide a la base.
sub tipo_postgres {
  my ($tipo, $resto, $es_enum, $enum_de) = @_;
  return $enum_de->{$tipo} if $es_enum->{$tipo};

  if (my ($nativo, $args) = $resto =~ /\@db\.(\w+)(\([^)]*\))?/) {
    my %mapa = (
      Uuid => 'uuid', Timestamptz => 'timestamptz', Timestamp => 'timestamp',
      Decimal => 'numeric', VarChar => 'varchar', Char => 'char', Text => 'text',
      Integer => 'integer', BigInt => 'bigint', Boolean => 'boolean',
      Date => 'date', Time => 'time', JsonB => 'jsonb', Money => 'money',
    );
    my $base = $mapa{$nativo} // lc $nativo;
    $args //= '';
    $args =~ s/\s//g;
    return "$base$args";
  }

  my %mapa = (
    String => 'text', Int => 'integer', BigInt => 'bigint', Float => 'double precision',
    Decimal => 'numeric', Boolean => 'boolean', DateTime => 'timestamp',
    Json => 'jsonb', Bytes => 'bytea',
  );
  return $mapa{$tipo} // lc $tipo;
}
PERL
  )

  local salida rc=0
  salida=$(printf '%s' "$schema" | perl -e "$programa" 2>&1) || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    erd_error "no se pudo generar el ERD: ${salida:-el analizador no corrió (¿falta perl?)}"
    return 1
  fi
  # Un 0 mudo no es una respuesta: es lo que devolvería un `perl -e ""`.
  if [[ -z "$salida" ]]; then
    erd_error "el analizador salió 0 sin emitir nada; no se escribe un diagrama vacío"
    return 1
  fi

  printf '%s\n' "$salida"
}
```

```bash
chmod 644 scripts/lib/erd-comun.sh
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
scripts/tests/test-erd-comun.sh
```
Expected: todo en verde, `0 fallan`.

Si falla la aserción del schema real, **leer la salida antes de tocar el fixture**: significa que el schema tiene una forma que el parseo no contempla, y el arreglo va en la lib.

- [ ] **Step 5: Verificar que las aserciones tienen dientes**

Un test que sigue verde cuando el código se rompe no protege nada. Mutar y confirmar que falla:

```bash
cp scripts/lib/erd-comun.sh /tmp/erd.bak
# 1. Que las vueltas de relación SÍ se emitan como columnas.
sed -i "s|next if \$es_modelo{\$tipo} && \$mod eq '\[\]';|# mutado|" scripts/lib/erd-comun.sh
scripts/tests/test-erd-comun.sh >/dev/null; echo "mutación 1 -> exit $? (debe ser != 0)"
cp /tmp/erd.bak scripts/lib/erd-comun.sh
# 2. Que el orden no sea estable.
sed -i 's|sort { \$tabla_de{\$a} cmp \$tabla_de{\$b} } keys %tabla_de|keys %tabla_de|' scripts/lib/erd-comun.sh
scripts/tests/test-erd-comun.sh >/dev/null; echo "mutación 2 -> exit $? (debe ser != 0)"
cp /tmp/erd.bak scripts/lib/erd-comun.sh
# 3. Que los comentarios no se saquen.
sed -i "s|elsif (!\$en_comillas && \$c eq '/'|elsif (0 \&\& \$c eq '/'|" scripts/lib/erd-comun.sh
scripts/tests/test-erd-comun.sh >/dev/null; echo "mutación 3 -> exit $? (debe ser != 0)"
cp /tmp/erd.bak scripts/lib/erd-comun.sh
rm /tmp/erd.bak
scripts/tests/test-erd-comun.sh >/dev/null; echo "restaurado -> exit $? (debe ser 0)"
```
Expected: las tres mutaciones fallan, el restaurado pasa. La mutación 2 puede pasar por casualidad si el orden del hash coincide; si eso ocurre, correrla tres veces.

- [ ] **Step 6: Correr la suite completa**

```bash
npm test
```
Expected: los tres archivos de bash y los 52 de vitest, todo en verde.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/erd-comun.sh scripts/tests/test-erd-comun.sh
git commit -m "$(cat <<'EOF'
feat(docs): la lógica del ERD, como función pura con sus tests

Entra el texto de un schema de Prisma, sale texto Mermaid. Sin disco, sin red,
sin Docker: los tests corren en milisegundos y nadie tiene motivo para
saltearlos.

El caso que decide si el diagrama miente son los campos de VUELTA de relación
(`users User[]`): existen sólo del lado de Prisma y no son columnas. Emitirlos
describiría tablas que en Postgres no tienen esa columna.

El parseo va en perl embebido y no en grep, misma técnica que
migracion_destructiva: un formato con bloques anidados, comillas y comentarios
no se parsea a mano sin terminar en casos que nadie previó. El schema de este
repo está lleno de comentarios largos que mencionan cosas con forma de campo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: El script y el diagrama inicial

**Files:**
- Create: `scripts/generar-erd.sh`
- Create: `docs/schema.md`

**Interfaces:**
- Consumes: `erd_desde_schema` de la Task 1.
- Produces: `scripts/generar-erd.sh [--verificar] --salida=<archivo> <schema...>`. Sin `--verificar` escribe; con `--verificar` compara y devuelve 1 si difiere, imprimiendo el diff.

- [ ] **Step 1: Escribir el script**

Crear `scripts/generar-erd.sh`:

```bash
#!/usr/bin/env bash
# Escribe el diagrama de la base a partir de los schemas de Prisma.
#
# Los efectos viven acá y la decisión en scripts/lib/erd-comun.sh: este archivo
# lee, escribe y compara; no decide qué dice el diagrama.
#
# Toma las rutas de los schemas por argumento en vez de fijarlas: cuando existan
# modules/<nombre>/schema.prisma (ver CLAUDE.md) se le pasan varios. Hoy se le
# pasa uno, y el merge multi-archivo NO está escrito — sería código sin un caso
# que lo ejercite.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/erd-comun.sh

VERIFICAR=false
SALIDA=""
SCHEMAS=()

uso() {
  cat >&2 <<'EOF'
uso: generar-erd.sh [--verificar] --salida=<archivo> <schema.prisma...>

  --salida     dónde se escribe el diagrama.
  --verificar  no escribe: compara lo generado contra lo que hay en --salida y
               sale 1 si difieren, imprimiendo el diff. Es lo que corren el
               hook de pre-commit y deploy.sh.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --verificar) VERIFICAR=true ;;
    --salida=*)  SALIDA="${arg#*=}" ;;
    -h|--help)   uso ;;
    -*)          erd_error "argumento desconocido: $arg"; uso ;;
    *)           SCHEMAS+=("$arg") ;;
  esac
done

[[ -n "$SALIDA" ]]        || { erd_error "falta --salida"; uso; }
[[ "${#SCHEMAS[@]}" -gt 0 ]] || { erd_error "falta al menos un schema"; uso; }

if [[ "${#SCHEMAS[@]}" -gt 1 ]]; then
  erd_error "por ahora sólo se soporta un schema; llegan varios con el primer módulo"
  exit 1
fi

[[ -f "${SCHEMAS[0]}" ]] || { erd_error "no existe: ${SCHEMAS[0]}"; exit 1; }

# El encabezado va acá y no en la lib: es texto del documento, no del diagrama,
# y la lib se mantiene pura emitiendo sólo el ERD.
componer() {
  cat <<EOF
# Diagrama de la base de datos

> **Generado por \`scripts/generar-erd.sh\` desde \`${SCHEMAS[0]}\`. No editar a
> mano**: el hook de pre-commit y el paso 3 de \`deploy.sh\` regeneran y frenan
> si este archivo no coincide.
>
> **Lo que este diagrama NO muestra son las policies de RLS**, que son lo que
> aísla un tenant de otro. Viven en el SQL de las migraciones, no en el schema,
> así que ninguna herramienta que lea el schema las ve. El modelo de aislamiento
> está explicado en
> \`docs/superpowers/specs/2026-08-04-schema-nucleo-design.md\`.

EOF
  erd_desde_schema "$(cat "${SCHEMAS[0]}")"
}

if [[ "$VERIFICAR" == true ]]; then
  if [[ ! -f "$SALIDA" ]]; then
    erd_error "$SALIDA no existe; correr: scripts/generar-erd.sh --salida=$SALIDA ${SCHEMAS[0]}"
    exit 1
  fi
  if ! diff -u "$SALIDA" <(componer); then
    erd_error "$SALIDA está desactualizado respecto de ${SCHEMAS[0]}"
    erd_error "regenerar con: scripts/generar-erd.sh --salida=$SALIDA ${SCHEMAS[0]}"
    exit 1
  fi
  exit 0
fi

componer > "$SALIDA"
printf '%s  escrito %s\n' "$(date -u +%H:%M:%S)" "$SALIDA"
```

```bash
chmod +x scripts/generar-erd.sh
```

- [ ] **Step 2: Generar el diagrama y mirarlo**

```bash
scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma
cat docs/schema.md
```
Expected: el encabezado, un bloque `mermaid` con las cinco tablas y las cuatro relaciones, y la sección de enums.

**Leerlo entero contra `prisma/schema.prisma`** antes de seguir: es la única vez que un humano lo va a comparar a mano. Verificar en particular que `tenants` no tiene `tenant_id` (es el tenant), que ninguna vuelta de relación aparece como columna, y que los tipos son los de Postgres.

- [ ] **Step 3: Verificar que `--verificar` detecta una diferencia**

```bash
scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma; echo "exit: $? (debe ser 0)"
printf '\nuna línea de más\n' >> docs/schema.md
scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma; echo "exit: $? (debe ser 1)"
scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma
scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma; echo "exit: $? (debe ser 0 de nuevo)"
```
Expected: 0, después 1 con el diff impreso, después 0.

- [ ] **Step 4: Verificar el rechazo de argumentos**

```bash
scripts/generar-erd.sh --salida=/tmp/x.md; echo "sin schema -> $?"
scripts/generar-erd.sh prisma/schema.prisma; echo "sin --salida -> $?"
scripts/generar-erd.sh --salida=/tmp/x.md /no/existe.prisma; echo "schema inexistente -> $?"
scripts/generar-erd.sh --inventado --salida=/tmp/x.md prisma/schema.prisma; echo "flag desconocido -> $?"
```
Expected: 2, 2, 1, 2. Ningún caso debe escribir `/tmp/x.md`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generar-erd.sh docs/schema.md
git commit -m "$(cat <<'EOF'
feat(docs): el diagrama de la base, generado

scripts/generar-erd.sh pone los efectos —leer, escribir, comparar— y deja la
decisión en la lib. Toma las rutas por argumento para que sumar los schemas de
los módulos sea trivial, pero el merge multi-archivo no está escrito: hoy no
hay un segundo schema que lo ejercite.

docs/schema.md es 100 % generado y lo dice en su encabezado. Un archivo mitad
generado y mitad escrito pierde la mitad escrita en la próxima regeneración.

El encabezado también dice lo que el diagrama NO muestra: las policies de RLS
viven en el SQL de las migraciones, no en el schema, y son justamente lo que
aísla un tenant de otro.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Que no pueda quedar desactualizado

Dos lugares, igual que el chequeo de migraciones destructivas: el hook porque es barato e inmediato, y `deploy.sh` porque `--no-verify` existe.

**Files:**
- Modify: `.githooks/pre-commit`
- Modify: `scripts/deploy.sh`

**Interfaces:**
- Consumes: `scripts/generar-erd.sh --verificar` de la Task 2.
- Produces: un commit o un deploy que traiga el schema cambiado sin el diagrama regenerado, frena.

- [ ] **Step 1: Sumar la verificación al hook**

En `.githooks/pre-commit`, después del bloque de migraciones destructivas, agregar:

```bash
# El diagrama de la base, si el commit toca un schema o el propio diagrama.
#
# Va acá y no sólo en deploy.sh por lo mismo que el chequeo de arriba: es
# barato. Parsea un archivo de texto y no necesita levantar nada, que es la
# condición que CLAUDE.md le pone a lo que puede vivir en un hook. Un hook que
# arranca un Postgres en cada commit termina con alguien usando --no-verify.
tocados=$(git diff --cached --name-only --diff-filter=d -- '*schema.prisma' 'docs/schema.md')
if [[ -n "$tocados" ]]; then
  if ! scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma; then
    cat >&2 <<'EOF'

El diagrama de la base quedó desactualizado respecto del schema.

Regeneralo y sumalo al commit:

    scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma
    git add docs/schema.md

docs/schema.md es 100 % generado: no lo edites a mano.
EOF
    exit 1
  fi
fi
```

- [ ] **Step 2: Probar el hook en sus tres caminos**

```bash
# a) Un commit que no toca el schema: el chequeo ni corre.
touch /tmp/nada.txt && cp /tmp/nada.txt README-prueba.md
git add README-prueba.md && .githooks/pre-commit; echo "sin tocar schema -> $?"
git restore --staged README-prueba.md; rm README-prueba.md

# b) Schema tocado con el diagrama al día: pasa.
touch prisma/schema.prisma && git add prisma/schema.prisma
.githooks/pre-commit; echo "schema tocado, diagrama al día -> $?"

# c) Schema tocado con el diagrama desactualizado: frena.
printf '\n// comentario de prueba\n' >> prisma/schema.prisma
git add prisma/schema.prisma && .githooks/pre-commit; echo "diagrama desactualizado -> $?"
git restore --staged prisma/schema.prisma
git checkout prisma/schema.prisma
```
Expected: 0, 0, 1 con el mensaje. El caso (c) sólo frena si el comentario cambia el ERD; si no cambia nada, probarlo agregando un campo en vez de un comentario — y eso mismo confirma que el chequeo mira el diagrama y no el archivo.

- [ ] **Step 3: Sumar la verificación al paso 3 de `deploy.sh`**

En `scripts/deploy.sh`, dentro del bloque del paso 3 y **después** de la comparación de schema contra migraciones, agregar:

```bash
# El diagrama, en el mismo paso: es la misma pregunta que las migraciones —¿el
# repo es coherente consigo mismo?— y un paso 17 obligaría a renumerar los
# dieciséis por una verificación de documentación.
if ! scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma; then
  error "docs/schema.md está desactualizado respecto de prisma/schema.prisma"
  error "regenerar con: scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma"
  exit 1
fi
```

Y cambiar el `log` del paso 3 para que nombre lo que ahora cubre:

```bash
log "paso 3/16: schema.prisma, migraciones y diagrama sincronizados"
```

- [ ] **Step 4: Verificar contra una copia en scratch, nunca el script real**

`scripts/deploy.sh` apunta a producción por defecto. **No ejecutarlo.** El paso 3 es preflight —no toca ningún stack— así que alcanza con una copia que sólo cambie las rutas peligrosas y corte después de ese paso:

```bash
S=/tmp/claude-0/-root-arandano/scratch-erd
mkdir -p "$S/prod" "$S/ensayo"
sed -e "s|DIR=/srv/arandano/prod|DIR=$S/prod|" \
    -e "s|DIR=/srv/arandano/ensayo|DIR=$S/ensayo|" \
    -e "s|/var/lock/arandano-deploy.lock|$S/deploy.lock|" \
    -e '/^log "paso 4\/16/i exit 99' \
    scripts/deploy.sh > "$S/copia.sh"
chmod +x "$S/copia.sh"

# La aserción que evita el accidente: si el DIR resuelto cae bajo /srv, no se corre.
grep -n 'DIR=' "$S/copia.sh" | grep '/srv' && { echo "ABORTAR: la copia todavía apunta a /srv"; exit 1; }
echo "copia segura, ningún DIR bajo /srv"
```

El `exit 99` insertado antes del paso 4 hace que la copia termine apenas cierra el preflight: nunca llega a frenar dev, ni a buildear, ni a tocar un stack.

```bash
# Con el diagrama al día, el paso 3 pasa y la copia corta en 99.
"$S/copia.sh" --objetivo=ensayo 2>&1 | grep -E 'paso 3/16'; echo "exit: $? "
# Con el diagrama desactualizado, frena EN el paso 3 (exit 1, no 99).
printf '\nlínea de más\n' >> docs/schema.md
"$S/copia.sh" --objetivo=ensayo; echo "exit: $? (debe ser 1, no 99)"
scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma
"$S/copia.sh" --objetivo=ensayo >/dev/null 2>&1; echo "exit: $? (debe volver a ser 99)"
rm -rf "$S"
```
Expected: 99, después 1 nombrando el diagrama, después 99 de nuevo. Que el fallo dé 1 y no 99 es lo que prueba que frenó en el paso 3 y no que llegó al corte.

- [ ] **Step 5: Correr la suite**

```bash
npm test
```
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add .githooks/pre-commit scripts/deploy.sh
git commit -m "$(cat <<'EOF'
feat(docs): el diagrama no puede quedar desactualizado

Se verifica en dos lugares, igual que las migraciones destructivas: el hook de
pre-commit porque es barato —parsea texto, no levanta nada, que es la condición
que CLAUDE.md le pone a lo que puede vivir en un hook— y deploy.sh porque
--no-verify existe.

En deploy.sh va adentro del paso 3 y no como paso nuevo: es la misma pregunta
que ya hace ese paso —¿el repo es coherente consigo mismo?— y agregar un paso
17 obligaría a renumerar los dieciséis por una verificación de documentación.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Documentación

**Files:**
- Modify: `docs/runbook-stacks.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: que alguien que llega nuevo sepa que el archivo es generado y cómo regenerarlo.

- [ ] **Step 1: Sumar el diagrama al runbook**

En `docs/runbook-stacks.md`, antes de *Certificado de producción, hoy*:

```markdown
## El diagrama de la base

`docs/schema.md` es **generado**, no escrito. Se regenera con:

```bash
scripts/generar-erd.sh --salida=docs/schema.md prisma/schema.prisma
```

No editarlo a mano: la próxima regeneración se lleva el cambio puesto. Si hace
falta explicar algo que el diagrama no dice, el lugar es el spec del schema del
núcleo, que es donde está el modelo de aislamiento.

Se verifica en dos lugares, así que no puede quedar desactualizado en silencio:
el hook de pre-commit lo chequea cuando el commit toca un `schema.prisma`, y el
paso 3 de `deploy.sh` lo chequea siempre. Los dos imprimen el diff y el comando
para regenerar.

**Lo que el diagrama no muestra son las policies de RLS.** Viven en el SQL de
las migraciones y no en el schema, así que ninguna herramienta que lea
`schema.prisma` las ve — y son justamente lo que aísla un tenant de otro.
```

- [ ] **Step 2: Anotarlo en `CLAUDE.md`**

En *Próximos pasos técnicos*, dentro de la lista del producto, agregar como hecho, siguiendo la convención de tachado que el archivo ya usa:

```markdown
- ~~Mantener un diagrama actualizado de la base.~~ **Hecho** (2026-08-07).
  `docs/schema.md`, generado desde `prisma/schema.prisma` por
  `scripts/generar-erd.sh` y verificado por el hook de pre-commit y por el paso
  3 de `deploy.sh`. Ver
  `docs/superpowers/specs/2026-08-07-diagrama-schema-design.md`.
```

- [ ] **Step 3: Verificar que no se contradice con nada**

```bash
grep -n -i "schema.md\|diagrama" CLAUDE.md docs/runbook-stacks.md
```
Expected: todas las menciones dicen lo mismo —generado, verificado en dos lugares, no editar a mano— y ninguna afirma que haya que actualizarlo a mano.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/runbook-stacks.md
git commit -m "$(cat <<'EOF'
docs: el diagrama de la base, en el runbook y en CLAUDE.md

Que alguien que llega nuevo sepa que docs/schema.md es generado antes de
editarlo a mano y perder el cambio en la próxima regeneración.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verificación final

- [ ] `npm test` — los tres archivos de bash y los de vitest, todo en verde.
- [ ] `scripts/generar-erd.sh --verificar --salida=docs/schema.md prisma/schema.prisma` — exit 0.
- [ ] El hook frena un commit que cambia el schema sin regenerar el diagrama.
- [ ] Una copia en scratch de `deploy.sh --objetivo=ensayo` frena en el paso 3 con el diagrama desactualizado.
- [ ] `docs/schema.md` renderiza en GitHub — pegarlo en un gist o mirarlo en el PR.
- [ ] `git log --oneline` — un commit por tarea, ninguno con el árbol sucio detrás.
