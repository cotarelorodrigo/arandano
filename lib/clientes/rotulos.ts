/**
 * `rotuloOrdenesPrevias` vive en su propio archivo y no en
 * `lib/clientes/administrar.ts`, de donde salió.
 *
 * Es una función de formateo pura —no toca la base—, pero `administrar.ts`
 * importa `enTransaccionDeTenant` (`@/lib/tenant/transaccion`) a nivel de
 * módulo, que a su vez importa `@/lib/db`, que importa `pg`. Un Client
 * Component (`'use client'`) que importe un VALOR —no un tipo— de
 * `administrar.ts` arrastra ese módulo ENTERO a su bundle del navegador, y
 * `pg` usa el módulo `dns` de Node, que no existe ahí.
 *
 * Eso es exactamente lo que le pasó a
 * `app/(app)/servicio-tecnico/formularios.tsx` (bug crítico detectado
 * después de una review, ciclo del cierre del rediseño, 2026-08-23): hacía
 * `import { rotuloOrdenesPrevias, type ClienteEncontrado } from
 * '@/lib/clientes/administrar'` — `ClienteEncontrado` es un import de tipo,
 * no arrastra nada, pero `rotuloOrdenesPrevias` sí, y arrastró el módulo
 * entero. Turbopack no fallaba sólo esa pantalla: fallaba la compilación
 * del bundle de CLIENTE completa, y con eso 500 en dev para /vender,
 * /inventario y /usuarios — pantallas sin ninguna relación con clientes ni
 * con servicio técnico. Ningún test, `tsc` ni `eslint` lo vieron: sólo
 * `npm run build` arma un bundle de verdad. `test/limite-cliente-servidor.
 * test.ts` es la red que no depende de que alguien se acuerde de buildear.
 *
 * Si el día de mañana alguien "ordena" este archivo y lo devuelve a
 * `administrar.ts` porque "es sobre clientes, tiene que vivir ahí": NO. El
 * criterio de dónde vive una función acá no es su TEMA, es QUIÉN la
 * consume —un Client Component— y qué arrastra el módulo que la rodea.
 */
export function rotuloOrdenesPrevias(n: number): string {
  return n === 1 ? '1 orden previa' : `${n} órdenes previas`
}
