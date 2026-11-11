import { Option } from 'effect'
import type { Game } from '../engine/game'

/** The live three.js game lives outside the (frozen) Model; Commands reach it through this host. */
let current: Game | null = null

export const setGame = (g: Game | null) => {
  current = g
}

export const getGame = (): Option.Option<Game> => Option.fromNullishOr(current)
