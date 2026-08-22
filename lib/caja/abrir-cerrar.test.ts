import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { Client, type PoolClient } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant, crearUsuario } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let usuarioA: string
let usuarioB: string
let abrirCaja: typeof import('@/lib/caja/abrir-cerrar').abrirCaja
let cerrarCaja: typeof import('@/lib/caja/abrir-cerrar').cerrarCaja
let cajaAbierta: typeof import('@/lib/caja/abrir-cerrar').cajaAbierta
let pool: typeof import('@/lib/db').pool

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'caja-a')
  tenantB = await crearTenant(owner, 'caja-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@caja-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@caja-b.test')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después.
  process.env.DATABASE_URL = urlApp()
  ;({ abrirCaja, cerrarCaja, cajaAbierta } = await import('@/lib/caja/abrir-cerrar'))
  // Mismo pool que usa `abrir-cerrar.ts` por debajo (vía lib/tenant/transaccion
  // -> lib/db): es un import dinámico y no uno estático arriba del archivo por
  // el mismo motivo que el de la línea anterior — importado antes de fijar
  // DATABASE_URL sería OTRO pool, apuntando a ningún lado.
  ;({ pool } = await import('@/lib/db'))
})

afterAll(async () => {
  await owner.end()
})

// Cada caso arranca sin caja abierta: el índice parcial es por tenant, así que
// una caja que quedó abierta de un caso anterior hace fallar al siguiente por
// el motivo equivocado.
beforeEach(async () => {
  await owner.query('DELETE FROM cajas')
})

