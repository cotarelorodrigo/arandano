#!/usr/bin/env bash
# Lógica de decisión compartida entre deploy.sh y rollback.sh.
#
# Sólo funciones PURAS: reciben strings, devuelven strings o un código de
# salida, y no tocan Docker, la red, git ni el disco. Eso es lo que permite que
# scripts/tests/test-deploy-comun.sh corra en milisegundos, y por lo tanto que
# nadie tenga excusa para saltearlo.
#
# mensaje_de_tag e imagen_de_tag son INVERSAS y viven juntas a propósito:
# deploy.sh escribe el mensaje del tag y rollback.sh lo lee. Separarlas en dos
# archivos es exactamente cómo se desincronizan, y el modo de falla sería que
# el rollback manual no encuentre a dónde volver — descubierto justo el día que
# hace falta.
#
# Este archivo sólo define funciones. No ejecuta nada al sourcearse.

log()   { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
error() { printf '%s  ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# La próxima versión, derivada del último tag. Con el tag vacío devuelve
# v1.0.0: ese es el primer deploy, y el caso vive acá y no en el llamador
# justamente para que tenga test.
#
# MAJOR se queda en 1 por decisión de producto (CLAUDE.md): esto es un SaaS sin
# API pública. Un tag v2.x.y es señal de que algo lo escribió a mano, así que se
# rechaza en vez de interpretarse.
proxima_version() {
  local ultimo="${1:-}" tipo="${2:-}"

  case "$tipo" in
    minor|patch) ;;
    *) error "tipo de versión inválido: '${tipo}' (válidos: minor, patch)"; return 1 ;;
  esac

  if [[ -z "$ultimo" ]]; then
    printf 'v1.0.0\n'
    return 0
  fi

  if [[ ! "$ultimo" =~ ^v1\.([0-9]+)\.([0-9]+)$ ]]; then
    error "tag con formato inesperado: '${ultimo}' (se espera v1.MINOR.PATCH)"
    return 1
  fi

  local minor="${BASH_REMATCH[1]}" patch="${BASH_REMATCH[2]}"
  # $((...)) y no concatenación de strings: v1.0.9 + patch es v1.0.10.
  if [[ "$tipo" == minor ]]; then
    printf 'v1.%d.0\n' "$((minor + 1))"
  else
    printf 'v1.%d.%d\n' "$minor" "$((patch + 1))"
  fi
}

