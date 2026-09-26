import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_GENERATE_API_TOKEN, USER_FEATURE_RESTRICTION_TYPE_MCP_ACCESS, USER_FEATURE_RESTRICTION_TYPE_REVOKE_OTHER_SESSION } from '../core/feature_restriction';
import { TokenUserAgentCreatedViaCli, TokenUserAgentForAPI, TokenUserAgentForMCP, USER_TOKEN_TYPE_API, USER_TOKEN_TYPE_MCP, USER_TOKEN_TYPE_NORMAL, type UserTokenClaims } from '../core/token_claims';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { newTokenRecord, sortTokenInfoResponses, type TokenGenerateAPIRequest, type TokenGenerateAPIResponse, type TokenGenerateMCPRequest, type TokenGenerateMCPResponse, type TokenInfoResponse, type TokenRecord, type TokenRefreshResponse, type TokenRevokeRequest, type User } from '../models/index';
import { Tokens } from '../services/tokens';
import { Users } from '../services/users';
import { stringToInt64 } from '../utils/converter';
import type { WebContext } from '../web/context';
import { currentConfig, errMsg, getAfterOpenNotificationContent, getLatestApplicationCloudSettings, getUserBasicInfo } from './base';
import { TokenGenerateRequestSchema, TokenRevokeRequestSchema } from './schemas';

function isCurrentToken(token: TokenRecord, claims: UserTokenClaims): boolean {
    return token.uid === claims.uid && token.userTokenId.toString() === claims.userTokenId && token.createdUnixTime === claims.issuedAt;
}

// tokenListHandler returns available token list of current user
export async function tokenListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    let tokens: TokenRecord[];

    try {
        tokens = await Tokens.getAllUnexpiredNormalAndMCPTokensByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[tokens.TokenListHandler] failed to get all tokens for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const claims = c.getTokenClaims()!;
    const tokenResps: TokenInfoResponse[] = tokens.map(token => {
        const tokenResp: TokenInfoResponse = {
            tokenId: Tokens.generateTokenId(token),
            tokenType: token.tokenType,
            userAgent: token.userAgent,
            lastSeen: token.lastSeenUnixTime,
            isCurrent: isCurrentToken(token, claims),
        };

        if (token.tokenType === USER_TOKEN_TYPE_API && token.userAgent !== TokenUserAgentCreatedViaCli) {
            tokenResp.userAgent = TokenUserAgentForAPI;
        } else if (token.tokenType === USER_TOKEN_TYPE_MCP && token.userAgent !== TokenUserAgentCreatedViaCli) {
            tokenResp.userAgent = TokenUserAgentForMCP;
        }

        return tokenResp;
    });

    return sortTokenInfoResponses(tokenResps);
}

async function getUserForTokenGeneration(c: WebContext, logPrefix: string, tokenKind: string): Promise<User> {
    const uid = c.getCurrentUid();
    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, `[${logPrefix}] current token is null`);
        throw errs.ErrInvalidToken;
    } else if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[${logPrefix}] token type "${claims.type}" is not allowed to generate ${tokenKind} tokens`);
        throw errs.ErrInvalidToken;
    }

    try {
        return await Users.getUserById(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to get user "uid:${uid}" info, because ${errMsg(err)}`);
        throw errs.ErrUserNotFound;
    }
}

// tokenGenerateAPIHandler generates a new API token for current user
export async function tokenGenerateAPIHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'tokens.TokenGenerateAPIHandler';

    if (!currentConfig().enableAPIToken) {
        throw errs.ErrAPITokenNotEnabled;
    }

    let generateAPITokenReq: TokenGenerateAPIRequest;

    try {
        generateAPITokenReq = await c.shouldBindJSON<TokenGenerateAPIRequest>(TokenGenerateRequestSchema);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }

    const user = await getUserForTokenGeneration(c, logPrefix, 'API');

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_GENERATE_API_TOKEN)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (!Users.isPasswordEqualsUserPassword(generateAPITokenReq.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    let token: string;
    let claims: UserTokenClaims;

    try {
        [token, claims] = await Tokens.createAPIToken(c, user, generateAPITokenReq.expiresInSeconds);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create api token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrTokenGenerating);
    }

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has generated api token, new token will be expired at ${claims.expiresAt}`);

    const response: TokenGenerateAPIResponse = {
        token: token,
        apiBaseUrl: currentConfig().rootUrl + 'api',
    };

    return response;
}

// tokenGenerateMCPHandler generates a new MCP token for current user
export async function tokenGenerateMCPHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'tokens.TokenGenerateMCPHandler';

    if (!currentConfig().enableMCPServer) {
        throw errs.ErrMCPServerNotEnabled;
    }

    let generateMCPTokenReq: TokenGenerateMCPRequest;

    try {
        generateMCPTokenReq = await c.shouldBindJSON<TokenGenerateMCPRequest>(TokenGenerateRequestSchema);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }

    const user = await getUserForTokenGeneration(c, logPrefix, 'MCP');

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_MCP_ACCESS)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (!Users.isPasswordEqualsUserPassword(generateMCPTokenReq.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    let token: string;
    let claims: UserTokenClaims;

    try {
        [token, claims] = await Tokens.createMCPToken(c, user, generateMCPTokenReq.expiresInSeconds);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create mcp token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrTokenGenerating);
    }

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has generated mcp token, new token will be expired at ${claims.expiresAt}`);

    const response: TokenGenerateMCPResponse = {
        token: token,
        mcpUrl: currentConfig().rootUrl + 'mcp',
    };

    return response;
}

