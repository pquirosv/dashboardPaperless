FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
COPY scripts ./scripts
COPY inventory.txt ./

RUN npm test
RUN npm run build

FROM nginx:1.27-alpine

COPY index.html app.js styles.css /usr/share/nginx/html/
COPY --from=build /app/data /usr/share/nginx/html/data

EXPOSE 80
