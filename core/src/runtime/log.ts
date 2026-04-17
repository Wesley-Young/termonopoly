import { PlayerStatus } from '../entity';

export interface GameLogBase<T extends string> {
  type: T;
}

export interface DiceRollLog extends GameLogBase<'diceRoll'> {
  playerIndex: number;
  rolls: number[];
}

export interface PlayerMoveLog extends GameLogBase<'playerMove'> {
  playerIndex: number;
  fromTileIndex: number;
  toTileIndex: number;
}

export interface PlayerMoneyChangeLog extends GameLogBase<'playerMoneyChange'> {
  playerIndex: number;
  previousCash: number;
  newCash: number;
}

export interface PlayerStateChangeLog extends GameLogBase<'playerStateChange'> {
  playerIndex: number;
  previousStatus: PlayerStatus;
  newStatus: PlayerStatus;
}

export interface PropertyOwnershipChangeLog extends GameLogBase<'propertyOwnershipChange'> {
  tileIndex: number;
  previousOwnerPlayerIndex?: number;
  newOwnerPlayerIndex?: number;
}

export interface PropertyTierChangeLog extends GameLogBase<'propertyTierChange'> {
  tileIndex: number;
  previousTier: number;
  newTier: number;
}

export type GameLog =
  | DiceRollLog
  | PlayerMoveLog
  | PlayerMoneyChangeLog
  | PlayerStateChangeLog
  | PropertyOwnershipChangeLog
  | PropertyTierChangeLog;
