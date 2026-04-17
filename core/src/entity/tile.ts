export interface TileBase<T extends string> {
  type: T;
}

export interface EmptyTile extends TileBase<'empty'> {}

export interface PropertyTile extends TileBase<'property'> {
  name: string;
  group: string;
  price: number;
  baseRent: number;
  maxTier: number;
  tier: number;
  ownerPlayerIndex?: number;
}

export interface EventTile extends TileBase<'event'> {
  eventIndex: number;
}

export type Tile =
  | EmptyTile
  | PropertyTile
  | EventTile;
