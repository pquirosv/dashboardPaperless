# Dashboard documental

Dashboard web para explorar un inventario de documentos y las coincidencias registradas en un repositorio de referencia. La aplicación está diseñada para ejecutarse en Docker sin incorporar datos reales a la imagen.

El informe, los documentos originales y el repositorio de referencia permanecen en el equipo del usuario. Docker Compose los monta como solo lectura; el servidor analiza el informe al arrancar y conserva el inventario únicamente en memoria.

## Inicio rápido

En el equipo que contiene los documentos solo hacen falta Docker, `compose.yaml` y un archivo `.env`:

```bash
cp .env.example .env
```

Edita `.env` con las rutas absolutas del equipo y la versión publicada. Después ejecuta:

```bash
docker compose pull
docker compose up -d
```

Abre `http://localhost:8080`. La imagen pública de GHCR no requiere `docker login`.

Para actualizar, cambia `DASHBOARD_VERSION` y repite los dos comandos. Consulta [DOCKER.md](DOCKER.md) para la configuración y publicación.

## Formato del informe

El parser admite el formato de desglose actual ArchivoMunet/Paperless. Obtiene las raíces originales de estas cabeceras:

```text
Carpeta origen ArchivoMunet:
  /ruta/original

Backup de Paperless:
  /ruta/referencia
```

El nombre y ubicación del TXT en el host son libres porque se montan en `/input/inventory.txt`. Un informe ausente, vacío o incompatible hace que el contenedor termine con un error explicativo.

## Desarrollo

Las pruebas utilizan exclusivamente datos sintéticos:

```bash
npm test
```

Para ejecutar sin Docker:

```bash
INVENTORY_FILE=/ruta/al/informe.txt \
SOURCE_FILES_ROOT=/ruta/a/origen \
BACKUP_FILES_ROOT=/ruta/a/referencia \
npm start
```

Variables opcionales: `APP_TITLE`, `SOURCE_LABEL`, `BACKUP_LABEL`, `HOST` y `PORT`.

## Privacidad

- Los datos reales están excluidos por `.gitignore` y `.dockerignore`.
- La imagen no contiene informes ni inventarios generados.
- Los tres volúmenes de Compose se montan como solo lectura.
- El servicio escucha por defecto únicamente en `127.0.0.1` y no incorpora autenticación.
