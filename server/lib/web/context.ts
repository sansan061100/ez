import { isIP } from 'node:net';

import { type H3Event, getRequestHeader, getRequestURL, getRouterParam, readMultipartFormData, readRawBody } from 'h3';

import type { RequestContext } from '../core/context';
import type { UserTokenClaims } from '../core/token_claims';
import type { AppError } from '../errs/index';
import type { Config } from '../settings/settings';
import { fixedZone, loadLocation, type Timezone } from '../utils/datetimes';
import { bindJSON, bindQuery, type Schema } from './binding';

export const AcceptLanguageHeaderName = 'Accept-Language';
export const RemoteClientPortHeader = 'X-Real-Port';
export const ClientTimezoneOffsetHeaderName = 'X-Timezone-Offset';
export const ClientTimezoneNameHeaderName = 'X-Timezone-Name';

const tokenHeaderName = 'Authorization';
const tokenHeaderValuePrefix = 'bearer ';
const tokenQueryStringParam = 'token';
const tokenCookieParam = 'ebk_auth_token';

const remoteIPHeaders = ['X-Forwarded-For', 'X-Real-IP'];

function normalizeIP(ip: string): string {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    return mapped ? mapped[1]! : ip;
}

// goQueryEscape escapes the string like go url.QueryEscape
function goQueryEscape(s: string): string {
    return encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

function goQueryUnescape(s: string): string {
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
        return s;
    }
}

export interface UploadedFile {
    name: string;
    size: number;
    type: string;
    data: Buffer;
}

// WebContext represents the context of a web request (like the go WebContext which wraps gin.Context)
export class WebContext implements RequestContext {
    public readonly event: H3Event;
    private readonly config: Config;
    private readonly responseHeaders: [string, string][] = [];
    private responseStatus: number = 0;
    private contextId: string = '';
    private textualToken: string = '';
    private tokenClaims: UserTokenClaims | null = null;
    private tokenContext: string = '';
    private responseError: AppError | null = null;
    private bodyCache: Buffer | null = null;
    private formCache: { values: Record<string, string[]>; files: Record<string, UploadedFile[]> } | null = null;

    public constructor(event: H3Event, config: Config) {
        this.event = event;
        this.config = config;
    }

    public static from(event: H3Event, config: Config): WebContext {
        let webContext = event.context['webContext'] as WebContext | undefined;

        if (!webContext) {
            webContext = new WebContext(event, config);
            event.context['webContext'] = webContext;
        }

        return webContext;
    }

    // ---------- request info ----------

    public get method(): string {
        return this.event.method;
    }

    public get path(): string {
        return this.url.pathname;
    }

    public get rawQuery(): string {
        const path = this.event.path;
        const index = path.indexOf('?');
        return index >= 0 ? path.substring(index + 1) : '';
    }

    public get url(): URL {
        return getRequestURL(this.event);
    }

    public getHeader(name: string): string {
        return getRequestHeader(this.event, name) ?? '';
    }

    public query(name: string): string {
        return this.url.searchParams.get(name) ?? '';
    }

    public param(name: string): string {
        const value = getRouterParam(this.event, name, { decode: true });
        return value ?? '';
    }

    public requestUserAgent(): string {
        return this.getHeader('User-Agent');
    }

    public remoteIP(): string {
        return normalizeIP(this.event.node.req.socket?.remoteAddress ?? '');
    }

    private remotePort(): number {
        return this.event.node.req.socket?.remotePort ?? 0;
    }

    private isTrustedProxyIP(ip: string): boolean {
        const blockList = this.config.trustedProxyBlockList;

        if (!blockList) {
            return false;
        }

        const version = isIP(ip);

        if (version === 0) {
            return false;
        }

        return blockList.check(ip, version === 4 ? 'ipv4' : 'ipv6');
    }

    // clientIP returns the real client ip (same algorithm as gin Context.ClientIP)
    public clientIP(): string {
        const remoteIP = this.remoteIP();

        if (isIP(remoteIP) === 0) {
            return '';
        }

        if (this.isTrustedProxyIP(remoteIP)) {
            for (const headerName of remoteIPHeaders) {
                const header = this.getHeader(headerName);

                if (header === '') {
                    continue;
                }

                const items = header.split(',');

                for (let i = items.length - 1; i >= 0; i--) {
                    const ipStr = items[i]!.trim();

                    if (isIP(ipStr) === 0) {
                        break;
                    }

                    if (i === 0 || !this.isTrustedProxyIP(ipStr)) {
                        return normalizeIP(ipStr);
                    }
                }
            }
        }

        return remoteIP;
    }

    public clientPort(): number {
        if (this.isTrustedProxyIP(this.remoteIP())) {
            const remotePort = this.getHeader(RemoteClientPortHeader);

            if (remotePort !== '' && /^[+-]?\d+$/.test(remotePort)) {
                return parseInt(remotePort, 10) & 0xFFFF;
            }
        }

        return this.remotePort();
    }

    // ---------- context values ----------

    public setContextId(requestId: string): void {
        this.contextId = requestId;
    }

    public getContextId(): string {
        return this.contextId;
    }

    public setTextualToken(token: string): void {
        this.textualToken = token;
    }

    public getTextualToken(): string {
        return this.textualToken;
    }

    public setTokenClaims(claims: UserTokenClaims | null): void {
        this.tokenClaims = claims;
    }

    public getTokenClaims(): UserTokenClaims | null {
        return this.tokenClaims;
    }

    public setTokenContext(context: string): void {
        this.tokenContext = context;
    }

    public getTokenContext(): string {
        return this.tokenContext;
    }

    public getCurrentUid(): bigint {
        return this.tokenClaims ? this.tokenClaims.uid : 0n;
    }

