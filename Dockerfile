# InstaBOT — production image for Render / Railway / any container host.
#
# The bot runs its own local Instagram engine (instagram-private-api +
# instagram_mqtt). Provide cookies via account.txt (or a Render Secret File and
# IG_ACCOUNT_PATH=/etc/secrets/account.txt). No external server is needed.
FROM node:20-alpine

ENV NODE_ENV=production
# The bot ships a tiny status/health server so a host like Render finds an open
# port. Set PORT=0 to disable it (pure worker mode).
ENV PORT=8080

WORKDIR /app

# No committed lockfile: npm install generates node_modules inside the image.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

# Persisted JSON store and uptime journal live under data/.
RUN mkdir -p data && chown -R node:node /app
USER node

EXPOSE 8080

CMD ["node", "index.js"]
