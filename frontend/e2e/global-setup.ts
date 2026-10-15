import { prepareE2EDatabase } from './database';

export default function globalSetup(): void {
  prepareE2EDatabase();
}