    public setResponseError(error: AppError): void {
        this.responseError = error;
    }

    public getResponseError(): AppError | null {
        return this.responseError;
    }

    // ---------- token ----------

    public getTokenStringFromHeader(): string {
        const tokenHeader = this.getHeader(tokenHeaderName);

        if (tokenHeader.length < 7 || tokenHeader.substring(0, 7).toLowerCase() !== tokenHeaderValuePrefix) {
            return '';
        }

        return tokenHeader.substring(7);
    }

    public getTokenStringFromQueryString(): string {
        return this.query(tokenQueryStringParam);
    }

    public getTokenStringFromCookie(): string {
        const cookieHeader = this.getHeader('Cookie');

        for (const part of cookieHeader.split(';')) {
            const index = part.indexOf('=');

            if (index < 0) {
                continue;
            }

            if (part.substring(0, index).trim() === tokenCookieParam) {
                return goQueryUnescape(part.substring(index + 1).trim().replace(/^"|"$/g, ''));
            }
        }

        return '';
    }

    public setTokenStringToCookie(token: string, tokenExpiredTime: number, path: string): void {
        if (token !== '') {
            this.setCookie(tokenCookieParam, token, tokenExpiredTime, path);
        } else {
            this.setCookie(tokenCookieParam, '', -1, path);
        }
    }

    public setCookie(name: string, value: string, maxAge: number, path: string): void {
        let cookie = `${name}=${goQueryEscape(value)}`;

        if (path !== '') {
            cookie += `; Path=${path}`;
        }

        if (maxAge > 0) {
            cookie += `; Max-Age=${maxAge}`;
        } else if (maxAge < 0) {
            cookie += '; Max-Age=0';
        }

        cookie += '; HttpOnly';
        this.responseHeaders.push(['Set-Cookie', cookie]);
    }

    // header sets the response header, it will be written to the response built by the response helpers
    public header(name: string, value: string): void {
        const lowerName = name.toLowerCase();

        for (let i = this.responseHeaders.length - 1; i >= 0; i--) {
            if (this.responseHeaders[i]![0].toLowerCase() === lowerName) {
                this.responseHeaders.splice(i, 1);
            }
        }

        this.responseHeaders.push([name, value]);
    }

    // newResponse creates the response with the response headers set before
    public newResponse(body: BodyInit | null, status: number, headers?: Record<string, string>): Response {
        const allHeaders = new Headers();

        for (const [name, value] of this.responseHeaders) {
            allHeaders.append(name, value);
        }

        if (headers) {
            for (const [name, value] of Object.entries(headers)) {
                allHeaders.set(name, value);
            }
        }

        this.responseStatus = status;
        return new Response(body, { status: status, headers: allHeaders });
    }

    // applyResponseHeaders adds the response headers set before to the specified response
    public applyResponseHeaders(response: Response): Response {
        if (this.responseHeaders.length > 0) {
            const allHeaders = new Headers(response.headers);

            for (const [name, value] of this.responseHeaders) {
                if (name.toLowerCase() === 'set-cookie') {
                    allHeaders.append(name, value);
                } else if (!allHeaders.has(name)) {
                    allHeaders.set(name, value);
                }
            }

            response = new Response(response.body, { status: response.status, statusText: response.statusText, headers: allHeaders });
        }

        this.responseStatus = response.status;
        return response;
    }

    public getResponseStatus(): number {
        return this.responseStatus;
    }

    // ---------- locale and timezone ----------

    public getClientLocale(): string {
        return this.getHeader(AcceptLanguageHeaderName);
    }

    public getClientTimezone(): Timezone {
        const timezoneName = this.getHeader(ClientTimezoneNameHeaderName);

        if (timezoneName !== '') {
            const location = loadLocation(timezoneName);

            if (location) {
                return location;
            }
        }

        const value = this.getHeader(ClientTimezoneOffsetHeaderName);

        if (!/^[+-]?\d+$/.test(value)) {
            throw new Error(`strconv.Atoi: parsing ${JSON.stringify(value)}: invalid syntax`);
        }

        const offset = parseInt(value, 10);
        // go converts the value to int16
        const int16Offset = ((offset + 32768) % 65536 + 65536) % 65536 - 32768;
        return fixedZone(int16Offset);
    }

    // ---------- body ----------

    public async rawBody(): Promise<Buffer> {
        if (this.bodyCache === null) {
            const body = await readRawBody(this.event, false);
            this.bodyCache = body ? Buffer.from(body) : Buffer.alloc(0);
        }

        return this.bodyCache;
    }

    public async shouldBindJSON<T>(s: Schema): Promise<T> {
        const body = await this.rawBody();
        return bindJSON<T>(body.toString('utf8'), s);
    }

    public shouldBindQuery<T>(s: Schema): T {
        return bindQuery<T>(this.url.searchParams, s);
    }

    // multipartForm returns the parsed multipart form data
    public async multipartForm(): Promise<{ values: Record<string, string[]>; files: Record<string, UploadedFile[]> }> {
        if (this.formCache === null) {
            const contentType = this.getHeader('Content-Type');

            if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
                throw new Error('request Content-Type isn\'t multipart/form-data');
            }

            const values: Record<string, string[]> = {};
            const files: Record<string, UploadedFile[]> = {};
            const parts = await readMultipartFormData(this.event) ?? [];

            for (const part of parts) {
                const key = part.name ?? '';

                if (part.filename !== undefined) {
                    (files[key] ??= []).push({
                        name: part.filename,
                        size: part.data.length,
                        type: part.type ?? '',
                        data: Buffer.from(part.data),
                    });
                } else {
                    (values[key] ??= []).push(part.data.toString('utf8'));
                }
            }

            this.formCache = { values: values, files: files };
        }

        return this.formCache;
    }
}
