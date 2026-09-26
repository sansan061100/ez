import { Agent, type Dispatcher, EnvHttpProxyAgent, fetch as undiciFetch, ProxyAgent, Socks5ProxyAgent } from 'undici';

// HttpResponseLogHandler is called with the response body when http response log is enabled
export type HttpResponseLogHandler = (body: Buffer) => void;

export interface HttpRequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | Uint8Array | null;
    // set to false to follow redirects manually
    followRedirect?: boolean;
    logHandler?: HttpResponseLogHandler;
}

export interface HttpResponse {
    status: number;
    headers: Headers;
    body: Buffer;
}

function createDispatcher(proxy: string, skipTLSVerify: boolean): Dispatcher {
    const connect = skipTLSVerify ? { rejectUnauthorized: false } : undefined;

    if (proxy === 'none') {
        return new Agent({ connect: connect });
    } else if (proxy !== 'system' && proxy !== '') {
        if (proxy.startsWith('socks5://') || proxy.startsWith('socks5h://') || proxy.startsWith('socks://')) {
            return new Socks5ProxyAgent(proxy, skipTLSVerify ? { connect: { rejectUnauthorized: false } as never } : {});
        }

        return new ProxyAgent({ uri: proxy, requestTls: connect, proxyTls: connect });
    }

    return new EnvHttpProxyAgent({ connect: connect });
}

// HttpClient represents a http client with timeout, proxy and default user agent settings
export class HttpClient {
    private readonly requestTimeout: number;
    private readonly dispatcher: Dispatcher;
    private readonly defaultUserAgent: string;
    private readonly enableHttpResponseLog: boolean;

    public constructor(requestTimeout: number, proxy: string, skipTLSVerify: boolean, defaultUserAgent: string, enableHttpResponseLog: boolean) {
        this.requestTimeout = requestTimeout;
        this.dispatcher = createDispatcher(proxy, skipTLSVerify);
        this.defaultUserAgent = defaultUserAgent;
        this.enableHttpResponseLog = enableHttpResponseLog;
    }

    public async request(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
        const headers = new Headers(options.headers ?? {});

        if (!headers.has('User-Agent')) {
            headers.set('User-Agent', this.defaultUserAgent);
        } else if (headers.get('User-Agent') === '') {
            headers.delete('User-Agent');
        }

        const response = await undiciFetch(url, {
            method: options.method ?? 'GET',
            headers: headers,
            body: options.body ?? undefined,
            dispatcher: this.dispatcher,
            redirect: options.followRedirect === false ? 'manual' : 'follow',
            signal: this.requestTimeout > 0 ? AbortSignal.timeout(this.requestTimeout) : undefined,
        });

        const body = Buffer.from(await response.arrayBuffer());

        if (this.enableHttpResponseLog && options.logHandler) {
            options.logHandler(body);
        }

        return {
            status: response.status,
            headers: response.headers as unknown as Headers,
            body: body,
        };
    }

    // stream returns the raw response for proxying (body is not consumed)
    public async stream(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const headers = new Headers(options.headers ?? {});

        if (!headers.has('User-Agent')) {
            headers.set('User-Agent', this.defaultUserAgent);
        } else if (headers.get('User-Agent') === '') {
            headers.delete('User-Agent');
        }

        return await undiciFetch(url, {
            method: options.method ?? 'GET',
            headers: headers,
            body: options.body ?? undefined,
            dispatcher: this.dispatcher,
            redirect: options.followRedirect === false ? 'manual' : 'follow',
            signal: this.requestTimeout > 0 ? AbortSignal.timeout(this.requestTimeout) : undefined,
        }) as unknown as Response;
    }
}

export function newHttpClient(requestTimeout: number, proxy: string, skipTLSVerify: boolean, defaultUserAgent: string, enableHttpResponseLog: boolean): HttpClient {
    return new HttpClient(requestTimeout, proxy, skipTLSVerify, defaultUserAgent, enableHttpResponseLog);
}
