import { Effect, Event, Jail, Player, PlayerStatus, PropertyTile, Tile } from '../entity';
import { GameLog } from './log';
import { mulberry32 } from './rng';

interface ResolutionBudget {
  remaining: number;
}

export interface GameRules {
  maxLandingResolutionsPerTurn: number;
  propertyUpgradeCostTierPower: number;
  propertyUpgradeCostPriceFactor: number;
  propertyRentTierPower: number;
  propertyRentBaseRentFactor: number;
}

export class Game {
  currentPlayerIndex: number = 0;
  rules: GameRules;
  private rng: () => number;
  private sendGameLog: (logs: GameLog[]) => void;

  constructor(
    public seed: number,
    public players: Player[],
    public tiles: Tile[],
    public jails: Jail[],
    public events: Event[],
    onGameLog: (logs: GameLog[]) => void,
    rules: Partial<GameRules> = {},
  ) {
    this.rng = mulberry32(seed);
    this.sendGameLog = onGameLog;
    this.rules = {
      maxLandingResolutionsPerTurn: 32,
      propertyUpgradeCostTierPower: 1.5,
      propertyUpgradeCostPriceFactor: 0.5,
      propertyRentTierPower: 1,
      propertyRentBaseRentFactor: 1,
      ...rules,
    };
  }

  rollDices(count: number, playerIndex: number = this.currentPlayerIndex): number[] {
    const player = this.getPlayer(playerIndex);
    const rollCount = Math.max(0, Math.min(count, player.maxRollsPerTurn));
    const rolls: number[] = [];
    for (let i = 0; i < rollCount; i++) {
      rolls.push(this.nextDiceRoll());
    }
    this.sendGameLog([
      {
        type: 'diceRoll',
        playerIndex,
        rolls,
      },
    ]);
    return rolls;
  }

  rollDiceSteps(count: number, playerIndex: number = this.currentPlayerIndex): number {
    const rolls = this.rollDices(count, playerIndex);
    return rolls.reduce((sum, roll) => sum + roll, 0);
  }

  advanceToNextPlayer(): void {
    this.assertPlayersExist();
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
  }

  movePlayer(steps: number): void {
    const playerIndex = this.currentPlayerIndex;
    const player = this.getPlayer(playerIndex);

    if (player.status.type === 'bankrupt') {
      this.advanceToNextPlayer();
      return;
    }

    if (player.status.type === 'inJail') {
      this.performJailTurn(playerIndex);
      this.advanceToNextPlayer();
      return;
    }

    const budget: ResolutionBudget = { remaining: this.rules.maxLandingResolutionsPerTurn };
    this.movePlayerBySteps(playerIndex, steps, false);
    this.resolveLanding(playerIndex, budget);
    this.advanceToNextPlayer();
  }

  buyProperty(tileIndex: number, playerIndex: number = this.currentPlayerIndex): boolean {
    const player = this.getPlayer(playerIndex);
    if (player.status.type !== 'alive') {
      return false;
    }

    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property' || tile.ownerPlayerIndex !== undefined || player.cash < tile.price) {
      return false;
    }

