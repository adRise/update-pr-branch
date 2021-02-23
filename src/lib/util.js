export const log = console.info.bind(null, 'LOG >');
export const printFailReason = (pullNumber, reason) =>
  log(`Won't update #${pullNumber}, the reason:\n      > ${reason}`);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
