import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MenuItem, PersistedOrder } from '../types.js';
import { serverConfig } from './config.js';

interface StoreData {
  orders: PersistedOrder[];
  menuCache: MenuItem[];
  lastMenuSyncAt: string | null;
}

const createEmptyStore = (): StoreData => ({
  orders: [],
  menuCache: [],
  lastMenuSyncAt: null,
});

class AppStore extends EventEmitter {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async read(): Promise<StoreData> {
    await this.ensureFile();

    try {
      const rawContent = await readFile(this.filePath, 'utf8');
      const parsedContent = JSON.parse(rawContent) as Partial<StoreData>;

      return {
        orders: parsedContent.orders ?? [],
        menuCache: parsedContent.menuCache ?? [],
        lastMenuSyncAt: parsedContent.lastMenuSyncAt ?? null,
      };
    } catch {
      return createEmptyStore();
    }
  }

  async update(mutator: (current: StoreData) => Promise<StoreData> | StoreData): Promise<StoreData> {
    let nextState = createEmptyStore();

    this.writeQueue = this.writeQueue.then(async () => {
      const currentState = await this.read();
      nextState = await mutator(structuredClone(currentState));
      await writeFile(this.filePath, JSON.stringify(nextState, null, 2), 'utf8');
    });

    await this.writeQueue;
    return nextState;
  }

  notifyOrdersChanged(orders: PersistedOrder[]) {
    this.emit('orders.changed', orders);
  }

  subscribeToOrders(listener: (orders: PersistedOrder[]) => void) {
    this.on('orders.changed', listener);
    return () => {
      this.off('orders.changed', listener);
    };
  }

  private async ensureFile() {
    const directoryPath = path.dirname(this.filePath);
    await mkdir(directoryPath, { recursive: true });

    try {
      await readFile(this.filePath, 'utf8');
    } catch {
      await writeFile(this.filePath, JSON.stringify(createEmptyStore(), null, 2), 'utf8');
    }
  }
}

export const appStore = new AppStore(serverConfig.dataFilePath);
