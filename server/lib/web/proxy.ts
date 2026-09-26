import { Readable } from 'node:stream';

import { Agent, type Dispatcher, EnvHttpProxyAgent, ProxyAgent, Socks5ProxyAgent, request as undiciRequest } from 'undici';

import type { WebContext } from './context';

// hop-by-hop headers which are removed by go httputil.ReverseProxy
const hopHeaders = new Set([
    'connection',
    'proxy-connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

// createProxyDispatcher creates the dispatcher by the proxy setting ("system", "none" or proxy url)
export function createProxyDispatcher(proxy: string): Dispatcher {
    if (proxy === 'none') {
        return new Agent();
    } else if (proxy !== 'system' && proxy !== '') {
        if (proxy.startsWith('socks5://') || proxy.startsWith('socks5h://') || proxy.startsWith('socks://')) {
            return new Socks5ProxyAgent(proxy);
        }

        return new ProxyAgent(proxy);
    }

    return new EnvHttpProxyAgent();
}

let defaultDispatcher: Dispatcher | null = null;

function getDefaultDispatcher(): Dispatcher {
    if (!defaultDispatcher) {
        defaultDispatcher = new EnvHttpProxyAgent();
    }

    return defaultDispatcher;
}

export type ProxyRequestHeadersModifier = (headers: Record<string, string | string[]>) => void;

// reverseProxy forwards the current request to the target url like go httputil.ReverseProxy
export async function reverseProxy(c: WebContext, targetUrl: string, dispatcher: Dispatcher | null, modifyHeaders?: ProxyRequestHeadersModifier): Promise<Response> {
    const target = new URL(targetUrl);
    const requestHeaders: Record<string, string | string[]> = {};
    const connectionHeaderTokens = new Set<string>();

    const connectionHeader = c.getHeader('Connection');

    if (connectionHeader) {
        for (const token of connectionHeader.split(',')) {
            connectionHeaderTokens.add(token.trim().toLowerCase());
        }
    }

    for (const [key, value] of Object.entries(c.event.node.req.headers)) {
        const lowerKey = key.toLowerCase();

        if (value === undefined || hopHeaders.has(lowerKey) || connectionHeaderTokens.has(lowerKey) || lowerKey === 'host') {
            continue;
        }

        requestHeaders[lowerKey] = Array.isArray(value) ? value.join(', ') : value;
    }

    const clientIP = c.remoteIP();

    if (clientIP) {
        const prior = requestHeaders['x-forwarded-for'];
        requestHeaders['x-forwarded-for'] = prior ? `${Array.isArray(prior) ? prior.join(', ') : prior}, ${clientIP}` : clientIP;
    }

    if (modifyHeaders) {
        modifyHeaders(requestHeaders);
    }

    const method = c.method;
    let body: Buffer | undefined;

    if (method !== 'GET' && method !== 'HEAD') {
        body = await c.rawBody();
    }

    try {
        const response = await undiciRequest(target, {
            method: method as Dispatcher.HttpMethod,
            headers: requestHeaders,
            body: body,
            dispatcher: dispatcher ?? getDefaultDispatcher(),
        });

        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(response.headers)) {
            if (hopHeaders.has(key.toLowerCase()) || value === undefined) {
                continue;
            }

            if (Array.isArray(value)) {
                for (const item of value) {
                    responseHeaders.append(key, item);
                }
            } else {
                responseHeaders.set(key, value);
            }
        }

        const status = response.statusCode;
        const hasBody = !(method === 'HEAD' || status === 204 || status === 304);

        return new Response(hasBody ? Readable.toWeb(response.body) as ReadableStream : null, {
            status: status,
            headers: responseHeaders,
        });
    } catch {
        return new Response(null, { status: 502 });
    }
}
