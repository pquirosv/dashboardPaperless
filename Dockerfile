FROM node:22-alpine AS test

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY scripts ./scripts
COPY test ./test

RUN npm test

FROM node:22-alpine

ENV HOST=0.0.0.0 \
    PORT=4173 \
    INVENTORY_FILE=/input/inventory.txt \
    SOURCE_FILES_ROOT=/documents/source \
    BACKUP_FILES_ROOT=/documents/backup

WORKDIR /app

RUN mkdir -p /input /documents/source /documents/backup

COPY --from=test --chown=node:node /app/package.json ./package.json
COPY --chown=node:node index.html app.js styles.css server.mjs ./
COPY --chown=node:node scripts/inventory.mjs ./scripts/inventory.mjs

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
