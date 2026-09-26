import { randomInt } from 'node:crypto';

const numberPattern = /(-?\d+)(\.\d+)?/;
const int64Min = -(2n ** 63n);
const int64Max = 2n ** 63n - 1n;

export function isStringOnlyContainsDigits(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        if (str[i]! < '0' || str[i]! > '9') {
            return false;
        }
    }

    return true;
}

// addInt64 returns the sum of two integers and whether the result is safe (no overflow)
export function addInt64(left: number, right: number): [number, boolean] {
    const result = BigInt(left) + BigInt(right);

    if (result < int64Min || result > int64Max || !Number.isSafeInteger(Number(result))) {
        return [0, false];
    }

    return [Number(result), true];
}

// subtractInt64 returns the difference of two integers and whether the result is safe (no overflow)
export function subtractInt64(left: number, right: number): [number, boolean] {
    const result = BigInt(left) - BigInt(right);

    if (result < int64Min || result > int64Max || !Number.isSafeInteger(Number(result))) {
        return [0, false];
    }

    return [Number(result), true];
}

export function getRandomInteger(max: number): number {
    return randomInt(max);
}

export function parseFirstConsecutiveNumber(str: string): [string, boolean] {
    const result = numberPattern.exec(str);

    if (result) {
        return [result[0], true];
    }

    return ['', false];
}

export function trimTrailingZerosInDecimal(num: string): string {
    if (num.length < 1) {
        return num;
    }

    const dotPosition = num.indexOf('.');

    if (dotPosition < 0) {
        return num;
    }

    let lastNonZeroPosition = num.length;

    for (let i = num.length - 1; i > dotPosition + 1; i--) {
        if (num[i] === '0') {
            lastNonZeroPosition = i;
        } else {
            break;
        }
    }

    if (lastNonZeroPosition >= num.length) {
        return num;
    }

    return num.substring(0, lastNonZeroPosition);
}
