import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDashboardServer, loadInventory, resolveUnderRoot } from '../server.mjs';

const fixture = new URL('./fixtures/sample-inventory.txt', import.meta.url);

test('resolves encoded paths under the configured root and rejects traversal', () => {
  assert.equal(resolveUnderRoot('/documents/source', 'Carpeta%20%C3%9Anica/archivo.pdf'), path.resolve('/documents/source/Carpeta Única/archivo.pdf'));
  assert.equal(resolveUnderRoot('/documents/source', '%2E%2E/secret.pdf'), null);
  assert.equal(resolveUnderRoot('/documents/source', '%E0%A4%A'), null);
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
  assert.equal(data.generatedFrom, 'sample-inventory.txt');
});

test('serves inventory, health and mounted files without mutable configuration', async (context) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-dashboard-'));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const backupRoot = path.join(temporaryRoot, 'backup');
  await mkdir(path.join(sourceRoot, 'Grupo'), { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, 'Grupo', 'documento uno.pdf'), '%PDF-synthetic');
  const inventory = await loadInventory({ inventoryFile: fixture.pathname });
  const server = createDashboardServer({ inventory, sourceFilesRoot: sourceRoot, backupFilesRoot: backupRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(temporaryRoot, { recursive: true, force: true });
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const inventoryResponse = await fetch(`${base}/api/inventory`);
  assert.equal((await inventoryResponse.json()).summary.total, 4);
  const configMutation = await fetch(`${base}/api/config`, { method: 'POST' });
  assert.equal(configMutation.status, 405);
  const pdf = await fetch(`${base}/files/source/Grupo/documento%20uno.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(await pdf.text(), '%PDF-synthetic');
  const traversal = await fetch(`${base}/files/source/%2E%2E/secret.pdf`);
  assert.ok([400, 404].includes(traversal.status));
});

test('fails to load an inventory that does not exist', async () => {
  await assert.rejects(loadInventory({ inventoryFile: '/definitely/missing/inventory.txt' }), /No existe INVENTORY_FILE/);
});

test('rejects a mounted directory in place of the inventory file', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-dashboard-directory-'));
  await assert.rejects(loadInventory({ inventoryFile: temporaryRoot }), /no es un archivo/);
  await rm(temporaryRoot, { recursive: true, force: true });
});
