const utils = require('./util');

describe('wait()', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  test('should resolve after waiting for predetermined duration', async () => {
    const fn = jest.fn();
    utils.wait(100).then(fn);

    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('printFailReason()', () => {
  test('should print out proper message', () => {
    const pullNumber = 1111;
    const failReason = 'something went wrong';
    utils.printFailReason(pullNumber, failReason);
    expect(console.info).toHaveBeenLastCalledWith(
      'LOG >',
      `Won't update #${pullNumber}, the reason:\n      > ${failReason}`,
    );
  });
});

describe('log()', () => {
  test('should print out proper message', () => {
    const msg = 'something went wrong';
    utils.log(msg);
    expect(console.info).toHaveBeenLastCalledWith('LOG >', msg);
  });
});

describe('isStringTrue()', () => {
  const isStringTrue = utils.isStringTrue;
  test('should return the correct value based on the string', () => {
    expect(isStringTrue('true')).toBe(true);
    expect(isStringTrue('True')).toBe(true);
    expect(isStringTrue('TRUE')).toBe(true);
    expect(isStringTrue('tRue')).toBe(true);
    expect(isStringTrue('false')).toBe(false);
    expect(isStringTrue('False')).toBe(false);
    expect(isStringTrue('FALSE')).toBe(false);
    expect(isStringTrue('fAlse')).toBe(false);
  });

  test('should return false if the string is not a boolean', () => {
    expect(isStringTrue('something')).toBe(false);
    expect(isStringTrue()).toBe(false);
  });
});

describe('isStringFalse()', () => {
  const isStringFalse = utils.isStringFalse;
  test('should return the correct value based on the string', () => {
    expect(isStringFalse('false')).toBe(true);
    expect(isStringFalse('False')).toBe(true);
    expect(isStringFalse('FALSE')).toBe(true);
    expect(isStringFalse('fAlse')).toBe(true);
    expect(isStringFalse('true')).toBe(false);
    expect(isStringFalse('True')).toBe(false);
    expect(isStringFalse('TRUE')).toBe(false);
  });

  test('should return false if the string is not a boolean', () => {
    expect(isStringFalse('something')).toBe(false);
    expect(isStringFalse()).toBe(false);
  });

  test('should coerce non-string inputs', () => {
    expect(isStringFalse(false)).toBe(true);
    expect(isStringFalse(true)).toBe(false);
  });
});
