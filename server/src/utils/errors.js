/**
 * Human-readable API errors. Route handlers throw these; the error middleware
 * turns them into `{ error: { code, message } }` responses. Internal causes are
 * logged server-side, never sent to the client.
 */
export class ApiError extends Error {
  /**
   * @param {string} code stable machine code, e.g. `UNSUPPORTED_FORMAT`
   * @param {string} message short, human message meant for the UI
   * @param {number} status HTTP status
   * @param {{ cause?: Error }} [opts] server-side context, never sent to clients
   */
  constructor(code, message, status = 400, opts = {}) {
    super(message, { cause: opts.cause })
    this.code = code
    this.status = status
  }
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found`, 404)
export const unauthorized = (msg = 'Pair with this library before sending music.') =>
  new ApiError('UNAUTHENTICATED', msg, 401)
export const forbidden = (msg = 'You do not have access to this library.') =>
  new ApiError('FORBIDDEN', msg, 403)
