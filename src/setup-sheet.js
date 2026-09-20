import { SheetStore } from './sheets.js';

const store = new SheetStore();
await store.ensureSchema();
console.log('Google Sheet tabs and headers are ready.');
