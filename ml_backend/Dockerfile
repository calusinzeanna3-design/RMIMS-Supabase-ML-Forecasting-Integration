FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files and ML model pickle
COPY . .

# Cloud Run defaults to PORT 8080
EXPOSE 8080

# Run with Gunicorn production WSGI server
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 120 app:app
