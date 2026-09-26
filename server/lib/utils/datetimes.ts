import { DateTime, FixedOffsetZone, IANAZone, SystemZone, type Zone } from 'luxon';

import { ErrFormatInvalid, ErrParameterInvalid } from '../errs/index';
import { stringToFloat64, stringToInt, stringToInt32 } from './converter';

export type Timezone = Zone;

const westernmostTimezoneUtcOffset = -720; // Etc/GMT+12 (UTC-12:00)
const easternmostTimezoneUtcOffset = 840; // Pacific/Kiritimati (UTC+14:00)

// DateTimeParseError represents the error of parsing date time
export class DateTimeParseError extends Error {
    public constructor(value: string, layout: string) {
        super(`parsing time ${JSON.stringify(value)} as ${JSON.stringify(layout)}: cannot parse`);
        this.name = 'DateTimeParseError';
    }
}

export function serverTimezone(): Timezone {
    return SystemZone.instance;
}

export function fixedZone(offsetMinutes: number): Timezone {
    return FixedOffsetZone.instance(offsetMinutes);
}

// loadLocation behaves like go time.LoadLocation
export function loadLocation(name: string): Timezone | null {
    if (name === '' || name === 'UTC') {
        return FixedOffsetZone.utcInstance;
    }

    if (name === 'Local') {
        return SystemZone.instance;
    }

    if (!IANAZone.isValidZone(name)) {
        return null;
    }

    return IANAZone.create(name);
}

export function nowUnixTime(): number {
    return Math.floor(Date.now() / 1000);
}

export function nowUnixMilli(): number {
    return Date.now();
}

export function fromUnixTime(unixTime: number, timezone?: Timezone | null): DateTime {
    return DateTime.fromSeconds(unixTime, { zone: timezone ?? SystemZone.instance });
}

export function parseNumericYearMonth(yearMonth: string): [number, number] {
    const yearMonthParts = yearMonth.split('-');

    if (yearMonthParts.length !== 2) {
        throw ErrParameterInvalid;
    }

    const year = stringToInt32(yearMonthParts[0]!);
    const month = stringToInt32(yearMonthParts[1]!);

    return [year, month];
}

function pad(num: number, length: number = 2): string {
    const negative = num < 0;
    const str = String(Math.abs(num)).padStart(length, '0');
    return negative ? '-' + str : str;
}

function formatLongDate(t: DateTime): string {
    return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
}

