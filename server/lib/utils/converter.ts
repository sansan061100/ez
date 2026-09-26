import { ErrNumberInvalid } from '../errs/index';
import { subString } from './strings';

const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;
const int32Min = -(2 ** 31);
const int32Max = 2 ** 31 - 1;

// NumberFormatError mimics go strconv.NumError
export class NumberFormatError extends Error {
    public constructor(func: string, num: string, reason: string) {
        super(`strconv.${func}: parsing ${JSON.stringify(num)}: ${reason}`);
        this.name = 'NumberFormatError';
    }
}

function parseDecimalBigInt(func: string, str: string): bigint {
    if (!/^[+-]?\d+$/.test(str)) {
        throw new NumberFormatError(func, str, 'invalid syntax');
    }

    return BigInt(str);
}

export function intToString(num: number): string {
    return String(Math.trunc(num));
}

// stringToInt behaves like go strconv.Atoi (64-bit int)
export function stringToInt(str: string): number {
    const value = parseDecimalBigInt('Atoi', str);

    if (value < int64Min || value > int64Max) {
        throw new NumberFormatError('Atoi', str, 'value out of range');
    }

    return Number(value);
}

export function stringTryToInt(str: string, defaultValue: number): number {
    try {
        return stringToInt(str);
    } catch {
        return defaultValue;
    }
}

export function stringToInt32(str: string): number {
    const value = parseDecimalBigInt('ParseInt', str);

    if (value < BigInt(int32Min) || value > BigInt(int32Max)) {
        throw new NumberFormatError('ParseInt', str, 'value out of range');
    }

    return Number(value);
}

export function int64ToString(num: bigint | number): string {
    return typeof num === 'bigint' ? num.toString() : String(Math.trunc(num));
}

export function int64ArrayToStringArray(nums: (bigint | number)[]): string[] {
    return nums.map(n => int64ToString(n));
}

// stringToInt64 parses a decimal string to bigint (int64 range)
export function stringToInt64(str: string): bigint {
    const value = parseDecimalBigInt('ParseInt', str);

    if (value < int64Min || value > int64Max) {
        throw new NumberFormatError('ParseInt', str, 'value out of range');
    }

    return value;
}

// stringToInt64Number parses a decimal string to a javascript number (for amounts and times)
export function stringToInt64Number(str: string): number {
    return Number(stringToInt64(str));
}

export function stringArrayToInt64Array(strs: string[]): bigint[] {
    return strs.map(s => stringToInt64(s));
}

export function stringTryToInt64(str: string, defaultValue: bigint): bigint {
    try {
        return stringToInt64(str);
    } catch {
        return defaultValue;
    }
}

// float64ToString behaves like strconv.FormatFloat(num, 'f', -1, 64)
export function float64ToString(num: number): string {
    const str = String(num);
    return /e/i.test(str) && Number.isFinite(num) ? toPlainDecimalString(num) : str;
}

function toPlainDecimalString(num: number): string {
    const str = String(num);

    if (!/e/i.test(str)) {
        return str;
    }

    const [mantissa, exponentStr] = str.toLowerCase().split('e') as [string, string];
    const exponent = parseInt(exponentStr, 10);
    const negative = mantissa.startsWith('-');
    const digits = mantissa.replace('-', '').replace('.', '');
    const pointIndex = (mantissa.replace('-', '').indexOf('.') >= 0 ? mantissa.replace('-', '').indexOf('.') : mantissa.replace('-', '').length) + exponent;
    let result: string;

    if (pointIndex <= 0) {
        result = '0.' + '0'.repeat(-pointIndex) + digits;
    } else if (pointIndex >= digits.length) {
        result = digits + '0'.repeat(pointIndex - digits.length);
    } else {
        result = digits.substring(0, pointIndex) + '.' + digits.substring(pointIndex);
    }

    return (negative ? '-' : '') + result;
}

// stringToFloat64 behaves like go strconv.ParseFloat
export function stringToFloat64(str: string): number {
    const trimmed = str;

    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed) && !/^[+-]?(inf|infinity|nan)$/i.test(trimmed)) {
        throw new NumberFormatError('ParseFloat', str, 'invalid syntax');
    }

    if (/^[+-]?(inf|infinity)$/i.test(trimmed)) {
        return trimmed.startsWith('-') ? -Infinity : Infinity;
    }

    if (/^[+-]?nan$/i.test(trimmed)) {
        return NaN;
    }

    return parseFloat(trimmed);
}

export function formatAmount(value: number | bigint): string {
    return formatAmountString(int64ToString(value));
}

// parseAmount parses amount text (e.g. "123.45") to integer in cents
export function parseAmount(amount: string): number {
    if (amount.length < 1) {
        return 0;
    }

    let sign = 1;

    if (amount[0] === '-') {
        amount = amount.substring(1);
        sign = -1;
    } else if (amount[0] === '+') {
        amount = amount.substring(1);
        sign = 1;
    }

    if (amount.length < 1) {
        throw ErrNumberInvalid;
    }

    const items = amount.split('.');

    if (items.length > 2) {
        throw ErrNumberInvalid;
    }

    let integer = 0n;
    let decimals = 0n;

    if (items[0]!.length > 0) {
        integer = stringToInt64(items[0]!);

        if (integer < 0n) {
            throw ErrNumberInvalid;
        }
    }

    if (items.length === 2) {
        if (items[1]!.length > 2) {
            throw ErrNumberInvalid;
        }

        decimals = stringToInt64(items[1]!);

        if (decimals < 0n) {
            throw ErrNumberInvalid;
        }

        if (items[1]!.length === 1) {
            decimals = decimals * 10n;
        }
    }

    return Number(BigInt(sign) * integer * 100n + BigInt(sign) * decimals);
}

function formatAmountString(displayAmount: string): string {
    const negative = displayAmount[0] === '-';

    if (negative) {
        displayAmount = displayAmount.substring(1);
    }

    let integer = subString(displayAmount, 0, displayAmount.length - 2);
    let decimals = subString(displayAmount, -2, 2);

    if (integer === '') {
        integer = '0';
    }

    if (decimals.length === 0) {
        decimals = '00';
    } else if (decimals.length === 1) {
        decimals = '0' + decimals;
    }

    return (negative ? '-' : '') + integer + '.' + decimals;
}
