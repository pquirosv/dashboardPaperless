# Docker

Este proyecto puede ejecutarse como una imagen Docker con un servidor Node integrado. La imagen hace dos cosas:

1. Ejecuta los tests y genera `data/dashboard-data.json` desde `data/inventory.txt`.
2. Sirve el dashboard y los PDFs mediante el servidor HTTP incluido.

## Construir la imagen

Desde la raíz del proyecto:

```bash
docker build -t archivo-munet-dashboard .
```

Si el build falla, revisa primero:

```bash
npm test
npm run build
```

## Ejecutar en local

```bash
docker run --rm --name archivo-munet-dashboard -p 8080:4173 \
  -v "/ruta/a/ArchivoMunet:/documents/source:ro" \
  -v "/ruta/al/backup:/documents/backup:ro" \
  archivo-munet-dashboard
```

Después abre:

```text
http://localhost:8080
```

## Rutas de los PDFs

Los PDFs se montan en el contenedor como solo lectura y se sirven bajo las rutas HTTP `/files/source/` y `/files/backup/`.

Sustituye en el comando:

- `/ruta/a/ArchivoMunet` por la carpeta raíz actual de ArchivoMunet;
- `/ruta/al/backup` por la carpeta actual del respaldo de Paperless.

En el formulario del dashboard usa `/documents/source` y `/documents/backup`, que son las rutas visibles dentro del contenedor. No introduzcas allí las rutas del host, porque el proceso Node solo puede acceder al sistema de archivos del contenedor.

Fuera de Docker puedes aceptar los placeholders históricos o escribir directamente cualquier ruta accesible en el equipo. El navegador guarda la configuración y la vuelve a enviar al servidor al cargar el dashboard.

No es necesario exponer las carpetas completas dentro de la imagen: los volúmenes `:ro` las mantienen externas y evitan modificaciones accidentales. Al usar HTTP para los enlaces, el navegador puede abrir los documentos en una pestaña nueva sin bloquearlos como ocurría con `file://`.

Si una carpeta no está montada, no es accesible o un PDF concreto no existe, el dashboard sigue funcionando. Al abrir el enlace se muestra una página de “Archivo no disponible” y puedes corregir las rutas desde **Rutas de archivos**.

## Sustituir un contenedor existente

Si ya hay una versión anterior usando el puerto 8080:

```bash
docker stop archivo-munet-dashboard
docker rm archivo-munet-dashboard
```

Después ejecuta de nuevo el comando de la sección **Ejecutar en local**. Si el contenedor anterior se creó con `--rm`, desaparecerá automáticamente al detenerse y `docker rm` indicará que ya no existe.

## Publicar la imagen

Ejemplo con Docker Hub:

```bash
docker login
docker tag archivo-munet-dashboard TU_USUARIO/archivo-munet-dashboard:latest
docker push TU_USUARIO/archivo-munet-dashboard:latest
```

Ejemplo con GitHub Container Registry:

```bash
docker login ghcr.io
docker tag archivo-munet-dashboard ghcr.io/TU_USUARIO/archivo-munet-dashboard:latest
docker push ghcr.io/TU_USUARIO/archivo-munet-dashboard:latest
```

Sustituye `TU_USUARIO` por tu usuario real.

## Ejecutar una imagen publicada

```bash
docker run --rm --name archivo-munet-dashboard -p 8080:4173 \
  -v "/ruta/a/ArchivoMunet:/documents/source:ro" \
  -v "/ruta/al/backup:/documents/backup:ro" \
  TU_USUARIO/archivo-munet-dashboard:latest
```

O, si usas GitHub Container Registry:

```bash
docker run --rm --name archivo-munet-dashboard -p 8080:4173 \
  -v "/ruta/a/ArchivoMunet:/documents/source:ro" \
  -v "/ruta/al/backup:/documents/backup:ro" \
  ghcr.io/TU_USUARIO/archivo-munet-dashboard:latest
```

## Archivos relevantes

- `Dockerfile`: define la imagen.
- `server.mjs`: sirve el dashboard y los PDFs configurados.
- `data/inventory.txt`: fuente del inventario.
- `scripts/build-data.mjs`: genera `data/dashboard-data.json`.
- `scripts/build-data.test.mjs`: valida el parser del inventario.
- `data/dashboard-data.json`: datos generados para el dashboard.