    this.setPlayerCash(playerIndex, player.cash - tile.price);
    this.setPropertyOwner(tileIndex, playerIndex);
    return true;
  }

  getPropertyUpgradeCost(tileIndex: number): number {
    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property') {
      throw new Error(`Tile at index ${tileIndex} is not a property.`);
    }

    return this.calculatePropertyUpgradeCost(tile);
  }

  getPropertyRent(tileIndex: number): number {
    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property') {
      throw new Error(`Tile at index ${tileIndex} is not a property.`);
    }

    return this.calculatePropertyRent(tile);
  }

  upgradePropertyTier(tileIndex: number, playerIndex: number = this.currentPlayerIndex): boolean {
    const player = this.getPlayer(playerIndex);
    if (player.status.type !== 'alive') {
      return false;
    }

    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property') {
      return false;
    }

    if (tile.ownerPlayerIndex !== playerIndex || tile.tier >= tile.maxTier) {
      return false;
    }

    const upgradeCost = this.calculatePropertyUpgradeCost(tile);
    if (player.cash < upgradeCost) {
      return false;
    }

    this.setPlayerCash(playerIndex, player.cash - upgradeCost);
    this.setPropertyTier(tileIndex, tile.tier + 1);
    return true;
  }

  getOwnedPropertyTileIndexes(playerIndex: number): number[] {
    this.getPlayer(playerIndex);
    const ownedTileIndexes: number[] = [];
    for (const [tileIndex, tile] of this.tiles.entries()) {
      if (tile.type === 'property' && tile.ownerPlayerIndex === playerIndex) {
        ownedTileIndexes.push(tileIndex);
      }
    }
    return ownedTileIndexes;
  }

  private performJailTurn(playerIndex: number): void {
    const player = this.getPlayer(playerIndex);
    if (player.status.type !== 'inJail') {
      return;
    }

    const { jailIndex, remainingTurns } = player.status;
    if (remainingTurns > 1) {
      this.setPlayerStatus(playerIndex, {
        type: 'inJail',
        jailIndex,
        remainingTurns: remainingTurns - 1,
      });
      return;
    }

    this.setPlayerStatus(playerIndex, { type: 'alive' });
    const jail = this.getJail(jailIndex);
    this.applyEffects(playerIndex, jail.onRelease ?? [], {
      remaining: this.rules.maxLandingResolutionsPerTurn,
    });
  }

  private applyEffects(playerIndex: number, effects: Effect[], budget: ResolutionBudget): void {
    for (const effect of effects) {
      if (!this.canContinueResolving(playerIndex)) {
        return;
      }
      this.applyEffect(playerIndex, effect, budget);
    }
  }

  private applyEffect(playerIndex: number, effect: Effect, budget: ResolutionBudget): void {
    switch (effect.type) {
      case 'move':
        this.movePlayerBySteps(playerIndex, effect.steps, true, budget);
        return;
      case 'jump':
        this.jumpPlayerToTile(playerIndex, effect.tileIndex, true, budget);
        return;
      case 'money': {
        const player = this.getPlayer(playerIndex);
        this.setPlayerCash(playerIndex, player.cash + effect.amount);
        return;
      }
      case 'jail':
        this.setPlayerStatus(playerIndex, {
          type: 'inJail',
          jailIndex: effect.jailIndex,
          remainingTurns: effect.turns,
        });
        return;
    }
  }

  private resolveLanding(playerIndex: number, budget: ResolutionBudget): void {
    if (!this.canContinueResolving(playerIndex)) {
      return;
    }

    if (budget.remaining <= 0) {
      throw new Error('Landing resolution exceeded the per-turn limit.');
    }
    budget.remaining -= 1;

    const tile = this.getTile(this.getPlayer(playerIndex).position);
    switch (tile.type) {
      case 'empty':
        return;
      case 'property':
        this.resolvePropertyLanding(playerIndex, tile);
        return;
      case 'event': {
        const event = this.getEvent(tile.eventIndex);
        this.applyEffects(playerIndex, event.effects, budget);
        return;
      }
    }
  }

  private resolvePropertyLanding(playerIndex: number, tile: PropertyTile): void {
    const ownerPlayerIndex = tile.ownerPlayerIndex;
    if (ownerPlayerIndex === undefined || ownerPlayerIndex === playerIndex) {
      return;
    }

    const rent = this.calculatePropertyRent(tile);
    const payer = this.getPlayer(playerIndex);
    const owner = this.getPlayer(ownerPlayerIndex);

    if (payer.cash >= rent) {
      this.setPlayerCash(playerIndex, payer.cash - rent);
      this.setPlayerCash(ownerPlayerIndex, owner.cash + rent);
      return;
    }

    const remainingCash = payer.cash;
    if (remainingCash > 0) {
      this.setPlayerCash(playerIndex, 0);
      this.setPlayerCash(ownerPlayerIndex, owner.cash + remainingCash);
    }

    this.setPlayerStatus(playerIndex, { type: 'bankrupt' });
    this.releasePlayerProperties(playerIndex);
  }

  private releasePlayerProperties(playerIndex: number): void {
    for (const [tileIndex, tile] of this.tiles.entries()) {
      if (tile.type === 'property' && tile.ownerPlayerIndex === playerIndex) {
        this.setPropertyOwner(tileIndex, undefined);
      }
    }
  }

  private movePlayerBySteps(
    playerIndex: number,
    steps: number,
    resolveLanding: boolean,
    budget?: ResolutionBudget,
  ): void {
    const player = this.getPlayer(playerIndex);
    const fromTileIndex = player.position;
    const toTileIndex = this.normalizeTileIndex(fromTileIndex + steps);

    player.position = toTileIndex;
    this.sendGameLog([
      {
        type: 'playerMove',
        playerIndex,
        fromTileIndex,
        toTileIndex,
      },
    ]);

    if (resolveLanding && this.canContinueResolving(playerIndex)) {
      this.resolveLanding(playerIndex, budget ?? { remaining: this.rules.maxLandingResolutionsPerTurn });
    }
  }

  private jumpPlayerToTile(
    playerIndex: number,
    tileIndex: number,
    resolveLanding: boolean,
    budget?: ResolutionBudget,
  ): void {
    const player = this.getPlayer(playerIndex);
    const fromTileIndex = player.position;
    const toTileIndex = this.normalizeTileIndex(tileIndex);

    player.position = toTileIndex;
    this.sendGameLog([
      {
        type: 'playerMove',
        playerIndex,
        fromTileIndex,
        toTileIndex,
      },
    ]);

    if (resolveLanding && this.canContinueResolving(playerIndex)) {
      this.resolveLanding(playerIndex, budget ?? { remaining: this.rules.maxLandingResolutionsPerTurn });
    }
  }

  private setPlayerCash(playerIndex: number, newCash: number): void {
    const player = this.getPlayer(playerIndex);
    if (player.cash === newCash) {
      return;
    }

    const previousCash = player.cash;
    player.cash = newCash;
    this.sendGameLog([
      {
        type: 'playerMoneyChange',
        playerIndex,
        previousCash,
        newCash,
      },
    ]);
  }

  private setPlayerStatus(playerIndex: number, newStatus: PlayerStatus): void {
    const player = this.getPlayer(playerIndex);
    if (this.playerStatusesEqual(player.status, newStatus)) {
      return;
    }

    const previousStatus = player.status;
    player.status = newStatus;
    this.sendGameLog([
      {
        type: 'playerStateChange',
        playerIndex,
        previousStatus,
        newStatus,
      },
    ]);
  }

  private setPropertyOwner(tileIndex: number, newOwnerPlayerIndex: number | undefined): void {
    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property') {
      throw new Error(`Tile at index ${tileIndex} is not a property.`);
    }

    if (tile.ownerPlayerIndex === newOwnerPlayerIndex) {
      return;
    }

    const previousOwnerPlayerIndex = tile.ownerPlayerIndex;
    tile.ownerPlayerIndex = newOwnerPlayerIndex;
    this.sendGameLog([
      {
        type: 'propertyOwnershipChange',
        tileIndex,
        previousOwnerPlayerIndex,
        newOwnerPlayerIndex,
      },
    ]);
  }

  private calculatePropertyUpgradeCost(tile: PropertyTile): number {
    const targetTier = tile.tier + 1;
    return Math.floor(
      tile.price *
        this.rules.propertyUpgradeCostPriceFactor *
        Math.pow(targetTier, this.rules.propertyUpgradeCostTierPower),
    );
  }

  private calculatePropertyRent(tile: PropertyTile): number {
    const rentTier = tile.tier + 1;
    return Math.floor(
      tile.baseRent * this.rules.propertyRentBaseRentFactor * Math.pow(rentTier, this.rules.propertyRentTierPower),
    );
  }

  private setPropertyTier(tileIndex: number, newTier: number): void {
    const tile = this.getTile(tileIndex);
    if (tile.type !== 'property') {
      throw new Error(`Tile at index ${tileIndex} is not a property.`);
    }

    if (tile.tier === newTier) {
      return;
    }

    const previousTier = tile.tier;
    tile.tier = newTier;
    this.sendGameLog([
      {
        type: 'propertyTierChange',
        tileIndex,
        previousTier,
        newTier,
      },
    ]);
  }

  private canContinueResolving(playerIndex: number): boolean {
    return this.getPlayer(playerIndex).status.type === 'alive';
  }

  private normalizeTileIndex(tileIndex: number): number {
    if (this.tiles.length === 0) {
      throw new Error('Game requires at least one tile.');
    }
    return ((tileIndex % this.tiles.length) + this.tiles.length) % this.tiles.length;
  }

  private getPlayer(playerIndex: number): Player {
    const player = this.players[playerIndex];
    if (!player) {
      throw new Error(`Player at index ${playerIndex} does not exist.`);
    }
    return player;
  }

  private getTile(tileIndex: number): Tile {
    const tile = this.tiles[tileIndex];
    if (!tile) {
      throw new Error(`Tile at index ${tileIndex} does not exist.`);
    }
    return tile;
  }

  private getEvent(eventIndex: number): Event {
    const event = this.events[eventIndex];
    if (!event) {
      throw new Error(`Event at index ${eventIndex} does not exist.`);
    }
    return event;
  }

  private getJail(jailIndex: number): Jail {
    const jail = this.jails[jailIndex];
    if (!jail) {
      throw new Error(`Jail at index ${jailIndex} does not exist.`);
    }
    return jail;
  }

  private assertPlayersExist(): void {
    if (this.players.length === 0) {
      throw new Error('Game requires at least one player.');
    }
  }

  private playerStatusesEqual(left: PlayerStatus, right: PlayerStatus): boolean {
    if (left.type !== right.type) {
      return false;
    }

    switch (left.type) {
      case 'alive':
      case 'bankrupt':
        return true;
      case 'inJail':
        return (
          right.type === 'inJail' && left.jailIndex === right.jailIndex && left.remainingTurns === right.remainingTurns
        );
    }
  }

  private nextInt(max: number): number {
    return Math.floor(this.rng() * max);
  }

  private nextIntRanged(min: number, max: number): number {
    return min + this.nextInt(max - min);
  }

  private nextDiceRoll(): number {
    return this.nextIntRanged(1, 7);
  }
}
