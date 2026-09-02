/**
 * Cada monto como porcentaje ENTERO del total, garantizando que la suma dé
 * exactamente 100 (o todos 0 si no hay total).
 *
 * Redondear cada fracción por separado ("naive rounding") puede dejar la
 * columna en 99 o en 101 por el acarreo de cada barra por separado — con
 * cuatro medios de pago no es un caso de borde raro, es lo esperable. El
 * método del resto mayor (largest remainder) reparte los enteros que sobran
 * —o faltan— entre las barras cuyo resto fue más grande, que es la forma
 * estándar de redondear una distribución de porcentajes sin que la suma se
 * mueva del 100% que el panel promete.
 */
export function porcentajesQueSuman100(
  valores: number[],
  // El total viene por parámetro y no siempre re-sumado acá — `total` default
  // preserva el comportamiento de antes para quien no lo pasa (y para los
  // tests de este archivo). El llamador real (GraficoDeMedios) SÍ lo pasa:
  // `composicion.total` ya es exacto —sale de sumar `Decimal`s, no floats—, así
  // que anclar el reparto a ESE número evita sumar de nuevo en float un valor
  // que ya se sumó bien una vez.
  total: number = valores.reduce((acc, v) => acc + v, 0),
): number[] {
  if (total <= 0) return valores.map(() => 0)

  const brutos = valores.map((v) => (v / total) * 100)
  const pisos = brutos.map(Math.floor)
  const faltan = 100 - pisos.reduce((acc, v) => acc + v, 0)

  // De mayor a menor resto: a esas barras les toca el punto entero que el
  // piso les recortó.
  const ordenPorResto = brutos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto)

  const resultado = [...pisos]
  for (let k = 0; k < faltan; k++) resultado[ordenPorResto[k].i] += 1
  return resultado
}
