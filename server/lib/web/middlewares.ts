import {
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
import { Container as RequestIdContainer } from '../requestid/index';
import { Tokens } from '../services/tokens';
import type { Config } from '../settings/settings';
import type { WebMiddlewareFunc } from './bind';
import type { WebContext } from './context';
import { printJsonErrorResult } from './response';

const requestIdHeader = 'X-Request-ID';

type TokenSourceType = 'header' | 'argument' | 'cookie';

async function parseToken(c: WebContext, source: TokenSourceType): Promise<[UserTokenClaims, string]> {
    let tokenString: string;

    if (source === 'argument') {
        tokenString = c.getTokenStringFromQueryString();
    } else if (source === 'cookie') {
        tokenString = c.getTokenStringFromCookie();
    } else {
        tokenString = c.getTokenStringFromHeader();
    }

    if (tokenString === '') {
        throw errs.ErrTokenIsEmpty;
    }

    const parsed = await Tokens.parseToken(c, tokenString);
    return [parsed.claims, parsed.tokenContext];
}

async function getTokenClaims(c: WebContext, source: TokenSourceType): Promise<[UserTokenClaims | null, string, errs.AppError | null]> {
    let claims: UserTokenClaims;
    let tokenContext: string;

    try {
        [claims, tokenContext] = await parseToken(c, source);
    } catch (err) {
        log.warnf(c, `[authorization.getTokenClaims] failed to parse token, because ${(err as Error).message}`);
        return [null, '', errs.or(err, errs.ErrUnauthorizedAccess)];
    }

    if (claims.uid <= 0n) {
        log.warnf(c, '[authorization.getTokenClaims] user id in token is invalid');
        return [null, '', errs.ErrCurrentInvalidToken];
    }

    return [claims, tokenContext, null];
}

function jwtAuthorization(config: Config, source: TokenSourceType, allowedAPIToken: boolean): WebMiddlewareFunc {
    return async (c, next) => {
        const [claims, tokenContext, err] = await getTokenClaims(c, source);

        if (err || !claims) {
            return printJsonErrorResult(c, err ?? errs.ErrUnauthorizedAccess);
        }

        if (claims.type === USER_TOKEN_TYPE_REQUIRE_2FA) {
            log.warnf(c, `[authorization.jwtAuthorization] user "uid:${claims.uid}" token requires 2fa`);
            return printJsonErrorResult(c, errs.ErrCurrentTokenRequire2FA);
        }

        if (claims.type !== USER_TOKEN_TYPE_NORMAL && claims.type !== USER_TOKEN_TYPE_API) {
            log.warnf(c, `[authorization.jwtAuthorization] user "uid:${claims.uid}" token type (${claims.type}) is invalid`);
            return printJsonErrorResult(c, errs.ErrCurrentInvalidTokenType);
        }

        if (claims.type === USER_TOKEN_TYPE_API && !allowedAPIToken) {
            log.warnf(c, `[authorization.jwtAuthorization] user "uid:${claims.uid}" token type (${claims.type}) is not allowed`);
            return printJsonErrorResult(c, errs.ErrCurrentInvalidTokenType);
        }

        if (claims.type === USER_TOKEN_TYPE_API && !config.enableAPIToken) {
            log.warnf(c, '[authorization.jwtAuthorization] api token is not enabled');
            return printJsonErrorResult(c, errs.ErrAPITokenNotEnabled);
        }

        c.setTokenClaims(claims);
        c.setTokenContext(tokenContext);
        await next();
        return undefined;
    };
}

// jwtAuthorizationByHeader verifies whether current request is valid by jwt token in header
export function jwtAuthorizationByHeader(config: Config): WebMiddlewareFunc {
    return jwtAuthorization(config, 'header', true);
}

// jwtAuthorizationByQueryString verifies whether current request is valid by jwt token in query string
export function jwtAuthorizationByQueryString(config: Config): WebMiddlewareFunc {
    return jwtAuthorization(config, 'argument', false);
}

// jwtAuthorizationByCookie verifies whether current request is valid by jwt token in cookie
export function jwtAuthorizationByCookie(config: Config): WebMiddlewareFunc {
    return jwtAuthorization(config, 'cookie', false);
}

function specialTokenAuthorization(source: TokenSourceType, expectedTypes: number[], parseError: errs.AppError | null, typeError: errs.AppError, logMessage: (claims: UserTokenClaims) => string): WebMiddlewareFunc {
    return async (c, next) => {
        const [claims, tokenContext, err] = await getTokenClaims(c, source);

        if (err || !claims) {
            return printJsonErrorResult(c, parseError ?? err ?? errs.ErrUnauthorizedAccess);
        }

        if (!expectedTypes.includes(claims.type)) {
            log.warnf(c, logMessage(claims));
            return printJsonErrorResult(c, typeError);
        }

        c.setTokenClaims(claims);
        c.setTokenContext(tokenContext);
        await next();
        return undefined;
    };
}

// jwtTwoFactorAuthorization verifies whether current request is valid by 2fa passcode
export function jwtTwoFactorAuthorization(_config: Config): WebMiddlewareFunc {
    return specialTokenAuthorization('header', [USER_TOKEN_TYPE_REQUIRE_2FA], null, errs.ErrCurrentTokenNotRequire2FA,
        claims => `[authorization.JWTTwoFactorAuthorization] user "uid:${claims.uid}" token is not need two-factor authorization`);
}

// jwtEmailVerifyAuthorization verifies whether current request is email verification
export function jwtEmailVerifyAuthorization(_config: Config): WebMiddlewareFunc {
    return specialTokenAuthorization('argument', [USER_TOKEN_TYPE_EMAIL_VERIFY], errs.ErrEmailVerifyTokenIsInvalidOrExpired, errs.ErrCurrentInvalidToken,
        claims => `[authorization.JWTEmailVerifyAuthorization] user "uid:${claims.uid}" token is not for email verification`);
}

// jwtResetPasswordAuthorization verifies whether current request is password reset
export function jwtResetPasswordAuthorization(_config: Config): WebMiddlewareFunc {
    return specialTokenAuthorization('argument', [USER_TOKEN_TYPE_PASSWORD_RESET], errs.ErrPasswordResetTokenIsInvalidOrExpired, errs.ErrCurrentInvalidToken,
        claims => `[authorization.JWTResetPasswordAuthorization] user "uid:${claims.uid}" token is not for password request`);
}

// jwtMCPAuthorization verifies whether current request is valid by mcp token
export function jwtMCPAuthorization(_config: Config): WebMiddlewareFunc {
    return specialTokenAuthorization('header', [USER_TOKEN_TYPE_MCP], null, errs.ErrCurrentInvalidTokenType,
        claims => `[authorization.jwtAuthorization] user "uid:${claims.uid}" token type (${claims.type}) is not mcp token`);
}

// jwtOAuth2CallbackAuthorization verifies whether current request is valid by oauth 2.0 callback token
export function jwtOAuth2CallbackAuthorization(_config: Config): WebMiddlewareFunc {
    return specialTokenAuthorization('header', [USER_TOKEN_TYPE_OAUTH2_CALLBACK, USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY], errs.ErrTokenExpired, errs.ErrCurrentInvalidToken,
        claims => `[authorization.JWTOAuth2CallbackAuthorization] user "uid:${claims.uid}" token is not for oauth 2.0 callback request`);
}

// apiTokenIpLimit limits the remote ip of api token requests
export function apiTokenIpLimit(config: Config): WebMiddlewareFunc {
    return async (c, next) => {
        const claims = c.getTokenClaims();

        if (!claims || claims.type !== USER_TOKEN_TYPE_API || !config.apiTokenAllowedRemoteIPs || config.apiTokenAllowedRemoteIPs.length < 1) {
            await next();
            return;
        }

        for (const pattern of config.apiTokenAllowedRemoteIPs) {
            if (pattern.match(c.clientIP())) {
                await next();
                return;
            }
        }

        return printJsonErrorResult(c, errs.ErrIPForbidden);
    };
}

// mcpServerIpLimit limits the remote ip of mcp requests
export function mcpServerIpLimit(config: Config): WebMiddlewareFunc {
    return async (c, next) => {
        if (!config.mcpAllowedRemoteIPs || config.mcpAllowedRemoteIPs.length < 1) {
            await next();
            return;
        }

        for (const pattern of config.mcpAllowedRemoteIPs) {
            if (pattern.match(c.clientIP())) {
                await next();
                return;
            }
        }

        return printJsonErrorResult(c, errs.ErrIPForbidden);
    };
}

// requestId generates a new request id and add it to context and response header
export function requestId(config: Config): WebMiddlewareFunc {
    return async (c, next) => {
        const newRequestId = RequestIdContainer.generateRequestId(c.clientIP(), c.clientPort());
        c.setContextId(newRequestId);

        if (config.enableRequestIdHeader) {
            c.header(requestIdHeader, newRequestId);
        }

        await next();
    };
}

// requestLog logs the http request
export const requestLog: WebMiddlewareFunc = async (c, next) => {
    const start = Date.now();
    let path = c.path;
    const query = c.rawQuery;

    await next();

    const statusCode = c.getResponseStatus();
    const claims = c.getTokenClaims();
    const err = c.getResponseError();
    const userId = claims ? claims.uid.toString() : '-';
    const errorCode = err ? err.code : 0;

    if (query !== '') {
        path = path + '?' + query;
    }

    log.requestf(c, `${statusCode} ${errorCode} ${userId} ${c.clientIP()} ${c.method} ${path} ${Date.now() - start}ms`);
};
