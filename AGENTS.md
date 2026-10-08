# AGENTS.md — Dashboard Paperless
- Este proyecto está pensado para empresas o entidades que están escaneando los documentos de su archivo y usando paperless-ngx para leer el texto de los documentos y estructurar su archivo de forma digital. Estoy trabajando directamente con una empresa que está realizando este proceso, por lo que conforme descubra nuevas utilidades las implementaré; es por lo tanto un proyecto muy abierto a cambios drásticos.
## Stack y estructura
- La aplicación es Node.js sin dependencias npm declaradas: servidor `server.mjs`, interfaz estática `index.html`/`app.js`/`styles.css`, parser del informe `scripts/inventory.mjs` y generador Python `desglose_documental.py`. Cambios en el formato del informe pueden afectar al parser y al generador; usa el fixture sintético `test/fixtures/sample-inventory.txt`.
- Se genera un package de docker para que los equipos puedan descargarse la imagen y empezar a operar de la forma más sencilla posible.
## Tests
- Verificación focalizada: `npm test` (Node `node:test`; `node --test test/server.test.mjs` ejecuta solo pruebas del servidor), `node --check app.js`, `node --check server.mjs` y `git diff --check`. CI usa Node 22, ejecuta `npm test` y construye la imagen con `docker build`. Las images se irán subiendo con el formato 'v.M.m.p', siendo M mayor; m, minor; p, patch. 
## Skills y MCP
- Uso de la skill frontent-design siempre que se toque algo relativo a frontend
- Uso del pluging de context7 siempre que pueda ser util.
## Límites
- **Nunca subas información confidencial a Git.** Antes de preparar o confirmar cambios, revisa `git status` y el diff (incluido el staged) para detectar secretos, credenciales, rutas locales, datos de clientes, PDF e informes reales. No copies esos valores a documentación, logs ni respuestas.
- No añadas `.env`, inventarios reales ni documentos al repositorio o a la imagen Docker. `.gitignore` y `.dockerignore` excluyen algunos datos, pero no garantizan que otros archivos sean seguros; `config/.env.example` es la plantilla compartible.

## Verificación
- Cómo comprobar que un cambio funciona antes de darlo por terminado.

