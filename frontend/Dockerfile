# Build context is the repo root (it needs packages/shared):
#   docker build -f frontend/Dockerfile .
FROM node:20-alpine AS deps
WORKDIR /repo/frontend
COPY frontend/package.json .
RUN npm install
COPY frontend/ .
COPY packages/ /repo/packages/
# Shared-package tests import vitest; let them resolve it from frontend's deps.
RUN ln -s /repo/frontend/node_modules /repo/node_modules

# Unit tests: `docker build --target test -f frontend/Dockerfile .` (scripts/test.sh).
# The production build below never runs this stage.
FROM deps AS test
RUN npx vitest run

FROM deps AS build
RUN npm run build

FROM nginx:alpine
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
