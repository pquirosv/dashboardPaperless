# Dashboard documental

Aplicación web local para explorar un informe de documentos y las coincidencias registradas en un repositorio de referencia. La imagen no contiene informes ni documentos reales: Docker los monta desde el equipo donde se ejecuta.

## Inicio rápido

Requisitos: Docker Compose y los archivos locales que quieras consultar.

```bash
cp config/.env.example config/.env
```

Edita `config/.env` y sustituye las rutas de ejemplo por rutas del equipo que ejecutará Docker. Después:

```bash
docker compose --env-file config/.env -f config/docker-compose.yml pull
docker compose --env-file config/.env -f config/docker-compose.yml up -d
```

Abre <http://localhost:8080>. Para comprobar el servicio:

```bash
docker compose --env-file config/.env -f config/docker-compose.yml ps
docker compose --env-file config/.env -f config/docker-compose.yml logs dashboard
```

Para detenerlo, ejecuta `docker compose --env-file config/.env -f config/docker-compose.yml down`. Para actualizar la imagen, cambia `DASHBOARD_VERSION` en `config/.env` y repite `pull` y `up -d`.

## Configuración

[`config/docker-compose.yml`](config/docker-compose.yml) es el ejemplo recomendado y no contiene rutas del equipo, informes, credenciales ni datos de cliente. Todos los valores editables se definen en `config/.env`:

```dotenv
DASHBOARD_IMAGE=ghcr.io/tu-organizacion/dashboard-documental
DASHBOARD_VERSION=v1.0.0
DASHBOARD_HOST_BIND=127.0.0.1
DASHBOARD_PORT=8080

INVENTORY_FILE_HOST=/ruta/al/informe.txt
SOURCE_DIRECTORY_HOST=/ruta/a/los/documentos/origen
BACKUP_DIRECTORY_HOST=/ruta/a/los/documentos/referencia

APP_TITLE=Dashboard documental
SOURCE_LABEL=Documentos de origen
BACKUP_LABEL=Repositorio de referencia
```

El informe, los documentos de origen y los documentos de referencia deben existir en el equipo anfitrión. Los tres volúmenes se montan como solo lectura. Dentro del contenedor se usan las rutas genéricas `/input/inventory.txt`, `/documents/source` y `/documents/backup`.

### Parámetros del Compose

- `image`: imagen y versión que Docker descargará.
- `init`: gestiona señales y procesos hijos dentro del contenedor.
- `restart`: reintenta el servicio si termina con error.
- `read_only`: impide escrituras en el sistema de archivos de la imagen.
- `cap_drop` y `security_opt`: reducen los privilegios del proceso.
- `environment`: define textos de interfaz y rutas internas, nunca rutas privadas del host.
- `ports`: publica el puerto interno `4173` en el host según `.env`.
- `volumes`: conecta el informe y las carpetas locales en modo lectura.
- `tmpfs`: ofrece espacio temporal efímero para el proceso.

Si falta el TXT o no tiene el formato esperado, el contenedor termina y el motivo se muestra con `docker compose --env-file config/.env -f config/docker-compose.yml logs dashboard`.

## Formato del informe

El parser usa las cabeceras del informe para detectar las etiquetas de origen y referencia. Un ejemplo sintético está en [`test/fixtures/sample-inventory.txt`](test/fixtures/sample-inventory.txt):

```text
Carpeta origen:
  /ruta/origen

Backup de referencia:
  /ruta/referencia

DOCUMENTOS DE ORIGEN QUE NO SE ENCONTRARON EN REFERENCIA
/ruta/origen/documento-a.pdf
NOMBRES PDF DUPLICADOS EN ORIGEN

DOCUMENTOS DE ORIGEN QUE SÍ ESTÁN EN REFERENCIA
ORIGEN: /ruta/origen/documento-b.pdf
REFERENCIA: /ruta/referencia/documento-b.pdf
DOCUMENTOS DEL MANIFEST SIN PDF ORIGINAL EN EL BACKUP
```

Las rutas originales escritas dentro del informe se muestran como información del inventario. Las rutas que Docker utiliza realmente se configuran por separado en `.env`.

## Desarrollo y verificación

Las pruebas usan únicamente datos sintéticos:

```bash
npm test
node --check app.js
node --check server.mjs
git diff --check
```

Para ejecutar sin Docker:

```bash
INVENTORY_FILE=/ruta/al/informe.txt \
SOURCE_FILES_ROOT=/ruta/a/origen \
BACKUP_FILES_ROOT=/ruta/a/referencia \
npm start
```

## Privacidad y publicación

- Los informes reales y sus rutas están excluidos por `.gitignore` y `.dockerignore`.
- `config/.env` nunca debe subirse; usa `config/.env.example` como plantilla.
- La imagen se construye sin incluir documentos locales.
- La aplicación escucha por defecto solo en `127.0.0.1` y no proporciona autenticación.
- El workflow de GitHub Actions ejecuta las pruebas y construye la imagen en cada cambio; al crear un tag `vX.Y.Z`, también la publica en GHCR.

Para publicar una versión:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Después de publicar por primera vez, cambia la visibilidad del paquete de GHCR a pública y verifica una descarga anónima. La visibilidad del repositorio se cambia desde la configuración de GitHub, no desde `docker-compose.yml`.
