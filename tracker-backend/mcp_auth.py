"""OAuth 2.1 authorization server for the Flowt MCP connector.

An MCP client registers itself, sends the user to Flowt's consent screen and
exchanges the resulting code for tokens, so nobody copies a secret by hand.
The user proves who they are with their Flowt (Firebase) session on that
screen; this module never sees a password. Codes and tokens are opaque random
strings stored only as SHA-256 digests, bound to one client and to this server.

Implements what the MCP authorization spec asks of a server: protected resource
metadata (RFC 9728), authorization server metadata (RFC 8414), dynamic client
registration (RFC 7591), PKCE with S256, resource indicators (RFC 8707),
rotating refresh tokens and revocation (RFC 7009).
"""
import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

from firebase_admin import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

SCOPE_READ, SCOPE_WRITE = "flowt:read", "flowt:write"
SCOPES = (SCOPE_READ, SCOPE_WRITE)
ACCESS_TTL = timedelta(hours=1)
REFRESH_TTL = timedelta(days=90)
CODE_TTL = timedelta(minutes=5)
UNUSED_CLIENT_TTL = timedelta(days=30)
# A client that retries a refresh after a lost response must not lose its connection.
REFRESH_GRACE = timedelta(seconds=60)
AUTH_METHODS = ("none", "client_secret_post", "client_secret_basic")
LOOPBACK = {"localhost", "127.0.0.1", "[::1]", "::1"}
BLOCKED_SCHEMES = {"javascript", "data", "vbscript", "file", "blob", "about", "ftp", "ws", "wss"}
NOW = firestore.SERVER_TIMESTAMP


class OAuthError(Exception):
    """An error in RFC 6749 form. `redirect` is set when the client may be told about it."""

    def __init__(self, error, description, status=400, redirect=None):
        super().__init__(description)
        self.error, self.description, self.status, self.redirect = error, description, status, redirect

    def body(self):
        return {"error": self.error, "error_description": self.description}


class Settings:
    def __init__(self, base_url, consent_url):
        self.issuer = base_url.rstrip("/")
        self.resource = self.issuer + "/mcp"
        self.consent_url = consent_url

    @classmethod
    def from_env(cls):
        base, consent = os.getenv("FLOWT_PUBLIC_BASE_URL", "").strip(), os.getenv("FLOWT_CONSENT_URL", "").strip()
        return cls(base, consent) if base and consent else None


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def now():
    return datetime.now(timezone.utc)


def valid_redirect(uri):
    """HTTPS, loopback HTTP, or a native app's private scheme (RFC 8252). Never script-like schemes."""
    if not isinstance(uri, str) or not 0 < len(uri) <= 2000 or re.search(r"[\x00-\x20]", uri):
        return False
    parts = urlsplit(uri)
    scheme = parts.scheme.lower()
    if parts.fragment or not re.fullmatch(r"[a-z][a-z0-9+.\-]*", scheme) or scheme in BLOCKED_SCHEMES:
        return False
    if scheme == "https":
        return bool(parts.hostname)
    if scheme == "http":
        return parts.hostname in LOOPBACK
    return True


def same_redirect(requested, registered):
    if requested == registered:
        return True
    a, b = urlsplit(requested), urlsplit(registered)
    # Native clients listen on an ephemeral loopback port, so the port is not compared.
    return (a.scheme == b.scheme == "http" and a.hostname in LOOPBACK and a.hostname == b.hostname
            and a.path == b.path and a.query == b.query)


def with_query(uri, **params):
    return uri + ("&" if urlsplit(uri).query else "?") + urlencode({k: v for k, v in params.items() if v is not None})


