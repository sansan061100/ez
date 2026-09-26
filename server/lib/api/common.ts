import { USER_TOKEN_TYPE_NORMAL } from '../core/token_claims';
import * as errs from '../errs/index';
import * as log from '../log/index';
import type { User } from '../models/index';
import { Users } from '../services/users';
import type { WebContext } from '../web/context';
import { errMsg } from './base';

// requireNormalToken checks whether current token is a normal token
export function requireNormalToken(c: WebContext, logPrefix: string, action: string): void {
    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, `[${logPrefix}] current token is null`);
        throw errs.ErrInvalidToken;
    } else if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[${logPrefix}] token type "${claims.type}" is not allowed to ${action}`);
        throw errs.ErrInvalidToken;
    }
}

// getCurrentUserForUpdate returns current user, logs warning with uid if failed (non custom error)
export async function getCurrentUserWarnWithUid(c: WebContext, logPrefix: string): Promise<User> {
    const uid = c.getCurrentUid();

    try {
        return await Users.getUserById(c, uid);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.warnf(c, `[${logPrefix}] failed to get user for user "uid:${uid}", because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }
}

// getCurrentUserOrOperationFailed returns current user, and throws the error itself or operation failed error
export async function getCurrentUserOrOperationFailed(c: WebContext, logPrefix: string): Promise<User> {
    const uid = c.getCurrentUid();

    try {
        return await Users.getUserById(c, uid);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// callOrFail executes the function, logs error and throws the error or default error if failed
export async function callOrFail<T>(c: WebContext, fn: () => Promise<T>, logMessage: () => string, defaultErr: errs.AppError = errs.ErrOperationFailed): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        log.errorf(c, `${logMessage()}, because ${errMsg(err)}`);
        throw errs.or(err, defaultErr);
    }
}
