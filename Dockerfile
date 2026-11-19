# Servidor de traslados (opcional, para hospedarlo en un servidor propio o en la nube)
FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
COPY server ./server
COPY www ./www
ENV PORT=3000 DB_FILE=/data/camilleros.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server/server.js"]
