import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadInventory } from '../server.mjs';

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

  const output = path.join(exportDirectory, 'desglose-documentos.txt');
  const command = ['--source', source, '--backup', exportDirectory, '--output', output];
  const run = (extra = []) => spawnSync('python3', [generator, ...command, ...extra], { encoding: 'utf8' });
  const missingManifest = run();
  assert.notEqual(missingManifest.status, 0);
  assert.match(missingManifest.stderr, /No existe el manifest/);

  await writeFile(path.join(exportDirectory, 'manifest.json'), JSON.stringify([
    { model: 'documents.tag', pk: 1, fields: { name: 'Contrato' } },
    { model: 'documents.document', pk: 7, __exported_file_name__: '2026-01-01 Persona documento uno.pdf', fields: { title: 'Documento uno', tags: [1] } }
  ]));
  const created = run();
  assert.equal(created.status, 0, created.stderr);
  const originalReport = await readFile(output, 'utf8');
  const data = await loadInventory({ inventoryInput: exportDirectory, inventoryExists: false });
  assert.deepEqual(data.summary, { total: 3, found: 2, missing: 1, ambiguous: 2, groups: 1 });
  assert.deepEqual(data.documents.find((document) => document.found).matches[0].tags, ['Contrato']);
  assert.equal(data.generatedFrom, 'desglose-documentos.txt');

  const exists = run();
  assert.notEqual(exists.status, 0);
  assert.match(exists.stderr, /ya existe/);
  assert.equal(await readFile(output, 'utf8'), originalReport);
  assert.equal(run(['--force']).status, 0);
  assert.equal(await readFile(output, 'utf8'), originalReport);
  const existing = await loadInventory({ inventoryInput: output, inventoryExists: true });
  assert.equal(existing.summary.total, 3);
});

test('requires generation before the directory input can be loaded', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dashboard-no-report-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(loadInventory({ inventoryInput: directory, inventoryExists: false }), /Ejecuta primero el servicio generator/);
  await assert.rejects(loadInventory({ inventoryInput: directory, inventoryExists: 'maybe' }), /true o false/);
});
