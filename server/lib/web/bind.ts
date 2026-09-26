import { defineEventHandler, type EventHandler, type H3Event } from 'h3';

import { currentConfig } from '../api/base';
import { waitForSystemReady } from '../boot/ready';
import type { JSONRPCRequest } from '../core/json_rpc';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { AmapProvider, AmapSecurityVerificationInternalProxyMethod, type Config } from '../settings/settings';
import { BindingError } from './binding';
import { WebContext } from './context';
import { printDataErrorResult, printDataSuccessResult, printJSONRPCErrorResult, printJSONRPCSuccessResult, printJsonErrorResult, printJsonSuccessResult } from './response';

export type ApiHandlerFunc = (c: WebContext) => Promise<unknown>;
export type RedirectHandlerFunc = (c: WebContext) => Promise<string>;
export type DataHandlerFunc = (c: WebContext) => Promise<[Buffer | string, string]>;
export type ImageHandlerFunc = (c: WebContext) => Promise<[Buffer, string]>;
export type ProxyHandlerFunc = (c: WebContext) => Promise<Response>;
export type JSONRPCApiHandlerFunc = (c: WebContext, request: JSONRPCRequest) => Promise<unknown>;
export type WebMiddlewareFunc = (c: WebContext, next: () => Promise<void>) => Promise<Response | void>;

// RouteHandler handles the request and returns the response
export type RouteHandler = (c: WebContext) => Promise<Response>;

// handleUnexpectedError logs the unexpected error (like go panic recovery) and returns system error
function toAppError(c: WebContext, err: unknown): errs.AppError {
    if (err instanceof errs.AppError) {
        return err;
    }

    const stack = err instanceof Error && err.stack ? err.stack + '\n' : '';
    log.errorfWithExtra(c, stack, `System Error! because ${err instanceof Error ? err.message : String(err)}`);
    return errs.ErrSystemError;
}

export function bindApi(fn: ApiHandlerFunc): RouteHandler {
    return async (c: WebContext) => {

        try {
            const result = await fn(c);
            return printJsonSuccessResult(c, result);
        } catch (err) {
            return printJsonErrorResult(c, toAppError(c, err));
        }
    };
}

export function bindApiWithTokenUpdate(fn: ApiHandlerFunc): RouteHandler {
    return async (c: WebContext) => {

        try {
            const result = await fn(c);
            const config = currentConfig();

            if (config.mapProvider === AmapProvider && config.amapSecurityVerificationMethod === AmapSecurityVerificationInternalProxyMethod) {
                amapApiProxyAuthCookie(c, config);
            }

            return printJsonSuccessResult(c, result);
        } catch (err) {
            return printJsonErrorResult(c, toAppError(c, err));
        }
    };
}

export function bindRedirect(fn: RedirectHandlerFunc): RouteHandler {
    return async (c: WebContext) => {

        try {
            const url = await fn(c);
            return c.newResponse(null, 302, { 'Location': url });
        } catch (err) {
            return printJsonErrorResult(c, toAppError(c, err));
        }
    };
}

export function bindJSONRPCApi(fns: Record<string, JSONRPCApiHandlerFunc>, skipMethods: Record<string, number> | null): RouteHandler {
    return async (c: WebContext) => {
        let jsonRPCRequest: JSONRPCRequest;

        try {
            const body = (await c.rawBody()).toString('utf8');

            if (body.trim() === '') {
                throw new BindingError('EOF');
            }

            const data = JSON.parse(body) as unknown;

            if (data === null || typeof data !== 'object' || Array.isArray(data)) {
                throw new BindingError('json: cannot unmarshal into Go value of type core.JSONRPCRequest');
            }

            const request = data as Record<string, unknown>;

            if ((request['jsonrpc'] !== undefined && request['jsonrpc'] !== null && typeof request['jsonrpc'] !== 'string') ||
                (request['method'] !== undefined && request['method'] !== null && typeof request['method'] !== 'string')) {
                throw new BindingError('json: cannot unmarshal into Go struct field of type string');
            }

            jsonRPCRequest = {
                jsonrpc: (request['jsonrpc'] as string | undefined) ?? '',
                method: (request['method'] as string | undefined) ?? '',
                params: Object.hasOwn(request, 'params') ? request['params'] : undefined,
                id: request['id'] ?? undefined,
            };
        } catch (err) {
            return printJSONRPCErrorResult(c, null, errs.newIncompleteOrIncorrectSubmissionError(err));
        }

        if (skipMethods) {
            const httpStatusCode = skipMethods[jsonRPCRequest.method];

            if (httpStatusCode !== undefined) {
                return c.newResponse(null, httpStatusCode);
            }
        }

        const fn = Object.prototype.hasOwnProperty.call(fns, jsonRPCRequest.method) ? fns[jsonRPCRequest.method] : undefined;

        if (!fn) {
            return printJSONRPCErrorResult(c, jsonRPCRequest, errs.ErrApiNotFound);
        }

        try {
            const result = await fn(c, jsonRPCRequest);
            return printJSONRPCSuccessResult(c, jsonRPCRequest, result);
        } catch (err) {
            return printJSONRPCErrorResult(c, jsonRPCRequest, toAppError(c, err));
        }
    };
}

interface CachedPage {
    status: number;
    headers: [string, string][];
    body: Uint8Array;
    expiration: number;
}

