/** Game-level error mapped to an HTTP status by the app error handler. */
export class GameError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GameError";
  }
}
