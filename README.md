# Dashboard documental

Aplicación web local para explorar un informe de documentos y las coincidencias registradas en un repositorio de referencia. La imagen no contiene informes ni documentos reales: Docker los monta desde el equipo donde se ejecuta.

## Inicio rápido

Requisitos: Docker Compose, una carpeta de PDF de origen y una exportación de `document_exporter` de Paperless que contenga los PDF originales y `manifest.json`. También puedes usar un informe TXT generado previamente.

```bash
cp config/.env.example config/.env
```

Edita `config/.env` y sustituye `SOURCE_DIRECTORY_HOST` y `BACKUP_DIRECTORY_HOST` por rutas absolutas del equipo que ejecutará Docker. La plantilla usa `INVENTORY_EXISTS=false` y hace que `INVENTORY_INPUT_HOST` reutilice la ruta de la exportación. Genera el informe antes del primer arranque:

```bash
docker compose --env-file config/.env -f config/docker-compose.yml build dashboard
docker compose --env-file config/.env -f config/docker-compose.yml --profile generate run --rm generator
docker compose --env-file config/.env -f config/docker-compose.yml up -d
```

El paso `generator` crea `desglose-documentos.txt` dentro de la carpeta exportada. No reemplaza un TXT existente. Para regenerarlo tras cambiar los PDF o el manifest, ejecuta `docker compose --env-file config/.env -f config/docker-compose.yml --profile generate run --rm generator --force` y después `docker compose --env-file config/.env -f config/docker-compose.yml restart dashboard`. El informe se carga al iniciar el servidor.

Si ya tienes un informe TXT, configura `INVENTORY_EXISTS=true` e `INVENTORY_INPUT_HOST=/ruta/al/informe.txt` y omite el comando `generator`. Mantén configuradas las dos carpetas de PDF para que funcionen sus enlaces.

Abre <http://localhost:8080>. Para comprobar el servicio:

```bash
docker compose --env-file config/.env -f config/docker-compose.yml ps
docker compose --env-file config/.env -f config/docker-compose.yml logs dashboard
```

Para detenerlo, ejecuta `docker compose --env-file config/.env -f config/docker-compose.yml down`. Tras cambiar el código local, repite `build dashboard` y `up -d`; para una imagen publicada, cambia `DASHBOARD_VERSION` y repite `pull` y `up -d`.

## Configuración

[`config/docker-compose.yml`](config/docker-compose.yml) es el ejemplo recomendado y no contiene rutas del equipo, informes, credenciales ni datos de cliente. Todos los valores editables se definen en `config/.env`:

```dotenv
DASHBOARD_IMAGE=dashboard-documental
DASHBOARD_VERSION=local
DASHBOARD_HOST_BIND=127.0.0.1
DASHBOARD_PORT=8080

INVENTORY_EXISTS=false
SOURCE_DIRECTORY_HOST=/ruta/a/los/documentos/origen
BACKUP_DIRECTORY_HOST=/ruta/a/la/exportacion-de-paperless
INVENTORY_INPUT_HOST=${BACKUP_DIRECTORY_HOST}

APP_TITLE=Dashboard documental
SOURCE_LABEL=Documentos de origen
BACKUP_LABEL=Repositorio de referencia
```

La plantilla construye una imagen local (`dashboard-documental:local`). Si utilizas una versión que ya incluya el generador y esté publicada en GHCR, configura `DASHBOARD_IMAGE` y `DASHBOARD_VERSION` con esa versión y usa `docker compose --env-file config/.env -f config/docker-compose.yml pull` en lugar de `build dashboard`.

Con `INVENTORY_EXISTS=false`, `INVENTORY_INPUT_HOST` debe ser la carpeta exportada y el generador espera allí `manifest.json`. Con `true`, debe ser la ruta de un TXT existente. Quien usaba `INVENTORY_FILE_HOST` debe renombrar esa variable a `INVENTORY_INPUT_HOST` y establecer `INVENTORY_EXISTS=true`. El dashboard monta todos los datos en solo lectura; únicamente el servicio `generator` escribe el TXT en la exportación. Dentro del contenedor se usan las rutas `/input/data`, `/documents/source` y `/documents/backup`.

El usuario del contenedor debe tener permiso de escritura en la carpeta exportada para generar el informe. Si aparece un error de permisos, revisa el propietario y los permisos de esa carpeta en el equipo anfitrión.

### Parámetros del Compose

- `image`: imagen y versión que Docker descargará.
- `init`: gestiona señales y procesos hijos dentro del contenedor.
- `restart`: reintenta el servicio si termina con error.
- `read_only`: impide escrituras en el sistema de archivos de la imagen.
- `cap_drop` y `security_opt`: reducen los privilegios del proceso.
- `environment`: define textos de interfaz, el modo de entrada y rutas internas, nunca rutas privadas del host.
- `ports`: publica el puerto interno `4173` en el host según `.env`.
- `volumes`: conecta el TXT o la exportación y las carpetas locales; el dashboard las usa en modo lectura.
- `tmpfs`: ofrece espacio temporal efímero para el proceso.

Si falta el TXT o no tiene el formato esperado, el contenedor termina y el motivo se muestra con `docker compose --env-file config/.env -f config/docker-compose.yml logs dashboard`. Si falta el manifest o la exportación no es válida, el comando `generator` muestra el error antes de iniciar el dashboard.

El emparejamiento del generador se basa en los nombres de PDF: reconoce el prefijo de fecha y la etiqueta de los archivos exportados por Paperless. Las coincidencias dudosas se mantienen agrupadas en el dashboard para que puedan revisarse.

### Si los enlaces a PDF muestran «Archivo no disponible»

La URL `/files/source/...` o `/files/backup/...` es normal: el navegador solicita el archivo al servidor, que lo lee desde los volúmenes de Docker. `SOURCE_DIRECTORY_HOST` y `BACKUP_DIRECTORY_HOST` deben apuntar a las carpetas **que contienen** los PDF en el equipo donde corre Docker. Sus contenidos aparecen dentro del contenedor en `/documents/source` y `/documents/backup`; `read_only: true` permite leerlos, pero impide modificarlos.

Después de configurar las rutas y recrear el servicio, comprueba la correspondencia entre el TXT y los archivos montados:

```bash
cd config
docker compose build dashboard
docker compose up -d --force-recreate dashboard
docker compose exec dashboard node /app/scripts/check-files.mjs
```

El comprobador muestra las raíces registradas en el TXT, las rutas internas y cuántos archivos se pueden leer. Si usas una imagen publicada, actualízala a una versión que incluya el comprobador en lugar de ejecutar `build`. Si indica «La carpeta montada no existe», revisa la ruta del host en `.env` y los permisos de Docker. Si indica archivos ausentes, el TXT describe otra estructura de carpetas o los PDF han cambiado: monta exactamente la carpeta raíz utilizada al crear el informe o regenera el informe con `generator` y reinicia `dashboard`. Si usas un TXT anterior en otro equipo, las rutas absolutas pueden ser distintas, pero la ruta **relativa** de cada PDF bajo la raíz del TXT debe coincidir con la ruta bajo la carpeta montada.

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
python3 desglose_documental.py --source /ruta/a/origen --backup /ruta/a/la/exportacion --output /ruta/a/la/exportacion/desglose-documentos.txt
INVENTORY_FILE=/ruta/a/la/exportacion/desglose-documentos.txt \
SOURCE_FILES_ROOT=/ruta/a/origen \
BACKUP_FILES_ROOT=/ruta/a/la/exportacion \
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
