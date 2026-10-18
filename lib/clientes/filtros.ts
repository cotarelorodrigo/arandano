import type { Prisma } from '@/generated/prisma/client'
import { DIGITOS_DE_LA_CLAVE, digitosDe, ultimos10 } from '@/lib/texto/telefono'

/**
 * Cuántos dígitos hacen falta para buscar también por la clave del teléfono.
 * Con menos, "1" o "11" matchearían a casi todos por la clave y el resultado
 * sería ruido; por el teléfono tal cual se tipeó siguen buscando igual.
 */
const DIGITOS_PARA_BUSCAR_POR_CLAVE = 3

/**
 * El `where` de la búsqueda de clientes, compartido por el buscador del
 * mostrador (`buscarClientes`), el listado de /clientes y su CSV: tres lugares
 * que tienen que encontrar a la misma gente con el mismo texto. `null` sin
 * texto.
 *
 * Por nombre y email sin distinguir mayúsculas; por el teléfono tal cual se
 * guardó; y por la CLAVE del teléfono con los dígitos de lo tipeado, que es lo
 * que hace que "1122334455" encuentre a quien está cargado como
 * "11 2233-4455" (y "2233-4455" también: la clave contiene "22334455").
 * Con 10 dígitos o más se busca por los últimos diez, igual que se arma la
 * clave: "+54 9 11 2233-4455" tiene trece dígitos y ninguna clave los contiene
 * enteros, pero termina en la misma clave que "11 2233-4455".
 */
export function dondeBusca(texto: string): Prisma.ClienteWhereInput | null {
  const busqueda = texto.trim()
  if (busqueda === '') return null
  const crudos = digitosDe(busqueda)
  const digitos = crudos.length >= DIGITOS_DE_LA_CLAVE ? ultimos10(crudos) : crudos
  return {
    OR: [
      { nombre: { contains: busqueda, mode: 'insensitive' } },
      { email: { contains: busqueda, mode: 'insensitive' } },
      { telefono: { contains: busqueda } },
      ...(digitos.length >= DIGITOS_PARA_BUSCAR_POR_CLAVE
        ? [{ telefonoClave: { contains: digitos } }]
        : []),
    ],
  }
}