describe('abrir y cerrar la caja', () => {
  it('abrir deja la caja con cerradaEn en null', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    const abierta = await cajaAbierta(tenantA)
    expect(abierta?.id).toBe(id)
    expect(abierta?.saldoInicial.toString()).toBe('15000')
  })

  it('sin caja abierta, cajaAbierta() devuelve null', async () => {
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('cerrar la deja con la fecha y con quién la cerró', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const fila = await owner.query('SELECT cerrada_en, cerrada_por_id FROM cajas WHERE id = $1', [id])
    expect(fila.rows[0].cerrada_en).not.toBeNull()
    expect(fila.rows[0].cerrada_por_id).toBe(usuarioA)
  })

  it('después de cerrar, cajaAbierta() vuelve a dar null', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('se puede abrir una caja nueva después de cerrar la anterior', async () => {
    const primera = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const segunda = await abrirCaja(tenantA, usuarioA, '20000.00')
    expect(segunda.id).not.toBe(primera.id)
    expect((await cajaAbierta(tenantA))?.id).toBe(segunda.id)
  })

  // El caso que justifica el índice único parcial. Sin el índice, esto pasa —
  // y el paso 8 del brief hace comprobar exactamente eso (documentado en el
  // reporte de la task).
  it('no deja abrir dos cajas a la vez en el mismo tenant', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await expect(abrirCaja(tenantA, usuarioA, '20000.00')).rejects.toMatchObject({
      codigo: 'CAJA_YA_ABIERTA',
    })
  })

  // El índice es POR TENANT, no global: dos locales distintos abren a la vez,
  // y CADA UNO ve la SUYA — no sólo "alguna caja no nula" (ver el hallazgo I2
  // de la review: ese assert más débil habría pasado igual con la policy
  // rota y A leyendo la caja de B). El aislamiento en sí, a nivel de base y
  // no de esta función, tiene su propia sonda en test/rls.test.ts.
  it('dos tenants pueden tener cada uno su caja abierta, y son cajas distintas', async () => {
    const deA = await abrirCaja(tenantA, usuarioA, '15000.00')
    const deB = await abrirCaja(tenantB, usuarioB, '9000.00')

    const abiertaA = await cajaAbierta(tenantA)
    const abiertaB = await cajaAbierta(tenantB)
    expect(abiertaA?.id).toBe(deA.id)
    expect(abiertaB?.id).toBe(deB.id)
    expect(abiertaA?.id).not.toBe(abiertaB?.id)
    expect(abiertaA?.saldoInicial.toString()).toBe('15000')
    expect(abiertaB?.saldoInicial.toString()).toBe('9000')
  })

  it('cerrar sin caja abierta falla con un error claro', async () => {
    await expect(cerrarCaja(tenantA, usuarioA)).rejects.toMatchObject({
      codigo: 'SIN_CAJA_ABIERTA',
    })
  })

  // Cualquiera del local abre y cierra, dueño o empleado: en un mostrador abre
  // el que llega primero. La fila registra quién fue, así que la trazabilidad
  // no se pierde, y sin arqueo todavía no hay plata que cuadrar — que es lo
  // único que justificaría restringirlo.
  it('un empleado puede abrir y cerrar', async () => {
    const empleado = await crearUsuario(owner, tenantA, 'nahuel@caja-a.test', 'EMPLEADO')
    await abrirCaja(tenantA, empleado, '15000.00')
    expect(await cajaAbierta(tenantA)).not.toBeNull()
    await cerrarCaja(tenantA, empleado)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  // C1 de la review: la FK de Postgres hacia `users` no distingue tenants —
  // sus triggers corren como dueño de la tabla, exento de RLS—, así que sin
  // `exigirUsuario` esto entraba sin quejarse y el tenant B quedaba con un
  // empleado que no puede dar de baja (onDelete: Restrict contra una fila que
  // RLS le esconde). Ver lib/ventas/pertenencia.ts.
  describe('el usuario tiene que ser del tenant', () => {
    it('abrirCaja rechaza un usuario de otro tenant', async () => {
      await expect(abrirCaja(tenantA, usuarioB, '15000.00')).rejects.toMatchObject({
        codigo: 'USUARIO_INEXISTENTE',
      })
      // Y no queda una caja huérfana: la transacción entera se descarta.
      expect(await cajaAbierta(tenantA)).toBeNull()
    })

    it('cerrarCaja rechaza un usuario de otro tenant', async () => {
      await abrirCaja(tenantA, usuarioA, '15000.00')
      await expect(cerrarCaja(tenantA, usuarioB)).rejects.toMatchObject({
        codigo: 'USUARIO_INEXISTENTE',
      })
      // Y la caja de A sigue abierta: el rechazo no la tocó.
      expect(await cajaAbierta(tenantA)).not.toBeNull()
    })
  })

  // I3 de la review, ronda de fix 2: NI 2 NI 15 llamadas concurrentes alcanzan
  // a mostrar la carrera en este entorno. El re-reviewer corrió el test de 15
  // ocho veces contra el código de ANTES del fix y las ocho dieron el mismo
  // resultado "correcto" (1 fulfilled, 14 rejected) que el código arreglado:
  // `lib/db.ts` limita el pool a `max: 5`, así que con más llamadas que
  // conexiones el resto queda ENCOLADO, y para cuando a una encolada le toca
  // correr su `findFirst` la caja YA está cerrada por otra que corrió entera
  // primero — la cola del pool serializa la carrera, no el código. Un test
  // que da el mismo resultado con el código roto y con el arreglado no prueba
  // nada, así que se sacó (junto con el de 2 concurrentes, que fallaba por el
  // mismo motivo — verificado con cinco corridas repetidas, cinco en verde
  // contra el código roto).
  //
  // Tampoco sirve una versión SECUENCIAL de dos llamadas a `cerrarCaja` (abrir,
  // cerrar, cerrar de nuevo): se probó y pasa igual contra el código roto,
  // porque el `findFirst({ where: { cerradaEn: null } })` —que existe en las
  // DOS versiones, la rota y la arreglada— ya rechaza la segunda llamada antes
  // de llegar al `update`. Sin concurrencia real no hay forma de que dos
  // llamadas pasen las dos ese `findFirst` antes de que cualquiera escriba, que
  // es exactamente la ventana que el fix cierra.
  //
  // Lo que SÍ es determinístico, y no depende de que el scheduler intercale
  // nada por casualidad, es probar el MECANISMO en sí —el mismo UPDATE que usa
  // `cerrarCaja`— con dos conexiones propias cuyo orden fijamos a mano: las dos
  // "leen" la caja como abierta ANTES de que cualquiera escriba (lo que verían
  // dos `findFirst` concurrentes de verdad), una cierra y comitea, y la otra
  // corre el UPDATE con `cerrada_en IS NULL` repetido en el where —el que
  // `cerrarCaja` usa desde el fix—. Si esa condición no estuviera (el `update
  // ({ where: { id } })` liso de ANTES del fix), este segundo UPDATE
  // encontraría la fila igual —por id, sin mirar su estado— y la reescribiría;
  // con la condición, no encuentra nada. Verificado sacando la condición de
  // este mismo query (dejando sólo `WHERE id = $2`): `rowCount` pasa de 0 a 1,
  // o sea que el test SÍ falla contra el patrón de antes del fix.
  it('el mecanismo: un UPDATE con cerrada_en IS NULL no reescribe una caja que otra transacción ya cerró', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')

    const c1 = new Client({ connectionString: urlApp() })
    const c2 = new Client({ connectionString: urlApp() })
    await c1.connect()
    await c2.connect()

    try {
      await c1.query('BEGIN')
      await c1.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantA])
      await c2.query('BEGIN')
      await c2.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantA])

      // Las dos ven la caja como abierta, ANTES de que ninguna escriba — es
      // exactamente lo que verían dos `findFirst` concurrentes de verdad.
      const l1 = await c1.query('SELECT 1 FROM cajas WHERE id = $1 AND cerrada_en IS NULL', [id])
      const l2 = await c2.query('SELECT 1 FROM cajas WHERE id = $1 AND cerrada_en IS NULL', [id])
      expect(l1.rows).toHaveLength(1)
      expect(l2.rows).toHaveLength(1)

      // c1 "gana": cierra y comitea primero.
      await c1.query(
        `UPDATE cajas SET cerrada_en = now(), cerrada_por_id = $1 WHERE id = $2 AND cerrada_en IS NULL`,
        [usuarioA, id],
      )
      await c1.query('COMMIT')

      // c2 recién ahora corre el MISMO patrón que usa cerrarCaja — con la
      // condición cerrada_en IS NULL repetida en el where.
      const r2 = await c2.query(
        `UPDATE cajas SET cerrada_en = now(), cerrada_por_id = $1 WHERE id = $2 AND cerrada_en IS NULL`,
        [usuarioB, id],
      )
      expect(r2.rowCount, 'el where con cerrada_en IS NULL tiene que impedir esta escritura').toBe(0)
      await c2.query('COMMIT')
    } finally {
      await c1.end()
      await c2.end()
    }

    // Y la fila quedó con el cierre de c1, no reescrita por c2.
    const fila = await owner.query('SELECT cerrada_por_id FROM cajas WHERE id = $1', [id])
    expect(fila.rows[0].cerrada_por_id).toBe(usuarioA)
  })

  // Complementario al de arriba, y ahora sí cubre el MECANISMO de verdad
  // llamando a la función pública (no a SQL a mano): `cerrarCaja` ya no tiene
  // ningún `findFirst` previo (I3, ronda de fix 3) — `cerradaEn: null` es el
  // ÚNICO selector del `updateManyAndReturn`, así que este caso es la única
  // forma en que la función puede pasar. Antes, con un `findFirst` previo más
  // un `updateMany` con el filtro repetido, este mismo test pasaba igual
  // aunque se le sacara el filtro al `findFirst` —la aserción real la
  // sostenía el chequeo de `resultado.count === 0`, no este test—, y el
  // comentario de esta sección afirmaba lo contrario. Eliminar el `findFirst`
  // en vez de sólo corregir el comentario es lo que lo vuelve cierto: ya no
  // hay un segundo camino por el que colarse.
  it('cerrar una caja ya cerrada (llamando dos veces, sin concurrencia) no la reescribe', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)

    const antes = await owner.query(
      'SELECT cerrada_en, cerrada_por_id FROM cajas WHERE id = $1',
      [id],
    )

    const otroUsuario = await crearUsuario(owner, tenantA, 'segundo@caja-a.test')
    await expect(cerrarCaja(tenantA, otroUsuario)).rejects.toMatchObject({
      codigo: 'SIN_CAJA_ABIERTA',
    })

    const despues = await owner.query(
      'SELECT cerrada_en, cerrada_por_id FROM cajas WHERE id = $1',
      [id],
    )
    expect(despues.rows[0].cerrada_en).toEqual(antes.rows[0].cerrada_en)
    expect(despues.rows[0].cerrada_por_id).toBe(antes.rows[0].cerrada_por_id)
    expect(despues.rows[0].cerrada_por_id).toBe(usuarioA)
  })

  // QUÉ PROTEGE ESTE TEST, para quien lo encuentre dentro de seis meses y se
  // pregunte si es una restricción de performance arbitraria: no lo es.
  // `cerrarCaja` resuelve el cierre con un solo `updateManyAndReturn`, sin
  // ningún `findFirst` previo — `cerradaEn: null` es el ÚNICO selector de la
  // fila. Volver a la forma de DOS pasos (leer cuál está abierta, y recién
  // después escribir el cierre por ese id) reintroduce la ventana entre la
  // lectura y la escritura que I3 (review de esta task) encontró: otra
  // llamada puede colarse en el medio y pisar el cierre. Ese defecto NO lo
  // detectan los tests de arriba si el cambio es sólo VOLVER a dos pasos
  // manteniendo el filtro `cerradaEn: null` en la lectura —son secuenciales,
  // y esa lectura previa ya rechaza una segunda llamada antes de que
  // compitan—; hace falta concurrencia real para verlo (el test 'el
  // mecanismo' de más arriba la ejercita con SQL crudo, pero no llama a
  // `cerrarCaja`). Contar cuántos statements toca la función en la base es lo
  // que sí distingue un mecanismo del otro sin depender de timing: un solo
  // paso SIEMPRE emite un statement contra `cajas`, dos pasos SIEMPRE emiten
  // dos, sea cual sea el resultado de la carrera.
  //
  // Cómo se mide: se espía `pool.connect` (lib/db.ts) —el mismo pool que usa
  // Prisma por debajo de `enTransaccionDeTenant`— y se envuelve el `.query`
  // del cliente que devuelve, para contar los statements cuyo SQL menciona
  // `cajas` durante una llamada a `cerrarCaja`. Es un spy de test sobre un
  // handle que ya es público: no toca código de producción.
  it('cerrarCaja resuelve el cierre con UN SOLO statement contra `cajas`', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')

    const statementsSobreCajas: string[] = []
    let clienteEspiado: PoolClient | undefined

    // `pool.connect` está sobrecargado (sin argumentos devuelve una Promise;
    // con callback, no) — de ahí los casts: sin ellos TypeScript infiere el
    // tipo de retorno de la sobrecarga equivocada (la de callback, `void`).
    const connectOriginal = pool.connect.bind(pool) as () => Promise<PoolClient>
    const espia = vi.spyOn(pool, 'connect').mockImplementation((async () => {
      const cliente = await connectOriginal()
      clienteEspiado = cliente
      const queryOriginal = cliente.query.bind(cliente)
      // El wrapper sólo necesita leer el texto del SQL y delegar: no hace
      // falta replicar la firma sobrecargada de `query` de `pg` (texto suelto,
      // config object, streams) para eso, así que se tipa ancho a propósito.
      cliente.query = ((...args: unknown[]) => {
        const primero = args[0]
        const texto = typeof primero === 'string' ? primero : (primero as { text?: string })?.text
        if (typeof texto === 'string' && /cajas/i.test(texto)) {
          statementsSobreCajas.push(texto)
        }
        return (queryOriginal as (...a: unknown[]) => unknown)(...args)
      }) as unknown as typeof cliente.query
      return cliente
    }) as unknown as typeof pool.connect)

    try {
      await cerrarCaja(tenantA, usuarioA)
    } finally {
      // Restaurar el mock de `connect` no alcanza: el `.query` envuelto quedó
      // como propiedad propia del CLIENTE devuelto, y ese mismo objeto vuelve
      // al pool para conexiones futuras. Sin borrarlo, un test posterior que
      // reutilice esta conexión seguiría empujando texto a este array cerrado.
      espia.mockRestore()
      if (clienteEspiado) delete (clienteEspiado as unknown as Record<string, unknown>).query
    }

    expect(statementsSobreCajas).toHaveLength(1)
  })

  describe('el saldo inicial', () => {
    it('rechaza un saldo negativo', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '-1.00')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('rechaza más de dos decimales', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '100.005')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('rechaza más de diez dígitos enteros', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '12345678901.00')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('acepta cero: un turno puede arrancar sin efectivo', async () => {
      const { id } = await abrirCaja(tenantA, usuarioA, '0.00')
      expect((await cajaAbierta(tenantA))?.id).toBe(id)
    })

    // I1/I2 de la review: antes de pasar por `aDecimal`, cada uno de estos se
    // escapaba de un modo distinto y sin código de dominio — 'NaN' quedaba
    // PERSISTIDO como `saldo_inicial = NaN` (el signo de NaN en decimal.js es
    // `null`, así que `isNegative()` no lo atajaba), '0x10' y '1_000' se leían
    // como 16 y 1000 (decimal.js parsea hexadecimal y guiones bajos),
    // 'Infinity' tiraba un `PrismaClientKnownRequestError` pelado al llegar a
    // Postgres, y 'abc'/''/'   ' tiraban un `Error: [DecimalError]` pelado.
    // Ahora los cinco salen por el mismo `SALDO_INVALIDO` que ya usan los
    // otros tres casos de arriba, porque `aDecimal` los rechaza a todos ANTES
    // de que decimal.js o Postgres los vean.
    it.each(['NaN', '0x10', '1_000', 'Infinity', 'abc', '', '   '])(
      'rechaza "%s" con el mismo código que el resto del saldo inválido, no un error pelado',
      async (saldo) => {
        await expect(abrirCaja(tenantA, usuarioA, saldo)).rejects.toMatchObject({
          codigo: 'SALDO_INVALIDO',
        })
        // Y no queda una caja huérfana con un saldo basura adentro.
        expect(await cajaAbierta(tenantA)).toBeNull()
      },
    )

    // El caso que más importa de los ocho que midió la review: hoy FALLA y
    // debería funcionar, porque así se escribe la plata en Argentina. Antes
    // de `aDecimal`, `new Prisma.Decimal('1,50')` tiraba `DecimalError`.
    it('acepta la coma decimal argentina', async () => {
      const { id } = await abrirCaja(tenantA, usuarioA, '1,50')
      expect((await cajaAbierta(tenantA))?.id).toBe(id)
      expect((await cajaAbierta(tenantA))?.saldoInicial.toFixed(2)).toBe('1.50')
    })

    // decimal.js tampoco toleraba espacios alrededor del número; `aDecimal`
    // los limpia antes de parsear.
    it('ignora los espacios alrededor', async () => {
      const { id } = await abrirCaja(tenantA, usuarioA, '  15000.00  ')
      expect((await cajaAbierta(tenantA))?.id).toBe(id)
      expect((await cajaAbierta(tenantA))?.saldoInicial.toFixed(2)).toBe('15000.00')
    })
  })
})