class AuthorizationServer:
    def __init__(self, db, settings):
        self.db, self.settings = db, settings

    def _atomic(self, operation):
        return firestore.transactional(operation)(self.db.transaction())

    def _ref(self, collection, key):
        return self.db.collection(collection).document(key)

    # --- Discovery ----------------------------------------------------------

    def resource_metadata(self):
        return {"resource": self.settings.resource, "authorization_servers": [self.settings.issuer],
                "scopes_supported": list(SCOPES), "bearer_methods_supported": ["header"], "resource_name": "Flowt"}

    def metadata(self):
        issuer = self.settings.issuer
        return {"issuer": issuer, "authorization_endpoint": self.settings.consent_url,
                "token_endpoint": issuer + "/oauth/token", "registration_endpoint": issuer + "/oauth/register",
                "revocation_endpoint": issuer + "/oauth/revoke", "scopes_supported": list(SCOPES),
                "response_types_supported": ["code"], "response_modes_supported": ["query"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "code_challenge_methods_supported": ["S256"],
                "token_endpoint_auth_methods_supported": list(AUTH_METHODS),
                "revocation_endpoint_auth_methods_supported": list(AUTH_METHODS),
                "authorization_response_iss_parameter_supported": True}

    def challenge(self):
        """Value of WWW-Authenticate that lets an MCP client start the flow on its own."""
        return f'Bearer resource_metadata="{self.settings.issuer}/.well-known/oauth-protected-resource/mcp", scope="{" ".join(SCOPES)}"'

    # --- Dynamic client registration ----------------------------------------

    def register(self, payload):
        if not isinstance(payload, dict):
            raise OAuthError("invalid_client_metadata", "Se esperaba un objeto JSON")
        redirects = payload.get("redirect_uris")
        if not isinstance(redirects, list) or not 1 <= len(redirects) <= 10 or not all(valid_redirect(u) for u in redirects):
            raise OAuthError("invalid_redirect_uri", "redirect_uris debe contener URL https, de loopback o de app nativa")
        method = payload.get("token_endpoint_auth_method", "none")
        grants = payload.get("grant_types", ["authorization_code", "refresh_token"])
        if method not in AUTH_METHODS or not isinstance(grants, list) or "authorization_code" not in grants \
                or set(grants) - {"authorization_code", "refresh_token"} or payload.get("response_types", ["code"]) != ["code"]:
            raise OAuthError("invalid_client_metadata", "Solo se admite el flujo authorization_code con PKCE")
        name = payload.get("client_name")
        name = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", name).strip()[:80] if isinstance(name, str) else ""
        client_id = "flowt-" + secrets.token_urlsafe(18)
        client = {"client_name": name or "Cliente MCP", "redirect_uris": redirects, "token_endpoint_auth_method": method,
                  "grant_types": grants, "created_at": NOW, "expires_at": now() + UNUSED_CLIENT_TTL}
        response = {"client_id": client_id, "client_id_issued_at": int(now().timestamp()), "client_name": client["client_name"],
                    "redirect_uris": redirects, "token_endpoint_auth_method": method, "grant_types": grants,
                    "response_types": ["code"]}
        if method != "none":
            secret = "flowt_cs_" + secrets.token_urlsafe(32)
            client["secret_digest"] = digest(secret)
            response.update({"client_secret": secret, "client_secret_expires_at": 0})
        self._ref("oauth_clients", client_id).set(client)
        return response

    def _client(self, client_id):
        if not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", client_id):
            return None
        snapshot = self._ref("oauth_clients", client_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def _authenticated_client(self, form, basic):
        """Identify the client at the token endpoint, checking its secret when it has one."""
        client_id, secret = form.get("client_id"), form.get("client_secret")
        if basic:
            client_id, secret = basic
        client = self._client(client_id)
        if not client:
            raise OAuthError("invalid_client", "Cliente desconocido", 401)
        if client["token_endpoint_auth_method"] != "none":
            if not isinstance(secret, str) or not hmac.compare_digest(digest(secret), client.get("secret_digest", "")):
                raise OAuthError("invalid_client", "Credenciales de cliente no válidas", 401)
        return client_id, client

    # --- Authorization request (driven by the consent screen) ---------------

    def _request(self, params):
        """Validate an authorization request exactly as received by the consent screen."""
        if not isinstance(params, dict) or not all(isinstance(v, str) for v in params.values()):
            raise OAuthError("invalid_request", "Petición de autorización no válida")
        client = self._client(params.get("client_id"))
        if not client:
            raise OAuthError("invalid_client", "Esta aplicación no está registrada en Flowt. Vuelve a conectarla desde el principio.")
        redirect = params.get("redirect_uri") or (client["redirect_uris"][0] if len(client["redirect_uris"]) == 1 else None)
        if not redirect or not valid_redirect(redirect) or not any(same_redirect(redirect, r) for r in client["redirect_uris"]):
            raise OAuthError("invalid_request", "La dirección de retorno no coincide con la registrada por la aplicación.")
        state = params.get("state")

        def reject(error, description):
            raise OAuthError(error, description, redirect=with_query(redirect, error=error, error_description=description,
                                                                     state=state, iss=self.settings.issuer))
        if state is not None and len(state) > 2000:
            state = None
            reject("invalid_request", "state demasiado largo")
        if params.get("response_type") != "code":
            reject("unsupported_response_type", "Solo se admite response_type=code")
        challenge = params.get("code_challenge", "")
        if params.get("code_challenge_method") != "S256" or not re.fullmatch(r"[A-Za-z0-9_\-]{43,128}", challenge):
            reject("invalid_request", "Se requiere PKCE con S256")
        resource = params.get("resource")
        if resource is not None and resource.rstrip("/") not in (self.settings.resource, self.settings.issuer):
            reject("invalid_target", "El recurso solicitado no es este servidor")
        requested = [s for s in params.get("scope", "").split() if s in SCOPES]
        return {"client_id": params["client_id"], "client_name": client["client_name"], "redirect_uri": redirect,
                "state": state, "code_challenge": challenge, "scopes": requested or list(SCOPES)}

    def describe(self, params):
        request = self._request(params)
        target = urlsplit(request["redirect_uri"])
        return {"client_name": request["client_name"], "scopes": request["scopes"],
                "redirect_host": target.hostname or target.scheme + ":", "local": target.hostname in LOOPBACK}

    def decide(self, owner, params, approve, write=True):
        """The signed-in user's answer. Returns the URL that takes them back to the client."""
        request = self._request(params)
        back = dict(state=request["state"], iss=self.settings.issuer)
        if not approve:
            return with_query(request["redirect_uri"], error="access_denied", **back)
        scopes = [s for s in request["scopes"] if s != SCOPE_WRITE or write]
        if SCOPE_READ not in scopes:
            scopes.insert(0, SCOPE_READ)
        code = "flowt_ac_" + secrets.token_urlsafe(32)
        self._ref("oauth_codes", digest(code)).set({
            "id_propietario": owner, "client_id": request["client_id"], "client_name": request["client_name"],
            "redirect_uri": request["redirect_uri"], "code_challenge": request["code_challenge"], "scopes": scopes,
            "used": False, "created_at": NOW, "expires_at": now() + CODE_TTL})
        return with_query(request["redirect_uri"], code=code, **back)

    # --- Token endpoint -----------------------------------------------------

    def _issue(self, tx, owner, client_id, grant_id, scopes):
        access, refresh = "flowt_at_" + secrets.token_urlsafe(32), "flowt_rt_" + secrets.token_urlsafe(32)
        base = {"id_propietario": owner, "client_id": client_id, "grant_id": grant_id, "scopes": scopes,
                "resource": self.settings.resource, "created_at": NOW}
        tx.set(self._ref("oauth_tokens", digest(access)), {**base, "kind": "access", "expires_at": now() + ACCESS_TTL})
        tx.set(self._ref("oauth_tokens", digest(refresh)), {**base, "kind": "refresh", "expires_at": now() + REFRESH_TTL})
        return {"access_token": access, "token_type": "Bearer", "expires_in": int(ACCESS_TTL.total_seconds()),
                "refresh_token": refresh, "scope": " ".join(scopes)}

    def _grant_tokens(self, grant_id, tx=None):
        query = self.db.collection("oauth_tokens").where(filter=FieldFilter("grant_id", "==", grant_id))
        return [snapshot.reference for snapshot in query.stream(transaction=tx)]

    def token(self, form, basic=None):
        client_id, _ = self._authenticated_client(form, basic)
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            result = self._atomic(lambda tx: self._redeem(tx, client_id, form))
        elif grant_type == "refresh_token":
            result = self._atomic(lambda tx: self._refresh(tx, client_id, form))
        else:
            raise OAuthError("unsupported_grant_type", "Solo authorization_code y refresh_token")
        if isinstance(result, OAuthError):
            raise result
        try:
            self.prune()
        except Exception:  # Housekeeping must never fail a login.
            pass
        return result

    def _redeem(self, tx, client_id, form):
        invalid = OAuthError("invalid_grant", "Código de autorización no válido o caducado")
        code, verifier = form.get("code"), form.get("code_verifier")
        if not isinstance(code, str) or not isinstance(verifier, str) or not re.fullmatch(r"[A-Za-z0-9._~\-]{43,128}", verifier):
            return invalid
        code_ref = self._ref("oauth_codes", digest(code))
        snapshot = code_ref.get(transaction=tx)
        stored = snapshot.to_dict() if snapshot.exists else None
        if not stored or stored.get("client_id") != client_id:
            return invalid
        if stored.get("used"):
            # A code presented twice was probably intercepted: drop everything it produced.
            if stored.get("grant_id"):
                for ref in self._grant_tokens(stored["grant_id"], tx):
                    tx.delete(ref)
                tx.delete(self._ref("oauth_grants", stored["grant_id"]))
            return invalid
        expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        redirect = form.get("redirect_uri")
        if (stored["expires_at"] <= now() or not hmac.compare_digest(expected, stored["code_challenge"])
                or (redirect is not None and redirect != stored["redirect_uri"])):
            return invalid
        resource = form.get("resource")
        if resource is not None and resource.rstrip("/") not in (self.settings.resource, self.settings.issuer):
            return OAuthError("invalid_target", "El recurso solicitado no es este servidor")
        grant_id = secrets.token_urlsafe(18)
        tx.set(self._ref("oauth_grants", grant_id), {
            "id_propietario": stored["id_propietario"], "client_id": client_id, "client_name": stored.get("client_name"),
            "scopes": stored["scopes"], "redirect_host": urlsplit(stored["redirect_uri"]).hostname,
            "created_at": NOW, "last_used_at": NOW})
        tx.update(code_ref, {"used": True, "grant_id": grant_id})
        tx.update(self._ref("oauth_clients", client_id), {"expires_at": firestore.DELETE_FIELD})
        return self._issue(tx, stored["id_propietario"], client_id, grant_id, stored["scopes"])

    def _refresh(self, tx, client_id, form):
        invalid = OAuthError("invalid_grant", "Token de renovación no válido o caducado")
        token = form.get("refresh_token")
        if not isinstance(token, str):
            return invalid
        token_ref = self._ref("oauth_tokens", digest(token))
        snapshot = token_ref.get(transaction=tx)
        stored = snapshot.to_dict() if snapshot.exists else None
        if not stored or stored.get("kind") != "refresh" or stored.get("client_id") != client_id or stored["expires_at"] <= now():
            return invalid
        grant_ref = self._ref("oauth_grants", stored["grant_id"])
        if not grant_ref.get(transaction=tx).exists:
            return invalid
        rotated = stored.get("rotated_at")
        if rotated and now() - rotated > REFRESH_GRACE:
            # An old refresh token long after its rotation means it leaked: end the connection.
            for ref in self._grant_tokens(stored["grant_id"], tx):
                tx.delete(ref)
            tx.delete(grant_ref)
            return invalid
        scopes = stored["scopes"]
        if form.get("scope"):
            scopes = [s for s in scopes if s in form["scope"].split()] or scopes
        if not rotated:
            tx.update(token_ref, {"rotated_at": now(), "expires_at": now() + timedelta(days=1)})
        tx.update(grant_ref, {"last_used_at": NOW})
        return self._issue(tx, stored["id_propietario"], client_id, stored["grant_id"], scopes)

    def prune(self, limit=100):
        """Delete expired tokens, codes, never-used clients and idempotency records."""
        removed = 0
        for collection in ("oauth_tokens", "oauth_codes", "oauth_clients", "mcp_operations"):
            query = self.db.collection(collection).where(filter=FieldFilter("expires_at", "<", now())).limit(limit)
            for snapshot in query.stream():
                snapshot.reference.delete()
                removed += 1
        return removed

    def revoke(self, form, basic=None):
        """RFC 7009: revoking any token of a connection ends that connection."""
        client_id, _ = self._authenticated_client(form, basic)
        token = form.get("token")
        if not isinstance(token, str):
            return
        snapshot = self._ref("oauth_tokens", digest(token)).get()
        if snapshot.exists and snapshot.to_dict().get("client_id") == client_id:
            self._end(snapshot.to_dict()["grant_id"])

    def _end(self, grant_id):
        for ref in self._grant_tokens(grant_id):
            ref.delete()
        self._ref("oauth_grants", grant_id).delete()

    # --- Resource server ----------------------------------------------------

    def authenticate(self, token):
        """(owner, scopes) for a live access token issued for this server, else None."""
        if not token.startswith("flowt_at_"):
            return None
        snapshot = self._ref("oauth_tokens", digest(token)).get()
        stored = snapshot.to_dict() if snapshot.exists else None
        if (not stored or stored.get("kind") != "access" or stored["expires_at"] <= now()
                or stored.get("resource") != self.settings.resource):
            return None
        return stored["id_propietario"], frozenset(stored["scopes"])

    # --- The user's connections (settings screen) ---------------------------

    def connections(self, owner):
        query = self.db.collection("oauth_grants").where(filter=FieldFilter("id_propietario", "==", owner))
        rows = [{"id": s.id, **{k: v for k, v in s.to_dict().items() if k != "id_propietario"}} for s in query.stream()]
        return sorted(rows, key=lambda row: row.get("created_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    def disconnect(self, owner, grant_id):
        if not isinstance(grant_id, str) or not re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", grant_id):
            return False
        snapshot = self._ref("oauth_grants", grant_id).get()
        if not snapshot.exists or snapshot.to_dict().get("id_propietario") != owner:
            return False
        self._end(grant_id)
        return True