// tokenRevokeCurrentHandler revokes current token of current user
export async function tokenRevokeCurrentHandler(c: WebContext): Promise<unknown> {
    const tokenString = c.getTokenStringFromHeader();

    if (tokenString === '') {
        throw errs.ErrTokenIsEmpty;
    }

    let claims: UserTokenClaims;

    try {
        claims = (await Tokens.parseToken(c, tokenString)).claims;
    } catch (err) {
        throw errs.or(err, errs.newIncompleteOrIncorrectSubmissionError(err));
    }

    let userTokenId: bigint;

    try {
        userTokenId = stringToInt64(claims.userTokenId);
    } catch (err) {
        log.warnf(c, `[tokens.TokenRevokeCurrentHandler] parse user token id failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }

    const tokenRecord = newTokenRecord({ uid: claims.uid, userTokenId: userTokenId, createdUnixTime: claims.issuedAt });
    const tokenId = Tokens.generateTokenId(tokenRecord);

    try {
        await Tokens.deleteToken(c, tokenRecord);
    } catch (err) {
        log.errorf(c, `[tokens.TokenRevokeCurrentHandler] failed to revoke token "id:${tokenId}" for user "uid:${claims.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[tokens.TokenRevokeCurrentHandler] user "uid:${claims.uid}" has revoked token "id:${tokenId}"`);
    return true;
}

// tokenRevokeHandler revokes specific token of current user
export async function tokenRevokeHandler(c: WebContext): Promise<unknown> {
    let tokenRevokeReq: TokenRevokeRequest;

    try {
        tokenRevokeReq = await c.shouldBindJSON<TokenRevokeRequest>(TokenRevokeRequestSchema);
    } catch (err) {
        log.warnf(c, `[tokens.TokenRevokeHandler] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }

    let tokenRecord: TokenRecord;

    try {
        tokenRecord = Tokens.parseFromTokenId(tokenRevokeReq.tokenId);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[tokens.TokenRevokeHandler] failed to parse token "id:${tokenRevokeReq.tokenId}", because ${errMsg(err)}`);
        }

        throw errs.or(err, errs.ErrInvalidTokenId);
    }

    const uid = c.getCurrentUid();

    if (tokenRecord.uid !== uid) {
        log.warnf(c, `[tokens.TokenRevokeHandler] token "id:${tokenRevokeReq.tokenId}" is not owned by user "uid:${uid}"`);
        throw errs.ErrInvalidTokenId;
    }

    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, '[tokens.TokenRevokeHandler] current token is null');
        throw errs.ErrInvalidToken;
    }

    if (tokenRecord.userTokenId.toString() !== claims.userTokenId || tokenRecord.createdUnixTime !== claims.issuedAt) {
        if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
            log.warnf(c, `[tokens.TokenRevokeHandler] token type "${claims.type}" is not allowed to revoke other tokens`);
            throw errs.ErrInvalidToken;
        }

        let user: User;

        try {
            user = await Users.getUserById(c, uid);
        } catch (err) {
            if (!errs.isCustomError(err)) {
                log.errorf(c, `[tokens.TokenRevokeHandler] failed to get user, because ${errMsg(err)}`);
            }

            throw errs.ErrUserNotFound;
        }

        if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_REVOKE_OTHER_SESSION)) {
            throw errs.ErrNotPermittedToPerformThisAction;
        }
    }

    try {
        await Tokens.deleteToken(c, tokenRecord);
    } catch (err) {
        log.errorf(c, `[tokens.TokenRevokeHandler] failed to revoke token "id:${tokenRevokeReq.tokenId}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[tokens.TokenRevokeHandler] user "uid:${uid}" has revoked token "id:${tokenRevokeReq.tokenId}"`);
    return true;
}

