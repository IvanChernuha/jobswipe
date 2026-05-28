"""Supabase client — used ONLY for Auth and Storage.

All data queries go through SQLModel/asyncpg (see session.py).
"""
from supabase import create_client, Client
from app.config import settings

_client: Client | None = None


def get_supabase_client() -> Client:
    """Return a service-role Supabase client for Storage operations."""
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    return _client


def get_auth_client() -> Client:
    """Return a fresh Supabase client for auth operations (sign_up/sign_in).

    Must NOT reuse the singleton — auth methods mutate the client's
    internal session, which would break the service-role JWT.
    """
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
