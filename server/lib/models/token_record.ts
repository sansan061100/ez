import { defineTable } from '../datastore/schema';
import type { UserBasicInfo } from './user';
import type { ApplicationCloudSetting } from './user_app_cloud_setting';

export const TokenMaxUserAgentLength = 255;

// TokenRecord represents token data stored in database
export interface TokenRecord {
    uid: bigint;
    userTokenId: bigint;
    tokenType: number;
    secret: string;
    userAgent: string;
    context: string;
    createdUnixTime: number;
    expiredUnixTime: number;
    lastSeenUnixTime: number;
}

const idxUidTypeExpiredTime = 'IDX_token_record_uid_type_expired_time';
const idxExpiredTime = 'IDX_token_record_expired_time';

export const TokenRecordTable = defineTable<TokenRecord>('token_record', [
    ['uid', 'id', { pk: true, index: [idxUidTypeExpiredTime, idxExpiredTime] }],
    ['user_token_id', 'id', { pk: true }],
    ['token_type', 'u8', { notNull: true, index: [idxUidTypeExpiredTime] }],
    ['secret', 'str', { length: 10, notNull: true }],
    ['user_agent', 'str', { length: 255 }],
    ['context', 'blob'],
    ['created_unix_time', 'i64', { pk: true }],
    ['expired_unix_time', 'i64', { index: [idxUidTypeExpiredTime, idxExpiredTime] }],
    ['last_seen_unix_time', 'i64'],
]);

export function newTokenRecord(values: Partial<TokenRecord> = {}): TokenRecord {
    return {
        uid: 0n,
        userTokenId: 0n,
        tokenType: 0,
        secret: '',
        userAgent: '',
        context: '',
        createdUnixTime: 0,
        expiredUnixTime: 0,
        lastSeenUnixTime: 0,
        ...values,
    };
}

// OAuth2CallbackTokenContext represents the context of oauth 2.0 callback token
export interface OAuth2CallbackTokenContext {
    externalAuthType: string;
    externalUsername: string;
    externalEmail: string;
}

export interface TokenGenerateAPIRequest {
    expiresInSeconds: number;
    password: string;
}

export interface TokenGenerateMCPRequest {
    expiresInSeconds: number;
    password: string;
}

export interface TokenRevokeRequest {
    tokenId: string;
}

export interface TokenGenerateAPIResponse {
    token: string;
    apiBaseUrl: string;
}

export interface TokenGenerateMCPResponse {
    token: string;
    mcpUrl: string;
}

export interface TokenRefreshResponse {
    newToken?: string;
    oldTokenId?: string;
    user: UserBasicInfo;
    applicationCloudSettings?: ApplicationCloudSetting[];
    notificationContent?: string;
}

export interface TokenInfoResponse {
    tokenId: string;
    tokenType: number;
    userAgent: string;
    lastSeen: number;
    isCurrent: boolean;
}

export function sortTokenInfoResponses(s: TokenInfoResponse[]): TokenInfoResponse[] {
    return s.sort((a, b) => b.lastSeen - a.lastSeen);
}
