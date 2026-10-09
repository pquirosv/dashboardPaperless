import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDashboardServer, loadInventory, resolveUnderRoot } from '../server.mjs';
import { checkFiles } from '../scripts/check-files.mjs';

const fixture = new URL('./fixtures/sample-inventory-v1.json', import.meta.url);

test('resolves encoded paths under the configured root and rejects traversal', () => {
  assert.equal(resolveUnderRoot('/documents/source', 'Carpeta%20%C3%9Anica/archivo.pdf'), path.resolve('/documents/source/Carpeta Única/archivo.pdf'));
  assert.equal(resolveUnderRoot('/documents/source', '%2E%2E/secret.pdf'), null);
  assert.equal(resolveUnderRoot('/documents/source', '%E0%A4%A'), null);
  assert.equal(resolveUnderRoot('/documents/source', 'folder%2F..%2Fsecret.pdf'), null);
});

test('loads a mounted inventory and applies neutral display labels', async () => {
  const data = await loadInventory({
    inventoryFile: fixture.pathname,
    appTitle: 'Visor de prueba',
    sourceLabel: 'Origen',
    backupLabel: 'Referencia'
  });
  assert.equal(data.display.appTitle, 'Visor de prueba');
  assert.equal(data.display.sourceLabel, 'Origen');
  assert.equal(data.display.backupLabel, 'Referencia');
  assert.equal(data.generatedFrom, 'sample-inventory-v1.json');
});

test('selects JSON v1 directly when it exists or from the generator output directory', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dashboard-inventory-mode-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const generatedFile = path.join(temporaryRoot, 'desglose-documentos.json');
  await writeFile(generatedFile, await readFile(fixture, 'utf8'));

  const generated = await loadInventory({ inventoryInput: temporaryRoot, inventoryExists: false });
  assert.equal(generated.generatedFrom, 'desglose-documentos.json');
  assert.equal(generated.summary.total, 4);

  await writeFile(path.join(temporaryRoot, 'desglose-documentos.txt'), 'historical TXT must not be loaded');
  await rm(generatedFile);
  await assert.rejects(
    loadInventory({ inventoryInput: temporaryRoot, inventoryExists: false }),
    /desglose-documentos\.json.*generator/i
  );

  const existing = await loadInventory({ inventoryInput: fixture.pathname, inventoryExists: true });
  assert.equal(existing.generatedFrom, 'sample-inventory-v1.json');
  assert.equal(existing.summary.total, 4);
});

test('checks inventory paths against different mounted host roots', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-dashboard-mounts-'));
  context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(temporaryRoot, 'host-source');
  const backupRoot = path.join(temporaryRoot, 'host-backup');
  await mkdir(path.join(sourceRoot, 'Grupo'), { recursive: true });
  await mkdir(path.join(backupRoot, 'originales'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'Grupo', 'documento uno.pdf'), '%PDF-source');
  await writeFile(path.join(backupRoot, 'originales', 'referencia uno.pdf'), '%PDF-backup');
  const inventory = await loadInventory({ inventoryFile: fixture.pathname });
  const result = await checkFiles(inventory, { source: sourceRoot, backup: backupRoot });
  assert.equal(result.source.rootAvailable, true);
  assert.equal(result.source.total, 4);
  assert.equal(result.source.missing.length, 3);
  assert.equal(result.backup.total, 3);
  assert.equal(result.backup.missing.length, 2);
  assert.ok(result.backup.missing.some((item) => item.relative === 'originales/referencia dos.pdf'));
});

test('serves inventory, health and mounted files without mutable configuration', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-dashboard-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const backupRoot = path.join(temporaryRoot, 'backup');
  await mkdir(path.join(sourceRoot, 'Grupo'), { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, 'Grupo', 'documento uno.pdf'), '%PDF-synthetic');
  const outsidePdf = path.join(temporaryRoot, 'outside.pdf');
  await writeFile(outsidePdf, '%PDF-outside-root');
  await symlink(outsidePdf, path.join(sourceRoot, 'outside.pdf'));
  const inventory = await loadInventory({ inventoryFile: fixture.pathname });
  const server = createDashboardServer({ inventory, sourceFilesRoot: sourceRoot, backupFilesRoot: backupRoot, runtime: { mode: 'package', version: '1.2.0' } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const runtime = await fetch(`${base}/api/runtime`);
  assert.deepEqual(await runtime.json(), { mode: 'package', version: '1.2.0' });
  const inventoryResponse = await fetch(`${base}/api/inventory`);
  assert.equal((await inventoryResponse.json()).summary.total, 4);
  const appScript = await fetch(`${base}/app.js`);
  assert.equal(appScript.headers.get('cache-control'), 'no-store');
  const configMutation = await fetch(`${base}/api/config`, { method: 'POST' });
  assert.equal(configMutation.status, 405);
  const pdf = await fetch(`${base}/files/source/Grupo/documento%20uno.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(await pdf.text(), '%PDF-synthetic');
  const traversal = await fetch(`${base}/files/source/%2E%2E/secret.pdf`);
  assert.ok([400, 404].includes(traversal.status));
  const nonPdf = await fetch(`${base}/files/source/Grupo/documento%20uno.txt`);
  assert.ok([400, 404].includes(nonPdf.status));
  const symlinkTraversal = await fetch(`${base}/files/source/outside.pdf`);
  assert.equal(symlinkTraversal.status, 404);
});

test('fails to load an inventory that does not exist', async () => {
  await assert.rejects(loadInventory({ inventoryFile: '/definitely/missing/inventory.json' }), /No existe INVENTORY_FILE/);
});

test('rejects a mounted directory in place of the inventory file', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-dashboard-directory-'));
  await assert.rejects(loadInventory({ inventoryFile: temporaryRoot }), /no es un archivo/);
  await rm(temporaryRoot, { recursive: true, force: true });
});
