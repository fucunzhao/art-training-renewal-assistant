FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY login.html ./
COPY login.js ./
COPY app.js ./
COPY styles.css ./
COPY data.json ./
COPY users.json ./
COPY notifications.json ./
COPY schedule.json ./
COPY knowledge_base ./knowledge_base

ENV HOST=0.0.0.0
ENV PORT=4173
ENV DATA_DIR=/app/storage

VOLUME ["/app/storage"]

EXPOSE 4173

CMD ["node", "server.js"]
