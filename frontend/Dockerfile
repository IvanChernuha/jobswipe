FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .

# Unit tests: `docker build --target test ./frontend` (scripts/test.sh).
# The production build below never runs this stage.
FROM deps AS test
RUN npx vitest run

FROM deps AS build
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
