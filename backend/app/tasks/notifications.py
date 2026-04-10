from celery import Celery
import httpx
from app.config import settings

celery_app = Celery("jobswipe", broker=settings.CELERY_BROKER_URL)
celery_app.conf.task_serializer = "json"
celery_app.conf.result_backend = settings.REDIS_URL


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_match_email(self, worker_email: str, employer_email: str, job_title: str):
    """Send match notification emails to both parties via Resend."""
    if not settings.RESEND_API_KEY:
        return  # Skip if not configured

    for recipient, role in [(worker_email, "worker"), (employer_email, "employer")]:
        if not recipient:
            continue
        body = (
            f"Congratulations! You matched for '{job_title}'. "
            f"{'The employer will be in touch.' if role == 'worker' else 'The worker is interested!'} "
            f"Log in to JobSwipe to view the match."
        )
        try:
            resp = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={
                    "from": settings.EMAIL_FROM,
                    "to": [recipient],
                    "subject": f"JobSwipe Match: {job_title}",
                    "text": body,
                },
                timeout=10,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise self.retry(exc=exc)
            # 4xx = permanent error (bad email, invalid API key, etc.)
            # Log and drop — retrying won't help.
            import logging
            logging.getLogger(__name__).warning(
                "Resend %d for %s: %s", exc.response.status_code, recipient, exc.response.text[:200]
            )
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            raise self.retry(exc=exc)


@celery_app.task
def send_daily_digest():
    """Placeholder for daily digest — query DB and send summary emails."""
    pass
