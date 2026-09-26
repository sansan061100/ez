// the global declarations are required when the server code is type checked by the nuxt app project (for the typed server routes)
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../global.d.ts" />

// Constants and enum-like types ported from pkg/core

export const ApplicationName = 'ezBookkeeping';

// the build info is injected at build time (see nuxt.config.ts), the environment variables take precedence
const injectedBuildInfo: ServerBuildInfo = __EZBOOKKEEPING_SERVER_BUILD_INFO__;

function buildInfoValue(envName: string, key: keyof ServerBuildInfo): string {
    const envValue = process.env[envName];

    if (envValue !== undefined) {
        return envValue;
    }

    return injectedBuildInfo[key];
}

export const buildInfo = {
    version: buildInfoValue('EBK_VERSION', 'version'),
    commitHash: buildInfoValue('EBK_COMMIT_HASH', 'commitHash'),
    buildTime: buildInfoValue('EBK_BUILD_TIME', 'buildTime'),
};

// getOutgoingUserAgent returns the user agent used for outgoing requests
export function getOutgoingUserAgent(): string {
    if (!buildInfo.version) {
        return ApplicationName;
    }

    return `${ApplicationName}/${buildInfo.version}`;
}

export type O = Record<string, unknown>;

function enumName(names: Record<number, string>, value: number): string {
    return names[value] ?? `Invalid(${value})`;
}

// CalendarDisplayType
export const CALENDAR_DISPLAY_TYPE_DEFAULT = 0;
export const CALENDAR_DISPLAY_TYPE_GREGORAIN = 1;
export const CALENDAR_DISPLAY_TYPE_BUDDHIST = 2;
export const CALENDAR_DISPLAY_TYPE_GREGORAIN_WITH_CHINESE = 3;
export const CALENDAR_DISPLAY_TYPE_GREGORAIN_WITH_PERSIAN = 4;
export const CALENDAR_DISPLAY_TYPE_INVALID = 255;
export const calendarDisplayTypeName = (v: number): string => enumName({ 0: 'Default', 1: 'Gregorian', 2: 'Buddhist', 3: 'Gregorian with Chinese Calendar', 4: 'Gregorian with Persian Calendar', 255: 'Invalid' }, v);

// DateDisplayType
export const DATE_DISPLAY_TYPE_DEFAULT = 0;
export const DATE_DISPLAY_TYPE_GREGORAIN = 1;
export const DATE_DISPLAY_TYPE_BUDDHIST = 2;
export const DATE_DISPLAY_TYPE_PERSIAN = 3;
export const DATE_DISPLAY_TYPE_INVALID = 255;
export const dateDisplayTypeName = (v: number): string => enumName({ 0: 'Default', 1: 'Gregorian', 2: 'Buddhist', 3: 'Persian', 255: 'Invalid' }, v);

// CoordinateDisplayType
export const COORDINATE_DISPLAY_TYPE_DEFAULT = 0;
export const COORDINATE_DISPLAY_TYPE_LATITUDE_LONGITUDE_DECIMAL_DEGREES = 1;
export const COORDINATE_DISPLAY_TYPE_LONGITUDE_LATITUDE_DECIMAL_DEGREES = 2;
export const COORDINATE_DISPLAY_TYPE_LATITUDE_LONGITUDE_DECIMAL_MINUTES = 3;
export const COORDINATE_DISPLAY_TYPE_LONGITUDE_LATITUDE_DECIMAL_MINUTES = 4;
export const COORDINATE_DISPLAY_TYPE_LATITUDE_LONGITUDE_DEGREES_MINUTES_SECONDS = 5;
export const COORDINATE_DISPLAY_TYPE_LONGITUDE_LATITUDE_DEGREES_MINUTES_SECONDS = 6;
export const COORDINATE_DISPLAY_TYPE_INVALID = 255;
export const coordinateDisplayTypeName = (v: number): string => enumName({
    0: 'Default',
    1: 'Latitude Longitude (Decimal Degrees)',
    2: 'Longitude Latitude (Decimal Degrees)',
    3: 'Latitude Longitude (Decimal Minutes)',
    4: 'Longitude Latitude (Decimal Minutes)',
    5: 'Latitude Longitude (Degrees Minutes Seconds)',
    6: 'Longitude Latitude (Degrees Minutes Seconds)',
    255: 'Invalid',
}, v);

// Currency
export const AccountCurrencyNotSetValue = '---';

