import { EventEmitter } from 'events';

declare global {
  var globalEventEmitter: EventEmitter | undefined;
}

export const realtimeEmitter = global.globalEventEmitter || new EventEmitter();

if (process.env.NODE_ENV !== 'production') {
  global.globalEventEmitter = realtimeEmitter;
}
