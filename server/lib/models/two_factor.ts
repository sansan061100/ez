import { defineTable } from '../datastore/schema';

// TwoFactor represents user 2fa data stored in database
export interface TwoFactor {
    uid: bigint;
    secret: string;
    createdUnixTime: number;
}

export const TwoFactorTable = defineTable<TwoFactor>('two_factor', [
    ['uid', 'id', { pk: true }],
    ['secret', 'str', { length: 80, notNull: true }],
    ['created_unix_time', 'i64'],
]);

export interface TwoFactorLoginRequest {
    passcode: string;
}

export interface TwoFactorEnableConfirmRequest {
    secret: string;
    passcode: string;
}

export interface TwoFactorEnableResponse {
    secret: string;
    qrcode: string;
}

export interface TwoFactorEnableConfirmResponse {
    token?: string;
    recoveryCodes: string[];
}

export interface TwoFactorDisableRequest {
    password: string;
}

export interface TwoFactorRegenerateRecoveryCodeRequest {
    password: string;
}

export interface TwoFactorStatusResponse {
    enable: boolean;
    createdAt?: number;
}

// TwoFactorRecoveryCode represents user 2fa recovery codes stored in database
export interface TwoFactorRecoveryCode {
    uid: bigint;
    recoveryCode: string;
    used: boolean;
    createdUnixTime: number;
    usedUnixTime: number;
}

export const TwoFactorRecoveryCodeTable = defineTable<TwoFactorRecoveryCode>('two_factor_recovery_code', [
    ['uid', 'id', { pk: true }],
    ['recovery_code', 'str', { length: 64, pk: true }],
    ['used', 'bool', { notNull: true }],
    ['created_unix_time', 'i64'],
    ['used_unix_time', 'i64'],
]);

export interface TwoFactorRecoveryCodeLoginRequest {
    recoveryCode: string;
}