# ¿El SQL trae algo que rompa el rollback? Exit 0 si SÍ encontró (y lo imprime),
# exit 1 si está limpio. Es la convención de grep, no la de un booleano: en bash
# "encontré" y "todo bien" no pueden ser el mismo 0.
#
# El criterio no es "destruye datos" sino "el código ANTERIOR deja de funcionar
# contra este schema" (la lista de patrones es una implementación de ESE
# criterio, no el criterio en sí — si aparece un caso nuevo que lo cumple, el
# patrón que falta se agrega, no se discute el criterio). Por eso entran los
# renames, que no borran nada: el rollback revierte la imagen y no la base, así
# que una columna renombrada deja a la imagen vieja consultando algo que ya no
# existe. Por la misma razón entra SET NOT NULL: Prisma lo emite cada vez que
# un campo opcional pasa a requerido, y la imagen vieja sigue insertando filas
# sin esa columna — el caso más común de todos, y el que más duele si se
# escapa.
#
# Hay UNA excepción a ese criterio, marcada como tal en la lista: DISABLE ROW
# LEVEL SECURITY entra por aislamiento entre tenants, no por rollback. Ver el
# comentario en el patrón.
#
# TODO el análisis pasa por UN solo programa de perl, y eso es a propósito. La
# versión anterior encadenaba etapas —perl, sed, tr, y después grep y wc— y
# cada etapa era una manera distinta de fallar ABIERTO: si una no corría, el
# texto llegaba vacío o el `grep` devolvía 127 y la migración se leía como
# aditiva. En esta máquina eso no es teórico: el build corre dentro de un slice
# de 2 GiB sobre una caja de 7.6 GB (ver CLAUDE.md) y un
# `fork: Cannot allocate memory` produce exactamente eso. Se le fueron
# poniendo guards de a uno y cada guard tapaba una etapa y dejaba la de al
# lado; con una sola etapa hay un solo exit code que mirar, y todo lo que no
# sea una respuesta explícita del analizador frena el deploy.
#
# Qué queda afuera, dicho sin redondear:
#
#   - Para BUSCAR (etapa 3) el contenido de los literales y de los cuerpos $$
#     se conserva tal cual, así que un texto que MENCIONA un DROP frena el
#     deploy. Es un falso positivo y es a propósito: alguien mira y sigue de
#     largo en un minuto.
#   - Para DEJAR PASAR (el emparejamiento de constraints de la etapa 2) ese
#     mismo texto NO cuenta, porque si contara alcanzaría con mencionar un
#     "ADD CONSTRAINT" adentro de un string para desarmar el chequeo. Esa
#     asimetría es deliberada; está explicada en la etapa 2.
#   - Un `\'` adentro de un literal sin prefijo E, y cualquier SQL que deje sin
#     cerrar un literal, un comentario de bloque o un $$, se tratan como no
#     analizables y frenan. También falsos positivos, y los dos últimos son SQL
#     inválido que no iba a aplicar igual.
#   - Lo que esta función NO decide es si la LISTA de patrones está completa.
#     La familia DROP POLICY / DROP FUNCTION / DROP TRIGGER / DROP SEQUENCE no
#     está y no va a disparar. En el caso de las policies es una decisión
#     tomada y no un olvido: recrear una policy (DROP + CREATE del mismo
#     nombre) es su forma normal, pero TODAS las policies de este repo se
#     llaman `tenant_aislamiento`, así que un emparejamiento por nombre —el
#     mismo truco que usan las constraints— dejaría pasar un DROP POLICY sobre
#     "clientes" emparejado con un CREATE POLICY sobre "articulos", y perder el
#     aislamiento de "clientes" en silencio. Un emparejamiento que además mire
#     la tabla es otro trabajo, no un patrón más en la lista.
#
# O sea: todo lo que el analizador no entiende cae del lado de frenar, y lo que
# puede dejar pasar algo peligroso es un patrón que falte en la lista — eso se
# ve leyendo la lista.
migracion_destructiva() {
  local sql="${1:-}"

  # El programa se lee con el builtin `read` y no con `$(cat <<...)`: la
  # función cuyo trabajo es no depender de binarios externos no debería sumar
  # uno para cargarse a sí misma. `read -d ''` sale 1 al llegar al fin del
  # heredoc sin encontrar un NUL, dejando la variable completa: el `|| true`
  # es esa mecánica y no un error tapado.
  local programa
  IFS= read -r -d '' programa <<'PERL' || true
use strict;
use warnings;

# Convención de salida: 0 = destructiva (y el motivo por stdout), 3 = limpia.
# Cualquier otro código es "el analizador no corrió", y del lado de bash eso
# frena el deploy. El 3 no es capricho: si "limpia" fuera 1, un perl que aborta
# por su cuenta (die, programa vacío, out of memory) también saldría con un
# código bajo y se leería como "no encontré nada".
sub no_analizable {
  print "SQL no analizable: $_[0]\n";
  exit 0;
}

my $sql = do { local $/; <STDIN> };
$sql = '' unless defined $sql;

# Etapa 1: sacar los comentarios sabiendo dónde empieza y termina cada literal.
# Un `--` adentro de un string NO abre un comentario, y esa distinción es todo
# el punto: sin ella el `--` se come el resto de la línea y con él cualquier
# DROP que viniera después. Prisma nunca escribe un `--` adentro de un literal,
# pero una migración de datos o una policy de RLS escrita a mano sí — y todo el
# aislamiento entre tenants de este proyecto son policies escritas a mano.
#
# Salen DOS textos del mismo recorrido, y la diferencia importa:
#   $limpio    conserva literales y cuerpos $$ tal cual.
#   $sin_texto los reemplaza por '' (dos comillas, no un espacio, para que el
#              blanqueo no pueda pegar dos tokens y fabricar una frase que no
#              estaba).
# La etapa 3 busca sobre $limpio, así que un texto que MENCIONA un DROP frena
# el deploy — falso positivo a propósito. La etapa 2 usa $sin_texto para el
# lado que DEJA PASAR (ver ahí abajo por qué sólo para ese lado).
my $limpio = '';
my $sin_texto = '';
my $n = length $sql;
my $i = 0;

while ($i < $n) {
  my $c  = substr($sql, $i, 1);
  my $c2 = substr($sql, $i, 2);

  # Comentario de bloque. En Postgres anidan, así que se cuenta profundidad.
  if ($c2 eq '/*') {
    my $prof = 1;
    $i += 2;
    while ($i < $n && $prof > 0) {
      my $t = substr($sql, $i, 2);
      if    ($t eq '/*') { $prof++; $i += 2; }
      elsif ($t eq '*/') { $prof--; $i += 2; }
      else               { $i++; }
    }
    no_analizable("comentario de bloque sin cerrar") if $prof > 0;
    $limpio .= ' ';
    $sin_texto .= ' ';
    next;
  }

  # Comentario de línea.
  if ($c2 eq '--') {
    $i += 2;
    $i++ while ($i < $n && substr($sql, $i, 1) ne "\n");
    $limpio .= ' ';
    $sin_texto .= ' ';
    next;
  }

  # Literal de string. Se conserva TAL CUAL, no se blanquea: si adentro dice
  # DROP TABLE preferimos frenar de más y que alguien lo mire, antes que borrar
  # texto y quedarnos sin ver lo que sí era código.
  if ($c eq "'") {
    # Sólo un literal con prefijo E interpreta el backslash como escape. Los
    # demás terminan en la primera comilla que no venga duplicada.
    my $escapes = ($i > 0
                   && substr($sql, $i - 1, 1) =~ /[Ee]/
                   && ($i < 2 || substr($sql, $i - 2, 1) !~ /[A-Za-z0-9_]/)) ? 1 : 0;
    my $j = $i + 1;
    my $cerrado = 0;
    while ($j < $n) {
      my $d = substr($sql, $j, 1);
      if ($escapes && $d eq "\\") { $j += 2; next; }
      # Un backslash pegado a una comilla en un literal SIN prefijo E es
      # ambiguo: sólo escapa si el servidor corre con
      # standard_conforming_strings en off, que dejó de ser el default en la
      # 9.1. No se adivina de qué lado está: no saber dónde termina el literal
      # es no saber qué es código, y eso frena el deploy.
      no_analizable("literal con \\' sin prefijo E (ambiguo)")
        if !$escapes && $d eq "\\" && substr($sql, $j + 1, 1) eq "'";
      if ($d eq "'") {
        if (substr($sql, $j + 1, 1) eq "'") { $j += 2; next; }
        $j++;
        $cerrado = 1;
        last;
      }
      $j++;
    }
    no_analizable("literal de string sin cerrar") unless $cerrado;
    $limpio .= substr($sql, $i, $j - $i);
    $sin_texto .= "''";
    $i = $j;
    next;
  }

  # Identificador entre comillas dobles. Se conserva porque los patrones lo
  # necesitan: ALTER COLUMN "x" TYPE se ancla justo ahí.
  if ($c eq '"') {
    my $j = $i + 1;
    my $cerrado = 0;
    while ($j < $n) {
      my $d = substr($sql, $j, 1);
      if ($d eq '"') {
        if (substr($sql, $j + 1, 1) eq '"') { $j += 2; next; }
        $j++;
        $cerrado = 1;
        last;
      }
      $j++;
    }
    no_analizable("identificador entre comillas sin cerrar") unless $cerrado;
    # El identificador va IGUAL en los dos: es el nombre de la constraint que la
    # etapa 2 tiene que poder leer.
    $limpio .= substr($sql, $i, $j - $i);
    $sin_texto .= substr($sql, $i, $j - $i);
    $i = $j;
    next;
  }

  # Dollar quoting ($$ ... $$ / $tag$ ... $tag$): el cuerpo de una función
  # plpgsql, que es como se escriben los triggers a mano. Se conserva como
  # código —adentro puede haber un DROP de verdad— y lo que importa acá es
  # reconocer dónde termina para no desincronizarse con el resto del archivo.
  if ($c eq '$' && substr($sql, $i) =~ /^(\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$)/) {
    my $tag = $1;
    my $fin = index($sql, $tag, $i + length($tag));
    no_analizable("bloque \$\$ sin cerrar") if $fin < 0;
    my $hasta = $fin + length($tag);
    $limpio .= substr($sql, $i, $hasta - $i);
    $sin_texto .= "''";
    $i = $hasta;
    next;
  }

  $limpio .= $c;
  $sin_texto .= $c;
  $i++;
}

$limpio =~ s/\s+/ /g;
$sin_texto =~ s/\s+/ /g;

# Etapa 2: un DROP CONSTRAINT emparejado con un ADD CONSTRAINT del MISMO nombre
# no es destructivo. Es lo que Prisma emite para cualquier cambio de relación
# (agregar onDelete: Cascade, volver opcional una FK): recrea la constraint, no
# la elimina, y el código anterior no depende de que exista entre un statement
# y el otro. Bloquearlo es justo el falso positivo que enseña a saltear el
# gate.
#
# Los dos lados NO leen el mismo texto, y es lo único que evita que un texto
# cualquiera desarme el gate:
#
#   - Los DROP se cuentan sobre $limpio (con literales y cuerpos $$ tal cual).
#     Ese lado sólo puede EXIGIR más emparejamientos, así que conservar el
#     texto sólo hace frenar de más. Y no perdemos el caso real de un DROP
#     CONSTRAINT adentro de un cuerpo $$, que sí es DDL que se va a ejecutar.
#   - Los ADD se leen de $sin_texto (literales y cuerpos $$ blanqueados). Ese
#     lado DEJA PASAR, así que su evidencia tiene que ser DDL de verdad y no
#     texto: un INSERT a una tabla de auditoría de DDL que guarde el string
#     'ALTER TABLE ... ADD CONSTRAINT "x" ...', o un EXECUTE adentro de una
#     función, alcanzaba para emparejar un DROP CONSTRAINT "x" real y que la
#     migración se leyera aditiva.
my @dropeadas = $limpio =~ /DROP[[:space:]]+CONSTRAINT[[:space:]]+"([^"]+)"/gi;
my $drops = () = $limpio =~ /DROP[[:space:]]+CONSTRAINT/gi;
# Un DROP CONSTRAINT cuyo nombre no se puede leer entre comillas no se puede
# emparejar. Prisma siempre cita identificadores; algo escrito a mano podría no
# hacerlo, y no poder verificar es motivo para frenar, no para seguir.
if ($drops > scalar @dropeadas) {
  print "DROP CONSTRAINT sin nombre entre comillas (no se puede verificar el emparejamiento)\n";
  exit 0;
}
if (@dropeadas) {
  my %agregadas = map { $_ => 1 } ($sin_texto =~ /ADD[[:space:]]+CONSTRAINT[[:space:]]+"([^"]+)"/gi);
  for my $nombre (@dropeadas) {
    next if $agregadas{$nombre};
    print "DROP CONSTRAINT \"$nombre\" sin ADD CONSTRAINT correspondiente\n";
    exit 0;
  }
}

