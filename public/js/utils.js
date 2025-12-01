export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sum = arr => arr.reduce((a, b) => a + b, 0);