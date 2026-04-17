export interface EffectBase<T extends string> {
  type: T;
}

export interface MoveEffect extends EffectBase<'move'> {
  /** >0 for forward, <0 for backward */
  steps: number;
}

export interface JumpEffect extends EffectBase<'jump'> {
  tileIndex: number;
}

export interface MoneyEffect extends EffectBase<'money'> {
  /** >0 for gain, <0 for loss */
  amount: number;
}

export interface JailEffect extends EffectBase<'jail'> {
  jailIndex: number;
  turns: number;
}

export type Effect =
  | MoveEffect
  | JumpEffect
  | MoneyEffect
  | JailEffect;
