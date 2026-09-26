import { DateTime, FixedOffsetZone, type Zone } from 'luxon';

// Parsing and formatting date time by go time layout (e.g. "2006-01-02 15:04:05")

const longMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortMonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const shortDayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Token =
    | { kind: 'literal'; value: string }
    | { kind: 'std'; value: string };

const stdTokens = [
    'January', 'Jan', 'Monday', 'Mon', 'MST',
    '-07:00:00', '-0700', '-07:00', '-070000', '-07',
    'Z07:00:00', 'Z0700', 'Z07:00', 'Z070000', 'Z07',
    '2006', '002', '01', '02', '03', '04', '05', '06', '_2', '15', 'PM', 'pm',
    '1', '2', '3', '4', '5',
];

const layoutCache = new Map<string, Token[]>();

// tokenize splits the go layout to tokens (same as go time.nextStdChunk)
function tokenize(layout: string): Token[] {
    const cached = layoutCache.get(layout);

    if (cached) {
        return cached;
    }

    const tokens: Token[] = [];
    let literal = '';
    let i = 0;

    while (i < layout.length) {
        let matched = '';
        const ch = layout[i] as string;

        // fractional seconds: .000 / ,000 / .999 / ,999
        if ((ch === '.' || ch === ',') && i + 1 < layout.length && (layout[i + 1] === '0' || layout[i + 1] === '9')) {
            const digit = layout[i + 1] as string;
            let j = i + 1;

            while (j < layout.length && layout[j] === digit) {
                j++;
            }

            // only a fraction if not followed by other digits
            if (j >= layout.length || !/[0-9]/.test(layout[j] as string)) {
                if (literal !== '') {
                    tokens.push({ kind: 'literal', value: literal });
                    literal = '';
                }

                tokens.push({ kind: 'std', value: layout.substring(i, j) });
                i = j;
                continue;
            }
        }

        for (const token of stdTokens) {
            if (layout.startsWith(token, i)) {
                // "Jan" and "Mon" must not be followed by lower case letter
                if ((token === 'Jan' || token === 'Mon') && i + 3 < layout.length && /[a-z]/.test(layout[i + 3] as string)) {
                    continue;
                }

                // "2006" vs "2", "01" etc. are handled by the order of tokens
                matched = token;
                break;
            }
        }

        if (matched !== '') {
            if (literal !== '') {
                tokens.push({ kind: 'literal', value: literal });
                literal = '';
            }

            tokens.push({ kind: 'std', value: matched });
            i += matched.length;
        } else {
            literal += ch;
            i++;
        }
    }

    if (literal !== '') {
        tokens.push({ kind: 'literal', value: literal });
    }

    layoutCache.set(layout, tokens);
    return tokens;
}

export class GoTimeParseError extends Error {
    public constructor(layout: string, value: string, message: string = 'cannot parse') {
        super(`parsing time ${JSON.stringify(value)} as ${JSON.stringify(layout)}: ${message}`);
        this.name = 'GoTimeParseError';
    }
}

function lookupName(names: string[], value: string, pos: number): [number, number] {
    for (let i = 0; i < names.length; i++) {
        const name = names[i] as string;

        if (value.length - pos >= name.length && value.substring(pos, pos + name.length).toLowerCase() === name.toLowerCase()) {
            return [i, pos + name.length];
        }
    }

    return [-1, pos];
}

function getNum(value: string, pos: number, fixed: boolean): [number, number] {
    if (pos >= value.length || !/[0-9]/.test(value[pos] as string)) {
        return [-1, pos];
    }

    if (pos + 1 >= value.length || !/[0-9]/.test(value[pos + 1] as string)) {
        if (fixed) {
            return [-1, pos];
        }

        return [parseInt(value[pos] as string, 10), pos + 1];
    }

    return [parseInt(value.substring(pos, pos + 2), 10), pos + 2];
}

function getNumN(value: string, pos: number, digits: number, exact: boolean): [number, number] {
    let end = pos;

    while (end < value.length && end - pos < digits && /[0-9]/.test(value[end] as string)) {
        end++;
    }

    if (end === pos || (exact && end - pos !== digits)) {
        return [-1, pos];
    }

    return [parseInt(value.substring(pos, end), 10), end];
}

