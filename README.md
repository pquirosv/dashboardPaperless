# Dashboard ArchivoMunet

Dashboard web para explorar el inventario de `ArchivoMunet` y las coincidencias registradas en el respaldo de Paperless. Incluye un pequeño servidor Node que entrega la interfaz y permite abrir los PDFs mediante HTTP.

La fuente del inventario está en `data/inventory.txt`; el proceso de build genera `data/dashboard-data.json` a partir de ella.

## Uso local

```bash
npm run build
npm start
```

Abre `http://localhost:4173` en el navegador.

Al abrir el dashboard puedes aceptar las rutas históricas mostradas o escribir las rutas actuales. También puedes cambiarlas después con **Rutas de archivos**. Las carpetas deben existir y ser accesibles para el usuario que ejecuta `npm start`.

Los PDFs se sirven bajo `/files/` desde las dos carpetas elegidas. Esto permite abrirlos en una pestaña nueva sin depender de enlaces `file://`, que los navegadores bloquean desde páginas HTTP. Si una carpeta o un archivo no existe, la nueva pestaña muestra un aviso para revisar la configuración.

Las rutas se guardan en el navegador y se vuelven a comunicar al servidor cuando se carga el dashboard. No se copian ni modifican los documentos originales.

## Docker

El proyecto incluye un `Dockerfile` que genera los datos y sirve el dashboard con el servidor Node incluido.

```bash
docker build -t archivo-munet-dashboard .
docker run --rm --name archivo-munet-dashboard -p 8080:4173 \
  -v "/ruta/a/ArchivoMunet:/documents/source:ro" \
  -v "/ruta/al/backup:/documents/backup:ro" \
  archivo-munet-dashboard
```

Abre `http://localhost:8080` en el navegador.

En el formulario usa `/documents/source` y `/documents/backup`. Son las rutas internas del contenedor asociadas a las carpetas reales mediante los dos volúmenes de solo lectura.

Consulta `DOCKER.md` para instrucciones más completas antes de subir o publicar la imagen.

## Validación

```bash
npm test
```

El generador conserva los PDFs de ArchivoMunet, los documentos sin coincidencia y los grupos de coincidencias ambiguas sin asignar una correspondencia de forma arbitraria.
