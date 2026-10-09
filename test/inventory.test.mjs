import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseInventory } from '../scripts/inventory.mjs';

const inventory = {
  schema: 'paperless-inventory',
  version: 1,
  generatedAt: '2026-01-02T03:04:05Z',
  roots: {
    source: { label: 'Archivo de origen' },
    paperless: { label: 'Exportación Paperless' }
  },
  summary: {
    sourcePdfCount: 2, paperlessPdfCount: 1, manifestDocumentCount: 1,
    paperlessDocumentsNotInSourceCount: 0, manifestDocumentsWithoutPdfCount: 0,
    paperlessFilesWithoutManifestCount: 0, matchedSourceCount: 1,
    unmatchedSourceCount: 1, oneToOneGroupCount: 1, manyToManyGroupCount: 0,
    manyToManySourceCount: 0, manyToManySameNumberGroupCount: 0,
    manyToManyDifferentNumberGroupCount: 0, duplicateSourceNameCount: 0
  },
  sourceDocuments: [
    { sourcePath: 'Carpeta/documento.pdf', matched: true, groupIds: ['grupo-1'] },
    { sourcePath: 'sin-copia.pdf', matched: false, groupIds: [] }
  ],
  paperlessDocuments: [{
    backupPath: 'originales/paperless.pdf', manifestPresent: true,
    exportedFileName: 'paperless.pdf', title: 'Título', tags: ['Prueba']
  }],
  groups: [{
    id: 'grupo-1', relation: 'one-to-one', sourcePaths: ['Carpeta/documento.pdf'],
    paperlessDocuments: [{
      backupPath: 'originales/paperless.pdf', manifestPresent: true,
      exportedFileName: 'paperless.pdf', title: 'Título', tags: ['Prueba']
    }]
  }],
  paperlessDocumentsNotInSource: [],
  duplicateSourceNames: [],
  paperlessFilesWithoutManifest: [],
  manifestDocumentsWithoutPdf: [],
  catalogs: { tags: [], correspondents: [], documentTypes: [], storagePaths: [] }
};

const input = () => JSON.stringify(inventory);

test('consumes a valid v1 JSON inventory into the dashboard model', () => {
  const data = parseInventory(input(), { sourceLabel: 'Etiqueta configurada' });
  assert.deepEqual(data.summary, { total: 2, found: 1, missing: 1, ambiguous: 0, groups: 0 });
  assert.equal(data.sourceRoot, '/source');
  assert.equal(data.backupRoot, '/backup');
  assert.equal(data.display.sourceLabel, 'Etiqueta configurada');
  assert.equal(data.documents[0].sourcePath, '/source/Carpeta/documento.pdf');
  assert.equal(data.documents[0].matches[0].path, '/backup/originales/paperless.pdf');
  assert.deepEqual(data.documents[0].matches[0].tags, ['Prueba']);
  assert.equal(data.documents[1].found, false);
  assert.equal(data.tree.stats.documents, 2);
});

test('loads the maintained synthetic fixture with matches, optional metadata and relative paths', async () => {
  const fixture = await readFile(new URL('./fixtures/sample-inventory-v1.json', import.meta.url), 'utf8');
  const data = parseInventory(fixture);
  assert.equal(data.summary.total, 4);
  assert.equal(data.summary.ambiguous, 2);
  assert.equal(data.documents.find(({ sourcePath }) => sourcePath.includes('Individual/')).matches[0].title, 'Referencia tres');
  const grouped = data.documents.find(({ sourcePath }) => sourcePath.endsWith('documento uno.pdf'));
  assert.deepEqual(grouped.matches[0].tags, ['contrato', 'ejemplo']);
  assert.equal(grouped.matches[0].storagePath, 'Ficticia | Contratos');
  assert.equal(grouped.matches[0].path, '/backup/originales/referencia uno.pdf');
  assert.ok(data.documents.every(({ sourcePath }) => sourcePath.startsWith('/source/')));
});

test('reports malformed JSON and unsupported contract versions clearly', () => {
  assert.throws(() => parseInventory('{'), /JSON.*inválido/i);
  assert.throws(() => parseInventory('DOCUMENTOS DE ORIGEN QUE SÍ ESTÁN EN PAPERLESS'), /JSON.*inválido/i);
  assert.throws(() => parseInventory(JSON.stringify({ ...inventory, version: 2 })), /versión.*2/i);
  assert.throws(() => parseInventory(JSON.stringify({ ...inventory, schema: 'otro' })), /schema/i);
});

test('rejects invalid structure and route traversal in every document path', () => {
  assert.throws(() => parseInventory(JSON.stringify({ ...inventory, summary: null })), /summary/i);
  for (const unsafePath of ['/etc/passwd', '../escape.pdf', 'a/../escape.pdf', 'a//b.pdf', 'a\\b.pdf']) {
    const changed = structuredClone(inventory);
    changed.sourceDocuments[0].sourcePath = unsafePath;
    assert.throws(() => parseInventory(JSON.stringify(changed)), /sourceDocuments.*ruta/i);
  }
  const badReference = structuredClone(inventory);
  badReference.groups[0].paperlessDocuments[0].backupPath = '../../outside.pdf';
  assert.throws(() => parseInventory(JSON.stringify(badReference)), /backupPath.*ruta/i);
});

test('rejects inconsistent group references and duplicate group ids', () => {
  const missingGroup = structuredClone(inventory);
  missingGroup.sourceDocuments[0].groupIds = ['grupo-1', 'missing'];
  assert.throws(() => parseInventory(JSON.stringify(missingGroup)), /grupo.*missing/i);
  const duplicate = structuredClone(inventory);
  duplicate.groups.push(structuredClone(duplicate.groups[0]));
  assert.throws(() => parseInventory(JSON.stringify(duplicate)), /identificador.*duplicado/i);
});
