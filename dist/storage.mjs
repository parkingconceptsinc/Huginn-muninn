import {normalizeCamera, MAX_CAMERAS} from './core.mjs';
export function storageKey(location = globalThis.location) {
  const scope = location ? new URL('./', location.href).href : 'test';
  return `huginn-muninn:${scope}:v1`;
}
export const defaults = {autoConnect:true,pauseHidden:true,layout:'grid',theme:'dark'};
export function readState(storage = localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(storageKey()) || '{}');
    const cameras = (Array.isArray(raw.cameras) ? raw.cameras : []).slice(0, MAX_CAMERAS).flatMap(c => {
      try { return [normalizeCamera(c)]; } catch { return []; }
    });
    const unique = [...new Map(cameras.map(c => [c.id,c])).values()];
    const settings = {...defaults};
    for (const key of ['autoConnect','pauseHidden']) if (typeof raw.settings?.[key] === 'boolean') settings[key] = raw.settings[key];
    if (['grid','focus'].includes(raw.settings?.layout)) settings.layout = raw.settings.layout;
    if (['dark','light'].includes(raw.settings?.theme)) settings.theme = raw.settings.theme;
    return {cameras:unique,settings};
  } catch { return {cameras:[],settings:{...defaults},storageError:true}; }
}
export function writeState(state, storage = localStorage) {
  // Explicit projection: bearer tokens and runtime media state never reach disk.
  storage.setItem(storageKey(), JSON.stringify({cameras:state.cameras.map(c => normalizeCamera(c)),settings:state.settings}));
}
