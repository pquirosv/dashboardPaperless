FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY scripts ./scripts
COPY data/inventory.txt ./data/

RUN npm test
RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY index.html app.js styles.css server.mjs ./
COPY --from=build /app/data/dashboard-data.json ./data/dashboard-data.json

EXPOSE 4173

ENV HOST=0.0.0.0

CMD ["node", "server.mjs"]
