FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sports_trends ./sports_trends

CMD ["python", "-m", "sports_trends.cron_agent"]
