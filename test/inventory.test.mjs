import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseInventory } from '../scripts/inventory.mjs';

const input = await readFile(new URL('./fixtures/sample-inventory.txt', import.meta.url), 'utf8');

test('infers roots and preserves matched, missing and ambiguous documents', () => {
  const data = parseInventory(input, { sourceLabel: 'Origen configurable' });
  assert.equal(data.sourceRoot, '/datos/origen');
  assert.equal(data.backupRoot, '/datos/referencia');
  assert.equal(data.tree.name, 'Origen configurable');
  assert.deepEqual(data.summary, { total: 4, found: 3, missing: 1, ambiguous: 2, groups: 1 });
});

test('keeps optional reference attributes and unicode paths', () => {
  const data = parseInventory(input);
  const missing = data.documents.find(({ sourcePath }) => sourcePath.includes('Carpeta Única'));
  const matched = data.documents.find(({ sourcePath }) => sourcePath.endsWith('documento uno.pdf'));
  assert.equal(missing.found, false);
  assert.equal(matched.matches[0].correspondent, 'Empresa ficticia');
  assert.deepEqual(matched.matches[0].tags, ['contrato', 'ejemplo']);
});

test('rejects empty and structurally invalid reports', () => {
  assert.throws(() => parseInventory(''), /vacío/);
  assert.throws(() => parseInventory('Carpeta origen ArchivoMunet:\n/solo/una/ruta'), /Backup de Paperless/);
});

test('rejects document paths outside the roots declared by the report', () => {
  const changed = input.replace('/datos/referencia/originales/referencia uno.pdf', '/fuera/referencia uno.pdf');
  assert.throws(() => parseInventory(changed), /fuera de la carpeta declarada/);
});
