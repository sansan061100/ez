import { DateTime } from 'luxon';

import { FISCAL_YEAR_START_DEFAULT, FISCAL_YEAR_START_MAX, FISCAL_YEAR_START_MIN } from '../core/fiscalyear';
import { defineTable } from '../datastore/schema';
import { getUnixTimeFromTransactionTime, type Timezone } from '../utils/datetimes';
import { type Account, getAccountLastReconciledTime } from './account';
import type { TransactionCategoryCreateWithSubCategories } from './transaction_category';

export type TransactionEditScope = number;

export const TRANSACTION_EDIT_SCOPE_NONE = 0;
export const TRANSACTION_EDIT_SCOPE_ALL = 1;
export const TRANSACTION_EDIT_SCOPE_TODAY_OR_LATER = 2;
export const TRANSACTION_EDIT_SCOPE_LAST_24H_OR_LATER = 3;
export const TRANSACTION_EDIT_SCOPE_THIS_WEEK_OR_LATER = 4;
export const TRANSACTION_EDIT_SCOPE_THIS_MONTH_OR_LATER = 5;
export const TRANSACTION_EDIT_SCOPE_THIS_YEAR_OR_LATER = 6;
export const TRANSACTION_EDIT_SCOPE_LAST_RECONCILED_TIME_OR_LATER = 7;
export const TRANSACTION_EDIT_SCOPE_INVALID = 255;

export function transactionEditScopeName(s: TransactionEditScope): string {
    const names: Record<number, string> = {
        0: 'None',
        1: 'All',
        2: 'TodayOrLater',
        3: 'Last24HourOrLater',
        4: 'ThisWeekOrLater',
        5: 'ThisMonthOrLater',
        6: 'ThisYearOrLater',
        7: 'LastReconciledTimeOrLater',
        255: 'Invalid',
    };

    return names[s] ?? `Invalid(${s})`;
}

export type AmountColorType = number;

export const AMOUNT_COLOR_TYPE_DEFAULT = 0;
export const AMOUNT_COLOR_TYPE_GREEN = 1;
export const AMOUNT_COLOR_TYPE_RED = 2;
export const AMOUNT_COLOR_TYPE_YELLOW = 3;
export const AMOUNT_COLOR_TYPE_BLACK_OR_WHITE = 4;
export const AMOUNT_COLOR_TYPE_INVALID = 255;

export function amountColorTypeName(s: AmountColorType): string {
    const names: Record<number, string> = { 0: 'Default', 1: 'Green', 2: 'Red', 3: 'Yellow', 4: 'Black or White', 255: 'Invalid' };
    return names[s] ?? `Invalid(${s})`;
}

// User represents user data stored in database
export interface User {
    uid: bigint;
    username: string;
    email: string;
    nickname: string;
    password: string;
    salt: string;
    customAvatarType: string;
    defaultAccountId: bigint;
    useLastReconciledTime: boolean;
    transactionEditScope: TransactionEditScope;
    language: string;
    defaultCurrency: string;
    firstDayOfWeek: number;
    fiscalYearStart: number;
    calendarDisplayType: number;
    dateDisplayType: number;
    longDateFormat: number;
    shortDateFormat: number;
    longTimeFormat: number;
    shortTimeFormat: number;
    fiscalYearFormat: number;
    currencyDisplayType: number;
    numeralSystem: number;
    decimalSeparator: number;
    digitGroupingSymbol: number;
    digitGrouping: number;
    coordinateDisplayType: number;
    expenseAmountColor: AmountColorType;
    incomeAmountColor: AmountColorType;
    featureRestriction: number;
    disabled: boolean;
    deleted: boolean;
    emailVerified: boolean;
    createdUnixTime: number;
    updatedUnixTime: number;
    deletedUnixTime: number;
    lastLoginUnixTime: number;
}