export const CURRENCY_DISPLAY_TYPE_DEFAULT = 0;
export const CURRENCY_DISPLAY_TYPE_NONE = 1;
export const CURRENCY_DISPLAY_TYPE_SYMBOL_BEFORE_AMOUNT = 2;
export const CURRENCY_DISPLAY_TYPE_SYMBOL_AFTER_AMOUNT = 3;
export const CURRENCY_DISPLAY_TYPE_SYMBOL_BEFORE_AMOUNT_WITHOUT_SPACE = 4;
export const CURRENCY_DISPLAY_TYPE_SYMBOL_AFTER_AMOUNT_WITHOUT_SPACE = 5;
export const CURRENCY_DISPLAY_TYPE_CODE_BEFORE_AMOUNT = 6;
export const CURRENCY_DISPLAY_TYPE_CODE_AFTER_AMOUNT = 7;
export const CURRENCY_DISPLAY_TYPE_UNIT_BEFORE_AMOUNT = 8;
export const CURRENCY_DISPLAY_TYPE_UNIT_AFTER_AMOUNT = 9;
export const CURRENCY_DISPLAY_TYPE_NAME_BEFORE_AMOUNT = 10;
export const CURRENCY_DISPLAY_TYPE_NAME_AFTER_AMOUNT = 11;
export const CURRENCY_DISPLAY_TYPE_INVALID = 255;
export const currencyDisplayTypeName = (v: number): string => enumName({
    0: 'Default', 1: 'None', 2: 'Symbol Before Amount', 3: 'Symbol After Amount',
    4: 'Symbol Before Amount Without Space', 5: 'Symbol After Amount Without Space',
    6: 'Code Before Amount', 7: 'Code After Amount', 8: 'Unit Before Amount', 9: 'Unit After Amount',
    10: 'Name Before Amount', 11: 'Name After Amount', 255: 'Invalid',
}, v);

// WeekDay
export const WEEKDAY_SUNDAY = 0;
export const WEEKDAY_MONDAY = 1;
export const WEEKDAY_TUESDAY = 2;
export const WEEKDAY_WEDNESDAY = 3;
export const WEEKDAY_THURSDAY = 4;
export const WEEKDAY_FRIDAY = 5;
export const WEEKDAY_SATURDAY = 6;
export const WEEKDAY_INVALID = 255;
export const weekDayName = (v: number): string => enumName({ 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 255: 'Invalid' }, v);

// LongDateFormat / ShortDateFormat
export const LONG_DATE_FORMAT_DEFAULT = 0;
export const LONG_DATE_FORMAT_YYYY_M_D = 1;
export const LONG_DATE_FORMAT_M_D_YYYY = 2;
export const LONG_DATE_FORMAT_D_M_YYYY = 3;
export const LONG_DATE_FORMAT_INVALID = 255;
export const SHORT_DATE_FORMAT_DEFAULT = 0;
export const SHORT_DATE_FORMAT_YYYY_M_D = 1;
export const SHORT_DATE_FORMAT_M_D_YYYY = 2;
export const SHORT_DATE_FORMAT_D_M_YYYY = 3;
export const SHORT_DATE_FORMAT_INVALID = 255;
export const dateFormatName = (v: number): string => enumName({ 0: 'Default', 1: 'YYYY_MM_D', 2: 'M_D_YYYY', 3: 'D_M_YYYY', 255: 'Invalid' }, v);

// LongTimeFormat / ShortTimeFormat
export const LONG_TIME_FORMAT_DEFAULT = 0;
export const LONG_TIME_FORMAT_HH_MM_SS = 1;
export const LONG_TIME_FORMAT_A_HH_MM_SS = 2;
export const LONG_TIME_FORMAT_HH_MM_SS_A = 3;
export const LONG_TIME_FORMAT_INVALID = 255;
export const longTimeFormatName = (v: number): string => enumName({ 0: 'Default', 1: 'HH_MM_SS', 2: 'A_HH_MM_SS', 3: 'HH_MM_SS_A', 255: 'Invalid' }, v);
export const SHORT_TIME_FORMAT_DEFAULT = 0;
export const SHORT_TIME_FORMAT_HH_MM = 1;
export const SHORT_TIME_FORMAT_A_HH_MM = 2;
export const SHORT_TIME_FORMAT_HH_MM_A = 3;
export const SHORT_TIME_FORMAT_INVALID = 255;
export const shortTimeFormatName = (v: number): string => enumName({ 0: 'Default', 1: 'HH_MM', 2: 'A_HH_MM', 3: 'HH_MM_A', 255: 'Invalid' }, v);

// FiscalYearFormat
export const FISCAL_YEAR_FORMAT_DEFAULT = 0;
export const FISCAL_YEAR_FORMAT_STARTYYYY_ENDYYYY = 1;
export const FISCAL_YEAR_FORMAT_STARTYYYY_ENDYY = 2;
export const FISCAL_YEAR_FORMAT_STARTYY_ENDYY = 3;
export const FISCAL_YEAR_FORMAT_ENDYYYY = 4;
export const FISCAL_YEAR_FORMAT_ENDYY = 5;
export const FISCAL_YEAR_FORMAT_INVALID = 255;
export const fiscalYearFormatName = (v: number): string => enumName({ 0: 'Default', 1: 'StartYYYY-EndYYYY', 2: 'StartYYYY-EndYY', 3: 'StartYY-EndYY', 4: 'EndYYYY', 5: 'EndYY', 255: 'Invalid' }, v);

