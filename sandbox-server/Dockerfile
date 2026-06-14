# Image for the sandbox SERVER itself.
# Needs access to the host Docker socket to manage per-session containers
# (mount /var/run/docker.sock at runtime — see docker-compose.yml).
FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=optional

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 8787

CMD ["node", "--import", "tsx", "src/index.ts"]
