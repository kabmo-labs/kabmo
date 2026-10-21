/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reject a promise that has not settled within `ms`.
 *
 * Both server-side dispatchers (a scheduled task, a prompt held until another
 * session finishes) wait on a spawn and then on a prompt ack, and neither has a
 * timeout of its own: an omp child that boots but never answers would leave the
 * dispatch in flight for the life of the process. The caller owns the message,
 * because it is the only place that knows what was being waited for.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  const { promise: guarded, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new Error(message)), ms);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
  );
  return guarded;
}