# Etapa 3: los patrones, sobre el texto ya limpio y con los espacios plegados.
for my $patron (
  'DROP[[:space:]]+COLUMN',
  'DROP[[:space:]]+TABLE',
  'DROP[[:space:]]+SCHEMA',
  'DROP[[:space:]]+TYPE',
  'DROP[[:space:]]+INDEX',
  'DROP[[:space:]]+VIEW',
  'DROP[[:space:]]+DEFAULT',
  '\bTRUNCATE\b',
  'RENAME[[:space:]]+TO',
  'RENAME[[:space:]]+COLUMN',
  'RENAME[[:space:]]+VALUE',
  'SET[[:space:]]+NOT[[:space:]]+NULL',
  # Las dos grafías que Prisma emite de verdad para un cambio de tipo:
  # "SET DATA TYPE" para el caso común, y "TYPE" a secas adentro del bloque que
  # recrea un enum angostado. Anclado a las comillas del identificador para que
  # no matchee ni CREATE TYPE ni ALTER TYPE ... ADD VALUE.
  'ALTER[[:space:]]+COLUMN[[:space:]]+"[^"]+"[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE[[:space:]]',
  # Este último NO responde al mismo criterio que los doce de arriba, y hay que
  # decirlo o el próximo lector lo va a leer como incoherente con el header y
  # lo va a sacar. Los otros son seguridad de ROLLBACK: el código anterior deja
  # de funcionar contra el schema nuevo. Éste es AISLAMIENTO: el código
  # anterior sigue funcionando perfecto, y justamente por eso devuelve filas de
  # OTROS tenants. Apaga el RLS de una tabla sin que aparezca un DROP en ningún
  # lado, y a diferencia de una policy recreada no tiene forma legítima
  # recurrente, así que no necesita emparejamiento ni arriesga falsos
  # positivos. ENABLE no matchea: la migración inicial está llena de ENABLE.
  #
  # Es un backstop barato, no la defensa real. La defensa real es el check de
  # query filtrada por tenant en el healthcheck, que CLAUDE.md tiene como
  # bloqueante #1 antes del primer tenant.
  'DISABLE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY',
) {
  if ($limpio =~ /$patron/i) {
    print "$patron\n";
    exit 0;
  }
}

