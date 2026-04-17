export interface Player {
  name: string;
  isComputer: boolean;
  position: number;
  cash: number;
  maxRollsPerTurn: number;
  status: PlayerStatus;
}

export interface PlayerStatusBase<T extends string> {
  type: T;
}

export interface AliveStatus extends PlayerStatusBase<'alive'> {}

export interface InJailStatus extends PlayerStatusBase<'inJail'> {
  jailIndex: number;
  remainingTurns: number;
}

export interface BankruptStatus extends PlayerStatusBase<'bankrupt'> {}

export type PlayerStatus = AliveStatus | InJailStatus | BankruptStatus;