// tokenRevokeAllHandler revokes all tokens of current user except current token
export async function tokenRevokeAllHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, '[tokens.TokenRevokeAllHandler] current token is null');
        throw errs.ErrInvalidToken;
    } else if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[tokens.TokenRevokeAllHandler] token type "${claims.type}" is not allowed to revoke all tokens`);
        throw errs.ErrInvalidToken;
    }

    let tokens: TokenRecord[];

    try {
        tokens = await Tokens.getAllTokensByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[tokens.TokenRevokeAllHandler] failed to get all tokens for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    let currentTokenIndex = 0;

    for (let i = 0; i < tokens.length; i++) {
        if (isCurrentToken(tokens[i]!, claims)) {
            currentTokenIndex = i;
            break;
        }
    }

    tokens.splice(currentTokenIndex, 1);

    if (tokens.length < 1) {
        throw errs.ErrTokenRecordNotFound;
    }

    let user: User;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[tokens.TokenRevokeAllHandler] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_REVOKE_OTHER_SESSION)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    try {
        await Tokens.deleteTokens(c, uid, tokens);
    } catch (err) {
        log.errorf(c, `[tokens.TokenRevokeAllHandler] failed to revoke all tokens for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[tokens.TokenRevokeAllHandler] user "uid:${uid}" has revoked all tokens`);
    return true;
}

function buildTokenRefreshResponse(c: WebContext, user: User, newToken: string, oldTokenId: string, applicationCloudSettings: ReturnType<typeof getLatestApplicationCloudSettings> extends Promise<infer T> ? T : never): TokenRefreshResponse {
    const response: Record<string, unknown> = {};

    if (newToken !== '') {
        response['newToken'] = newToken;
    }

    if (oldTokenId !== '') {
        response['oldTokenId'] = oldTokenId;
    }

    response['user'] = getUserBasicInfo(user);

    if (applicationCloudSettings) {
        response['applicationCloudSettings'] = applicationCloudSettings;
    }

    const notificationContent = getAfterOpenNotificationContent(user.language, c.getClientLocale());

    if (notificationContent !== '') {
        response['notificationContent'] = notificationContent;
    }

    return response as unknown as TokenRefreshResponse;
}

// tokenRefreshHandler refreshes current token of current user
export async function tokenRefreshHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'tokens.TokenRefreshHandler';
    const uid = c.getCurrentUid();
    let user: User;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to get user "uid:${uid}" info, because ${errMsg(err)}`);
        throw errs.ErrUserNotFound;
    }

    const now = Math.floor(Date.now() / 1000);
    const oldTokenClaims = c.getTokenClaims();

    if (!oldTokenClaims) {
        log.warnf(c, `[${logPrefix}] current token is null`);
        throw errs.ErrInvalidToken;
    } else if (oldTokenClaims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[${logPrefix}] token type "${oldTokenClaims.type}" is not allowed to be refreshed`);
        throw errs.ErrInvalidToken;
    }

    if (now - oldTokenClaims.issuedAt < currentConfig().tokenMinRefreshInterval) {
        log.infof(c, `[${logPrefix}] token of user "uid:${uid}" does not need to be refreshed`);

        try {
            const userTokenId = stringToInt64(oldTokenClaims.userTokenId);
            const tokenRecord = newTokenRecord({ uid: oldTokenClaims.uid, userTokenId: userTokenId, createdUnixTime: oldTokenClaims.issuedAt });
            const tokenId = Tokens.generateTokenId(tokenRecord);

            try {
                await Tokens.updateTokenLastSeen(c, tokenRecord);
            } catch (err) {
                log.warnf(c, `[${logPrefix}] failed to update last seen of token "id:${tokenId}" for user "uid:${uid}", because ${errMsg(err)}`);
            }
        } catch (err) {
            log.warnf(c, `[${logPrefix}] parse user token id failed, because ${errMsg(err)}`);
        }

        const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, logPrefix);
        return buildTokenRefreshResponse(c, user, '', '', applicationCloudSettings);
    }

    let token: string;
    let claims: UserTokenClaims;

    try {
        [token, claims] = await Tokens.createToken(c, user);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrTokenGenerating);
    }

    let oldUserTokenId = 0n;

    try {
        oldUserTokenId = stringToInt64(oldTokenClaims.userTokenId);
    } catch {
        oldUserTokenId = 0n;
    }

    const oldTokenRecord = newTokenRecord({ uid: uid, userTokenId: oldUserTokenId, createdUnixTime: oldTokenClaims.issuedAt });

    c.setTextualToken(token);
    c.setTokenClaims(claims);
    c.setTokenContext('');

    const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, logPrefix);

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" token refreshed, new token will be expired at ${claims.expiresAt}`);

    return buildTokenRefreshResponse(c, user, token, Tokens.generateTokenId(oldTokenRecord), applicationCloudSettings);
}