exit 3;
PERL

  # Dos detalles que parecen de estilo y no lo son:
  #
  #   - Sin `local motivo=$(...)`: `local` es un comando y pisa el $? del
  #     substitution, que es justo lo único que se mira acá.
  #   - Con `|| rc=$?` y no con `rc=$?` en la línea siguiente: si el script que
  #     sourcea esta lib corre con `set -e` (deploy.sh lo va a hacer) y llama a
  #     esta función suelta, una asignación que sale distinto de 0 aborta el
  #     script ahí mismo, sin el mensaje y sin el `return 0` de fallar cerrado.
  #     El `||` la vuelve un comando compuesto y errexit la deja pasar.
  local motivo rc=0
  motivo=$(printf '%s' "$sql" | perl -e "$programa") || rc=$?

  case "$rc" in
    0)
      # Destructiva SIEMPRE viene con motivo. Un 0 mudo no es una respuesta:
      # es lo que devolvería un `perl -e ""`, o sea el heredoc llegando vacío.
      if [[ -z "$motivo" ]]; then
        error "migracion_destructiva: el analizador salió 0 sin decir por qué; fallando cerrado"
        printf 'analizador incoherente (salió 0 sin motivo)\n'
        return 0
      fi
      printf '%s\n' "$motivo"
      return 0
      ;;
    3)
      return 1
      ;;
    *)
      # Todo lo que no sea 0 ó 3: perl ausente del PATH (127), un fork que no
      # entró en memoria, un die. No sabemos qué trae la migración, y no saber
      # es motivo para frenar.
      error "migracion_destructiva: el analizador no corrió (perl salió ${rc}); fallando cerrado"
      printf 'analizador de migraciones roto (perl salió %s)\n' "$rc"
      return 0
      ;;
  esac
}

