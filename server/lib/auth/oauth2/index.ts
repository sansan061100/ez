import { createHash } from 'node:crypto';

import { createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet, jwtVerify } from 'jose';

import type { Context } from '../../core/context';
import {
    getOutgoingUserAgent,
    USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITEA,
    USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITHUB,
    USER_EXTERNAL_AUTH_TYPE_OAUTH2_NEXTCLOUD,
    USER_EXTERNAL_AUTH_TYPE_OAUTH2_OIDC,
    type UserExternalAuthType,
} from '../../core/types';
import * as errs from '../../errs/index';
import { type HttpClient, newHttpClient } from '../../httpclient/index';
import * as log from '../../log/index';
import { type Config, OAuth2ProviderGitea, OAuth2ProviderGithub, OAuth2ProviderNextcloud, OAuth2ProviderOIDC } from '../../settings/settings';

// OAuth2UserInfo represents the user info retrieved from oauth 2.0 provider
export interface OAuth2UserInfo {
    userName: string;
    email: string;
    nickName: string;
    languageCode: string;
    currencyCode: string;
    firstDayOfWeek: number;
}

// OAuth2Token represents the oauth 2.0 token (same as golang.org/x/oauth2 Token)
export interface OAuth2Token {
    accessToken: string;
    tokenType: string;
    refreshToken: string;
    expiry: number;
    raw: Record<string, unknown>;
}

export type AuthCodeOption = [string, string];

interface OAuth2Endpoint {
    authURL: string;
    tokenURL: string;
}

interface OAuth2Config {
    clientID: string;
    clientSecret: string;
    endpoint: OAuth2Endpoint;
    redirectURL: string;
    scopes: string[];
}

// OAuth2Provider represents the oauth 2.0 provider interface
export interface OAuth2Provider {
    getOAuth2AuthUrl(c: Context, httpClient: HttpClient, state: string, opts: AuthCodeOption[]): Promise<string>;
    getOAuth2Token(c: Context, httpClient: HttpClient, code: string, opts: AuthCodeOption[]): Promise<OAuth2Token>;
    getUserInfo(c: Context, httpClient: HttpClient, token: OAuth2Token): Promise<OAuth2UserInfo>;
}

