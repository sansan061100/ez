import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_DISABLE_2FA, USER_FEATURE_RESTRICTION_TYPE_ENABLE_2FA } from '../core/feature_restriction';
import { USER_TOKEN_TYPE_NORMAL } from '../core/token_claims';
import * as errs from '../errs/index';
import * as log from '../log/index';
import type { TwoFactorDisableRequest, TwoFactorEnableConfirmRequest, TwoFactorEnableConfirmResponse, TwoFactorStatusResponse, User } from '../models/index';
import { Tokens } from '../services/tokens';
import { validateTotp } from '../services/totp';
import { TwoFactorAuthorizations } from '../services/twofactor_authorizations';
import { Users } from '../services/users';
import type { WebContext } from '../web/context';
import { bindJson, errMsg } from './base';
import { PasswordRequestSchema, TwoFactorEnableConfirmRequestSchema } from './schemas';

const P = 'twofactor_authorizations';

function checkNormalToken(c: WebContext, handler: string, action: string): void {
    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, `[${P}.${handler}] current token is null`);
        throw errs.ErrInvalidToken;
    } else if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[${P}.${handler}] token type "${claims.type}" is not allowed to ${action}`);
        throw errs.ErrInvalidToken;
    }
}

async function getUser(c: WebContext, handler: string, withUid: boolean): Promise<User> {
    const uid = c.getCurrentUid();

    try {
        return await Users.getUserById(c, uid);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            if (withUid) {
                log.warnf(c, `[${P}.${handler}] failed to get user for user "uid:${uid}", because ${errMsg(err)}`);
            } else {
                log.errorf(c, `[${P}.${handler}] failed to get user, because ${errMsg(err)}`);
            }
        }

        throw errs.ErrUserNotFound;
    }
}

async function existsTwoFactor(c: WebContext, handler: string): Promise<boolean> {
    try {
        return await TwoFactorAuthorizations.existsTwoFactorSetting(c, c.getCurrentUid());
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to check two-factor setting, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// twoFactorStatusHandler returns 2fa status of current user
export async function twoFactorStatusHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();

    try {
        const twoFactorSetting = await TwoFactorAuthorizations.getUserTwoFactorSettingByUid(c, uid);
        const resp: TwoFactorStatusResponse = { enable: true };

        if (twoFactorSetting.createdUnixTime !== 0) {
            resp.createdAt = twoFactorSetting.createdUnixTime;
        }

        return resp;
    } catch (err) {
        if (err === errs.ErrTwoFactorIsNotEnabled) {
            return { enable: false };
        }

        log.errorf(c, `[${P}.TwoFactorStatusHandler] failed to get two-factor setting, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// twoFactorEnableRequestHandler returns a new 2fa secret and qr code for current user to set 2fa and verify passcode next
