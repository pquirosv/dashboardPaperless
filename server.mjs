import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/data/dashboard-data.json', ['data/dashboard-data.json', 'application/json; charset=utf-8']]
]);

const isDirectory = async (candidate) => {
  try {
    await access(candidate);
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
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

function sendErrorPage(response, status, message) {
  const body = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Archivo no disponible</title><style>body{font:16px system-ui;margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f2;color:#20201e}.card{max-width:600px;margin:24px;padding:32px;background:white;border:1px solid #ddd;border-radius:12px}h1{margin-top:0}button{padding:10px 16px}</style><main class="card"><h1>Archivo no disponible</h1><p>${message}</p><p>Cierra esta pestaña y, en el dashboard, abre <strong>Rutas de archivos</strong> para comprobar la carpeta configurada.</p><button onclick="window.close()">Cerrar pestaña</button></main></html>`;
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Payload demasiado grande.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function sendFile(request, response, filePath, contentType, friendlyError = false) {
  try {
    const details = await stat(filePath);
    if (!details.isFile()) return friendlyError
      ? sendErrorPage(response, 404, 'No existe ningún archivo con esta ruta.')
      : sendJson(response, 404, { error: 'Archivo no encontrado.' });
    const headers = {
      'Content-Type': contentType,
      'Content-Length': details.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline'
    };
    response.writeHead(200, headers);
    if (request.method === 'HEAD') return response.end();
    createReadStream(filePath).pipe(response);
  } catch {
    if (friendlyError) return sendErrorPage(response, 404, 'No existe ningún archivo con esta ruta o no se puede leer.');
    sendJson(response, 404, { error: 'Archivo no encontrado.' });
  }
}

async function initialConfiguration() {
  const inventory = JSON.parse(await readFile(path.join(root, 'data', 'dashboard-data.json'), 'utf8'));
  return { sourceRoot: inventory.sourceRoot, backupRoot: inventory.backupRoot };
}

async function configuration(configured) {
  return {
    source: { root: configured.sourceRoot, available: await isDirectory(configured.sourceRoot) },
    backup: { root: configured.backupRoot, available: await isDirectory(configured.backupRoot) }
  };
}

export async function createDashboardServer() {
  let configured = await initialConfiguration();
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    if (url.pathname === '/api/config' && request.method === 'GET') return sendJson(response, 200, await configuration(configured));
    if (url.pathname === '/api/config' && request.method === 'POST') {
      try {
        const next = await readJson(request);
        if (!path.isAbsolute(next.sourceRoot) || !path.isAbsolute(next.backupRoot)) {
          return sendJson(response, 400, { error: 'Las dos rutas deben ser absolutas.' });
        }
        configured = { sourceRoot: path.resolve(next.sourceRoot), backupRoot: path.resolve(next.backupRoot) };
        return sendJson(response, 200, await configuration(configured));
      } catch {
        return sendJson(response, 400, { error: 'No se pudieron guardar las rutas.' });
      }
    }

    if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: 'Método no permitido.' });

    const publicFile = publicFiles.get(url.pathname);
    if (publicFile) return sendFile(request, response, path.join(root, publicFile[0]), publicFile[1]);

    const match = url.pathname.match(/^\/files\/(source|backup)\/(.+)$/);
    if (match) {
      const roots = await configuration(configured);
      const selected = roots[match[1]];
      if (!selected.available) return sendErrorPage(response, 404, 'La carpeta configurada no existe o no está accesible en este equipo.');
      const filePath = resolveUnderRoot(selected.root, match[2]);
      if (!filePath) return sendErrorPage(response, 400, 'La ruta solicitada no es válida.');
      return sendFile(request, response, filePath, 'application/pdf', true);
    }

    return sendJson(response, 404, { error: 'Recurso no encontrado.' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const server = await createDashboardServer();
  server.listen(port, host, () => console.log(`Dashboard disponible en http://localhost:${port}`));
}
