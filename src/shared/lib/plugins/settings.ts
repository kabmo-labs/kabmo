/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wire contract for a plugin's declared settings.
 *
 * Shared by the server that masks a stored secret and the browser that renders
 * the form, so the marker cannot drift between the two: a client that compared
 * against a different string would send the mask back as the new value and
 * overwrite the credential it was trying to preserve.
 */

/**
 * What the server substitutes for a stored secret.
 *
 * A secret's value never leaves the server, so the settings form is told only
 * that one exists. The marker is what the form recognises as "unchanged" — it
 * is never written back.
 */
export const PLUGIN_SECRET_MASK = '••••••••';
