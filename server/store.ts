import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AdminSettings, AdminTable, MenuItem, MenuMetadata, PersistedOrder } from '../types.js';
import { serverConfig } from './config.js';

interface StoreData {
  orders: PersistedOrder[];
  menu: MenuItem[];
  tables: AdminTable[];
  settings: AdminSettings;
  menuMetadata: MenuMetadata;
  lastLegacyMenuImportAt: string | null;
  menuCache?: MenuItem[];
  lastMenuSyncAt?: string | null;
}

const createEmptyStore = (): StoreData => ({
  orders: [],
  menu: [],
  tables: [],
  settings: {
    showWifiPopup: false,
    wifiSsid: '',
    wifiPassword: '',
  },
  menuMetadata: {
    lastUpdatedAt: null,
    lastUpdatedBy: null,
  },
  lastLegacyMenuImportAt: null,
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
        orders: (parsedContent.orders ?? []).map((order) => ({
          ...order,
          customerEmail: order.reviewConsent && order.customerEmail ? order.customerEmail : undefined,
          reviewConsent: Boolean(order.reviewConsent && order.customerEmail),
        })),
        menu: parsedContent.menu ?? parsedContent.menuCache ?? [],
        tables: parsedContent.tables ?? [],
        settings: {
          showWifiPopup: parsedContent.settings?.showWifiPopup ?? false,
          wifiSsid: parsedContent.settings?.wifiSsid ?? '',
          wifiPassword: parsedContent.settings?.wifiPassword ?? '',
        },
        menuMetadata: {
          lastUpdatedAt: parsedContent.menuMetadata?.lastUpdatedAt ?? parsedContent.lastMenuSyncAt ?? null,
          lastUpdatedBy: parsedContent.menuMetadata?.lastUpdatedBy ?? ((parsedContent.menu ?? parsedContent.menuCache)?.length ? 'legacy_import' : null),
        },
        lastLegacyMenuImportAt: parsedContent.lastLegacyMenuImportAt ?? parsedContent.lastMenuSyncAt ?? null,
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

  notifyMenuChanged(menu: MenuItem[]) {
    this.emit('menu.changed', menu);
  }

  notifyTablesChanged(tables: AdminTable[]) {
    this.emit('tables.changed', tables);
  }

  subscribeToOrders(listener: (orders: PersistedOrder[]) => void) {
    this.on('orders.changed', listener);
    return () => {
      this.off('orders.changed', listener);
    };
  }

  subscribeToMenu(listener: (menu: MenuItem[]) => void) {
    this.on('menu.changed', listener);
    return () => {
      this.off('menu.changed', listener);
    };
  }

  subscribeToTables(listener: (tables: AdminTable[]) => void) {
    this.on('tables.changed', listener);
    return () => {
      this.off('tables.changed', listener);
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