function goQueryEscape(s: string): string {
    return encodeURIComponent(s)
        .replace(/%20/g, '+')
        .replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

// encodeValues encodes the values like go url.Values.Encode (sorted by key)
function encodeValues(values: Record<string, string>): string {
    return Object.keys(values).sort().map(key => `${goQueryEscape(key)}=${goQueryEscape(values[key] as string)}`).join('&');
}

function newUserInfo(userName: string, email: string, nickName: string): OAuth2UserInfo {
    return { userName, email, nickName, languageCode: '', currencyCode: '', firstDayOfWeek: 0 };
}

// tokenType returns the normalized token type (same as golang.org/x/oauth2 Token.Type)
function tokenType(token: OAuth2Token): string {
    const type = token.tokenType.toLowerCase();

    if (type === 'bearer' || token.tokenType === '') {
        return 'Bearer';
    } else if (type === 'mac') {
        return 'MAC';
    } else if (type === 'basic') {
        return 'Basic';
    }

    return token.tokenType;
}

function authCodeURL(config: OAuth2Config, state: string, opts: AuthCodeOption[]): string {
    const values: Record<string, string> = {
        response_type: 'code',
        client_id: config.clientID,
    };

    if (config.redirectURL !== '') {
        values['redirect_uri'] = config.redirectURL;
    }

    if (config.scopes.length > 0) {
        values['scope'] = config.scopes.join(' ');
    }

    if (state !== '') {
        values['state'] = state;
    }

    for (const [key, value] of opts) {
        values[key] = value;
    }

    return config.endpoint.authURL + (config.endpoint.authURL.includes('?') ? '&' : '?') + encodeValues(values);
}

const authStyleCache = new Map<string, 'header' | 'params'>();

async function retrieveToken(httpClient: HttpClient, config: OAuth2Config, values: Record<string, string>, authStyle: 'header' | 'params'): Promise<OAuth2Token> {
    const params = { ...values };
    const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (authStyle === 'params') {
        params['client_id'] = config.clientID;

        if (config.clientSecret !== '') {
            params['client_secret'] = config.clientSecret;
        }
    } else {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${goQueryEscape(config.clientID)}:${goQueryEscape(config.clientSecret)}`).toString('base64');
    }

    const response = await httpClient.request(config.endpoint.tokenURL, {
        method: 'POST',
        headers: headers,
        body: encodeValues(params),
    });

    const bodyText = response.body.toString('utf8');

    if (response.status < 200 || response.status > 299) {
        throw new Error(`oauth2: cannot fetch token: ${response.status}\nResponse: ${bodyText}`);
    }

    const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    const token: OAuth2Token = { accessToken: '', tokenType: '', refreshToken: '', expiry: 0, raw: {} };

    if (contentType === 'application/x-www-form-urlencoded' || contentType === 'text/plain') {
        const form = new URLSearchParams(bodyText);
        const raw: Record<string, unknown> = {};

        form.forEach((value, key) => {
            raw[key] = value;
        });

        token.accessToken = form.get('access_token') ?? '';
        token.tokenType = form.get('token_type') ?? '';
        token.refreshToken = form.get('refresh_token') ?? '';
        const expiresIn = parseInt(form.get('expires_in') ?? '', 10);

        if (!isNaN(expiresIn) && expiresIn !== 0) {
            token.expiry = Math.floor(Date.now() / 1000) + expiresIn;
        }

        token.raw = raw;
    } else {
        let data: Record<string, unknown>;

        try {
            data = JSON.parse(bodyText) as Record<string, unknown>;
        } catch (err) {
            throw new Error(`oauth2: cannot parse json: ${(err as Error).message}`);
        }

        token.accessToken = typeof data['access_token'] === 'string' ? data['access_token'] : '';
        token.tokenType = typeof data['token_type'] === 'string' ? data['token_type'] : '';
        token.refreshToken = typeof data['refresh_token'] === 'string' ? data['refresh_token'] : '';
        const expiresIn = Number(data['expires_in'] ?? 0);

        if (Number.isFinite(expiresIn) && expiresIn !== 0) {
            token.expiry = Math.floor(Date.now() / 1000) + expiresIn;
        }

        token.raw = data;
    }

    if (token.accessToken === '') {
        throw new Error('oauth2: server response missing access_token');
    }

    return token;
}

// exchange converts an authorization code into a token (same as golang.org/x/oauth2 Config.Exchange with auto detect auth style)
async function exchange(httpClient: HttpClient, config: OAuth2Config, code: string, opts: AuthCodeOption[]): Promise<OAuth2Token> {
    const values: Record<string, string> = {
        grant_type: 'authorization_code',
        code: code,
    };

    if (config.redirectURL !== '') {
        values['redirect_uri'] = config.redirectURL;
    }

    for (const [key, value] of opts) {
        values[key] = value;
    }

    const cachedStyle = authStyleCache.get(config.endpoint.tokenURL);

    if (cachedStyle) {
        return retrieveToken(httpClient, config, values, cachedStyle);
    }

    try {
        const token = await retrieveToken(httpClient, config, values, 'header');
        authStyleCache.set(config.endpoint.tokenURL, 'header');
        return token;
    } catch {
        const token = await retrieveToken(httpClient, config, values, 'params');
        authStyleCache.set(config.endpoint.tokenURL, 'params');
        return token;
    }
}

async function requestWithToken(c: Context, httpClient: HttpClient, url: string, token: OAuth2Token, headers: Record<string, string>, logPrefix: string, logName: string): Promise<Buffer> {
    let response;

    try {
        response = await httpClient.request(url, {
            method: 'GET',
            headers: { ...headers, Authorization: `${tokenType(token)} ${token.accessToken}` },
            logHandler: body => log.debugf(c, `[${logPrefix}] ${logName} is ${body.toString('utf8')}`),
        });
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get user info response, because ${(err as Error).message}`);
        throw errs.ErrFailedToRequestRemoteApi;
    }

    if (response.status !== 200) {
        log.errorf(c, `[${logPrefix}] failed to get user info response, because response code is ${response.status}`);
        throw errs.ErrFailedToRequestRemoteApi;
    }

    return response.body;
}

function parseJson(body: Buffer): unknown {
    return JSON.parse(body.toString('utf8'));
}

function getStringField(data: Record<string, unknown>, key: string): string {
    const value = data[key];

    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value !== 'string') {
        throw new Error(`json: cannot unmarshal ${typeof value} into Go struct field .${key} of type string`);
    }

    return value;
}

