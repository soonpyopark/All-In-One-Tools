/**
 * Late-bound handles that main.js fills in at startup, so API modules can use
 * OS integration without importing Electron themselves.
 *
 * @typedef {{
 *   autoLaunch: {
 *     supported: boolean,
 *     get: () => boolean,
 *     set: (enabled: boolean) => void,
 *   } | null,
 *   isDev: boolean,
 *   stateRoot: string,
 *   portable: boolean,
 * }} Runtime
 */

/** @type {Runtime} */
export const runtime = {
  autoLaunch: null,
  isDev: false,
  stateRoot: '',
  portable: false,
};
