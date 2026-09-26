/**
 * Tegenhanger van `sealed class NetworkResult<T>` uit de Android-app.
 * Onderscheid tussen `error` (definitief, niet opnieuw proberen) en
 * `networkError` (transiënt, kandidaat voor retry) is wat de retry-laag stuurt.
 *
 * @typedef {{ kind: 'success', data: any }} Success
 * @typedef {{ kind: 'error', message: string, cause?: unknown }} Failure
 * @typedef {{ kind: 'networkError', message: string, cause?: unknown }} TransientFailure
 * @typedef {Success | Failure | TransientFailure} NetworkResult
 */

export const Result = {
  /** @returns {Success} */
  success(data) {
    return { kind: 'success', data };
  },
  /** @returns {Failure} */
  error(message, cause) {
    return { kind: 'error', message, cause };
  },
  /** @returns {TransientFailure} */
  networkError(message, cause) {
    return { kind: 'networkError', message, cause };
  },
  isSuccess(result) {
    return result.kind === 'success';
  },
  isRetryable(result) {
    return result.kind === 'networkError';
  },
  message(result) {
    return result.kind === 'success' ? 'success' : result.message;
  },
};
