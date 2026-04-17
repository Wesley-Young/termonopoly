/// <reference types="node" />

import assert from 'node:assert/strict';
import test from 'node:test';

import { type Event, Game, type GameRules, type Jail, type Player, type Tile } from '../src';

function createPlayer(overrides: Partial<Player> = {}): Player {
  return {
    name: 'Player',
    isComputer: false,
    position: 0,
    cash: 1500,
    maxRollsPerTurn: 3,
    status: { type: 'alive' },
    ...overrides,
  };
}

function createPropertyTile(overrides: Partial<Extract<Tile, { type: 'property' }>> = {}): Tile {
  return {
    type: 'property',
    name: 'Lot',
    group: 'A',
    price: 100,
    baseRent: 10,
    maxTier: 3,
    tier: 0,
    ...overrides,
  };
}

function createEventTile(eventIndex: number): Tile {
  return {
    type: 'event',
    eventIndex,
  };
}

function createGame(overrides: {
  players?: Player[];
  tiles?: Tile[];
  jails?: Jail[];
  events?: Event[];
  seed?: number;
  onGameLog?: (logs: unknown[]) => void;
  rules?: Partial<GameRules>;
} = {}): Game {
  return new Game(
    overrides.seed ?? 42,
    overrides.players ?? [createPlayer(), createPlayer({ name: 'Player 2' })],
    overrides.tiles ?? Array.from({ length: 8 }, () => ({ type: 'empty' } satisfies Tile)),
    overrides.jails ?? [],
    overrides.events ?? [],
    overrides.onGameLog ?? (() => {}),
    overrides.rules ?? {},
  );
}

test('nextDiceRolls uses the seed deterministically and writes a dice log', () => {
  const gameLogs: unknown[][] = [];
  const game = createGame({
    onGameLog: (logs) => {
      gameLogs.push(logs);
    },
  });

  const rolls = game.rollDices(3);

  assert.deepStrictEqual(rolls, [4, 3, 6]);
  assert.deepStrictEqual(gameLogs, [
    [
      {
        type: 'diceRoll',
        playerIndex: 0,
        rolls: [4, 3, 6],
      },
    ],
  ]);
});

test('rollDiceSteps returns the summed dice result', () => {
  const game = createGame();

  const steps = game.rollDiceSteps(3);

  assert.equal(steps, 13);
});

test('movePlayer wraps correctly for negative steps', () => {
  const game = createGame({
    players: [createPlayer({ position: 1 })],
    tiles: Array.from({ length: 6 }, () => ({ type: 'empty' } satisfies Tile)),
  });

  game.movePlayer(-2);

  assert.equal(game.players[0].position, 5);
});

test('movePlayer wraps movement and advances turn order from a provided dice result', () => {
  const game = createGame({
    players: [
      createPlayer({ position: 4, maxRollsPerTurn: 2 }),
      createPlayer({ name: 'Player 2', position: 2 }),
    ],
    tiles: Array.from({ length: 6 }, () => ({ type: 'empty' } satisfies Tile)),
  });

  game.movePlayer(7);

  assert.equal(game.players[0].position, 5);
  assert.equal(game.currentPlayerIndex, 1);
});

test('rollDiceSteps and movePlayer form the explicit public turn flow', () => {
  const game = createGame({
    players: [createPlayer({ position: 4, maxRollsPerTurn: 2 }), createPlayer({ name: 'Player 2' })],
    tiles: Array.from({ length: 6 }, () => ({ type: 'empty' } satisfies Tile)),
  });

  const steps = game.rollDiceSteps(3);
  game.movePlayer(steps);

  assert.equal(steps, 7);
  assert.equal(game.players[0].position, 5);
  assert.equal(game.currentPlayerIndex, 1);
});

test('buyProperty stores ownership only on the tile and exposes a derived ownership query', () => {
  const gameLogs: unknown[][] = [];
  const game = createGame({
    players: [createPlayer({ cash: 250 })],
    tiles: [{ type: 'empty' }, createPropertyTile({ price: 120 }), { type: 'empty' }],
    onGameLog: (logs) => {
      gameLogs.push(logs);
    },
  });

  const bought = game.buyProperty(1);

  assert.equal(bought, true);
  assert.equal(game.players[0].cash, 130);
  assert.deepStrictEqual(game.getOwnedPropertyTileIndexes(0), [1]);
  assert.deepStrictEqual(game.tiles[1], {
    type: 'property',
    name: 'Lot',
    group: 'A',
    price: 120,
    baseRent: 10,
    maxTier: 3,
    tier: 0,
    ownerPlayerIndex: 0,
  });
  assert.deepStrictEqual(gameLogs.slice(-1), [
    [
      {
        type: 'propertyOwnershipChange',
        tileIndex: 1,
        previousOwnerPlayerIndex: undefined,
        newOwnerPlayerIndex: 0,
      },
    ],
  ]);
});

