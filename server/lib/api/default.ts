import * as errs from '../errs/index';
import type { WebContext } from '../web/context';

// apiNotFound returns api not found error
export async function apiNotFound(_c: WebContext): Promise<unknown> {
    throw errs.ErrApiNotFound;
}

// methodNotAllowed returns method not allowed error
export async function methodNotAllowed(_c: WebContext): Promise<unknown> {
    throw errs.ErrMethodNotAllowed;
}