export const UserTable = defineTable<User>('user', [
    ['uid', 'id', { pk: true }],
    ['username', 'str', { length: 32, notNull: true, unique: ['username'] }],
    ['email', 'str', { length: 100, notNull: true, unique: ['email'] }],
    ['nickname', 'str', { length: 64, notNull: true }],
    ['password', 'str', { length: 64, notNull: true }],
    ['salt', 'str', { length: 10, notNull: true }],
    ['custom_avatar_type', 'str', { length: 10 }],
    ['default_account_id', 'id'],
    ['use_last_reconciled_time', 'bool'],
    ['transaction_edit_scope', 'u8', { notNull: true }],
    ['language', 'str', { length: 10 }],
    ['default_currency', 'str', { length: 3, notNull: true }],
    ['first_day_of_week', 'u8', { notNull: true }],
    ['fiscal_year_start', 'i16'],
    ['calendar_display_type', 'u8'],
    ['date_display_type', 'u8'],
    ['long_date_format', 'u8'],
    ['short_date_format', 'u8'],
    ['long_time_format', 'u8'],
    ['short_time_format', 'u8'],
    ['fiscal_year_format', 'u8'],
    ['currency_display_type', 'u8'],
    ['numeral_system', 'u8'],
    ['decimal_separator', 'u8'],
    ['digit_grouping_symbol', 'u8'],
    ['digit_grouping', 'u8'],
    ['coordinate_display_type', 'u8'],
    ['expense_amount_color', 'u8'],
    ['income_amount_color', 'u8'],
    ['feature_restriction', 'u64'],
    ['disabled', 'bool'],
    ['deleted', 'bool', { notNull: true }],
    ['email_verified', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
    ['deleted_unix_time', 'i64'],
    ['last_login_unix_time', 'i64'],
]);

export function newUser(values: Partial<User> = {}): User {
    return {
        uid: 0n,
        username: '',
        email: '',
        nickname: '',
        password: '',
        salt: '',
        customAvatarType: '',
        defaultAccountId: 0n,
        useLastReconciledTime: false,
        transactionEditScope: 0,
        language: '',
        defaultCurrency: '',
        firstDayOfWeek: 0,
        fiscalYearStart: 0,
        calendarDisplayType: 0,
        dateDisplayType: 0,
        longDateFormat: 0,
        shortDateFormat: 0,
        longTimeFormat: 0,
        shortTimeFormat: 0,
        fiscalYearFormat: 0,
        currencyDisplayType: 0,
        numeralSystem: 0,
        decimalSeparator: 0,
        digitGroupingSymbol: 0,
        digitGrouping: 0,
        coordinateDisplayType: 0,
        expenseAmountColor: 0,
        incomeAmountColor: 0,
        featureRestriction: 0,
        disabled: false,
        deleted: false,
        emailVerified: false,
        createdUnixTime: 0,
        updatedUnixTime: 0,
        deletedUnixTime: 0,
        lastLoginUnixTime: 0,
        ...values,
    };
}

// UserBasicInfo represents a view-object of user basic info
export interface UserBasicInfo {
    username: string;
    email: string;
    nickname: string;
    avatar: string;
    avatarProvider?: string;
    defaultAccountId: bigint;
    useLastReconciledTime: boolean;
    transactionEditScope: TransactionEditScope;
    language: string;
    defaultCurrency: string;
    firstDayOfWeek: number;
    fiscalYearStart: number;
    calendarDisplayType: number;
    dateDisplayType: number;
    longDateFormat: number;
    shortDateFormat: number;
    longTimeFormat: number;
    shortTimeFormat: number;
    fiscalYearFormat: number;
    currencyDisplayType: number;
    numeralSystem: number;
    decimalSeparator: number;
    digitGroupingSymbol: number;
    digitGrouping: number;
    coordinateDisplayType: number;
    expenseAmountColor: AmountColorType;
    incomeAmountColor: AmountColorType;
    emailVerified: boolean;
}

export interface UserLoginRequest {
    loginName: string;
    password: string;
}

export interface UserRegisterRequest {
    username: string;
    email: string;
    nickname: string;
    password: string;
    language: string;
    defaultCurrency: string;
    firstDayOfWeek: number;
    categories: TransactionCategoryCreateWithSubCategories[] | null;
}

export interface UserVerifyEmailRequest {
    requestNewToken: boolean;
}

export interface UserVerifyEmailResponse {
    newToken?: string;
    user: UserBasicInfo;
    notificationContent?: string;
}

export interface UserResendVerifyEmailRequest {
    email: string;
    password: string;
}

export interface UserProfileUpdateRequest {
    email: string;
    nickname: string;
    password: string;
    oldPassword: string;
    defaultAccountId: bigint;
    useLastReconciledTime: boolean | null;
    transactionEditScope: number | null;
    language: string;
    defaultCurrency: string;
    firstDayOfWeek: number | null;
    fiscalYearStart: number | null;
    calendarDisplayType: number | null;
    dateDisplayType: number | null;
    longDateFormat: number | null;
    shortDateFormat: number | null;
    longTimeFormat: number | null;
    shortTimeFormat: number | null;
    fiscalYearFormat: number | null;
    currencyDisplayType: number | null;
    numeralSystem: number | null;
    decimalSeparator: number | null;
    digitGroupingSymbol: number | null;
    digitGrouping: number | null;
    coordinateDisplayType: number | null;
    expenseAmountColor: number | null;
    incomeAmountColor: number | null;
}

export interface UserProfileUpdateResponse {
    user: UserBasicInfo;
    newToken?: string;
}

export type UserProfileResponse = UserBasicInfo & {
    noPassword?: boolean;
    lastLoginAt: number;
};

// canEditTransactionByTransactionTime returns whether this user can edit transaction with specified transaction time
export function canEditTransactionByTransactionTime(u: User, transactionTime: number, clientTimezone: Timezone, account: Account | null, destinationAccount: Account | null): boolean {
    if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_NONE) {
        return false;
    } else if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_ALL) {
        return true;
    }

    const now = DateTime.now();
    const transactionUnixTime = getUnixTimeFromTransactionTime(transactionTime);

    if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_LAST_24H_OR_LATER) {
        return transactionUnixTime > Math.floor(now.minus({ hours: 24 }).toSeconds());
    }

    const clientNow = now.setZone(clientTimezone);
    const clientTodayStartTime = clientNow.startOf('day');

    if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_TODAY_OR_LATER) {
        return transactionUnixTime > Math.floor(clientTodayStartTime.toSeconds());
    } else if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_THIS_WEEK_OR_LATER) {
        let dayOfWeek = (now.weekday % 7) - u.firstDayOfWeek;

        if (dayOfWeek < 0) {
            dayOfWeek += 7;
        }

        const clientWeekStartTime = clientTodayStartTime.minus({ days: dayOfWeek });
        return transactionUnixTime > Math.floor(clientWeekStartTime.toSeconds());
    } else if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_THIS_MONTH_OR_LATER) {
        const clientMonthStartTime = clientTodayStartTime.minus({ days: now.day - 1 });
        return transactionUnixTime > Math.floor(clientMonthStartTime.toSeconds());
    } else if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_THIS_YEAR_OR_LATER) {
        const clientYearStartTime = clientTodayStartTime.minus({ days: now.ordinal - 1 });
        return transactionUnixTime > Math.floor(clientYearStartTime.toSeconds());
    } else if (u.transactionEditScope === TRANSACTION_EDIT_SCOPE_LAST_RECONCILED_TIME_OR_LATER && u.useLastReconciledTime) {
        let minAccountLastReconciledTime = 0;

        if (account) {
            minAccountLastReconciledTime = getAccountLastReconciledTime(account);
        }

        if (destinationAccount) {
            const destinationAccountLastReconciledTime = getAccountLastReconciledTime(destinationAccount);

            if (destinationAccountLastReconciledTime > minAccountLastReconciledTime) {
                minAccountLastReconciledTime = destinationAccountLastReconciledTime;
            }
        }

        return transactionUnixTime > minAccountLastReconciledTime;
    }

    return false;
}

