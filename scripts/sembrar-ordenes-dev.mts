/**
 * Órdenes de servicio sintéticas para mirar /servicio-tecnico en dev:
 * `npm run ordenes:sembrar -- <tenantId> <usuarioId>`.
 *
 * **Sólo dev.** Escribe equipos de mentira; correrlo contra una base con datos
 * de clientes ensucia el mostrador de alguien.
 *
 * Los equipos tienen nombres y fallas de largo DELIBERADAMENTE disparejo: con
 * datos parejos no se puede ver si el ticket de 80 mm desborda, que es
 * justamente lo que hay que mirar con el papel en la mano. Es la misma lección
 * que dejó el sembrador de ventas con los importes de distinta cantidad de
 * dígitos (anotada en CLAUDE.md al cerrar la verificación visual del punto de
 * venta).
 */
import { crearOrden } from '@/lib/ordenes-de-trabajo/crear'
import { cambiarEstado } from '@/lib/ordenes-de-trabajo/operaciones'
import { crearCliente } from '@/lib/clientes/administrar'
import { prisma } from '@/lib/db'
import type { EstadoOrden } from '@/generated/prisma/client'

// Por argumento y no resueltos acá: la app conecta como `arandano_app`, sobre
// el que RLS aplica, así que un `findFirst` de tenants sin GUC no devuelve
// nada. Los ids salen de psql, que entra con el rol dueño. Mismo criterio que
// scripts/sembrar-ventas-dev.mts.
const [tenantId, usuarioId] = process.argv.slice(2)
if (!tenantId || !usuarioId) {
  throw new Error('uso: sembrar-ordenes-dev.mts <tenantId> <usuarioId>')
}

type Receta = {
  cliente: { nombre: string; telefono: string | null }
  equipoMarca: string
  equipoModelo: string
  equipoSerie: string | null
  claveDesbloqueo: string | null
  fallaDeclarada: string
  accesorios: string | null
  danosVisibles: string | null
  // Cada orden termina en un estado distinto: es lo que hace que los contadores
  // del tablero muestren algo y no una sola columna con todo.
  camino: EstadoOrden[]
}

const RECETAS: Receta[] = [
  // El caso corto: todo entra holgado. Queda en RECIBIDO.
  {
    cliente: { nombre: 'Ana', telefono: '1155667788' },
    equipoMarca: 'Samsung',
    equipoModelo: 'A54',
    equipoSerie: '358240051111110',
    claveDesbloqueo: '1234',
    fallaDeclarada: 'no carga',
    accesorios: 'cargador',
    danosVisibles: null,
    camino: [],
  },
  // El caso largo, que es el que rompe el ticket si algo está mal: nombre de
  // cliente largo, modelo largo, y una falla de cinco renglones.
  {
    cliente: { nombre: 'María Fernanda Gutiérrez de la Serna', telefono: '1144332211' },
    equipoMarca: 'Xiaomi',
    equipoModelo: 'Redmi Note 12 Pro Plus 5G Dual SIM',
    equipoSerie: '860123456789012',
    claveDesbloqueo: 'patrón: L invertida',
    fallaDeclarada:
      'se cayó al agua, prende pero la pantalla queda en negro y a veces vibra sola. ' +
      'El cliente dice que le pasa desde el domingo y que ya probó con otro cargador.',
    accesorios: 'cargador, funda, chip Movistar',
    danosVisibles: 'tapa trasera despegada, marco golpeado en la esquina inferior izquierda',
    camino: ['EN_DIAGNOSTICO', 'PRESUPUESTADO'],
  },
  // Sin IMEI ni accesorios: el equipo que entra sin encender.
  {
    cliente: { nombre: 'Luis Paz', telefono: null },
    equipoMarca: 'Motorola',
    equipoModelo: 'G22',
    equipoSerie: null,
    claveDesbloqueo: null,
    fallaDeclarada: 'pantalla rota',
    accesorios: null,
    danosVisibles: 'vidrio astillado',
    camino: ['EN_REPARACION', 'LISTO'],
  },
  // El que no tuvo arreglo: sigue en el estante hasta que lo vengan a buscar.
  {
    cliente: { nombre: 'Carla Ríos', telefono: '1199887766' },
    equipoMarca: 'Apple',
    equipoModelo: 'iPhone 11',
    equipoSerie: '013948005566771',
    claveDesbloqueo: '0000',
    fallaDeclarada: 'batería dura 2 horas',
    accesorios: 'cable',
    danosVisibles: null,
    camino: ['EN_DIAGNOSTICO', 'SIN_REPARACION'],
  },
]

for (const receta of RECETAS) {
  const cliente = await crearCliente({
    tenantId,
    nombre: receta.cliente.nombre,
    telefono: receta.cliente.telefono,
  })

  const orden = await crearOrden({
    tenantId,
    usuarioId,
    clienteId: cliente.id,
    equipoMarca: receta.equipoMarca,
    equipoModelo: receta.equipoModelo,
    equipoSerie: receta.equipoSerie,
    claveDesbloqueo: receta.claveDesbloqueo,
    fallaDeclarada: receta.fallaDeclarada,
    accesorios: receta.accesorios,
    danosVisibles: receta.danosVisibles,
  })

  for (const hasta of receta.camino) {
    await cambiarEstado({ tenantId, usuarioId, ordenId: orden.id, hasta })
  }

  // La URL del ticket, que es lo que se abre para mirar el papel.
  console.log(`orden #${orden.numero} → /servicio-tecnico/${orden.id}/ticket`)
}

await prisma.$disconnect()
