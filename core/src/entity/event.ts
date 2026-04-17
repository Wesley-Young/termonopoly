import { Effect } from './effect';

export interface Event {
  id: string;
  name: string;
  description: string;
  effects: Effect[];
}
