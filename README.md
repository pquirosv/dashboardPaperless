# Dashboard ArchivoMunet

Dashboard estático para explorar el inventario de `ArchivoMunet` y las coincidencias registradas en el respaldo de Paperless.

## Uso local

```bash
npm run build
python3 -m http.server 4173
```

Abre `http://localhost:4173` en el navegador.

La primera vez el dashboard pregunta por la ruta actual de `ArchivoMunet` y por la ruta actual del respaldo de Paperless. Si se dejan vacías, usa las rutas históricas que aparecen como placeholder.

## Docker

El proyecto incluye un `Dockerfile` que genera los datos y sirve el dashboard con Nginx.

```bash
docker build -t archivo-munet-dashboard .
docker run --rm -p 8080:80 archivo-munet-dashboard
```

Abre `http://localhost:8080` en el navegador.

Consulta `DOCKER.md` para instrucciones más completas antes de subir o publicar la imagen.

## Validación

```bash
npm test
```

El generador conserva los PDFs de ArchivoMunet, los documentos sin coincidencia y los grupos de coincidencias ambiguas sin asignar una correspondencia de forma arbitraria.