test('upgradePropertyTier increments tier for the owning alive player and emits a tier log', () => {
  const gameLogs: unknown[][] = [];
  const game = createGame({
    players: [createPlayer({ cash: 500 }), createPlayer({ name: 'Player 2' })],
    tiles: [{ type: 'empty' }, createPropertyTile({ price: 100, ownerPlayerIndex: 0, tier: 1, maxTier: 3 }), { type: 'empty' }],
    onGameLog: (logs) => {
      gameLogs.push(logs);
    },
  });

  const upgradeCost = game.getPropertyUpgradeCost(1);
  const upgraded = game.upgradePropertyTier(1);

  assert.equal(upgradeCost, 141);
  assert.equal(upgraded, true);
  assert.equal(game.players[0].cash, 359);
  assert.equal((game.tiles[1] as Extract<Tile, { type: 'property' }>).tier, 2);
  assert.deepStrictEqual(gameLogs.slice(-2), [
    [
      {
        type: 'playerMoneyChange',
        playerIndex: 0,
        previousCash: 500,
        newCash: 359,
      },
    ],
    [
      {
        type: 'propertyTierChange',
        tileIndex: 1,
        previousTier: 1,
        newTier: 2,
      },
    ],
  ]);
});

test('getPropertyUpgradeCost coerces the tier-power rule to an integer', () => {
  const game = createGame({
    players: [createPlayer()],
    tiles: [{ type: 'empty' }, createPropertyTile({ price: 99, ownerPlayerIndex: 0, tier: 1 }), { type: 'empty' }],
  });

  assert.equal(game.getPropertyUpgradeCost(1), 140);
});

test('getPropertyRent applies the configurable tier-power rule and coerces to an integer', () => {
  const game = createGame({
    tiles: [{ type: 'empty' }, createPropertyTile({ baseRent: 11, ownerPlayerIndex: 1, tier: 1 }), { type: 'empty' }],
    rules: {
      propertyRentTierPower: 1.5,
      propertyRentBaseRentFactor: 0.5,
    },
  });

  assert.equal(game.getPropertyRent(1), 15);
});

test('upgradePropertyTier fails when the player is not the owner, lacks cash, or the property is maxed', () => {
  const game = createGame({
    players: [createPlayer({ cash: 100 }), createPlayer({ name: 'Player 2' })],
    tiles: [
      { type: 'empty' },
      createPropertyTile({ ownerPlayerIndex: 1, tier: 1, maxTier: 3 }),
      createPropertyTile({ price: 100, ownerPlayerIndex: 0, tier: 1, maxTier: 3 }),
      createPropertyTile({ ownerPlayerIndex: 0, tier: 3, maxTier: 3 }),
      { type: 'empty' },
    ],
  });

  assert.equal(game.upgradePropertyTier(1), false);
  assert.equal(game.upgradePropertyTier(2), false);
  assert.equal(game.upgradePropertyTier(3), false);
  assert.equal((game.tiles[1] as Extract<Tile, { type: 'property' }>).tier, 1);
  assert.equal((game.tiles[2] as Extract<Tile, { type: 'property' }>).tier, 1);
  assert.equal((game.tiles[3] as Extract<Tile, { type: 'property' }>).tier, 3);
  assert.equal(game.players[0].cash, 100);
});

test('movePlayer resolves chained events from a provided movement result', () => {
  const game = createGame({
    players: [createPlayer({ cash: 100 }), createPlayer({ name: 'Player 2' })],
    tiles: [
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      createEventTile(0),
      { type: 'empty' },
      createEventTile(1),
      { type: 'empty' },
    ],
    events: [
      {
        id: 'event-0',
        name: 'Step forward',
        description: 'Move to the next event',
        effects: [{ type: 'move', steps: 2 }],
      },
      {
        id: 'event-1',
        name: 'Bonus',
        description: 'Gain money',
        effects: [{ type: 'money', amount: 25 }],
      },
    ],
  });

  game.movePlayer(4);

  assert.equal(game.players[0].position, 6);
  assert.equal(game.players[0].cash, 125);
  assert.equal(game.currentPlayerIndex, 1);
});