// cachePage caches the successful response for one minute (like gin-contrib/cache CachePage)
function cachePage(handler: RouteHandler): RouteHandler {
    const cache = new Map<string, CachedPage>();

    return async (c: WebContext) => {
        const key = c.path + c.url.search;
        const cached = cache.get(key);

        if (cached && cached.expiration > Date.now()) {
            const headers: Record<string, string> = {};

            for (const [name, value] of cached.headers) {
                if (name.toLowerCase() !== 'x-request-id') {
                    headers[name] = value;
                }
            }

            return c.newResponse(cached.body.slice(), cached.status, headers);
        }

        const response = await handler(c);

        if (response.status < 300) {
            const body = new Uint8Array(await response.clone().arrayBuffer());
            const headers: [string, string][] = [];

            response.headers.forEach((value, name) => headers.push([name, value]));
            cache.set(key, { status: response.status, headers: headers, body: body, expiration: Date.now() + 60 * 1000 });
        }

        return response;
    };
}

export function bindCachedJs(fn: DataHandlerFunc): RouteHandler {
    return cachePage(async (c: WebContext) => {

        try {
            const [result] = await fn(c);
            return printDataSuccessResult(c, 'text/javascript; charset=utf-8', '', result);
        } catch (err) {
            return printDataErrorResult(c, 'text/javascript', toAppError(c, err));
        }
    });
}

function bindData(fn: DataHandlerFunc, contentType: string): RouteHandler {
    return async (c: WebContext) => {

        try {
            const [result, fileName] = await fn(c);
            return printDataSuccessResult(c, contentType, fileName, result);
        } catch (err) {
            return printDataErrorResult(c, 'text/text', toAppError(c, err));
        }
    };
}

export function bindCsv(fn: DataHandlerFunc): RouteHandler {
    return bindData(fn, 'text/csv; charset=utf-8');
}

export function bindTsv(fn: DataHandlerFunc): RouteHandler {
    return bindData(fn, 'text/tab-separated-values; charset=utf-8');
}

export function bindImage(fn: ImageHandlerFunc): RouteHandler {
    return async (c: WebContext) => {

        try {
            const [result, contentType] = await fn(c);
            return printDataSuccessResult(c, contentType, '', result);
        } catch (err) {
            return printDataErrorResult(c, 'text/text', toAppError(c, err));
        }
    };
}

export function bindCachedImage(fn: ImageHandlerFunc): RouteHandler {
    return cachePage(bindImage(fn));
}

export function bindProxy(fn: ProxyHandlerFunc): RouteHandler {
    return async (c: WebContext) => {

        try {
            return c.applyResponseHeaders(await fn(c));
        } catch (err) {
            return printDataErrorResult(c, 'text/text', toAppError(c, err));
        }
    };
}

// amapApiProxyAuthCookie sets the token to the cookie for amap api proxy
export function amapApiProxyAuthCookie(c: WebContext, config: Config): void {
    const token = c.getTextualToken();
    c.setTokenStringToCookie(token, config.tokenExpiredTime, '/_AMapService');
}

// runWithMiddlewares runs the middlewares (like gin middlewares) and then the handler, returns the final response
async function runWithMiddlewares(c: WebContext, middlewares: WebMiddlewareFunc[], handler: RouteHandler): Promise<Response> {
    let response: Response | null = null;

    const dispatch = async (index: number): Promise<void> => {
        if (index >= middlewares.length) {
            response = await handler(c);
            return;
        }

        const middleware = middlewares[index]!;
        let result: Response | void;

        try {
            result = await middleware(c, () => dispatch(index + 1));
        } catch (err) {
            result = printJsonErrorResult(c, toAppError(c, err));
        }

        if (result instanceof Response) {
            response = result;
        }
    };

    await dispatch(0);

    return response ?? c.newResponse(null, 404);
}

export type HttpMethod = 'GET' | 'POST' | 'HEAD';

export interface RouteOptions {
    // the allowed http methods of the route
    methods: HttpMethod[];
    // the middlewares of the route group which the route belongs to
    middlewares?: (config: Config) => WebMiddlewareFunc[];
    // returns whether the route is enabled by the current configuration, the disabled route returns api not found
    enabled?: (config: Config) => boolean;
    handler: RouteHandler;
}

const apiNotFoundHandler: RouteHandler = async (c: WebContext) => printJsonErrorResult(c, errs.ErrApiNotFound);

// defineRoute defines the nitro event handler of ezBookkeeping route
export function defineRoute(options: RouteOptions): EventHandler {
    return defineEventHandler(async (event: H3Event) => {
        await waitForSystemReady();

        const config = currentConfig();
        const c = WebContext.from(event, config);

        if (!options.methods.includes(event.method as HttpMethod) || (options.enabled && !options.enabled(config))) {
            return apiNotFoundHandler(c);
        }

        try {
            return await runWithMiddlewares(c, options.middlewares ? options.middlewares(config) : [], options.handler);
        } catch (err) {
            return printJsonErrorResult(c, toAppError(c, err));
        }
    });
}

// defineNotFoundRoute defines the nitro event handler which always returns api not found error
export function defineNotFoundRoute(): EventHandler {
    return defineEventHandler(async (event: H3Event) => {
        await waitForSystemReady();
        return apiNotFoundHandler(WebContext.from(event, currentConfig()));
    });
}
