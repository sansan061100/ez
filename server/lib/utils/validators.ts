const usernamePattern = /^[a-z0-9_-]+$/i;
const emailPattern = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/i;
const hexRGBColorPattern = /^([0-9a-f]{6}|[0-9a-f]{3})$/i;
const longDateTimePattern = /^([1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[01]) ([0-1][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/;
const longDateTimeWithoutSecondPattern = /^([1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[01]) ([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
const longDatePattern = /^([1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|1[0-9]|2[0-9]|3[01])$/;
const longOrShortYearMonthDayDatePattern = /^(([1-9][0-9])?[0-9]{2})[-/.']([1-9]|0[1-9]|1[0-2])[-/.']([1-9]|0[1-9]|1[0-9]|2[0-9]|3[01])$/;
const longOrShortMonthDayYearDatePattern = /^([1-9]|0[1-9]|1[0-2])[-/.']([1-9]|0[1-9]|1[0-9]|2[0-9]|3[01])[-/.'](([1-9][0-9])?[0-9]{2})$/;
const longOrShortDayMonthYearDatePattern = /^([1-9]|0[1-9]|1[0-9]|2[0-9]|3[01])[-/.']([1-9]|0[1-9]|1[0-2])[-/.'](([1-9][0-9])?[0-9]{2})$/;

// byteLength returns the utf-8 byte length (go len(string))
export function byteLength(s: string): number {
    return Buffer.byteLength(s, 'utf8');
}

export function isValidUsername(username: string): boolean {
    return byteLength(username) <= 32 && usernamePattern.test(username);
}

export function isValidEmail(email: string): boolean {
    return byteLength(email) <= 100 && emailPattern.test(email);
}

export function isValidNickName(nickname: string): boolean {
    return byteLength(nickname) <= 64;
}

export function isValidHexRGBColor(color: string): boolean {
    return hexRGBColorPattern.test(color);
}

export function isValidLongDateTimeFormat(datetime: string): boolean {
    return longDateTimePattern.test(datetime);
}

export function isValidLongDateTimeWithoutSecondFormat(datetime: string): boolean {
    return longDateTimeWithoutSecondPattern.test(datetime);
}

export function isValidLongDateFormat(date: string): boolean {
    return longDatePattern.test(date);
}

export function isValidYearMonthDayLongOrShortDateFormat(date: string): boolean {
    return longOrShortYearMonthDayDatePattern.test(date);
}

export function isValidMonthDayYearLongOrShortDateFormat(date: string): boolean {
    return longOrShortMonthDayYearDatePattern.test(date);
}

export function isValidDayMonthYearLongOrShortDateFormat(date: string): boolean {
    return longOrShortDayMonthYearDatePattern.test(date);
}
