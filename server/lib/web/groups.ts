import type { Config } from '../settings/settings';
import type { WebMiddlewareFunc } from './bind';
import * as middlewares from './middlewares';

// The middlewares of the route groups (same as the gin router groups of the original program)

// requestIdGroup is the group of the routes which only generate request id (e.g. /qrcode)
export function requestIdGroup(config: Config): WebMiddlewareFunc[] {
    return [middlewares.requestId(config)];
}

// apiGroup is the group of /api, /oauth2 routes
export function apiGroup(config: Config): WebMiddlewareFunc[] {
    return [middlewares.requestId(config), middlewares.requestLog];
}

// apiV1Group is the group of /api/v1 routes which require user logged in
export function apiV1Group(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.jwtAuthorizationByHeader(config), middlewares.apiTokenIpLimit(config)];
}

// twoFactorApiGroup is the group of /api/2fa routes
export function twoFactorApiGroup(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.jwtTwoFactorAuthorization(config)];
}

// oauth2CallbackApiGroup is the group of /api/oauth2 routes
export function oauth2CallbackApiGroup(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.jwtOAuth2CallbackAuthorization(config)];
}

// emailVerifyApiGroup is the group of /api/verify_email routes which require email verify token
export function emailVerifyApiGroup(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.jwtEmailVerifyAuthorization(config)];
}

// resetPasswordApiGroup is the group of /api/forget_password/reset routes
export function resetPasswordApiGroup(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.jwtResetPasswordAuthorization(config)];
}

// queryStringTokenGroup is the group of /avatar, /pictures, /icons and /proxy routes
export function queryStringTokenGroup(config: Config): WebMiddlewareFunc[] {
    return [middlewares.jwtAuthorizationByQueryString(config)];
}

// cookieTokenGroup is the group of /_AMapService routes
export function cookieTokenGroup(config: Config): WebMiddlewareFunc[] {
    return [middlewares.jwtAuthorizationByCookie(config)];
}

// mcpGroup is the group of /mcp routes
export function mcpGroup(config: Config): WebMiddlewareFunc[] {
    return [...apiGroup(config), middlewares.mcpServerIpLimit(config), middlewares.jwtMCPAuthorization(config)];
}