# El cuerpo del tag anotado. Lleva lo que el SHA no dice: qué imagen se promovió
# y qué migraciones corrieron en ese deploy. Es lo primero que alguien quiere
# leer a las 11 de la noche.
mensaje_de_tag() {
  local sha="${1:-}" migraciones="${2:-}"
  [[ -n "$sha" ]] || { error "mensaje_de_tag necesita un sha"; return 1; }
  [[ -n "$migraciones" ]] || migraciones="(ninguna)"
  printf 'imagen: arandano-app:%s\nmigraciones: %s\n' "$sha" "$migraciones"
}

# La inversa de mensaje_de_tag: de dónde saca rollback.sh a qué imagen volver.
imagen_de_tag() {
  local mensaje="${1:-}" sha
  sha=$(printf '%s\n' "$mensaje" \
        | sed -nE 's|^imagen: arandano-app:([0-9a-f]+)[[:space:]]*$|\1|p' \
        | head -1)
  if [[ -z "$sha" ]]; then
    error "el mensaje del tag no tiene una línea 'imagen: arandano-app:<sha>'"
    return 1
  fi
  printf '%s\n' "$sha"
}

# Sano es: status ok, AL MENOS un check, y NINGÚN check en false.
#
# Los tres a la vez, y no sólo el status: un `status: ok` con un check caído
# dejaría pasar un deploy con la app conectada como superusuario, que es
# exactamente lo que el check `rol` existe para atrapar. Y cero checks no es
# salud, es ausencia de evidencia.
health_ok() {
  local json="${1:-}"
  printf '%s' "$json" | jq -e '
    .status == "ok"
    and (.checks | length) > 0
    and ([.checks[] | select(.ok != true)] | length) == 0
  ' >/dev/null 2>&1
}

