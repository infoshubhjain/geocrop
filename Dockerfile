FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY geocrop/data/example_scene.json ./geocrop/data/example_scene.json
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
COPY geocrop ./geocrop
RUN pip install --no-cache-dir uv==0.12.15 && uv sync --locked --no-dev --python /usr/local/bin/python
COPY --from=frontend /app/dist ./dist
RUN useradd --system --uid 10001 --create-home geocrop
USER 10001
EXPOSE 8000
CMD [".venv/bin/uvicorn", "geocrop.api:app", "--host", "0.0.0.0", "--port", "8000"]