function daysIn(month: number, year: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// parseGoTime parses the value by go layout, the result is in the specified location if no timezone info in value (same as go time.ParseInLocation)
export function parseGoTime(layout: string, value: string, location: Zone | null = null): DateTime {
    const tokens = tokenize(layout);
    let pos = 0;
    let year = 1;
    let month = -1;
    let day = -1;
    let yday = -1;
    let hour = 0;
    let minute = 0;
    let second = 0;
    let nanosecond = 0;
    let pmSet = false;
    let amSet = false;
    let zoneOffset: number | null = null;
    let zoneName: string | null = null;
    const fail = (message?: string): never => {
        throw new GoTimeParseError(layout, value, message);
    };

    for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t] as Token;

        if (token.kind === 'literal') {
            if (!value.startsWith(token.value, pos)) {
                fail();
            }

            pos += token.value.length;
            continue;
        }

        const std = token.value;
        let n: number;

        switch (std) {
            case '2006':
                [n, pos] = getNumN(value, pos, 4, true);
                if (n < 0) fail();
                year = n;
                break;
            case '06':
                [n, pos] = getNumN(value, pos, 2, true);
                if (n < 0) fail();
                year = n >= 69 ? n + 1900 : n + 2000;
                break;
            case 'January':
                [n, pos] = lookupName(longMonthNames, value, pos);
                if (n < 0) fail();
                month = n + 1;
                break;
            case 'Jan':
                [n, pos] = lookupName(shortMonthNames, value, pos);
                if (n < 0) fail();
                month = n + 1;
                break;
            case '01':
            case '1':
                [n, pos] = getNum(value, pos, std === '01');
                if (n < 1 || n > 12) fail('month out of range');
                month = n;
                break;
            case 'Monday':
                [n, pos] = lookupName(longDayNames, value, pos);
                if (n < 0) fail();
                break;
            case 'Mon':
                [n, pos] = lookupName(shortDayNames, value, pos);
                if (n < 0) fail();
                break;
            case '02':
            case '2':
            case '_2':
                if (std === '_2' && value[pos] === ' ') {
                    pos++;
                }

                [n, pos] = getNum(value, pos, std === '02');
                if (n < 0) fail();
                day = n;
                break;
            case '002':
                [n, pos] = getNumN(value, pos, 3, true);
                if (n < 1 || n > 366) fail('day-of-year out of range');
                yday = n;
                break;
            case '15':
                [n, pos] = getNum(value, pos, false);
                if (n < 0 || n >= 24) fail('hour out of range');
                hour = n;
                break;
            case '03':
            case '3':
                [n, pos] = getNum(value, pos, std === '03');
                if (n < 0 || n > 12) fail('hour out of range');
                hour = n;
                break;
            case '04':
            case '4':
                [n, pos] = getNum(value, pos, std === '04');
                if (n < 0 || n >= 60) fail('minute out of range');
                minute = n;
                break;
            case '05':
            case '5': {
                [n, pos] = getNum(value, pos, std === '05');
                if (n < 0 || n >= 60) fail('second out of range');
                second = n;

                // fractional second in the value even if the layout does not have it
                const nextToken = tokens[t + 1];
                const nextIsFraction = nextToken && nextToken.kind === 'std' && (nextToken.value.startsWith('.') || nextToken.value.startsWith(','));

                if (!nextIsFraction && pos + 1 < value.length && (value[pos] === '.' || value[pos] === ',') && /[0-9]/.test(value[pos + 1] as string)) {
                    let end = pos + 1;

                    while (end < value.length && /[0-9]/.test(value[end] as string)) {
                        end++;
                    }

                    nanosecond = Math.round(parseFloat('0.' + value.substring(pos + 1, end)) * 1e9);
                    pos = end;
                }

                break;
            }
            case 'PM':
            case 'pm': {
                const text = value.substring(pos, pos + 2);
                const upper = text.toUpperCase();

                if (upper === 'PM') {
                    pmSet = true;
                } else if (upper === 'AM') {
                    amSet = true;
                } else {
                    fail();
                }

                if (std === 'PM' ? text !== upper : text !== text.toLowerCase()) {
                    fail();
                }

                pos += 2;
                break;
            }
            case 'MST': {
                if (value.startsWith('UTC', pos)) {
                    zoneName = 'UTC';
                    pos += 3;
                    break;
                }

                let end = pos;

                while (end < value.length && /[A-Z]/.test(value[end] as string)) {
                    end++;
                }

                if (value.startsWith('GMT', pos)) {
                    // GMT+h or GMT-h
                    end = pos + 3;

                    if (end < value.length && (value[end] === '+' || value[end] === '-')) {
                        let numEnd = end + 1;

                        while (numEnd < value.length && /[0-9]/.test(value[numEnd] as string)) {
                            numEnd++;
                        }

                        const hours = parseInt(value.substring(end + 1, numEnd), 10);

                        if (!isNaN(hours)) {
                            zoneOffset = (value[end] === '-' ? -1 : 1) * hours * 60;
                            end = numEnd;
                        }
                    }
                }

                if (end - pos < 3) {
                    fail();
                }

                zoneName = value.substring(pos, end);
                pos = end;
                break;
            }
            default: {
                if (std.startsWith('.') || std.startsWith(',')) {
                    const digits = std.length - 1;
                    const optional = std[1] === '9';

                    if (value[pos] !== '.' && value[pos] !== ',') {
                        if (optional) {
                            break;
                        }

                        fail();
                    }

                    let end = pos + 1;

                    while (end < value.length && /[0-9]/.test(value[end] as string)) {
                        end++;
                    }

                    if (!optional && end - (pos + 1) !== digits) {
                        fail();
                    }

                    nanosecond = Math.round(parseFloat('0.' + value.substring(pos + 1, end)) * 1e9);
                    pos = end;
                    break;
                }

                // timezone offset
                if (std.startsWith('Z') && value[pos] === 'Z') {
                    zoneOffset = 0;
                    zoneName = 'UTC';
                    pos++;
                    break;
                }

                const format = std.startsWith('Z') ? '-' + std.substring(1) : std;
                const sign = value[pos];

                if (sign !== '+' && sign !== '-') {
                    fail();
                }

                let hh: string, mm = '00', ss = '00';
                const rest = value.substring(pos + 1);

                if (format === '-07:00:00') {
                    if (rest.length < 8 || rest[2] !== ':' || rest[5] !== ':') fail();
                    hh = rest.substring(0, 2); mm = rest.substring(3, 5); ss = rest.substring(6, 8);
                    pos += 9;
                } else if (format === '-07:00') {
                    if (rest.length < 5 || rest[2] !== ':') fail();
                    hh = rest.substring(0, 2); mm = rest.substring(3, 5);
                    pos += 6;
                } else if (format === '-070000') {
                    if (rest.length < 6) fail();
                    hh = rest.substring(0, 2); mm = rest.substring(2, 4); ss = rest.substring(4, 6);
                    pos += 7;
                } else if (format === '-0700') {
                    if (rest.length < 4) fail();
                    hh = rest.substring(0, 2); mm = rest.substring(2, 4);
                    pos += 5;
                } else {
                    if (rest.length < 2) fail();
                    hh = rest.substring(0, 2);
                    pos += 3;
                }

                if (!/^[0-9]{2}$/.test(hh) || !/^[0-9]{2}$/.test(mm) || !/^[0-9]{2}$/.test(ss)) {
                    fail();
                }

                const totalSeconds = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseInt(ss, 10);
                zoneOffset = (sign === '-' ? -1 : 1) * Math.round(totalSeconds / 60);
                break;
            }
        }
    }

    if (pos !== value.length) {
        fail(`extra text: ${JSON.stringify(value.substring(pos))}`);
    }

    if (pmSet && hour < 12) {
        hour += 12;
    } else if (amSet && hour === 12) {
        hour = 0;
    }

    if (yday >= 0) {
        const date = new Date(Date.UTC(year, 0, 1));
        date.setUTCDate(yday);

        if (date.getUTCFullYear() !== year) {
            fail('day-of-year out of range');
        }

        month = date.getUTCMonth() + 1;
        day = date.getUTCDate();
    }

    if (month < 0) {
        month = 1;
    }

    if (day < 0) {
        day = 1;
    }

    if (day < 1 || day > daysIn(month, year)) {
        fail('day out of range');
    }

    const values = { year, month, day, hour, minute, second, millisecond: Math.floor(nanosecond / 1e6) };

    if (zoneOffset !== null) {
        return DateTime.fromObject(values, { zone: FixedOffsetZone.instance(zoneOffset) });
    }

    if (zoneName !== null) {
        if (zoneName === 'UTC') {
            return DateTime.fromObject(values, { zone: FixedOffsetZone.utcInstance });
        }

        if (location) {
            const candidate = DateTime.fromObject(values, { zone: location });

            if (candidate.offsetNameShort === zoneName) {
                return candidate;
            }
        }

        // unknown zone abbreviation, go uses zero offset
        return DateTime.fromObject(values, { zone: FixedOffsetZone.utcInstance });
    }

    return DateTime.fromObject(values, { zone: location ?? FixedOffsetZone.utcInstance });
}

