import crypto from 'node:crypto';

import QRCode from 'qrcode';

import type {
  AdminTable,
  CreateAdminTableRequest,
  PrintTableQrRequest,
  PrintTablesQrRequest,
  TableQrResponse,
  TablesQrBatchResponse,
  UpdateAdminTableRequest,
} from '../types.js';
import { appStore } from './store.js';

class TablesServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sortTables = (tables: AdminTable[]) =>
  [...tables].sort((left, right) => {
    const leftNumber = Number(left.number);
    const rightNumber = Number(right.number);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }

    return left.number.localeCompare(right.number, 'es');
  });

const normalizeNumber = (value: string) => value.trim();
const normalizeLabel = (value?: string) => value?.trim() || undefined;

async function persistTables(tables: AdminTable[]) {
  const nextStore = await appStore.update((currentStore) => ({
    ...currentStore,
    tables: sortTables(tables),
  }));

  appStore.notifyTablesChanged(nextStore.tables);
  return nextStore.tables;
}

function assertUniqueNumber(tables: AdminTable[], tableNumber: string, ignoreId?: string) {
  const duplicate = tables.find((table) => table.number === tableNumber && table.id !== ignoreId);
  if (duplicate) {
    throw new TablesServiceError('Ya existe una mesa con ese numero.', 400);
  }
}

function buildQrUrl(tableNumber: string, origin: string) {
  try {
    const normalizedOrigin = new URL(origin).origin;
    return `${normalizedOrigin}/mesa/${encodeURIComponent(tableNumber)}`;
  } catch {
    throw new TablesServiceError('El dominio actual no es valido para generar el QR.', 400);
  }
}

async function buildQrSvg(qrUrl: string) {
  return QRCode.toString(qrUrl, {
    type: 'svg',
    margin: 1,
    width: 320,
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });
}

export async function listTables() {
  const { tables } = await appStore.read();
  return sortTables(tables);
}

export async function createTable(input: CreateAdminTableRequest) {
  const { tables } = await appStore.read();
  const number = normalizeNumber(input.number);
  const label = normalizeLabel(input.label);

  assertUniqueNumber(tables, number);

  const now = new Date().toISOString();
  const table: AdminTable = {
    id: crypto.randomUUID(),
    number,
    label,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  return persistTables([...tables, table]);
}

export async function updateTable(tableId: string, input: UpdateAdminTableRequest) {
  const { tables } = await appStore.read();
  const currentTable = tables.find((table) => table.id === tableId);

  if (!currentTable) {
    throw new TablesServiceError('La mesa no existe.', 404);
  }

  const nextNumber = input.number ? normalizeNumber(input.number) : currentTable.number;
  assertUniqueNumber(tables, nextNumber, tableId);

  return persistTables(
    tables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            number: nextNumber,
            label: input.label !== undefined ? normalizeLabel(input.label) : table.label,
            updatedAt: new Date().toISOString(),
          }
        : table,
    ),
  );
}

export async function updateTableStatus(tableId: string, active: boolean) {
  const { tables } = await appStore.read();
  if (!tables.some((table) => table.id === tableId)) {
    throw new TablesServiceError('La mesa no existe.', 404);
  }

  return persistTables(
    tables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            active,
            updatedAt: new Date().toISOString(),
          }
        : table,
    ),
  );
}

export async function deleteTable(tableId: string) {
  const { tables } = await appStore.read();
  if (!tables.some((table) => table.id === tableId)) {
    throw new TablesServiceError('La mesa no existe.', 404);
  }

  return persistTables(tables.filter((table) => table.id !== tableId));
}

export async function getTableQr(tableId: string, input: PrintTableQrRequest): Promise<TableQrResponse> {
  const { tables } = await appStore.read();
  const table = tables.find((entry) => entry.id === tableId);

  if (!table) {
    throw new TablesServiceError('La mesa no existe.', 404);
  }

  const qrUrl = buildQrUrl(table.number, input.origin);
  const qrSvg = await buildQrSvg(qrUrl);

  return {
    table,
    qrSvg,
    qrUrl,
  };
}

export async function getTablesQrBatch(input: PrintTablesQrRequest): Promise<TablesQrBatchResponse> {
  const { tables } = await appStore.read();

  if (input.tableIds.length === 0) {
    throw new TablesServiceError('Selecciona al menos una mesa para imprimir.', 400);
  }

  const items = await Promise.all(
    input.tableIds.map(async (tableId) => {
      const table = tables.find((entry) => entry.id === tableId);
      if (!table) {
        throw new TablesServiceError('Una de las mesas seleccionadas no existe.', 404);
      }

      const qrUrl = buildQrUrl(table.number, input.origin);
      const qrSvg = await buildQrSvg(qrUrl);

      return {
        table,
        qrSvg,
        qrUrl,
      } satisfies TableQrResponse;
    }),
  );

  return {
    items: sortTables(items.map((item) => item.table)).map((table) => items.find((item) => item.table.id === table.id)!),
  };
}

export function toTablesServiceError(error: unknown) {
  if (error instanceof TablesServiceError) {
    return error;
  }

  return new TablesServiceError('Se produjo un error inesperado con las mesas.', 500);
}
