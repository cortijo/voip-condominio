# Sem apt-get e sem compilação nativa: o SQLite é o módulo embutido do Node 22 (node:sqlite).
# O único acesso de rede no build é o "npm ci" (registry.npmjs.org, HTTPS).
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=9670 \
    DATA_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME ["/data"]
EXPOSE 9670
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
