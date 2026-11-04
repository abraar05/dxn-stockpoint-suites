# Mohammadpur Stock Point - production image
# Build:  docker build -t dxn-stockpoint .
# Run:    docker run -p 4173:4173 --env-file .env dxn-stockpoint
FROM node:20-alpine

WORKDIR /app

# Server + the web app (served by the same process)
COPY server ./server
COPY docs  ./docs

RUN mkdir -p server/data

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4173/api/v1/health || exit 1

CMD ["node", "server/index.js"]