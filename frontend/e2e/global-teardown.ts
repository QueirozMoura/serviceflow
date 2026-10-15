import { destroyE2EDatabase } from './database';

export default function globalTeardown(): void {
  destroyE2EDatabase();
}