// CommonOAuth2DataSource represents the data source of common oauth 2.0 provider
interface CommonOAuth2DataSource {
    getAuthUrl(): string;
    getTokenUrl(): string;
    getUserInfoUrl(): string;
    getUserInfoRequestHeaders(): Record<string, string>;
    getScopes(): string[];
    parseUserInfo(c: Context, body: Buffer): OAuth2UserInfo;
}

class CommonOAuth2Provider implements OAuth2Provider {
    private readonly oauth2Config: OAuth2Config;
    private readonly dataSource: CommonOAuth2DataSource;

    public constructor(config: Config, redirectUrl: string, dataSource: CommonOAuth2DataSource) {
        this.oauth2Config = {
            clientID: config.oauth2ClientID,
            clientSecret: config.oauth2ClientSecret,
            endpoint: {
                authURL: dataSource.getAuthUrl(),
                tokenURL: dataSource.getTokenUrl(),
            },
            redirectURL: redirectUrl,
            scopes: dataSource.getScopes(),
        };
        this.dataSource = dataSource;
    }

    public async getOAuth2AuthUrl(_c: Context, _httpClient: HttpClient, state: string, opts: AuthCodeOption[]): Promise<string> {
        return authCodeURL(this.oauth2Config, state, opts);
    }

    public async getOAuth2Token(_c: Context, httpClient: HttpClient, code: string, opts: AuthCodeOption[]): Promise<OAuth2Token> {
        return exchange(httpClient, this.oauth2Config, code, opts);
    }

    public async getUserInfo(c: Context, httpClient: HttpClient, token: OAuth2Token): Promise<OAuth2UserInfo> {
        const body = await requestWithToken(c, httpClient, this.dataSource.getUserInfoUrl(), token, this.dataSource.getUserInfoRequestHeaders(), 'common_oauth2_provider.GetUserInfo', 'response');
        return this.dataSource.parseUserInfo(c, body);
    }
}

class NextcloudOAuth2DataSource implements CommonOAuth2DataSource {
    public constructor(private readonly baseUrl: string) {
    }

    public getAuthUrl(): string {
        return this.baseUrl + 'apps/oauth2/authorize';
    }

    public getTokenUrl(): string {
        return this.baseUrl + 'apps/oauth2/api/v1/token';
    }

    public getUserInfoUrl(): string {
        return this.baseUrl + 'ocs/v2.php/cloud/user';
    }

    public getUserInfoRequestHeaders(): Record<string, string> {
        return { 'Accept': 'application/json', 'OCS-APIRequest': 'true' };
    }

    public getScopes(): string[] {
        return [];
    }

