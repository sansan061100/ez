import { defineTable } from '../datastore/schema';
import { float64ToString, stringToFloat64 } from '../utils/converter';

export const UserCustomExchangeRateFactorInDatabase = 100000000;

// UserCustomExchangeRate represents user custom exchange rate data stored in database
export interface UserCustomExchangeRate {
    uid: bigint;
    deletedUnixTime: number;
    currency: string;
    rate: number;
    createdUnixTime: number;
    updatedUnixTime: number;
}

export const UserCustomExchangeRateTable = defineTable<UserCustomExchangeRate>('user_custom_exchange_rate', [
    ['uid', 'id', { pk: true }],
    ['deleted_unix_time', 'i64', { pk: true }],
    ['currency', 'str', { length: 3, pk: true }],
    ['rate', 'i64', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['updated_unix_time', 'i64'],
]);

export interface UserCustomExchangeRateUpdateRequest {
    currency: string;
    rate: string;
}

export interface UserCustomExchangeRateDeleteRequest {
    currency: string;
}

export interface LatestExchangeRate {
    currency: string;
    rate: string;
}

export type UserCustomExchangeRateUpdateResponse = LatestExchangeRate & {
    updateTime: number;
};

export interface LatestExchangeRateResponse {
    dataSource: string;
    referenceUrl: string;
    updateTime: number;
    baseCurrency: string;
    exchangeRates: LatestExchangeRate[];
}

export function toLatestExchangeRate(r: UserCustomExchangeRate, baseCurrencyRate: number): LatestExchangeRate {
    let rate = 0;

    if (baseCurrencyRate > 0) {
        rate = r.rate / baseCurrencyRate;
    }

    return {
        currency: r.currency,
        rate: float64ToString(rate),
    };
}

export function toUserCustomExchangeRateUpdateResponse(r: UserCustomExchangeRate, baseCurrencyRate: number): UserCustomExchangeRateUpdateResponse {
    return {
        ...toLatestExchangeRate(r, baseCurrencyRate),
        updateTime: r.updatedUnixTime,
    };
}

export function createUserCustomExchangeRate(uid: bigint, currency: string, exchangeRate: string, baseCurrencyRate: number): UserCustomExchangeRate {
    if (baseCurrencyRate <= 0) {
        return {
            uid: uid,
            deletedUnixTime: 0,
            currency: currency,
            rate: UserCustomExchangeRateFactorInDatabase,
            createdUnixTime: 0,
            updatedUnixTime: 0,
        };
    }

    let rate = stringToFloat64(exchangeRate);
    rate = rate * baseCurrencyRate;

    return {
        uid: uid,
        deletedUnixTime: 0,
        currency: currency,
        rate: Math.trunc(rate),
        createdUnixTime: 0,
        updatedUnixTime: 0,
    };
}

export function sortLatestExchangeRates(s: LatestExchangeRate[]): LatestExchangeRate[] {
    return s.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
