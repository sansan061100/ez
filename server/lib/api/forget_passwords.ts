import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_FORGET_PASSWORD } from '../core/feature_restriction';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { type ForgetPasswordRequest, newUser, type PasswordResetRequest, type User } from '../models/index';
import { ForgetPasswords } from '../services/forget_passwords';
import { Tokens } from '../services/tokens';
import { Users } from '../services/users';
import type { WebContext } from '../web/context';
import { bindJson, checkAndIncreaseFailureCount, checkFailureCount, currentConfig, errMsg } from './base';
import { ForgetPasswordRequestSchema, PasswordResetRequestSchema } from './schemas';

const P = 'forget_passwords';

// userForgetPasswordRequestHandler generates password reset link and send user an email with this link
export async function userForgetPasswordRequestHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.UserForgetPasswordRequestHandler`;
    let request: ForgetPasswordRequest;

    try {
        request = await c.shouldBindJSON<ForgetPasswordRequest>(ForgetPasswordRequestSchema);
    } catch (err) {
        log.warnf(c, `[${handler}] parse request failed, because ${errMsg(err)}`);
        throw errs.ErrEmailIsEmptyOrInvalid;
    }

    try {
        checkFailureCount(c, 0n);
    } catch (err) {
        log.warnf(c, `[${handler}] cannot send forget password mail to "${request.email}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrFailureCountLimitReached);
    }

    let user: User;

    try {
        user = await Users.getUserByEmail(c, request.email);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${handler}] failed to get user, because ${errMsg(err)}`);
        }

        const failureCheckErr = checkAndIncreaseFailureCount(c, 0n);

        if (failureCheckErr) {
            log.warnf(c, `[${handler}] cannot send forget password mail to "${request.email}", because ${failureCheckErr.message}`);
            throw failureCheckErr;
        }

        throw errs.ErrUserNotFound;
    }

    if (user.disabled) {
        log.warnf(c, `[${handler}] user "uid:${user.uid}" is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_FORGET_PASSWORD)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (currentConfig().forgetPasswordRequireVerifyEmail && !user.emailVerified) {
        log.warnf(c, `[${handler}] user "uid:${user.uid}" has not verified email`);
        throw errs.ErrEmailIsNotVerified;
    }

    if (!currentConfig().enableSMTP) {
        throw errs.ErrSMTPServerNotEnabled;
    }

    let token: string;

    try {
        [token] = await Tokens.createPasswordResetToken(c, user);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.ErrTokenGenerating;
    }

    const clientLocale = c.getClientLocale();

    void ForgetPasswords.sendPasswordResetEmail(c, user, token, clientLocale).catch(err => {
        log.warnf(c, `[${handler}] cannot send email to "${user.email}", because ${errMsg(err)}`);
    });

    return true;
}

// userResetPasswordHandler resets user password by request parameters
export async function userResetPasswordHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.UserResetPasswordHandler`;
    const request = await bindJson<PasswordResetRequest>(c, PasswordResetRequestSchema, handler);
    const uid = c.getCurrentUid();
    let user: User;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${handler}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }

    if (user.disabled) {
        log.warnf(c, `[${handler}] user "uid:${user.uid}" is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_FORGET_PASSWORD)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (currentConfig().forgetPasswordRequireVerifyEmail && !user.emailVerified) {
        log.warnf(c, `[${handler}] user "uid:${user.uid}" has not verified email`);
        throw errs.ErrEmailIsNotVerified;
    }

    if (user.email !== request.email) {
        log.warnf(c, `[${handler}] request email not equals the user email`);
        throw errs.ErrEmailIsInvalid;
    }

    if (Users.isPasswordEqualsUserPassword(request.password, user)) {
        const oldTokenClaims = c.getTokenClaims()!;

        try {
            await Tokens.deleteTokenByClaims(c, oldTokenClaims);
        } catch (err) {
            log.warnf(c, `[${handler}] failed to revoke password reset token "utid:${oldTokenClaims.userTokenId}" for user "uid:${user.uid}", because ${errMsg(err)}`);
        }

        throw errs.ErrNewPasswordEqualsOldInvalid;
    }

    const userNew = newUser({ uid: user.uid, salt: user.salt, password: request.password });

    try {
        await Users.updateUser(c, userNew, false, false);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to update user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const now = Math.floor(Date.now() / 1000);

    try {
        await Tokens.deleteTokensBeforeTime(c, uid, now);
        log.infof(c, `[${handler}] revoke old tokens before unix time "${now}" for user "uid:${user.uid}"`);
    } catch (err) {
        log.warnf(c, `[${handler}] failed to revoke old tokens for user "uid:${user.uid}", because ${errMsg(err)}`);
    }

    return true;
}
