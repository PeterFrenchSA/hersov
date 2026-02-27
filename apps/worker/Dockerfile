FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.base.json .eslintrc.cjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY . .

RUN npm run build --workspace @hersov/shared
RUN npm run prisma:generate --workspace @hersov/worker
RUN npm run build --workspace @hersov/worker

WORKDIR /app/apps/worker

CMD ["node", "dist/main.js"]
