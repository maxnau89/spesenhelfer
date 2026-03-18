FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install poetry
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.create false && \
    poetry install --no-interaction --no-root --only main

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app
WORKDIR /app

# System deps: curl (health check) + poppler-utils (pdf2image → PDF→PNG rendering)
RUN apt-get update && apt-get install -y --no-install-recommends curl poppler-utils && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

RUN useradd -m appuser
COPY --chown=appuser:appuser backend ./backend

RUN mkdir -p /data/uploads && chown -R appuser:appuser /data

USER appuser
EXPOSE 8011
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8011"]