# El SHA que la app dice estar corriendo. deploy.sh lo compara contra el tag que
# promovió: sin eso, un healthcheck en 200 desde el contenedor VIEJO se lee como
# deploy exitoso.
sha_del_health() {
  local json="${1:-}" sha
  sha=$(printf '%s' "$json" | jq -re '.info.sha // empty' 2>/dev/null) || true
  if [[ -z "$sha" ]]; then
    error "el healthcheck no reportó info.sha"
    return 1
  fi
  printf '%s\n' "$sha"
}

# ¿El Postgres que escribió estos logs ya terminó su arranque en dos fases?
# El entrypoint de la imagen levanta un servidor TEMPORAL para correr sus
# scripts de init (crear el rol, la base), lo apaga, y recién ahí arranca el
# DEFINITIVO — y la línea "database system is ready to accept connections"
# aparece una vez por cada uno. `pg_isready` (y por lo tanto el healthcheck de
# `docker compose ... --wait`) puede responder OK contra el servidor TEMPORAL,
# así que confiar en la primera aparición deja una ventana real donde una
# conexión nueva se cae con "Connection refused" o "the database system is
# starting up" aunque compose ya haya marcado el contenedor healthy —
# reproducido en la práctica contra arandano-stage (ver task-8-report.md).
# Contar hasta la SEGUNDA aparición es la señal inequívoca: mismo criterio que
# ya usa a mano el paso 3 de deploy.sh (shadow database) y
# test/postgres-efimero.ts.
#
# Pura: recibe el texto de `docker logs` ya leído, no lo lee ella misma — eso
# es lo que la hace testeable sin Docker. El llamador (deploy.sh) es quien
# hace `docker logs` en un loop acotado y decide cuándo rendirse.
postgres_definitivo_listo() {
  local logs="${1:-}" n
  n=$(printf '%s' "$logs" | grep -c 'database system is ready to accept connections' || true)
  [[ "$n" -ge 2 ]]
}
