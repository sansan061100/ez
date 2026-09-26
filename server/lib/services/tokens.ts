import { randomInt } from 'node:crypto';

import type { Context, RequestContext } from '../core/context';
import {
    TokenUserAgentCreatedViaCli,
    type TokenType,
    USER_TOKEN_TYPE_API,
    USER_TOKEN_TYPE_EMAIL_VERIFY,
    USER_TOKEN_TYPE_MCP,
    USER_TOKEN_TYPE_NORMAL,
    USER_TOKEN_TYPE_OAUTH2_CALLBACK,
    USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY,
    USER_TOKEN_TYPE_PASSWORD_RESET,
    USER_TOKEN_TYPE_REQUIRE_2FA,
    type UserTokenClaims,
} from '../core/token_claims';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { newTokenRecord, TokenMaxUserAgentLength, type TokenRecord, TokenRecordTable, type User } from '../models/index';
import { stringToInt64 } from '../utils/converter';
import { getRandomString, subString } from '../utils/strings';
import { nowUnix, ServiceBase } from './base';
import { JwtError, parseAndVerifyJwt, signJwt } from './jwt';

const tokenMaxExpiredAtUnixTime = 253402300799; // 9999-12-31 23:59:59 UTC

export interface ParsedToken {
    claims: UserTokenClaims;
    tokenContext: string;
}

// TokenService represents user token service
export class TokenService extends ServiceBase {
    // getAllTokensByUid returns all token models of given user
    public async getAllTokensByUid(c: Context, uid: bigint): Promise<TokenRecord[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.tokenDB(uid).newSession(c).cols('uid', 'user_token_id', 'token_type', 'user_agent', 'created_unix_time', 'expired_unix_time').where('uid=?', uid).find(TokenRecordTable);
    }

    // getAllUnexpiredNormalAndMCPTokensByUid returns all available normal, mcp and api token models of given user
    public async getAllUnexpiredNormalAndMCPTokensByUid(c: Context, uid: bigint): Promise<TokenRecord[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        return this.tokenDB(uid).newSession(c)
            .cols('uid', 'user_token_id', 'token_type', 'user_agent', 'created_unix_time', 'expired_unix_time', 'last_seen_unix_time')
            .where('uid=? AND (token_type=? OR token_type=? OR token_type=?) AND expired_unix_time>?', uid, USER_TOKEN_TYPE_NORMAL, USER_TOKEN_TYPE_MCP, USER_TOKEN_TYPE_API, now)
            .find(TokenRecordTable);
    }

    // parseToken returns the token model according to token string
    public async parseToken(c: Context, token: string): Promise<ParsedToken> {
        let tokenContext = '';

        try {
            const claims = await parseAndVerifyJwt(token, async claims => {
                const now = nowUnix();
                let userTokenId: bigint;

                try {
                    userTokenId = stringToInt64(claims.userTokenId);
                } catch (err) {
                    log.warnf(c, `[tokens.parseToken] token "utid:${claims.userTokenId}" in token of user "uid:${claims.uid}" is invalid, because ${(err as Error).message}`);
                    throw errs.ErrInvalidUserTokenId;
                }

                let tokenRecord: TokenRecord;

                try {
                    tokenRecord = await this.getTokenRecord(c, claims.uid, userTokenId, claims.issuedAt);
                } catch (err) {
                    log.warnf(c, `[tokens.parseToken] token "utid:${claims.userTokenId}" of user "uid:${claims.uid}" record not found, because ${(err as Error).message}`);
                    throw errs.ErrTokenRecordNotFound;
                }

                if (tokenRecord.expiredUnixTime < now) {
                    log.warnf(c, `[tokens.parseToken] token "utid:${claims.userTokenId}" of user "uid:${claims.uid}" record is expired`);
                    throw errs.ErrTokenExpired;
                }

                tokenContext = tokenRecord.context;
                return tokenRecord.secret;
            });

            return { claims: claims, tokenContext: tokenContext };
        } catch (err) {
            if (err instanceof JwtError) {
                if (err.kind === 'malformed' || err.kind === 'unverifiable' || err.kind === 'signature_invalid') {
                    log.warnf(c, `[tokens.parseToken] token is invalid, because ${err.message}${err.cause ? ': ' + (err.cause as Error).message : ''}`);
                    throw errs.ErrCurrentInvalidToken;
                }

                if (err.kind === 'expired') {
                    throw errs.ErrCurrentTokenExpired;
                }

                if (err.kind === 'used_before_issued') {
                    log.warnf(c, '[tokens.parseToken] token is invalid, because issue time is later than now');
                    throw errs.ErrCurrentInvalidToken;
                }
            }

            throw err;
        }
    }