// toUserBasicInfo returns a user basic view-object according to database model
export function toUserBasicInfo(u: User, avatarProvider: string, avatarUrl: string): UserBasicInfo {
    let fiscalYearStart = u.fiscalYearStart;

    if (fiscalYearStart < FISCAL_YEAR_START_MIN || fiscalYearStart > FISCAL_YEAR_START_MAX) {
        fiscalYearStart = FISCAL_YEAR_START_DEFAULT;
    }

    const info: Record<string, unknown> = {
        username: u.username,
        email: u.email,
        nickname: u.nickname,
        avatar: avatarUrl,
    };

    if (avatarProvider !== '') {
        info['avatarProvider'] = avatarProvider;
    }

    Object.assign(info, {
        defaultAccountId: u.defaultAccountId,
        useLastReconciledTime: u.useLastReconciledTime,
        transactionEditScope: u.transactionEditScope,
        language: u.language,
        defaultCurrency: u.defaultCurrency,
        firstDayOfWeek: u.firstDayOfWeek,
        fiscalYearStart: fiscalYearStart,
        calendarDisplayType: u.calendarDisplayType,
        dateDisplayType: u.dateDisplayType,
        longDateFormat: u.longDateFormat,
        shortDateFormat: u.shortDateFormat,
        longTimeFormat: u.longTimeFormat,
        shortTimeFormat: u.shortTimeFormat,
        fiscalYearFormat: u.fiscalYearFormat,
        currencyDisplayType: u.currencyDisplayType,
        numeralSystem: u.numeralSystem,
        decimalSeparator: u.decimalSeparator,
        digitGroupingSymbol: u.digitGroupingSymbol,
        digitGrouping: u.digitGrouping,
        coordinateDisplayType: u.coordinateDisplayType,
        expenseAmountColor: u.expenseAmountColor,
        incomeAmountColor: u.incomeAmountColor,
        emailVerified: u.emailVerified,
    });

    return info as unknown as UserBasicInfo;
}

export function toUserProfileResponse(u: User, basicInfo: UserBasicInfo): UserProfileResponse {
    const ret: Record<string, unknown> = { ...basicInfo };

    if (u.password === '') {
        ret['noPassword'] = true;
    }

    ret['lastLoginAt'] = u.lastLoginUnixTime;
    return ret as unknown as UserProfileResponse;
}
