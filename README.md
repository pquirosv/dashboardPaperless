# Dashboard documental

Aplicación para explorar un informe de documentos y sus coincidencias en Paperless. El modo recomendado es Docker; también se puede ejecutar directamente con Node.

## Ejecutar con Docker

El Compose público usa el inventario sintético JSON v1 `test/fixtures/sample-inventory-v1.json`. No necesita `.env`, GHCR ni documentos reales.

```bash
docker compose -f config/docker-compose.yml up --build -d
```

Abre <http://localhost:8080>. Para detenerlo:

```bash
docker compose -f config/docker-compose.yml down
```

El Compose construye la imagen desde el código del repositorio y usa carpetas de ejemplo. Los enlaces a PDF no apuntan a documentos reales.

### Usar datos propios

Edita `config/docker-compose.yml` y monta un inventario JSON v1 en `INVENTORY_FILE`; cambia también los dos volúmenes de documentos por las carpetas de PDF del equipo. Mantén el inventario y los documentos fuera del repositorio. La demo fija `INVENTORY_EXISTS=true` y consume el JSON ya generado.

Hay dos modos de entrada:

- `INVENTORY_EXISTS=true`: `INVENTORY_FILE` señala directamente al archivo JSON v1 existente.
- `INVENTORY_EXISTS=false`: `INVENTORY_INPUT` señala a un directorio. El dashboard consume `desglose-documentos.json` dentro de ese directorio; antes, genera o regenera el archivo:

  ```bash
  SOURCE_FILES_ROOT=/datos/origen \
  BACKUP_FILES_ROOT=/datos/exportacion-paperless \
  INVENTORY_OUTPUT=/datos/inventario/desglose-documentos.json \
  python3 desglose_documental.py
  ```

  Para reemplazar un inventario existente, añade `--force`. También se puede configurar `INVENTORY_FILE` explícitamente en cualquiera de los dos modos.

## Ejecutar en local sin Docker

```bash
INVENTORY_FILE="$PWD/test/fixtures/sample-inventory-v1.json" \
SOURCE_FILES_ROOT="$PWD/test/fixtures" \
BACKUP_FILES_ROOT="$PWD/test/fixtures" \
npm start
```

Abre <http://localhost:4173>.

## Verificación

```bash
npm test
node --check app.js
node --check server.mjs
docker compose -f config/docker-compose.yml config --quiet
git diff --check
```

El Compose personal de la raíz (`docker-compose.yml`) no forma parte del repositorio. El archivo público de ejemplo está en `config/docker-compose.yml`.

## Formato del informe

El inventario debe cumplir el [contrato JSON v1](docs/inventory-json-v1.md). Los informes TXT históricos ya no son compatibles; deben regenerarse como JSON v1. El fixture público y sintético está en [`test/fixtures/sample-inventory-v1.json`](test/fixtures/sample-inventory-v1.json).

## Privacidad y publicación

- Los informes reales y sus rutas están excluidos por `.gitignore` y `.dockerignore`.
- El Compose personal `docker-compose.yml` de la raíz se conserva localmente y está excluido de Git y de la imagen Docker.
- La imagen se construye sin incluir documentos locales.
- La aplicación escucha por defecto solo en `127.0.0.1` y no proporciona autenticación.
- El workflow de GitHub Actions ejecuta las pruebas y construye la imagen en cada cambio. En los push a `main`, solo publica en GHCR si cambia la versión de `package.json` y el incremento es válido respecto al último tag `vX.Y.Z`; después crea y sube el tag correspondiente.

Para publicar una versión, cambia manualmente `version` en `package.json` siguiendo exactamente una de estas reglas respecto a la última versión publicada:

- **Patch:** `X.Y.Z` → `X.Y.(Z+1)`.
- **Minor:** `X.Y.Z` → `X.(Y+1).0`.
- **Major:** `X.Y.Z` → `(X+1).0.0`.

Sube el cambio a `main` como de costumbre. Si la versión no cambia, no se publica un paquete. Si el cambio no es exactamente un incremento patch, minor o major (incluidos los reinicios a cero requeridos), el workflow falla antes de publicar y explica el motivo. Los cambios de versión en pull requests no publican; la publicación ocurre al llegar a `main`.

Después de publicar por primera vez, cambia la visibilidad del paquete de GHCR a pública y verifica una descarga anónima. La visibilidad del repositorio se cambia desde la configuración de GitHub, no desde `docker-compose.yml`.