// tryParseGoTime parses the value by go layout, returns null if failed
export function tryParseGoTime(layout: string, value: string, location: Zone | null = null): DateTime | null {
    try {
        const result = parseGoTime(layout, value, location);
        return result.isValid ? result : null;
    } catch {
        return null;
    }
}

function pad(num: number, width: number, ch: string = '0'): string {
    return String(num).padStart(width, ch);
}

function formatOffset(offsetMinutes: number, withColon: boolean, withSeconds: boolean, hoursOnly: boolean): string {
    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    const hh = pad(Math.floor(abs / 60), 2);
    const mm = pad(abs % 60, 2);

    if (hoursOnly) {
        return `${sign}${hh}`;
    }

    const sep = withColon ? ':' : '';
    return `${sign}${hh}${sep}${mm}${withSeconds ? sep + '00' : ''}`;
}

// formatGoTime formats the date time by go layout (same as go time.Format)
export function formatGoTime(t: DateTime, layout: string): string {
    let result = '';

    for (const token of tokenize(layout)) {
        if (token.kind === 'literal') {
            result += token.value;
            continue;
        }

        const std = token.value;

        switch (std) {
            case '2006': result += pad(t.year, 4); break;
            case '06': result += pad(t.year % 100, 2); break;
            case 'January': result += longMonthNames[t.month - 1]; break;
            case 'Jan': result += shortMonthNames[t.month - 1]; break;
            case '01': result += pad(t.month, 2); break;
            case '1': result += String(t.month); break;
            case 'Monday': result += longDayNames[t.weekday % 7]; break;
            case 'Mon': result += shortDayNames[t.weekday % 7]; break;
            case '02': result += pad(t.day, 2); break;
            case '2': result += String(t.day); break;
            case '_2': result += pad(t.day, 2, ' '); break;
            case '002': result += pad(t.ordinal, 3); break;
            case '15': result += pad(t.hour, 2); break;
            case '03': result += pad(t.hour % 12 === 0 ? 12 : t.hour % 12, 2); break;
            case '3': result += String(t.hour % 12 === 0 ? 12 : t.hour % 12); break;
            case '04': result += pad(t.minute, 2); break;
            case '4': result += String(t.minute); break;
            case '05': result += pad(t.second, 2); break;
            case '5': result += String(t.second); break;
            case 'PM': result += t.hour >= 12 ? 'PM' : 'AM'; break;
            case 'pm': result += t.hour >= 12 ? 'pm' : 'am'; break;
            case 'MST': {
                const name = t.offsetNameShort;
                result += name && /^[A-Z]{3,5}$/.test(name) ? name : formatOffset(t.offset, false, false, false).replace(/00$/, '') ;
                break;
            }
            default: {
                if (std.startsWith('.') || std.startsWith(',')) {
                    const digits = std.length - 1;
                    let fraction = pad(t.millisecond, 3) + '000000';
                    fraction = fraction.substring(0, Math.max(digits, 0));

                    if (std[1] === '9') {
                        fraction = fraction.replace(/0+$/, '');

                        if (fraction !== '') {
                            result += std[0] + fraction;
                        }
                    } else {
                        result += std[0] + fraction;
                    }

                    break;
                }

                if (std.startsWith('Z') && t.offset === 0) {
                    result += 'Z';
                    break;
                }

                const format = std.startsWith('Z') ? '-' + std.substring(1) : std;
                result += formatOffset(t.offset, format.includes(':'), format === '-07:00:00' || format === '-070000', format === '-07');
                break;
            }
        }
    }

    return result;
}