    public parseUserInfo(c: Context, body: Buffer): OAuth2UserInfo {
        const prefix = 'nextcloud_oauth2_datasource.ParseUserInfo';
        let ocs: Record<string, unknown> | null;

        try {
            const data = parseJson(body) as Record<string, unknown> | null;
            ocs = (data?.['ocs'] ?? null) as Record<string, unknown> | null;
        } catch (err) {
            log.warnf(c, `[${prefix}] failed to parse user info response body, because ${(err as Error).message}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        const meta = (ocs?.['meta'] ?? null) as Record<string, unknown> | null;
        const data = (ocs?.['data'] ?? null) as Record<string, unknown> | null;

        if (!ocs || !meta || !data) {
            log.warnf(c, `[${prefix}] invalid user info response body`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        if (meta['statuscode'] !== 200) {
            log.warnf(c, `[${prefix}] user info response status code is ${Number(meta['statuscode'] ?? 0)}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        let id: string, email: string, displayName: string;

        try {
            id = getStringField(data, 'id');
            email = getStringField(data, 'email');
            displayName = getStringField(data, 'display-name');
        } catch (err) {
            log.warnf(c, `[${prefix}] failed to parse user info response body, because ${(err as Error).message}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        if (id === '') {
            log.warnf(c, `[${prefix}] user info id is empty`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        return newUserInfo(id, email, displayName);
    }
}

class GiteaOAuth2DataSource implements CommonOAuth2DataSource {
    public constructor(private readonly baseUrl: string) {
    }

    public getAuthUrl(): string {
        return this.baseUrl + 'login/oauth/authorize';
    }

    public getTokenUrl(): string {
        return this.baseUrl + 'login/oauth/access_token';
    }

    public getUserInfoUrl(): string {
        return this.baseUrl + 'api/v1/user';
    }

    public getUserInfoRequestHeaders(): Record<string, string> {
        return { 'Accept': 'application/json' };
    }

    public getScopes(): string[] {
        return ['read:user'];
    }

    public parseUserInfo(c: Context, body: Buffer): OAuth2UserInfo {
        const prefix = 'gitea_oauth2_datasource.ParseUserInfo';
        let login: string, fullName: string, email: string;

        try {
            const data = (parseJson(body) ?? {}) as Record<string, unknown>;
            login = getStringField(data, 'login');
            fullName = getStringField(data, 'full_name');
            email = getStringField(data, 'email');
        } catch (err) {
            log.warnf(c, `[${prefix}] failed to parse user profile response body, because ${(err as Error).message}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        if (login === '') {
            log.warnf(c, `[${prefix}] invalid user profile response body`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        return newUserInfo(login, email, fullName);
    }
}

const githubOAuth2AuthUrl = 'https://github.com/login/oauth/authorize';
const githubOAuth2TokenUrl = 'https://github.com/login/oauth/access_token';
const githubUserProfileApiUrl = 'https://api.github.com/user';
const githubUserEmailApiUrl = 'https://api.github.com/user/emails';

class GithubOAuth2Provider implements OAuth2Provider {
    private readonly oauth2Config: OAuth2Config;

    public constructor(config: Config, redirectUrl: string) {
        this.oauth2Config = {
            clientID: config.oauth2ClientID,
            clientSecret: config.oauth2ClientSecret,
            endpoint: {
                authURL: githubOAuth2AuthUrl,
                tokenURL: githubOAuth2TokenUrl,
            },
            redirectURL: redirectUrl,
            scopes: ['user:email'],
        };
    }

    public async getOAuth2AuthUrl(_c: Context, _httpClient: HttpClient, state: string, opts: AuthCodeOption[]): Promise<string> {
        return authCodeURL(this.oauth2Config, state, opts);
    }

    public async getOAuth2Token(_c: Context, httpClient: HttpClient, code: string, opts: AuthCodeOption[]): Promise<OAuth2Token> {
        return exchange(httpClient, this.oauth2Config, code, opts);
    }

    public async getUserInfo(c: Context, httpClient: HttpClient, token: OAuth2Token): Promise<OAuth2UserInfo> {
        const prefix = 'github_oauth2_provider.GetUserInfo';
        const headers = { Accept: 'application/vnd.github+json' };
        const profileBody = await requestWithToken(c, httpClient, githubUserProfileApiUrl, token, headers, prefix, 'user profile response');
        let login: string, name: string;

        try {
            const data = (parseJson(profileBody) ?? {}) as Record<string, unknown>;
            login = getStringField(data, 'login');
            name = getStringField(data, 'name');
        } catch (err) {
            log.warnf(c, `[github_oauth2_provider.parseUserProfile] failed to parse user profile response body, because ${(err as Error).message}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        if (login === '') {
            log.warnf(c, '[github_oauth2_provider.parseUserProfile] invalid user profile response body');
            throw errs.ErrCannotRetrieveUserInfo;
        }

        const emailsBody = await requestWithToken(c, httpClient, githubUserEmailApiUrl, token, headers, prefix, 'user emails response');
        let email = '';

        try {
            const emails = (parseJson(emailsBody) ?? []) as Record<string, unknown>[];

            if (!Array.isArray(emails)) {
                throw new Error('json: cannot unmarshal object into Go value of type []github.githubUserEmailsResponse');
            }

            for (const entry of emails) {
                if (entry['primary'] === true && entry['verified'] === true) {
                    email = getStringField(entry, 'email');
                    break;
                }
            }
        } catch (err) {
            log.warnf(c, `[github_oauth2_provider.parsePrimaryEmail] failed to parse user emails response body, because ${(err as Error).message}`);
            throw errs.ErrCannotRetrieveUserInfo;
        }

        return newUserInfo(login, email, name);
    }
}

// supported signing algorithms of go-oidc
const oidcSupportedAlgorithms = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512', 'EdDSA'];

interface OIDCProviderMetadata {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userInfoEndpoint: string;
    jwksUri: string;
    algorithms: string[];
}

class OIDCProvider implements OAuth2Provider {
    private oauth2Config: OAuth2Config | null = null;
    private metadata: OIDCProviderMetadata | null = null;
    private jwks: JSONWebKeySet | null = null;

    public constructor(
        private readonly oidcIssuerURL: string,
        private readonly oidcCheckIssuerURL: boolean,
        private readonly redirectUrl: string,
        private readonly clientID: string,
        private readonly clientSecret: string,
    ) {
    }

    public async getOAuth2AuthUrl(c: Context, httpClient: HttpClient, state: string, opts: AuthCodeOption[]): Promise<string> {
        const config = await this.getOAuth2Config(c, httpClient);
        return authCodeURL(config, state, opts);
    }

    public async getOAuth2Token(c: Context, httpClient: HttpClient, code: string, opts: AuthCodeOption[]): Promise<OAuth2Token> {
        const config = await this.getOAuth2Config(c, httpClient);
        return exchange(httpClient, config, code, opts);
    }

    public async getUserInfo(c: Context, httpClient: HttpClient, token: OAuth2Token): Promise<OAuth2UserInfo> {
        const prefix = 'oidc_provider.GetUserInfo';
        await this.getOAuth2Config(c, httpClient);
        const rawIDToken = token.raw['id_token'];

        if (typeof rawIDToken !== 'string') {
            log.errorf(c, `[${prefix}] missing "id_token" field in oauth 2.0 token`);
            throw errs.ErrInvalidOAuth2Token;
        }

        let payload: Record<string, unknown>;

        try {
            payload = await this.verifyIDToken(httpClient, rawIDToken);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to verify "id_token" field in oauth 2.0 token, because ${(err as Error).message}`);
            throw errs.ErrInvalidOAuth2Token;
        }

        const claims = { preferredUserName: '', userName: '', name: '', email: '' };

        const applyClaims = (data: Record<string, unknown>): void => {
            if ('preferred_username' in data) {
                claims.preferredUserName = getStringField(data, 'preferred_username');
            }

            if ('username' in data) {
                claims.userName = getStringField(data, 'username');
            }

            if ('name' in data) {
                claims.name = getStringField(data, 'name');
            }

            if ('email' in data) {
                claims.email = getStringField(data, 'email');
            }
        };

        try {
            applyClaims(payload);
        } catch (err) {
            log.errorf(c, `[${prefix}] failed to parse claims in oauth 2.0 token, because ${(err as Error).message}`);
            throw errs.ErrInvalidOAuth2Token;
        }

        let userName = claims.preferredUserName;
        let email = claims.email;
        let nickName = claims.name;

        if (userName === '' || email === '' || nickName === '') {
            let userInfoData: Record<string, unknown>;

            try {
                userInfoData = await this.requestUserInfo(c, httpClient, token);
            } catch (err) {
                log.errorf(c, `[${prefix}] failed to get user info, because ${(err as Error).message}`);
                throw errs.ErrCannotRetrieveUserInfo;
            }

            try {
                applyClaims(userInfoData);
            } catch (err) {
                log.errorf(c, `[${prefix}] failed to parse user info, because ${(err as Error).message}`);
                throw errs.ErrCannotRetrieveUserInfo;
            }

            if (userName === '') {
                userName = claims.preferredUserName;
            }

            if (userName === '') {
                userName = claims.userName;
            }

            if (email === '') {
                email = claims.email;
            }

            if (nickName === '') {
                nickName = claims.name;
            }
        }

        return newUserInfo(userName, email, nickName);
    }

    private async requestUserInfo(c: Context, httpClient: HttpClient, token: OAuth2Token): Promise<Record<string, unknown>> {
        const metadata = this.metadata as OIDCProviderMetadata;

        if (metadata.userInfoEndpoint === '') {
            throw new Error('oidc: user info endpoint is not supported by this provider');
        }

        const response = await httpClient.request(metadata.userInfoEndpoint, {
            method: 'GET',
            headers: { Authorization: `${tokenType(token)} ${token.accessToken}` },
            logHandler: body => log.debugf(c, `[oidc_provider.GetUserInfo] response is ${body.toString('utf8')}`),
        });

        if (response.status !== 200) {
            throw new Error(`${response.status} ${response.body.toString('utf8')}`);
        }

        const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim();

        if (contentType === 'application/jwt') {
            return await this.verifyIDToken(httpClient, response.body.toString('utf8'), true);
        }

        return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
    }

    private async fetchJwks(httpClient: HttpClient): Promise<JSONWebKeySet> {
        const metadata = this.metadata as OIDCProviderMetadata;
        const response = await httpClient.request(metadata.jwksUri, { method: 'GET' });

        if (response.status !== 200) {
            throw new Error(`oidc: get keys failed: ${response.status}`);
        }

        return JSON.parse(response.body.toString('utf8')) as JSONWebKeySet;
    }

    private async verifyIDToken(httpClient: HttpClient, rawToken: string, userInfoToken: boolean = false): Promise<Record<string, unknown>> {
        const metadata = this.metadata as OIDCProviderMetadata;
        const header = decodeProtectedHeader(rawToken);

        if (!header.alg || !metadata.algorithms.includes(header.alg)) {
            throw new Error(`oidc: id token signed with unsupported algorithm, expected ${JSON.stringify(metadata.algorithms)} got "${header.alg ?? ''}"`);
        }

        if (!this.jwks) {
            this.jwks = await this.fetchJwks(httpClient);
        }

        const verifyOptions = {
            algorithms: metadata.algorithms,
            ...(userInfoToken ? {} : { audience: this.clientID }),
            ...(this.oidcCheckIssuerURL ? { issuer: metadata.issuer } : {}),
        };

        try {
            const result = await jwtVerify(rawToken, createLocalJWKSet(this.jwks), verifyOptions);
            return result.payload as Record<string, unknown>;
        } catch (err) {
            if ((err as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY' && (err as { code?: string }).code !== 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
                throw err;
            }

            // keys may be rotated, refresh the key set and verify again
            this.jwks = await this.fetchJwks(httpClient);
            const result = await jwtVerify(rawToken, createLocalJWKSet(this.jwks), verifyOptions);
            return result.payload as Record<string, unknown>;
        }
    }

    private async getOAuth2Config(c: Context, httpClient: HttpClient): Promise<OAuth2Config> {
        if (this.oauth2Config) {
            return this.oauth2Config;
        }

        try {
            const issuer = this.oidcIssuerURL.replace(/\/+$/, '');
            const response = await httpClient.request(issuer + '/.well-known/openid-configuration', { method: 'GET' });

            if (response.status !== 200) {
                throw new Error(`${response.status} ${response.body.toString('utf8')}`);
            }

            const data = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
            const discoveredIssuer = typeof data['issuer'] === 'string' ? data['issuer'] : '';

            if (this.oidcCheckIssuerURL && discoveredIssuer !== this.oidcIssuerURL) {
                throw new Error(`oidc: issuer URL provided to client ("${this.oidcIssuerURL}") did not match the issuer URL returned by provider ("${discoveredIssuer}")`);
            }

            const providerAlgorithms = Array.isArray(data['id_token_signing_alg_values_supported']) ? (data['id_token_signing_alg_values_supported'] as string[]).filter(alg => oidcSupportedAlgorithms.includes(alg)) : [];

            this.metadata = {
                issuer: this.oidcCheckIssuerURL ? discoveredIssuer : this.oidcIssuerURL,
                authorizationEndpoint: String(data['authorization_endpoint'] ?? ''),
                tokenEndpoint: String(data['token_endpoint'] ?? ''),
                userInfoEndpoint: String(data['userinfo_endpoint'] ?? ''),
                jwksUri: String(data['jwks_uri'] ?? ''),
                algorithms: providerAlgorithms.length > 0 ? providerAlgorithms : ['RS256'],
            };
        } catch (err) {
            log.errorf(c, `[oidc_provider.getOAuth2Config] failed to create oidc provider, because ${(err as Error).message}`);
            throw err;
        }

        this.oauth2Config = {
            clientID: this.clientID,
            clientSecret: this.clientSecret,
            endpoint: {
                authURL: this.metadata.authorizationEndpoint,
                tokenURL: this.metadata.tokenEndpoint,
            },
            redirectURL: this.redirectUrl,
            scopes: ['openid', 'profile', 'email'],
        };

        return this.oauth2Config;
    }
}

function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : url + '/';
}

class OAuth2Container {
    public current: OAuth2Provider | null = null;
    public usePKCE: boolean = false;
    public oauth2HttpClient: HttpClient | null = null;
    public externalUserAuthType: UserExternalAuthType = '' as UserExternalAuthType;
}

export const Container = new OAuth2Container();

// initializeOAuth2Provider initializes the current oauth 2.0 provider according to the config
export function initializeOAuth2Provider(config: Config): void {
    if (!config.enableOAuth2Login) {
        return;
    }

    if (config.oauth2ClientID === '' || config.oauth2ClientSecret === '' || config.oauth2UserIdentifier === '' || config.oauth2Provider === '') {
        throw errs.ErrInvalidOAuth2Config;
    }

    const redirectUrl = config.rootUrl + 'oauth2/callback';
    let oauth2Provider: OAuth2Provider;
    let externalUserAuthType: UserExternalAuthType;

    if (config.oauth2Provider === OAuth2ProviderOIDC) {
        if (config.oauth2OIDCProviderIssuerURL.length < 1) {
            throw errs.ErrInvalidOAuth2Config;
        }

        oauth2Provider = new OIDCProvider(config.oauth2OIDCProviderIssuerURL, config.oauth2OIDCProviderCheckIssuerURL, redirectUrl, config.oauth2ClientID, config.oauth2ClientSecret);
        externalUserAuthType = USER_EXTERNAL_AUTH_TYPE_OAUTH2_OIDC;
    } else if (config.oauth2Provider === OAuth2ProviderNextcloud) {
        if (config.oauth2NextcloudBaseUrl.length < 1) {
            throw errs.ErrInvalidOAuth2Config;
        }

        oauth2Provider = new CommonOAuth2Provider(config, redirectUrl, new NextcloudOAuth2DataSource(ensureTrailingSlash(config.oauth2NextcloudBaseUrl)));
        externalUserAuthType = USER_EXTERNAL_AUTH_TYPE_OAUTH2_NEXTCLOUD;
    } else if (config.oauth2Provider === OAuth2ProviderGitea) {
        if (config.oauth2GiteaBaseUrl.length < 1) {
            throw errs.ErrInvalidOAuth2Config;
        }

        oauth2Provider = new CommonOAuth2Provider(config, redirectUrl, new GiteaOAuth2DataSource(ensureTrailingSlash(config.oauth2GiteaBaseUrl)));
        externalUserAuthType = USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITEA;
    } else if (config.oauth2Provider === OAuth2ProviderGithub) {
        oauth2Provider = new GithubOAuth2Provider(config, redirectUrl);
        externalUserAuthType = USER_EXTERNAL_AUTH_TYPE_OAUTH2_GITHUB;
    } else {
        throw errs.ErrInvalidOAuth2Provider;
    }

    Container.current = oauth2Provider;
    Container.usePKCE = config.oauth2UsePKCE;
    Container.oauth2HttpClient = newHttpClient(config.oauth2RequestTimeout, config.oauth2Proxy, config.oauth2SkipTLSVerify, getOutgoingUserAgent(), config.enableDebugLog);
    Container.externalUserAuthType = externalUserAuthType;
}

// getOAuth2AuthUrl returns the oauth 2.0 authorization url
export async function getOAuth2AuthUrl(c: Context, state: string, verifier: string): Promise<string> {
    if (!Container.current || !Container.oauth2HttpClient) {
        throw errs.ErrOAuth2NotEnabled;
    }

    const opts: AuthCodeOption[] = [];

    if (Container.usePKCE) {
        opts.push(['code_challenge_method', 'S256']);
        opts.push(['code_challenge', createHash('sha256').update(verifier).digest('base64url')]);
    }

    return Container.current.getOAuth2AuthUrl(c, Container.oauth2HttpClient, state, opts);
}

// getOAuth2Token exchanges the authorization code to oauth 2.0 token
export async function getOAuth2Token(c: Context, code: string, verifier: string): Promise<OAuth2Token> {
    if (!Container.current || !Container.oauth2HttpClient) {
        throw errs.ErrOAuth2NotEnabled;
    }

    const opts: AuthCodeOption[] = [];

    if (Container.usePKCE) {
        opts.push(['code_verifier', verifier]);
    }

    return Container.current.getOAuth2Token(c, Container.oauth2HttpClient, code, opts);
}

// getOAuth2UserInfo returns the user info of the oauth 2.0 token
export async function getOAuth2UserInfo(c: Context, token: OAuth2Token | null): Promise<OAuth2UserInfo> {
    if (!Container.current || !Container.oauth2HttpClient) {
        throw errs.ErrOAuth2NotEnabled;
    }

    if (!token) {
        throw errs.ErrInvalidOAuth2Token;
    }

    return Container.current.getUserInfo(c, Container.oauth2HttpClient, token);
}

// getExternalUserAuthType returns the external user auth type of current oauth 2.0 provider
export function getExternalUserAuthType(): UserExternalAuthType {
    return Container.externalUserAuthType;
}