function formatLongDateTime(t: DateTime): string {
    return `${formatLongDate(t)} ${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

// formatOffset formats utc offset like go "Z07:00" layout
function formatOffsetZ(offsetMinutes: number, withColon: boolean, zForUtc: boolean): string {
    if (offsetMinutes === 0 && zForUtc) {
        return 'Z';
    }

    const sign = offsetMinutes < 0 ? '-' : '+';
    const abs = Math.abs(offsetMinutes);
    return `${sign}${pad(Math.floor(abs / 60))}${withColon ? ':' : ''}${pad(abs % 60)}`;
}

export function formatUnixTimeToLongDate(unixTime: number, timezone: Timezone | null): string {
    return formatLongDate(fromUnixTime(unixTime, timezone));
}

export function formatUnixTimeToLongDateTime(unixTime: number, timezone: Timezone | null): string {
    return formatLongDateTime(fromUnixTime(unixTime, timezone));
}

export function formatUnixTimeToLongDateTimeWithTimezone(unixTime: number, timezone: Timezone | null): string {
    const t = fromUnixTime(unixTime, timezone);
    return formatLongDateTime(t) + formatOffsetZ(t.offset, true, true);
}

export function formatUnixTimeToLongDateTimeWithTimezoneRFC3339Format(unixTime: number, timezone: Timezone | null): string {
    const t = fromUnixTime(unixTime, timezone);
    return `${formatLongDate(t)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}${formatOffsetZ(t.offset, true, true)}`;
}

export function formatYearMonthDayToLongDateTime(year: string, month: string, day: string): string {
    if (year.length === 2) {
        const yearLast2Digits = stringToInt(year);
        const currentYear = new Date().getFullYear();
        const currentYearLast2Digits = currentYear % 100;

        if (yearLast2Digits <= currentYearLast2Digits) {
            year = String(Math.floor(currentYear / 100)) + year;
        } else {
            year = String(Math.floor(currentYear / 100) - 1) + year;
        }
    }

    if (month.length < 2) {
        month = '0' + month;
    }

    if (day.length < 2) {
        day = '0' + day;
    }

    return `${year}-${month}-${day} 00:00:00`;
}

export function formatUnixTimeToLongDateTimeInServerTimezone(unixTime: number): string {
    return formatLongDateTime(fromUnixTime(unixTime, null));
}

export function formatUnixTimeToLongDateTimeWithoutSecond(unixTime: number, timezone: Timezone | null): string {
    const t = fromUnixTime(unixTime, timezone);
    return `${formatLongDate(t)} ${pad(t.hour)}:${pad(t.minute)}`;
}

export function formatUnixTimeToYearMonth(unixTime: number, timezone: Timezone | null): string {
    const t = fromUnixTime(unixTime, timezone);
    return `${pad(t.year, 4)}-${pad(t.month)}`;
}

export function formatUnixTimeToNumericYearMonth(unixTime: number, timezone: Timezone | null): number {
    const t = fromUnixTime(unixTime, timezone);
    return t.year * 100 + t.month;
}

export function formatUnixTimeToNumericYearMonthDay(unixTime: number, timezone: Timezone | null): number {
    const t = fromUnixTime(unixTime, timezone);
    return t.year * 10000 + t.month * 100 + t.day;
}

export function formatUnixTimeToNumericLocalDateTime(unixTime: number, timezone: Timezone | null): number {
    const t = fromUnixTime(unixTime, timezone);
    let localDateTime = t.year;
    localDateTime = localDateTime * 100 + t.month;
    localDateTime = localDateTime * 100 + t.day;
    localDateTime = localDateTime * 100 + t.hour;
    localDateTime = localDateTime * 100 + t.minute;
    localDateTime = localDateTime * 100 + t.second;
    return localDateTime;
}

export function formatNumericYearMonthDayToLongDate(yearMonthDay: number): string {
    const year = Math.trunc(yearMonthDay / 10000);
    const month = Math.trunc((yearMonthDay % 10000) / 100);
    const day = yearMonthDay % 100;
    return `${year}-${pad(month)}-${pad(day)}`;
}

export function getMinUnixTimeWithSameLocalDateTime(unixTime: number, currentUtcOffset: number): number {
    return unixTime + currentUtcOffset * 60 - easternmostTimezoneUtcOffset * 60;
}

export function getMaxUnixTimeWithSameLocalDateTime(unixTime: number, currentUtcOffset: number): number {
    return unixTime + currentUtcOffset * 60 - westernmostTimezoneUtcOffset * 60;
}

interface ParsedDateTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    offsetMinutes?: number;
}

function buildDateTime(parts: ParsedDateTimeParts, zone: Timezone, value: string, layout: string): DateTime {
    const t = DateTime.fromObject({
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
    }, { zone: zone });

    if (!t.isValid || t.day !== parts.day || t.month !== parts.month) {
        throw new DateTimeParseError(value, layout);
    }

    return t;
}

// strict parsers for the go layouts used in this project
const longDateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
const longDateTimeRegex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const longDateTimeWithoutSecondRegex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
const shortDateTimeRegex = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/;
const longDateTimeWithTimezoneRegex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;
const longDateTimeWithTimezone2Regex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (Z|[+-]\d{4})$/;
const longDateTimeWithTimezoneRFC3339Regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/;

function parseParts(regex: RegExp, value: string, layout: string): ParsedDateTimeParts {
    const m = regex.exec(value);

    if (!m) {
        throw new DateTimeParseError(value, layout);
    }

    const parts: ParsedDateTimeParts = {
        year: parseInt(m[1]!, 10),
        month: parseInt(m[2]!, 10),
        day: parseInt(m[3]!, 10),
        hour: m[4] !== undefined ? parseInt(m[4], 10) : 0,
        minute: m[5] !== undefined ? parseInt(m[5], 10) : 0,
        second: m[6] !== undefined && /^\d+$/.test(m[6]) ? parseInt(m[6], 10) : 0,
    };

    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
        throw new DateTimeParseError(value, layout);
    }

    const tz = m[7];

    if (tz !== undefined) {
        if (tz === 'Z') {
            parts.offsetMinutes = 0;
        } else {
            const sign = tz[0] === '-' ? -1 : 1;
            const digits = tz.substring(1).replace(':', '');
            parts.offsetMinutes = sign * (parseInt(digits.substring(0, 2), 10) * 60 + parseInt(digits.substring(2, 4), 10));
        }
    }

    return parts;
}

export function parseFromLongDateFirstTime(t: string, utcOffset: number): DateTime {
    return buildDateTime(parseParts(longDateRegex, t, '2006-01-02'), fixedZone(utcOffset), t, '2006-01-02');
}

export function parseFromLongDateLastTime(t: string, utcOffset: number): DateTime {
    const firstTime = parseFromLongDateFirstTime(t, utcOffset);
    return firstTime.plus({ hours: 24 }).minus({ milliseconds: 1 });
}

export function parseFromLongDateTimeToMinUnixTime(t: string): DateTime {
    return buildDateTime(parseParts(longDateTimeRegex, t, '2006-01-02 15:04:05'), fixedZone(easternmostTimezoneUtcOffset), t, '2006-01-02 15:04:05');
}

export function parseFromLongDateTimeToMaxUnixTime(t: string): DateTime {
    return buildDateTime(parseParts(longDateTimeRegex, t, '2006-01-02 15:04:05'), fixedZone(westernmostTimezoneUtcOffset), t, '2006-01-02 15:04:05');
}

export function parseFromLongDateTimeInFixedUtcOffset(t: string, utcOffset: number): DateTime {
    return buildDateTime(parseParts(longDateTimeRegex, t, '2006-01-02 15:04:05'), fixedZone(utcOffset), t, '2006-01-02 15:04:05');
}

export function parseFromLongDateTimeInTimeZone(t: string, timezone: Timezone): DateTime {
    return buildDateTime(parseParts(longDateTimeRegex, t, '2006-01-02 15:04:05'), timezone, t, '2006-01-02 15:04:05');
}

function parseWithTimezone(regex: RegExp, t: string, layout: string): DateTime {
    const parts = parseParts(regex, t, layout);
    return buildDateTime(parts, fixedZone(parts.offsetMinutes ?? 0), t, layout);
}

export function parseFromLongDateTimeWithTimezone(t: string): DateTime {
    return parseWithTimezone(longDateTimeWithTimezoneRegex, t, '2006-01-02 15:04:05Z07:00');
}

export function parseFromLongDateTimeWithTimezone2(t: string): DateTime {
    return parseWithTimezone(longDateTimeWithTimezone2Regex, t, '2006-01-02 15:04:05 Z0700');
}

export function parseFromLongDateTimeWithTimezoneRFC3339Format(t: string): DateTime {
    return parseWithTimezone(longDateTimeWithTimezoneRFC3339Regex, t, '2006-01-02T15:04:05Z07:00');
}

export function parseFromLongDateTimeWithoutSecondInFixedUtcOffset(t: string, utcOffset: number): DateTime {
    return buildDateTime(parseParts(longDateTimeWithoutSecondRegex, t, '2006-01-02 15:04'), fixedZone(utcOffset), t, '2006-01-02 15:04');
}

export function parseFromShortDateTimeInFixedUtcOffset(t: string, utcOffset: number): DateTime {
    return buildDateTime(parseParts(shortDateTimeRegex, t, '2006-1-2 15:4:5'), fixedZone(utcOffset), t, '2006-1-2 15:4:5');
}

export function parseFromElapsedSeconds(elapsedSeconds: number): string {
    if (elapsedSeconds < 0 || elapsedSeconds >= 86400) {
        throw ErrFormatInvalid;
    }

    const second = elapsedSeconds % 60;
    const minute = Math.floor(elapsedSeconds / 60) % 60;
    const hour = Math.floor(elapsedSeconds / 3600);

    return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export function isUnixTimeEqualsYearAndMonth(unixTime: number, timezone: Timezone, year: number, month: number): boolean {
    const date = fromUnixTime(unixTime, timezone);
    return date.year === year && date.month === month;
}

export function getMaxDayOfMonth(year: number, month: number): number {
    return DateTime.utc(year, month, 1).daysInMonth!;
}

export function getTimezoneOffsetMinutes(unixTime: number, timezone: Timezone): number {
    return timezone.offset(unixTime * 1000);
}

export function getServerTimezoneOffsetMinutes(): number {
    return SystemZone.instance.offset(Date.now());
}

function formatMinutesOffset(tzMinutesOffset: number): string {
    let sign = '+';

    if (tzMinutesOffset < 0) {
        sign = '-';
        tzMinutesOffset = -tzMinutesOffset;
    }

    return `${sign}${pad(Math.trunc(tzMinutesOffset / 60))}:${pad(tzMinutesOffset % 60)}`;
}

export function formatTimezoneOffset(unixTime: number, timezone: Timezone): string {
    return formatMinutesOffset(getTimezoneOffsetMinutes(unixTime, timezone));
}

export function formatTimezoneOffsetFromHoursOffset(hoursOffset: string): string {
    let hoursOffsetValue: number;

    try {
        hoursOffsetValue = stringToFloat64(hoursOffset);
    } catch {
        throw ErrFormatInvalid;
    }

    return formatMinutesOffset(Math.trunc(hoursOffsetValue * 60));
}

export function parseFromTimezoneOffset(tzOffset: string): Timezone {
    if (tzOffset.length !== 6) { // +/-HH:MM
        throw ErrFormatInvalid;
    }

    const sign = tzOffset[0];

    if (sign !== '-' && sign !== '+') {
        throw ErrFormatInvalid;
    }

    const offsets = tzOffset.substring(1).split(':');

    if (offsets.length !== 2) {
        throw ErrFormatInvalid;
    }

    const hourAbsOffset = stringToInt(offsets[0]!);
    const minuteAbsOffset = stringToInt(offsets[1]!);
    let totalMinuteOffset = hourAbsOffset * 60 + minuteAbsOffset;

    if (sign === '-') {
        totalMinuteOffset = -totalMinuteOffset;
    }

    return fixedZone(totalMinuteOffset);
}

export function getMinTransactionTimeFromUnixTime(unixTime: number): number {
    return unixTime * 1000;
}

export function getMaxTransactionTimeFromUnixTime(unixTime: number): number {
    return unixTime * 1000 + 999;
}

export function getUnixTimeFromTransactionTime(transactionTime: number): number {
    return Math.trunc(transactionTime / 1000);
}

export function getTransactionTimeRangeByYearMonth(year: number, month: number): [number, number] {
    const text = `${year}-${pad(month)}-01 00:00:00`;
    const startMinUnixTime = parseFromLongDateTimeToMinUnixTime(text);
    const startMaxUnixTime = parseFromLongDateTimeToMaxUnixTime(text);
    const endMaxUnixTime = startMaxUnixTime.plus({ months: 1 });

    const minTransactionTime = getMinTransactionTimeFromUnixTime(Math.floor(startMinUnixTime.toSeconds()));
    const maxTransactionTime = getMinTransactionTimeFromUnixTime(Math.floor(endMaxUnixTime.toSeconds())) - 1;

    return [minTransactionTime, maxTransactionTime];
}

export function getStartOfDay(t: DateTime): DateTime {
    return t.startOf('day');
}

export function toUnixTime(t: DateTime): number {
    return Math.floor(t.toMillis() / 1000);
}

export { DateTime };
