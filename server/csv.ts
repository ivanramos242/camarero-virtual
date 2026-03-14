const stripDiacritics = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '');

export const normaliseCsvKey = (value: string) =>
  stripDiacritics(value)
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/\s+/g, '_')
    .trim();

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === ',' && !insideQuotes) {
      cells.push(currentCell.trim());
      currentCell = '';
      continue;
    }

    currentCell += character;
  }

  cells.push(currentCell.trim());
  return cells;
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(normaliseCsvKey);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      const rawValue = values[index] ?? '';
      row[header] = rawValue.replace(/^"(.*)"$/u, '$1').trim();
    });

    return row;
  });
}

export async function fetchCsvRows(url: string): Promise<Array<Record<string, string>>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`No se pudo leer el CSV remoto (${response.status}).`);
  }

  const text = await response.text();
  return parseCsv(text);
}
