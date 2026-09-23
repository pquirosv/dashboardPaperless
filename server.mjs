import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInventory } from './scripts/inventory.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

const isDirectory = async (candidate) => {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
};

export function resolveUnderRoot(configuredRoot, encodedPath) {
  if (!configuredRoot) return null;
  let relative;
  try {
    relative = encodedPath.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
  if (!relative || relative.includes('\0')) return null;
  const absoluteRoot = path.resolve(configuredRoot);
  const candidate = path.resolve(absoluteRoot, relative);
  return candidate.startsWith(`${absoluteRoot}${path.sep}`) ? candidate : null;
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function sendErrorPage(response, status, message) {
  const body = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Archivo no disponible</title><style>body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f2;color:#20201e}.card{max-width:600px;margin:24px;padding:32px;background:white;border:1px solid #ddd;border-radius:12px}h1{margin-top:0}button{padding:10px 16px}</style><main class="card"><h1>Archivo no disponible</h1><p>${message}</p><p>Comprueba los volúmenes configurados en Compose y reinicia el contenedor.</p><button onclick="window.close()">Cerrar pestaña</button></main></html>`;
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

async function sendFile(request, response, filePath, contentType, friendlyError = false) {
  try {
    const details = await stat(filePath);
    if (!details.isFile()) return friendlyError
      ? sendErrorPage(response, 404, 'No existe ningún archivo con esta ruta.')
      : sendJson(response, 404, { error: 'Archivo no encontrado.' });
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': details.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') return response.end();
    createReadStream(filePath).pipe(response);
  } catch {
    if (friendlyError) return sendErrorPage(response, 404, 'No existe ningún archivo con esta ruta o no se puede leer.');
    sendJson(response, 404, { error: 'Archivo no encontrado.' });
  }
}

export async function loadInventory(options = {}) {
  const inventoryFile = options.inventoryFile || process.env.INVENTORY_FILE || '/input/inventory.txt';
  let details;
  try {
    details = await stat(inventoryFile);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No existe INVENTORY_FILE: ${inventoryFile}`);
    throw new Error(`No se puede acceder a INVENTORY_FILE (${inventoryFile}): ${error.message}`);
  }
  if (!details.isFile()) throw new Error(`INVENTORY_FILE no es un archivo: ${inventoryFile}`);
  let input;
  try {
    input = await readFile(inventoryFile, 'utf8');
  } catch (error) {
    throw new Error(`No se puede leer INVENTORY_FILE (${inventoryFile}): ${error.message}`);
  }
  return parseInventory(input, {
    generatedFrom: path.basename(inventoryFile),
    appTitle: options.appTitle || process.env.APP_TITLE,
    sourceLabel: options.sourceLabel || process.env.SOURCE_LABEL,
    backupLabel: options.backupLabel || process.env.BACKUP_LABEL
  });
}

export function createDashboardServer(options) {
  if (!options?.inventory) throw new Error('Se necesita un inventario para iniciar el servidor.');
  const inventory = options.inventory;
  const files = {
    source: path.resolve(options.sourceFilesRoot || '/documents/source'),
    backup: path.resolve(options.backupFilesRoot || '/documents/backup')
  };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { status: 'ok' });
    if (url.pathname === '/api/inventory' && request.method === 'GET') return sendJson(response, 200, inventory);
    if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: 'Método no permitido.' });

    const publicFile = publicFiles.get(url.pathname);
    if (publicFile) return sendFile(request, response, path.join(root, publicFile[0]), publicFile[1]);

    const match = url.pathname.match(/^\/files\/(source|backup)\/(.+)$/);
    if (match) {
      const selectedRoot = files[match[1]];
      if (!await isDirectory(selectedRoot)) return sendErrorPage(response, 404, 'La carpeta montada no existe o no está accesible.');
      const filePath = resolveUnderRoot(selectedRoot, match[2]);
      if (!filePath) return sendErrorPage(response, 400, 'La ruta solicitada no es válida.');
      return sendFile(request, response, filePath, 'application/pdf', true);
    }
    return sendJson(response, 404, { error: 'Recurso no encontrado.' });
  });
}

async function main() {
  const inventory = await loadInventory();
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '0.0.0.0';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un puerto válido.');
  const server = createDashboardServer({
    inventory,
    sourceFilesRoot: process.env.SOURCE_FILES_ROOT,
    backupFilesRoot: process.env.BACKUP_FILES_ROOT
  });
  server.listen(port, host, () => console.log(`Dashboard disponible en http://${host}:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`No se pudo iniciar el dashboard: ${error.message}`);
    process.exitCode = 1;
  });
}
