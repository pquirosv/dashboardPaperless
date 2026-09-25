import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadInventory } from '../server.mjs';

export async function checkFiles(inventory, roots) {
  const result = {};
  for (const type of ['source', 'backup']) {
    const inventoryRoot = inventory[`${type}Root`];
    const mountedRoot = path.resolve(roots[type]);
    const paths = type === 'source'
      ? inventory.documents.map((document) => document.sourcePath)
      : inventory.documents.flatMap((document) => document.matches.map((match) => match.path));
    const uniquePaths = [...new Set(paths)];
    let rootAvailable = false;
    try {
      rootAvailable = (await stat(mountedRoot)).isDirectory();
    } catch { /* Report the missing mount below. */ }
    const missing = [];
    if (rootAvailable) {
      for (const originalPath of uniquePaths) {
        const relative = path.relative(inventoryRoot, originalPath);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          missing.push({ relative: originalPath, reason: 'fuera de la raíz del informe' });
          continue;
        }
        const candidate = path.join(mountedRoot, relative);
        try {
          if (!(await stat(candidate)).isFile()) missing.push({ relative, reason: 'no es un archivo' });
          else await access(candidate, constants.R_OK);
        } catch (error) {
          missing.push({ relative, reason: error.code === 'EACCES' ? 'sin permiso de acceso' : 'no existe o no se puede leer' });
        }
      }
    }
    result[type] = { inventoryRoot, mountedRoot, rootAvailable, total: uniquePaths.length, missing };
  }
  return result;
}

async function main() {
  const inventory = await loadInventory();
  const results = await checkFiles(inventory, {
    source: process.env.SOURCE_FILES_ROOT || '/documents/source',
    backup: process.env.BACKUP_FILES_ROOT || '/documents/backup'
  });
  for (const [type, result] of Object.entries(results)) {
    console.log(`${type}: raíz del TXT ${result.inventoryRoot} -> montaje ${result.mountedRoot}`);
    if (!result.rootAvailable) {
      console.error(`  La carpeta montada no existe o no es una carpeta.`);
      continue;
    }
    console.log(`  Archivos accesibles: ${result.total - result.missing.length}/${result.total}`);
    for (const item of result.missing.slice(0, 5)) console.log(`  Falta ${item.relative} (${item.reason})`);
    if (result.missing.length > 5) console.log(`  ... y ${result.missing.length - 5} más`);
  }
  if (Object.values(results).some((result) => !result.rootAvailable || result.missing.length)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`No se pudo comprobar los archivos: ${error.message}`);
    process.exitCode = 1;
  });
}
