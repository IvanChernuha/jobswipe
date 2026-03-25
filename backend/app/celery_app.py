"""Celery application entry point — imports all task modules."""
from app.tasks.notifications import celery_app  # noqa: F401
import app.tasks.cv_processing  # noqa: F401
