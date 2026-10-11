/** A failure the caller can act on: a stable code plus a message in the user's language. */
export class FlowtError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FlowtError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new FlowtError(code, message);
}

/** A failure in RFC 6749 form. `redirect` is set when the client may be told about it. */
export class OAuthError extends Error {
  constructor(error, description, status = 400, redirect = null) {
    super(description);
    this.name = 'OAuthError';
    this.error = error;
    this.status = status;
    this.redirect = redirect;
  }

  body() {
    return { error: this.error, error_description: this.message };
  }
}
