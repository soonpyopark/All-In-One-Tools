import path from 'node:path';

/**
 * Process-wide paths, set once by main.js before any service is used.
 *
 * @typedef {{
 *   isDev: boolean,
 *   projectRoot: string,
 *   distDir: string,
 *   stateRoot: string,
 *   portable: boolean,
 * }} AppContext
 */

/** @type {AppContext | null} */
let context = null;

/** @param {AppContext} value */
export function setAppContext(value) {
  context = value;
}

/** @returns {AppContext} */
export function getAppContext() {
  if (!context) throw new Error('App context is not initialised yet.');
  return context;
}

/** 설정·런처·알람 등 가변 데이터가 들어가는 폴더. */
export function getStateRoot() {
  return getAppContext().stateRoot;
}

/** @param {...string} segments */
export function statePath(...segments) {
  return path.join(getStateRoot(), ...segments);
}
