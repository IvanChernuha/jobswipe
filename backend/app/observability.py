import logging

import sentry_sdk

from app.config import settings

logger = logging.getLogger(__name__)


def init_observability() -> None:
    """Configure logging and (optionally) Sentry error tracking.

    Call once at process startup, as early as possible, so Sentry captures
    everything that follows. Safe to call when SENTRY_DSN is empty: Sentry is
    left disabled and only logging is configured, so local/dev runs need no
    Sentry project. Once a DSN is set (via the k8s Secret in prod) every
    unhandled exception in a request handler — plus any ERROR-level log — is
    reported automatically by the auto-enabled FastAPI/logging integrations.
    """
    # Single-line stdout logging. GKE ships stdout to Cloud Logging, so a
    # consistent format is all we need; no file handlers.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if not settings.SENTRY_DSN:
        logger.info("Sentry disabled (SENTRY_DSN empty) — errors logged locally only")
        return

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=settings.RELEASE or None,
        # Keep PII (emails, request bodies, cookies, client IP) out of events.
        # Sentry is an external processor, and this app is GDPR-scoped.
        send_default_pii=False,
        # Performance tracing off by default (0.0) to stay within the free tier;
        # raise SENTRY_TRACES_SAMPLE_RATE later to sample transactions.
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
    )
    logger.info("Sentry enabled (environment=%s)", settings.ENVIRONMENT)