test('movePlayer charges rent based on property tier', () => {
  const game = createGame({
    players: [createPlayer({ cash: 100 }), createPlayer({ name: 'Player 2', cash: 500 })],
    tiles: [
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      createPropertyTile({ baseRent: 10, tier: 2, ownerPlayerIndex: 1 }),
      { type: 'empty' },
    ],
  });

  assert.equal(game.upgradePropertyTier(4, 1), true);
  assert.equal(game.getPropertyRent(4), 40);
  game.movePlayer(4);

  assert.equal(game.players[0].cash, 60);
  assert.equal(game.players[1].cash, 281);
  assert.equal(game.players[0].position, 4);
});

test('movePlayer bankrupts players who cannot pay rent and releases their properties', () => {
  const game = createGame({
    players: [createPlayer({ cash: 5 }), createPlayer({ name: 'Player 2', cash: 50 })],
    tiles: [
      { type: 'empty' },
      { type: 'empty' },
      createPropertyTile({ ownerPlayerIndex: 0 }),
      { type: 'empty' },
      createPropertyTile({ baseRent: 10, tier: 0, ownerPlayerIndex: 1 }),
      { type: 'empty' },
    ],
  });

  game.movePlayer(4);

  assert.equal(game.players[0].cash, 0);
  assert.equal(game.players[1].cash, 55);
  assert.deepStrictEqual(game.players[0].status, { type: 'bankrupt' });
  assert.equal((game.tiles[2] as Extract<Tile, { type: 'property' }>).ownerPlayerIndex, undefined);
  assert.deepStrictEqual(game.getOwnedPropertyTileIndexes(0), []);
});

test('movePlayer counts down jail turns without rolling dice', () => {
  const game = createGame({
    players: [
      createPlayer({
        position: 3,
        status: {
          type: 'inJail',
          jailIndex: 0,
          remainingTurns: 2,
        },
      }),
      createPlayer({ name: 'Player 2', position: 1 }),
    ],
    jails: [{ id: 'jail-0', name: 'Main Jail' }],
  });

  game.movePlayer(99);

  assert.equal(game.players[0].position, 3);
  assert.deepStrictEqual(game.players[0].status, {
    type: 'inJail',
    jailIndex: 0,
    remainingTurns: 1,
  });
  assert.equal(game.currentPlayerIndex, 1);
  });

test('movePlayer releases players from jail and resolves release effects', () => {
  const game = createGame({
    players: [
      createPlayer({
        cash: 100,
        status: {
          type: 'inJail',
          jailIndex: 0,
          remainingTurns: 1,
        },
      }),
      createPlayer({ name: 'Player 2' }),
    ],
    tiles: [
      { type: 'empty' },
      { type: 'empty' },
      createEventTile(0),
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
    ],
    jails: [
      {
        id: 'jail-0',
        name: 'Main Jail',
        onRelease: [{ type: 'move', steps: 2 }],
      },
    ],
    events: [
      {
        id: 'event-0',
        name: 'Release Bonus',
        description: 'Gain money after release',
        effects: [{ type: 'money', amount: 50 }],
      },
    ],
  });

  game.movePlayer(99);

  assert.deepStrictEqual(game.players[0].status, { type: 'alive' });
  assert.equal(game.players[0].position, 2);
  assert.equal(game.players[0].cash, 150);
  assert.equal(game.currentPlayerIndex, 1);
});

test('movePlayer skips bankrupt players', () => {
  const game = createGame({
    players: [
      createPlayer({
        position: 3,
        status: { type: 'bankrupt' },
      }),
      createPlayer({ name: 'Player 2', position: 1 }),
    ],
  });

  game.movePlayer(99);

  assert.equal(game.players[0].position, 3);
  assert.equal(game.players[1].position, 1);
  assert.equal(game.currentPlayerIndex, 1);
});

test('movePlayer throws when event resolution exceeds the per-turn limit', () => {
  const game = createGame({
    players: [createPlayer(), createPlayer({ name: 'Player 2' })],
    tiles: [
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      { type: 'empty' },
      createEventTile(0),
      { type: 'empty' },
    ],
    events: [
      {
        id: 'event-0',
        name: 'Loop',
        description: 'Jump back to self forever',
        effects: [{ type: 'jump', tileIndex: 4 }],
      },
    ],
  });

  assert.throws(
    () => {
      game.movePlayer(4);
    },
    {
      message: 'Landing resolution exceeded the per-turn limit.',
    },
  );
});
