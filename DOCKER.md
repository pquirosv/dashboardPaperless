# Despliegue con Docker Compose

## Archivos necesarios en el equipo documental

No es necesario clonar el repositorio ni instalar Node. Copia únicamente:

- `compose.yaml`
- `.env.example`, renombrado a `.env`

El informe TXT y las dos carpetas documentales ya deben existir en ese equipo.

## Configuración

Completa `.env` con rutas absolutas del host:

```dotenv
DASHBOARD_IMAGE=ghcr.io/pquirosv/dashboardpaperless
DASHBOARD_VERSION=v1.0.1
DASHBOARD_PORT=8080
INVENTORY_FILE_HOST=/ruta/al/informe.txt
SOURCE_DIRECTORY_HOST=/ruta/a/los/documentos/origen
BACKUP_DIRECTORY_HOST=/ruta/a/los/documentos/referencia
APP_TITLE=Dashboard Paperless
SOURCE_LABEL=Documentos de origen
BACKUP_LABEL=Repositorio de referencia
```

Las rutas del informe son las originales registradas cuando se generó. Las rutas de `.env` indican dónde están ahora los archivos en el equipo que ejecuta Docker.

## Descargar y ejecutar

La imagen de GHCR debe estar configurada como pública. No se necesita una cuenta de GitHub ni `docker login`:

```bash
docker compose pull
docker compose up -d
```

Comprueba el estado:

```bash
docker compose ps
docker compose logs dashboard
```

Abre `http://localhost:8080`.

Para detenerlo:

```bash
docker compose down
```

Para actualizar a una versión nueva, modifica `DASHBOARD_VERSION` y vuelve a ejecutar `pull` y `up -d`.

## Construcción local

El contexto de construcción excluye todos los datos reales:

```bash
docker build -t document-dashboard:test .
```

La imagen ejecuta como usuario sin privilegios, usa un filesystem raíz de solo lectura desde Compose y mantiene el inventario en memoria.

## Publicación

El workflow `.github/workflows/publish-container.yml` valida cada cambio. Al subir un tag semántico construye y publica en GHCR para AMD64 y ARM64:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Después de la primera publicación, abre la configuración del paquete en GitHub y cambia su visibilidad a **Public**. Verifica la descarga anónima desde una sesión sin credenciales antes de distribuir el Compose.
