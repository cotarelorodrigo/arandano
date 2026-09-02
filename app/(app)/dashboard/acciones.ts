'use server'

import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { hoyEnArgentina } from '@/lib/formato/fechas'
import { rangoValido, periodoDeRango, filtroDe } from '@/lib/dashboard/rango'
import { filaCsv } from '@/lib/formato/csv'
import { ENCABEZADO_CSV, filaDeVenta } from './csv'

/**
 * Las ventas del período elegido, como CSV — en memoria, sin librería, sin
 * endpoint nuevo y sin streaming (misma decisión ya tomada para
 * `exportarHistorialCsv` en `app/(app)/inventario/acciones.ts`): arma el
 * string entero acá y lo devuelve; `BotonDeExportar` (`./exportar.tsx`) lo
 * convierte en una descarga del lado del cliente con un `Blob` — un server
 * action no puede fijar `Content-Disposition`.
 *
 * **La única acción de esta pantalla, sola en este archivo — como en toda
 * pantalla del repo.** `ENCABEZADO_CSV`/`filaDeVenta` (`./csv.ts`) y
 * `filaCsv` (`@/lib/formato/csv`) son PUROS y viven afuera a propósito: no
 * porque no pudieran estar acá, sino porque este archivo necesita
 * `'use server'` de MÓDULO —no de función— para que
 * `test/limite-cliente-servidor.test.ts` lo trate como frontera. Ese test
 * sólo deja de seguir los imports de un archivo cuando su PRIMERA línea es
 * `'use server'`; con el directive a nivel de función (la primera versión de
 * este ciclo) el test cruzaba de largo hasta encontrar
 * `import { prismaParaTenant } from '@/lib/tenant/prisma'`, uno de los tres
 * módulos "sensibles" que un Client Component no puede alcanzar —
 * `exportar.tsx` es justo eso—. Con el directive de módulo acá, ESTE archivo
 * es la frontera, y por eso puede importar `prismaParaTenant` sin que ese
 * test lo vea: importa código que declara `'use server'` sí mismo, y ahí el
 * test se frena.
 *
 * **`exigirSesion()` adentro y SIN exigir ningún permiso**: una action es un
 * endpoint y se invoca sin pasar por la pantalla, así que necesita su propio
 * guard de sesión — pero exportar es de sólo lectura sobre datos que
 * `/dashboard` ya le muestra a CUALQUIER sesión (los cuatro paneles no están
 * detrás de ningún permiso salvo el tile de Margen, que este CSV ni siquiera
 * incluye).
 *
 * `rango` es `string`, no `Rango`: cruza el límite de un server action como
 * dato serializable, y `rangoValido()` (mismo helper que usa `page.tsx`) hace
 * que un valor tipeado a mano —o una pestaña vieja con un `rango` que dejó de
 * existir— caiga al default en vez de explotar.
 *
 * **Sin techo de filas**, mismo motivo que ya dejaron escrito
 * `pagos.groupBy` y `ventasDelPeriodo` en `app/(app)/ventas/page.tsx`: el
 * sentido de exportar es llevarse TODO el período, no el recorte que entra
 * cómodo en una pantalla.
 */
export async function exportarVentas(rango: string): Promise<string> {
  const sesion = await exigirSesion()
  const periodo = periodoDeRango(rangoValido(rango), hoyEnArgentina())
  const prisma = prismaParaTenant(sesion.tenant.id)

  const ventas = await prisma.venta.findMany({
    where: filtroDe(periodo),
    orderBy: { numero: 'desc' },
    select: {
      numero: true, creadoEn: true, total: true, totalUsd: true, recargo: true, anuladaEn: true,
      cliente: { select: { nombre: true } },
      // orderBy explícito, mismo motivo que ya documenta `page.tsx` de
      // /ventas: sin esto Postgres no promete ningún orden para "Medios".
      pagos: { select: { medio: true, moneda: true, monto: true }, orderBy: { creadoEn: 'asc' } },
    },
  })

  const filas = ventas.map(filaDeVenta)
  return [ENCABEZADO_CSV, ...filas].map(filaCsv).join('\r\n')
}
