# Docker

Este proyecto puede ejecutarse como una imagen Docker estática. La imagen hace dos cosas:

1. Ejecuta los tests y genera `data/dashboard-data.json` desde `data/inventory.txt`.
2. Sirve `index.html`, `app.js`, `styles.css` y `data/` con Nginx.

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
docker run --rm -p 8080:80 archivo-munet-dashboard
```

Después abre:

```text
http://localhost:8080
```

## Rutas de los PDFs

El contenedor sirve el dashboard, pero los PDFs se abren desde el navegador del equipo donde lo uses.

Al entrar, el dashboard pregunta por:

- la carpeta raíz actual de `ArchivoMunet`;
- la carpeta actual del respaldo de Paperless.

Si dejas esos campos vacíos y haces submit, se usan las rutas que aparecen como placeholder. Esas rutas se guardan en el `localStorage` del navegador, no dentro del contenedor.

Los enlaces a PDFs se generan como `file://...`, así que algunos navegadores pueden bloquearlos si la página se sirve por HTTP. En ese caso, la información del dashboard seguirá funcionando, pero puede que tengas que abrir los archivos manualmente desde la ruta mostrada.

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
docker run --rm -p 8080:80 TU_USUARIO/archivo-munet-dashboard:latest
```

O, si usas GitHub Container Registry:

```bash
docker run --rm -p 8080:80 ghcr.io/TU_USUARIO/archivo-munet-dashboard:latest
```

## Archivos relevantes

- `Dockerfile`: define la imagen.
- `data/inventory.txt`: fuente del inventario.
- `scripts/build-data.mjs`: genera `data/dashboard-data.json`.
- `scripts/build-data.test.mjs`: valida el parser del inventario.
- `data/dashboard-data.json`: datos generados para el dashboard.
