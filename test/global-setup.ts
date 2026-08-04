import { levantar, bajar } from './postgres-efimero'

export async function setup(): Promise<void> {
  await levantar()
}

export async function teardown(): Promise<void> {
  await bajar()
}
