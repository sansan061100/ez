export const JSONRPCVersion = '2.0';

export interface JSONRPCRequest {
    jsonrpc: string;
    method: string;
    params?: unknown;
    id?: unknown;
}

export interface JSONRPCError {
    code: number;
    message: string;
    data?: unknown;
}

export interface JSONRPCResponse {
    jsonrpc: string;
    result?: unknown;
    error?: JSONRPCError;
    id?: unknown;
}

export const JSONRPCParseError: JSONRPCError = { code: -32700, message: 'Parse error' };
export const JSONRPCMethodNotFoundError: JSONRPCError = { code: -32601, message: 'Method not found' };
export const JSONRPCInvalidParamsError: JSONRPCError = { code: -32602, message: 'Invalid params' };
export const JSONRPCInternalError: JSONRPCError = { code: -32603, message: 'Internal error' };

function omitEmpty(response: JSONRPCResponse): JSONRPCResponse {
    const ret: JSONRPCResponse = { jsonrpc: response.jsonrpc };

    if (response.result !== undefined && response.result !== null) {
        ret.result = response.result;
    }

    if (response.error) {
        ret.error = response.error;
    }

    // go omits the interface field only when it is nil
    if (response.id !== undefined && response.id !== null) {
        ret.id = response.id;
    }

    return ret;
}

export function newJSONRPCResponse(id: unknown, result: unknown): JSONRPCResponse {
    return omitEmpty({ jsonrpc: JSONRPCVersion, result: result, id: id });
}

export function newJSONRPCErrorResponse(id: unknown, err: JSONRPCError): JSONRPCResponse {
    return omitEmpty({ jsonrpc: JSONRPCVersion, error: { code: err.code, message: err.message }, id: id });
}

export function newJSONRPCErrorResponseWithCause(id: unknown, err: JSONRPCError, cause: string): JSONRPCResponse {
    return omitEmpty({ jsonrpc: JSONRPCVersion, error: { code: err.code, message: err.message, data: cause }, id: id });
}