// IconType
export const ICON_TYPE_SYSTEM = 0;
export const ICON_TYPE_USER_CUSTOM = 1;
export const iconTypeName = (v: number): string => enumName({ 0: 'System', 1: 'User Custom' }, v);
export const isValidIconType = (v: number): boolean => v === ICON_TYPE_SYSTEM || v === ICON_TYPE_USER_CUSTOM;

// MatchMode
export const MATCH_MODE_DEFAULT = 0;
export const MATCH_MODE_IGNORE_CASE = 1;

// NumeralSystem
export const NUMERAL_SYSTEM_DEFAULT = 0;
export const NUMERAL_SYSTEM_WESTERN_ARABIC_NUMERALS = 1;
export const NUMERAL_SYSTEM_EASTERN_ARABIC_NUMERALS = 2;
export const NUMERAL_SYSTEM_PERSIAN_DIGITS = 3;
export const NUMERAL_SYSTEM_BURMESE_NUMERALS = 4;
export const NUMERAL_SYSTEM_DEVANAGARI_NUMERALS = 5;
export const NUMERAL_SYSTEM_INVALID = 255;
export const numeralSystemName = (v: number): string => enumName({ 0: 'Default', 1: 'Western Arabic Numerals', 2: 'Eastern Arabic Numerals', 3: 'Persian Digits', 4: 'Burmese Numerals', 5: 'Devanagari Numerals' }, v);

// DecimalSeparator
export const DECIMAL_SEPARATOR_DEFAULT = 0;
export const DECIMAL_SEPARATOR_DOT = 1;
export const DECIMAL_SEPARATOR_COMMA = 2;
export const DECIMAL_SEPARATOR_INVALID = 255;
export const decimalSeparatorName = (v: number): string => enumName({ 0: 'Default', 1: 'Dot', 2: 'Comma', 255: 'Invalid' }, v);

// DigitGroupingSymbol
export const DIGIT_GROUPING_SYMBOL_DEFAULT = 0;
export const DIGIT_GROUPING_SYMBOL_DOT = 1;
export const DIGIT_GROUPING_SYMBOL_COMMA = 2;
export const DIGIT_GROUPING_SYMBOL_SPACE = 3;
export const DIGIT_GROUPING_SYMBOL_APOSTROPHE = 4;
export const DIGIT_GROUPING_SYMBOL_INVALID = 255;
export const digitGroupingSymbolName = (v: number): string => enumName({ 0: 'Default', 1: 'Dot', 2: 'Comma', 3: 'Space', 4: 'Apostrophe', 255: 'Invalid' }, v);

// DigitGroupingType
export const DIGIT_GROUPING_TYPE_DEFAULT = 0;
export const DIGIT_GROUPING_TYPE_NONE = 1;
export const DIGIT_GROUPING_TYPE_THOUSANDS_SEPARATOR = 2;
export const DIGIT_GROUPING_TYPE_INDIAN_NUMBER_GROUPING = 3;
export const DIGIT_GROUPING_TYPE_INVALID = 255;
export const digitGroupingTypeName = (v: number): string => enumName({ 0: 'Default', 1: 'None', 2: 'Thousands Separator', 3: 'Indian Number Grouping', 255: 'Invalid' }, v);

// TaskProcessUpdateHandler
export type TaskProcessUpdateHandler = (currentProcess: number) => void;

// UserAvatarProviderType
export type UserAvatarProviderType = '' | 'internal' | 'gravatar';
export const USER_AVATAR_PROVIDER_INTERNAL: UserAvatarProviderType = 'internal';
export const USER_AVATAR_PROVIDER_GRAVATAR: UserAvatarProviderType = 'gravatar';

// UserExternalAuthType
export const USER_EXTERNAL_AUTH_TYPE_CATEOGRY_OAUTH2 = 'oauth2';
export type UserExternalAuthType = 'oidc' | 'nextcloud' | 'gitea' | 'github';
export const USER_EXTERNAL_AUTH_TYPE_OAUTH2_OIDC: UserExternalAuthType = 'oidc';
export const USER_EXTERNAL_AUTH_TYPE_OAUTH2_NEXTCLOUD: UserExternalAuthType = 'nextcloud';
export const USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITEA: UserExternalAuthType = 'gitea';
export const USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITHUB: UserExternalAuthType = 'github';

export function getUserExternalAuthTypeCategory(t: string): string {
    switch (t) {
        case 'oidc':
        case 'nextcloud':
        case 'gitea':
        case 'github':
            return USER_EXTERNAL_AUTH_TYPE_CATEOGRY_OAUTH2;
    }

    return '';
}

export function isValidUserExternalAuthType(t: string): t is UserExternalAuthType {
    return getUserExternalAuthTypeCategory(t) !== '';
}
