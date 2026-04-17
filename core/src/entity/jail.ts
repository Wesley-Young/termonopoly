import { Effect } from './effect';

export interface Jail {
  id: string;
  name: string;
  onRelease?: Effect[];
}
