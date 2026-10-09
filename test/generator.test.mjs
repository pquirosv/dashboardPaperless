import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from '../server.mjs';
import { parseInventory } from '../scripts/inventory.mjs';

const generator = fileURLToPath(new URL('../desglose_documental.py', import.meta.url));

test('generates a persistent report from source PDFs and a Paperless export', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dashboard-generator-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const source = path.join(temporaryRoot, 'source');
  const exportDirectory = path.join(temporaryRoot, 'export');
  await mkdir(path.join(source, 'Primera'), { recursive: true });
  await mkdir(path.join(source, 'Segunda'), { recursive: true });
  await mkdir(exportDirectory);
  await writeFile(path.join(source, 'Primera', 'documento uno.pdf'), '%PDF-synthetic');
  await writeFile(path.join(source, 'Segunda', 'documento uno.pdf'), '%PDF-synthetic');
  await writeFile(path.join(source, 'sin copia.pdf'), '%PDF-synthetic');
  await writeFile(path.join(exportDirectory, '2026-01-01 Persona documento uno.pdf'), '%PDF-synthetic');
  await writeFile(path.join(exportDirectory, '2026-02-02 Otra persona documento ajeno.pdf'), '%PDF-synthetic');

  const output = path.join(exportDirectory, 'desglose-documentos.json');
  const command = ['--source', source, '--backup', exportDirectory, '--output', output];
  const run = (extra = []) => spawnSync('python3', [generator, ...command, ...extra], { encoding: 'utf8' });
  const missingManifest = run();
  assert.notEqual(missingManifest.status, 0);
  assert.match(missingManifest.stderr, /No existe el manifest/);

  await writeFile(path.join(exportDirectory, 'manifest.json'), JSON.stringify([
    { model: 'documents.tag', pk: 1, fields: { name: 'Contrato' } },
    { model: 'documents.tag', pk: 2, fields: { name: 'Sin uso' } },
    { model: 'documents.correspondent', pk: 3, fields: { name: 'Organización ficticia' } },
    { model: 'documents.documenttype', pk: 4, fields: { name: 'Expediente' } },
    { model: 'documents.storagepath', pk: 5, fields: { name: 'Archivo', path: 'series/{created_year}' } },
    { model: 'documents.document', pk: 7, __exported_file_name__: '2026-01-01 Persona documento uno.pdf', fields: {
      title: 'Documento uno', tags: [1, 999], correspondent: 3, document_type: 4,
      storage_path: 5, deleted_at: '2026-01-03'
    } },
    { model: 'documents.document', pk: 8, __exported_file_name__: '2025-12-31 Documento sin PDF.pdf', fields: { tags: [1] } }
  ]));
  const created = run();
  assert.equal(created.status, 0, created.stderr);
  const originalReport = await readFile(output, 'utf8');
  const data = JSON.parse(originalReport);
  assert.equal(data.schema, 'paperless-inventory');
  assert.equal(data.version, 1);
  assert.equal(data.summary.sourcePdfCount, 3);
  assert.equal(data.summary.matchedSourceCount, 2);
  assert.equal(data.summary.unmatchedSourceCount, 1);
  assert.equal(data.summary.paperlessPdfCount, 2);
  assert.equal(data.summary.manifestDocumentCount, 2);
  assert.equal(data.summary.paperlessDocumentsNotInSourceCount, 1);
  assert.equal(data.summary.manifestDocumentsWithoutPdfCount, 1);
  assert.equal(data.summary.paperlessFilesWithoutManifestCount, 1);
  assert.equal(data.summary.duplicateSourceNameCount, 1);
  assert.equal(data.summary.manyToManyDifferentNumberGroupCount, 1);
  assert.deepEqual(data.catalogs.tags, [
    { id: 1, name: 'Contrato', documentCount: 2 },
    { id: 2, name: 'Sin uso', documentCount: 0 }
  ]);
  assert.equal(data.groups[0].paperlessDocuments[0].tags[0], 'Contrato');
  assert.equal(data.groups[0].paperlessDocuments[0].tags[1], 'ID 999 (no encontrado en el manifest)');
  assert.deepEqual(data.groups[0].paperlessDocuments[0].storagePath, { name: 'Archivo', pathTemplate: 'series/{created_year}' });
  assert.equal(data.groups[0].paperlessDocuments[0].status, 'Eliminado el 2026-01-03');
  assert.equal(data.paperlessDocumentsNotInSource[0].manifestPresent, false);
  assert.equal(data.paperlessDocuments[1].manifestPresent, false);
  assert.equal(data.paperlessFilesWithoutManifest[0].backupPath, '2026-02-02 Otra persona documento ajeno.pdf');
  assert.deepEqual(data.duplicateSourceNames[0].sourcePaths, ['Primera/documento uno.pdf', 'Segunda/documento uno.pdf']);
  assert.equal(data.manifestDocumentsWithoutPdf[0].exportedFileName, '2025-12-31 Documento sin PDF.pdf');
  assert.equal(Object.hasOwn(data.manifestDocumentsWithoutPdf[0], 'title'), false);
  assert.equal(data.catalogs.correspondents[0].documentCount, 1);
  assert.equal(data.catalogs.documentTypes[0].name, 'Expediente');
  assert.equal(data.catalogs.storagePaths[0].pathTemplate, 'series/{created_year}');
  assert.equal(data.sourceDocuments.find((document) => !document.matched).sourcePath, 'sin copia.pdf');
  assert.doesNotMatch(originalReport, new RegExp(temporaryRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const dashboardModel = parseInventory(originalReport);
  assert.equal(dashboardModel.summary.total, 3);
  assert.equal(dashboardModel.documents.find((document) => document.found).matches[0].tags[0], 'Contrato');

  const exists = run();
  assert.notEqual(exists.status, 0);
  assert.match(exists.stderr, /ya existe/);
  assert.equal(await readFile(output, 'utf8'), originalReport);
  assert.equal(run(['--force']).status, 0);
  const regenerated = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(regenerated.schema, 'paperless-inventory');
  assert.equal(regenerated.summary.sourcePdfCount, 3);
});

test('requires generation before the directory input can be loaded', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dashboard-no-report-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(loadInventory({ inventoryInput: directory, inventoryExists: false }), /Ejecuta primero el servicio generator/);
  await assert.rejects(loadInventory({ inventoryInput: directory, inventoryExists: 'maybe' }), /true o false/);
});
