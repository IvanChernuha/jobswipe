from supabase import create_client, Client
from app.config import settings

_client: Client | None = None


def get_client() -> Client:
    """Return a service-role Supabase client for data operations (bypasses RLS)."""
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    return _client


def get_auth_client() -> Client:
    """Return a fresh Supabase client for auth operations (sign_up/sign_in).

    This must NOT reuse the singleton — auth methods mutate the client's
    internal session, which would override the service-role JWT and break
    RLS bypass on subsequent data queries.
    """
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