    // createToken generates a new normal token and saves to database
    public async createToken(c: RequestContext, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_NORMAL, this.getUserAgent(c), '', this.currentConfig().tokenExpiredTime);
        return [token, claims];
    }

    // createRequire2FAToken generates a new token requiring user to verify 2fa passcode and saves to database
    public async createRequire2FAToken(c: RequestContext, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_REQUIRE_2FA, this.getUserAgent(c), '', this.currentConfig().temporaryTokenExpiredTime);
        return [token, claims];
    }

    // createEmailVerifyToken generates a new email verify token and saves to database
    public async createEmailVerifyToken(c: RequestContext, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_EMAIL_VERIFY, this.getUserAgent(c), '', this.currentConfig().emailVerifyTokenExpiredTime);
        return [token, claims];
    }

    // createEmailVerifyTokenWithoutUserAgent generates a new email verify token and saves to database
    public async createEmailVerifyTokenWithoutUserAgent(c: Context, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_EMAIL_VERIFY, '', '', this.currentConfig().emailVerifyTokenExpiredTime);
        return [token, claims];
    }

    // createPasswordResetToken generates a new password reset token and saves to database
    public async createPasswordResetToken(c: RequestContext, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_PASSWORD_RESET, this.getUserAgent(c), '', this.currentConfig().passwordResetTokenExpiredTime);
        return [token, claims];
    }

    // createPasswordResetTokenWithoutUserAgent generates a new password reset token and saves to database
    public async createPasswordResetTokenWithoutUserAgent(c: Context, user: User): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_PASSWORD_RESET, '', '', this.currentConfig().passwordResetTokenExpiredTime);
        return [token, claims];
    }

    // createAPIToken generates a new api token and saves to database
    public async createAPIToken(c: RequestContext, user: User, expiresInSeconds: number): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_API, this.getUserAgent(c), '', this.getTokenExpiredTimeDuration(expiresInSeconds));
        return [token, claims];
    }

    // createAPITokenViaCli generates a new api token and saves to database
    public async createAPITokenViaCli(c: Context, user: User, expiresInSeconds: number): Promise<[string, TokenRecord]> {
        const [token, , tokenRecord] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_API, TokenUserAgentCreatedViaCli, '', this.getTokenExpiredTimeDuration(expiresInSeconds));
        return [token, tokenRecord];
    }

    // createMCPToken generates a new MCP token and saves to database
    public async createMCPToken(c: RequestContext, user: User, expiresInSeconds: number): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_MCP, this.getUserAgent(c), '', this.getTokenExpiredTimeDuration(expiresInSeconds));
        return [token, claims];
    }

    // createMCPTokenViaCli generates a new MCP token and saves to database
    public async createMCPTokenViaCli(c: Context, user: User, expiresInSeconds: number): Promise<[string, TokenRecord]> {
        const [token, , tokenRecord] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_MCP, TokenUserAgentCreatedViaCli, '', this.getTokenExpiredTimeDuration(expiresInSeconds));
        return [token, tokenRecord];
    }

    // createOAuth2CallbackRequireVerifyToken generates a new OAuth 2.0 callback token requiring user to verify and saves to database
    public async createOAuth2CallbackRequireVerifyToken(c: RequestContext, user: User, context: string): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY, this.getUserAgent(c), context, this.currentConfig().temporaryTokenExpiredTime);
        return [token, claims];
    }

    // createOAuth2CallbackToken generates a new OAuth 2.0 callback token and saves to database
    public async createOAuth2CallbackToken(c: RequestContext, user: User, context: string): Promise<[string, UserTokenClaims]> {
        const [token, claims] = await this.createTokenInternal(c, user, USER_TOKEN_TYPE_OAUTH2_CALLBACK, this.getUserAgent(c), context, this.currentConfig().temporaryTokenExpiredTime);
        return [token, claims];
    }

    // updateTokenLastSeen updates the last seen time of specified token
    public async updateTokenLastSeen(c: Context, tokenRecord: TokenRecord): Promise<void> {
        if (tokenRecord.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tokenRecord.userTokenId <= 0n) {
            throw errs.ErrInvalidUserTokenId;
        }

        tokenRecord.lastSeenUnixTime = nowUnix();

        await this.tokenDB(tokenRecord.uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('last_seen_unix_time').where('uid=? AND user_token_id=? AND created_unix_time=?', tokenRecord.uid, tokenRecord.userTokenId, tokenRecord.createdUnixTime).update(TokenRecordTable, tokenRecord);

            if (updatedRows < 1) {
                throw errs.ErrTokenRecordNotFound;
            }
        });
    }

    // deleteToken deletes given token from database
    public async deleteToken(c: Context, tokenRecord: Pick<TokenRecord, 'uid' | 'userTokenId' | 'createdUnixTime'>): Promise<void> {
        if (tokenRecord.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tokenRecord.userTokenId <= 0n) {
            throw errs.ErrInvalidUserTokenId;
        }

        await this.tokenDB(tokenRecord.uid).doTransaction(c, async sess => {
            const deletedRows = await sess.where('uid=? AND user_token_id=? AND created_unix_time=?', tokenRecord.uid, tokenRecord.userTokenId, tokenRecord.createdUnixTime).delete(TokenRecordTable);

            if (deletedRows < 1) {
                throw errs.ErrTokenRecordNotFound;
            }
        });
    }

    // deleteTokens deletes given tokens from database
    public async deleteTokens(c: Context, uid: bigint, tokenRecords: TokenRecord[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.tokenDB(uid).doTransaction(c, async sess => {
            for (const tokenRecord of tokenRecords) {
                const deletedRows = await sess.where('uid=? AND user_token_id=? AND created_unix_time=?', uid, tokenRecord.userTokenId, tokenRecord.createdUnixTime).delete(TokenRecordTable);

                if (deletedRows < 1) {
                    throw errs.ErrTokenRecordNotFound;
                }
            }
        });
    }

    // deleteTokenByClaims deletes given token from database
    public async deleteTokenByClaims(c: Context, claims: UserTokenClaims): Promise<void> {
        let userTokenId: bigint;

        try {
            userTokenId = stringToInt64(claims.userTokenId);
        } catch {
            throw errs.ErrInvalidUserTokenId;
        }

        await this.deleteToken(c, { uid: claims.uid, userTokenId: userTokenId, createdUnixTime: claims.issuedAt });
    }

    // deleteTokensBeforeTime deletes tokens that is created before specific time
    public async deleteTokensBeforeTime(c: Context, uid: bigint, createTime: number): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.tokenDB(uid).doTransaction(c, async sess => {
            await sess.where('uid=? AND created_unix_time<?', uid, createTime).delete(TokenRecordTable);
        });
    }

    // deleteTokensByType deletes specified type tokens
    public async deleteTokensByType(c: Context, uid: bigint, tokenType: TokenType): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.tokenDB(uid).doTransaction(c, async sess => {
            await sess.where('uid=? AND token_type=?', uid, tokenType).delete(TokenRecordTable);
        });
    }

    // deleteAllExpiredTokens deletes all expired tokens
    public async deleteAllExpiredTokens(c: Context): Promise<void> {
        const errors: unknown[] = [];
        let totalCount = 0;

        for (let i = 0; i < this.tokenDBCount(); i++) {
            try {
                await this.tokenDBByIndex(i).doTransaction(c, async sess => {
                    totalCount += await sess.where('expired_unix_time<=?', nowUnix()).delete(TokenRecordTable);
                });
            } catch (err) {
                errors.push(err);
            }
        }

        if (totalCount > 0) {
            log.infof(c, `[tokens.DeleteAllExpiredTokens] ${totalCount} expired tokens have been deleted`);
        } else if (errors.length === 0) {
            log.infof(c, '[tokens.DeleteAllExpiredTokens] no expired tokens have been deleted');
        }

        const err = errs.newMultiErrorOrNil(...errors);

        if (err) {
            throw err;
        }
    }

    // existsValidTokenByType returns whether the given token type exists
    public async existsValidTokenByType(c: Context, uid: bigint, tokenType: TokenType): Promise<boolean> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        return this.tokenDB(uid).newSession(c).cols('uid', 'user_token_id', 'expired_unix_time').where('uid=? AND token_type=? AND expired_unix_time>?', uid, tokenType, now).exist(TokenRecordTable);
    }

    // parseFromTokenId returns token model according to token id
    public parseFromTokenId(tokenId: string): TokenRecord {
        const pairs = tokenId.split(':');

        if (pairs.length !== 3) {
            throw errs.ErrInvalidTokenId;
        }

        try {
            return newTokenRecord({
                uid: stringToInt64(pairs[0]!),
                createdUnixTime: Number(stringToInt64(pairs[1]!)),
                userTokenId: stringToInt64(pairs[2]!),
            });
        } catch {
            throw errs.ErrInvalidTokenId;
        }
    }

    // generateTokenId generates token id according to token model
    public generateTokenId(tokenRecord: TokenRecord): string {
        return `${tokenRecord.uid}:${tokenRecord.createdUnixTime}:${tokenRecord.userTokenId}`;
    }

    private getTokenExpiredTimeDuration(expiresInSeconds: number): number {
        if (expiresInSeconds > 0) {
            return expiresInSeconds;
        }

        return tokenMaxExpiredAtUnixTime - nowUnix();
    }

    private async createTokenInternal(c: Context, user: User, tokenType: TokenType, userAgent: string, context: string, expiryDateSeconds: number): Promise<[string, UserTokenClaims, TokenRecord]> {
        const now = nowUnix();
        const tokenRecord = newTokenRecord({
            uid: user.uid,
            userTokenId: this.getUserTokenId(),
            tokenType: tokenType,
            userAgent: userAgent,
            context: context,
            createdUnixTime: now,
            expiredUnixTime: now + expiryDateSeconds,
            lastSeenUnixTime: now,
        });

        tokenRecord.secret = getRandomString(10);

        const claims: UserTokenClaims = {
            userTokenId: tokenRecord.userTokenId.toString(),
            uid: tokenRecord.uid,
            username: user.username,
            type: tokenRecord.tokenType,
            issuedAt: tokenRecord.createdUnixTime,
            expiresAt: tokenRecord.expiredUnixTime,
        };

        const tokenString = signJwt(claims, tokenRecord.secret);
        await this.createTokenRecord(c, tokenRecord);

        return [tokenString, claims, tokenRecord];
    }

    private async getTokenRecord(c: Context, uid: bigint, userTokenId: bigint, createUnixTime: number): Promise<TokenRecord> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (userTokenId <= 0n) {
            throw errs.ErrInvalidUserTokenId;
        }

        const tokenRecord = await this.tokenDB(uid).newSession(c).where('uid=? AND user_token_id=? AND created_unix_time=?', uid, userTokenId, createUnixTime).limit(1).get(TokenRecordTable);

        if (!tokenRecord) {
            throw errs.ErrTokenRecordNotFound;
        }

        return tokenRecord;
    }

    private async createTokenRecord(c: Context, tokenRecord: TokenRecord): Promise<void> {
        if (tokenRecord.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (tokenRecord.userTokenId <= 0n) {
            throw errs.ErrInvalidUserTokenId;
        }

        await this.tokenDB(tokenRecord.uid).doTransaction(c, async sess => {
            await sess.insert(TokenRecordTable, tokenRecord);
        });
    }

    private getUserTokenId(): bigint {
        const nanoSeconds = BigInt((Date.now() % 1000) * 1000000 + Math.floor((performance.now() % 1) * 1000000));
        const randomNumber = BigInt(randomInt(2147483647));
        return (nanoSeconds << 32n) | randomNumber;
    }

    private getUserAgent(ctx: RequestContext | null): string {
        let userAgent = ctx ? ctx.requestUserAgent() : '';

        if (userAgent.length > TokenMaxUserAgentLength) {
            userAgent = subString(userAgent, 0, TokenMaxUserAgentLength);
        }

        return userAgent;
    }
}

export const Tokens = new TokenService();
