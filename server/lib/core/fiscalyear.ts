import { ErrFormatInvalid } from '../errs/index';

export type FiscalYearStart = number;

export const FISCAL_YEAR_START_DEFAULT = 0x0101; // January 1
export const FISCAL_YEAR_START_MIN = 0x0101; // January 1
export const FISCAL_YEAR_START_MAX = 0x0C1F; // December 31
export const FISCAL_YEAR_START_INVALID = 0xFFFF; // Invalid

export const MONTH_MAX_DAYS = [
    31, // January
    28, // February (Disallow fiscal year start on leap day)
    31, // March
    30, // April
    31, // May
    30, // June
    31, // July
    31, // August
    30, // September
    31, // October
    30, // November
    31, // December
];

function isValidFiscalYearMonthDay(month: number, day: number): boolean {
    return month >= 1 && month <= 12 && day >= 1 && day <= MONTH_MAX_DAYS[month - 1]!;
}

// newFiscalYearStart creates a new FiscalYearStart from month and day values
export function newFiscalYearStart(month: number, day: number): FiscalYearStart {
    if (!isValidFiscalYearMonthDay(month, day)) {
        throw ErrFormatInvalid;
    }

    return (month << 8) | day;
}

// getFiscalYearStartMonthDay returns the month and day of fiscal year start
export function getFiscalYearStartMonthDay(f: FiscalYearStart): [number, number] {
    if (f < FISCAL_YEAR_START_MIN || f > FISCAL_YEAR_START_MAX) {
        throw ErrFormatInvalid;
    }

    const month = f >> 8;
    const day = f & 0xFF;

    if (!isValidFiscalYearMonthDay(month, day)) {
        throw ErrFormatInvalid;
    }

    return [month, day];
}

export function fiscalYearStartToString(f: FiscalYearStart): string {
    try {
        const [month, day] = getFiscalYearStartMonthDay(f);
        return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    } catch {
        return 'Invalid';
    }
}