export async function twoFactorEnableRequestHandler(c: WebContext): Promise<unknown> {
    const handler = 'TwoFactorEnableRequestHandler';
    checkNormalToken(c, handler, 'enable two-factor authentication');

    if (await existsTwoFactor(c, handler)) {
        throw errs.ErrTwoFactorAlreadyEnabled;
    }

    const user = await getUser(c, handler, false);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_ENABLE_2FA)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const key = TwoFactorAuthorizations.generateTwoFactorSecret(c, user, c.getClientLocale());
    let image: Buffer;

    try {
        image = await key.image(240);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to generate two-factor qrcode, because ${errMsg(err)}`);
        throw errs.ErrOperationFailed;
    }

    return {
        secret: key.secret(),
        qrcode: 'data:image/png;base64,' + image.toString('base64'),
    };
}

// twoFactorEnableConfirmHandler enables 2fa for current user
export async function twoFactorEnableConfirmHandler(c: WebContext): Promise<unknown> {
    const handler = 'TwoFactorEnableConfirmHandler';
    const confirmReq = await bindJson<TwoFactorEnableConfirmRequest>(c, TwoFactorEnableConfirmRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    checkNormalToken(c, handler, 'enable two-factor authentication');

    if (await existsTwoFactor(c, handler)) {
        throw errs.ErrTwoFactorAlreadyEnabled;
    }

    const user = await getUser(c, handler, false);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_ENABLE_2FA)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (!validateTotp(confirmReq.passcode, confirmReq.secret)) {
        log.warnf(c, `[${P}.${handler}] passcode is invalid`);
        throw errs.ErrPasscodeInvalid;
    }

    const recoveryCodes = TwoFactorAuthorizations.generateTwoFactorRecoveryCodes();

    try {
        await TwoFactorAuthorizations.createTwoFactorRecoveryCodes(c, uid, recoveryCodes, user.salt);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to create two-factor recovery codes for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    try {
        await TwoFactorAuthorizations.createTwoFactorSetting(c, { uid: uid, secret: confirmReq.secret, createdUnixTime: 0 });
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to create two-factor setting for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has enabled two-factor authorization`);

    const now = Math.floor(Date.now() / 1000);

    try {
        await Tokens.deleteTokensBeforeTime(c, uid, now);
        log.infof(c, `[${P}.${handler}] revoke old tokens before unix time "${now}" for user "uid:${user.uid}"`);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] failed to revoke old tokens for user "uid:${user.uid}", because ${errMsg(err)}`);
    }

    try {
        const [token, claims] = await Tokens.createToken(c, user);
        c.setTextualToken(token);
        c.setTokenClaims(claims);
        c.setTokenContext('');

        log.infof(c, `[${P}.${handler}] user "uid:${user.uid}" token refreshed, new token will be expired at ${claims.expiresAt}`);

        const resp: TwoFactorEnableConfirmResponse = { token: token, recoveryCodes: recoveryCodes };
        return resp;
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        return { recoveryCodes: recoveryCodes };
    }
}

// twoFactorDisableHandler disables 2fa for current user
export async function twoFactorDisableHandler(c: WebContext): Promise<unknown> {
    const handler = 'TwoFactorDisableHandler';
    const disableReq = await bindJson<TwoFactorDisableRequest>(c, PasswordRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    checkNormalToken(c, handler, 'disable two-factor authentication');

    const user = await getUser(c, handler, true);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_DISABLE_2FA)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (!Users.isPasswordEqualsUserPassword(disableReq.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    if (!await existsTwoFactor(c, handler)) {
        throw errs.ErrTwoFactorIsNotEnabled;
    }

    try {
        await TwoFactorAuthorizations.deleteTwoFactorRecoveryCodes(c, uid);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to delete two-factor recovery codes for user "uid:${uid}"`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    try {
        await TwoFactorAuthorizations.deleteTwoFactorSetting(c, uid);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to delete two-factor setting for user "uid:${uid}"`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has disabled two-factor authorization`);
    return true;
}

// twoFactorRecoveryCodeRegenerateHandler returns new 2fa recovery codes and revokes old recovery codes for current user
export async function twoFactorRecoveryCodeRegenerateHandler(c: WebContext): Promise<unknown> {
    const handler = 'TwoFactorRecoveryCodeRegenerateHandler';
    const regenerateReq = await bindJson<TwoFactorDisableRequest>(c, PasswordRequestSchema, `${P}.${handler}`);
    const uid = c.getCurrentUid();

    checkNormalToken(c, handler, 'regenerate two-factor recovery codes');

    const user = await getUser(c, handler, true);

    if (!Users.isPasswordEqualsUserPassword(regenerateReq.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    if (!await existsTwoFactor(c, handler)) {
        throw errs.ErrTwoFactorIsNotEnabled;
    }

    const recoveryCodes = TwoFactorAuthorizations.generateTwoFactorRecoveryCodes();

    try {
        await TwoFactorAuthorizations.createTwoFactorRecoveryCodes(c, uid, recoveryCodes, user.salt);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to create two-factor recovery codes for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${P}.${handler}] user "uid:${uid}" has regenerated two-factor recovery codes`);
    return { recoveryCodes: recoveryCodes };
}
