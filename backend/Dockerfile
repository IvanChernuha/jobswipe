FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# --proxy-headers + --forwarded-allow-ips=* so request.client.host reflects the
# real client from X-Forwarded-For (set by the ingress/Caddy). Required for the
# rate limiter to key on the actual caller instead of the proxy IP.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
