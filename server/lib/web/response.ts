import { JSONRPCInternalError, JSONRPCInvalidParamsError, JSONRPCMethodNotFoundError, JSONRPCParseError, type JSONRPCRequest, newJSONRPCErrorResponseWithCause, newJSONRPCResponse } from '../core/json_rpc';
import * as errs from '../errs/index';
import { getDisplayErrorMessage } from './binding';
import type { WebContext } from './context';
import { goJsonStringify } from './json';

export function jsonResponse(c: WebContext, status: number, value: unknown): Response {
    return c.newResponse(goJsonStringify(value), status, { 'Content-Type': 'application/json; charset=utf-8' });
}

// getJsonErrorResult returns the error result, the keys are in the same order as the go map marshal output (sorted)
export function getJsonErrorResult(err: errs.AppError, path: string, context?: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (context !== undefined && context !== null) {
        result['context'] = context;
    }

    result['errorCode'] = err.code;
    result['errorMessage'] = getDisplayErrorMessage(err);
    result['path'] = path;
    result['success'] = false;

    return result;
}

export function printJsonSuccessResult(c: WebContext, result: unknown): Response {
    return jsonResponse(c, 200, {
        result: result === undefined ? null : result,
        success: true,
    });
}

export function printDataSuccessResult(c: WebContext, contentType: string, fileName: string, result: Buffer | Uint8Array | string): Response {
    const headers: Record<string, string> = {};

    if (fileName !== '') {
        headers['Content-Disposition'] = 'attachment;filename=' + fileName;
    }

    headers['Content-Type'] = contentType;
    return c.newResponse(typeof result === 'string' ? result : new Uint8Array(result), 200, headers);
}

export function printJsonErrorResult(c: WebContext, err: errs.AppError): Response {
    c.setResponseError(err);

    const result = getJsonErrorResult(err, c.path, err.context);

    return jsonResponse(c, err.httpStatusCode, result);
}

export function printJSONRPCSuccessResult(c: WebContext, jsonRPCRequest: JSONRPCRequest, result: unknown): Response {
    return jsonResponse(c, 200, newJSONRPCResponse(jsonRPCRequest.id, result));
}

export function printJSONRPCErrorResult(c: WebContext, jsonRPCRequest: JSONRPCRequest | null, err: errs.AppError): Response {
    c.setResponseError(err);

    const id = jsonRPCRequest ? jsonRPCRequest.id : undefined;
    let jsonRPCError = JSONRPCInternalError;

    if (err.code === errs.ErrIncompleteOrIncorrectSubmission.code) {
        jsonRPCError = JSONRPCParseError;
    } else if (err.code === errs.ErrApiNotFound.code) {
        jsonRPCError = JSONRPCMethodNotFoundError;
    } else if (err.code === errs.ErrParameterInvalid.code) {
        jsonRPCError = JSONRPCInvalidParamsError;
    }

    return jsonResponse(c, err.httpStatusCode, newJSONRPCErrorResponseWithCause(id, jsonRPCError, getDisplayErrorMessage(err)));
}

export function printDataErrorResult(c: WebContext, contentType: string, err: errs.AppError): Response {
    c.setResponseError(err);
    return c.newResponse(getDisplayErrorMessage(err), err.httpStatusCode, { 'Content-Type': contentType });
}
