/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether omp's local speech command can run on this install.
 *
 * Shared because the settings page, the settings route and the synthesis
 * dispatch all quote the same fact, and a second spelling is how one surface
 * says "available" while another refuses the request.
 */
export interface TtsLocalCapability {
  available: boolean;
  reason?: string;
}
