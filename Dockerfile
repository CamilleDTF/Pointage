# Image de production. Deux etapes pour ne pas embarquer les outils de
# compilation de better-sqlite3 dans l'image finale.

FROM node:22-slim AS dependances
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# sqlite3 sert aux sauvegardes (voir docs/DEPLOIEMENT.md).
RUN apt-get update \
 && apt-get install -y --no-install-recommends sqlite3 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=dependances /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/moi').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
