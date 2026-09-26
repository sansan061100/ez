import { USER_TOKEN_TYPE_EMAIL_VERIFY, USER_TOKEN_TYPE_NORMAL, USER_TOKEN_TYPE_OAUTH2_CALLBACK, USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY, type UserTokenClaims } from '../core/token_claims';
import { isValidUserExternalAuthType } from '../core/types';
import { DUPLICATE_CHECKER_TYPE_2FA_PASSCODE } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import type { ApplicationCloudSetting, AuthResponse, OAuth2CallbackLoginRequest, OAuth2CallbackTokenContext, TwoFactor, TwoFactorLoginRequest, TwoFactorRecoveryCodeLoginRequest, User, UserLoginRequest } from '../models/index';
import { Tokens } from '../services/tokens';
import { validateTotp } from '../services/totp';
import { TwoFactorAuthorizations } from '../services/twofactor_authorizations';
import { UserExternalAuths } from '../services/user_external_auths';
import { Users } from '../services/users';
import { md5EncodeToStringWithUidAndSalt } from '../utils/strings';
import type { WebContext } from '../web/context';
import { checkAndIncreaseFailureCount, checkFailureCount, currentConfig, errMsg, getAfterLoginNotificationContent, getLatestApplicationCloudSettings, getSubmissionRemark, getUserBasicInfo, setSubmissionRemarkWithCustomExpiration } from './base';
import { OAuth2CallbackLoginRequestSchema, TwoFactorLoginRequestSchema, TwoFactorRecoveryCodeLoginRequestSchema, UserLoginRequestSchema } from './schemas';

export function buildAuthResponse(c: WebContext, token: string, need2FA: boolean, user: User, applicationCloudSettings: ApplicationCloudSetting[] | null): AuthResponse {
    const response: AuthResponse = {
        token: token,
        need2FA: need2FA,
        user: getUserBasicInfo(user),
    };

    if (applicationCloudSettings) {
        response.applicationCloudSettings = applicationCloudSettings;
    }

    const notificationContent = getAfterLoginNotificationContent(user.language, c.getClientLocale());

    if (notificationContent !== '') {
        response.notificationContent = notificationContent;
    }

    return response;
}

function is2FAPasscodeUsed(c: WebContext, uid: bigint, passcode: string): [boolean, string] {
    const passcodeHash = md5EncodeToStringWithUidAndSalt(Buffer.from(passcode), uid, currentConfig().secretKey);
    const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_2FA_PASSCODE, uid, passcodeHash);

    if (found) {
        log.warnf(c, `[authorizations.is2FAPasscodeUsed] passcode "${passcode}" has been used for user "uid:${uid}" in unix timestamp ${remark}`);
        return [true, passcodeHash];
    }

    return [false, passcodeHash];
}

function update2FAPasscodeUsed(_c: WebContext, uid: bigint, passcodeHash: string): void {
    setSubmissionRemarkWithCustomExpiration(DUPLICATE_CHECKER_TYPE_2FA_PASSCODE, uid, passcodeHash, String(Math.floor(Date.now() / 1000)), 30);
}

// authorizeHandler verifies and authorizes current login request
export async function authorizeHandler(c: WebContext): Promise<unknown> {
    if (!currentConfig().enableInternalAuth) {
        throw errs.ErrCannotLoginByPassword;
    }

    let credential: UserLoginRequest;

    try {
        credential = await c.shouldBindJSON<UserLoginRequest>(UserLoginRequestSchema);
    } catch (err) {
        log.warnf(c, `[authorizations.AuthorizeHandler] parse request failed, because ${errMsg(err)}`);
        throw errs.ErrLoginNameOrPasswordInvalid;
    }

    try {
        checkFailureCount(c, 0n);
    } catch (err) {
        log.warnf(c, `[authorizations.AuthorizeHandler] cannot login for user "${credential.loginName}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrFailureCountLimitReached);
    }

    const [user, uid, err] = await Users.getUserByUsernameOrEmailAndPassword(c, credential.loginName, credential.password);

    if (errs.isCustomError(err)) {
        const failureCheckErr = checkAndIncreaseFailureCount(c, uid);

        if (failureCheckErr) {
            log.warnf(c, `[authorizations.AuthorizeHandler] cannot login for user "${credential.loginName}", because ${failureCheckErr.message}`);
            throw failureCheckErr;
        }
    }

    if (err || !user) {
        log.warnf(c, `[authorizations.AuthorizeHandler] login failed for user "${credential.loginName}", because ${errMsg(err)}`);
        throw errs.ErrLoginNameOrPasswordWrong;
    }

    if (user.disabled) {
        log.warnf(c, `[authorizations.AuthorizeHandler] login failed for user "${credential.loginName}", because user is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (currentConfig().enableUserForceVerifyEmail && !user.emailVerified) {
        let hasValidEmailVerifyToken: boolean;

        try {
            hasValidEmailVerifyToken = await Tokens.existsValidTokenByType(c, user.uid, USER_TOKEN_TYPE_EMAIL_VERIFY);
        } catch (e) {
            log.warnf(c, `[authorizations.AuthorizeHandler] failed check whether user "uid:${user.uid}" has valid verify email token, because ${errMsg(e)}`);
            hasValidEmailVerifyToken = false;
        }

        log.warnf(c, `[authorizations.AuthorizeHandler] login failed for user "${credential.loginName}", because user has not verified email`);
        throw errs.newErrorWithContext(errs.ErrEmailIsNotVerified, {
            email: user.email,
            hasValidEmailVerifyToken: hasValidEmailVerifyToken,
        });
    }

    try {
        await Users.updateUserLastLoginTime(c, user.uid);
    } catch (e) {
        log.warnf(c, `[authorizations.AuthorizeHandler] failed to update last login time for user "uid:${user.uid}", because ${errMsg(e)}`);
    }

    let twoFactorEnable = currentConfig().enableTwoFactor;

    if (twoFactorEnable) {
        try {
            twoFactorEnable = await TwoFactorAuthorizations.existsTwoFactorSetting(c, user.uid);
        } catch (e) {
            log.errorf(c, `[authorizations.AuthorizeHandler] failed to check two-factor setting for user "uid:${user.uid}", because ${errMsg(e)}`);
            throw errs.or(e, errs.ErrSystemError);
        }
    }

    let token: string;
    let claims: UserTokenClaims;

    try {
        if (twoFactorEnable) {
            [token, claims] = await Tokens.createRequire2FAToken(c, user);
        } else {
            [token, claims] = await Tokens.createToken(c, user);
        }
    } catch (e) {
        log.errorf(c, `[authorizations.AuthorizeHandler] failed to create token for user "uid:${user.uid}", because ${errMsg(e)}`);
        throw errs.ErrTokenGenerating;
    }

    if (!twoFactorEnable) {
        c.setTextualToken(token);
    }

    c.setTokenClaims(claims);
    c.setTokenContext('');

    const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, 'authorizations.AuthorizeHandler');

    log.infof(c, `[authorizations.AuthorizeHandler] user "uid:${user.uid}" has logged in, token type is ${claims.type}, token will be expired at ${claims.expiresAt}`);

    return buildAuthResponse(c, token, twoFactorEnable, user, applicationCloudSettings);
}

async function getVerifiedUser(c: WebContext, uid: bigint, logPrefix: string): Promise<User> {
    let user: User;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get user "uid:${uid}" info, because ${errMsg(err)}`);
        throw errs.ErrUserNotFound;
    }

    if (user.disabled) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (currentConfig().enableUserForceVerifyEmail && !user.emailVerified) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" has not verified email`);
        throw errs.ErrEmailIsNotVerified;
    }

    return user;
}

async function revokeTemporaryToken(c: WebContext, user: User, logPrefix: string): Promise<void> {
    const oldTokenClaims = c.getTokenClaims()!;

    try {
        await Tokens.deleteTokenByClaims(c, oldTokenClaims);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to revoke temporary token "utid:${oldTokenClaims.userTokenId}" for user "uid:${user.uid}", because ${errMsg(err)}`);
    }
}

async function createNormalToken(c: WebContext, user: User, logPrefix: string): Promise<[string, UserTokenClaims]> {
    try {
        return await Tokens.createToken(c, user);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.ErrTokenGenerating;
    }
}

// twoFactorAuthorizeHandler verifies and authorizes current 2fa login by passcode
export async function twoFactorAuthorizeHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'authorizations.TwoFactorAuthorizeHandler';

    if (!currentConfig().enableInternalAuth) {
        throw errs.ErrCannotLoginByPassword;
    }

    let credential: TwoFactorLoginRequest;

    try {
        credential = await c.shouldBindJSON<TwoFactorLoginRequest>(TwoFactorLoginRequestSchema);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.ErrPasscodeInvalid;
    }

    const uid = c.getCurrentUid();

    try {
        checkFailureCount(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrFailureCountLimitReached);
    }

    let twoFactorSetting: TwoFactor;

    try {
        twoFactorSetting = await TwoFactorAuthorizations.getUserTwoFactorSettingByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get two-factor setting for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrSystemError);
    }

    const [passcodeUsed, passcodeHash] = is2FAPasscodeUsed(c, uid, credential.passcode);

    if (passcodeUsed) {
        throw errs.ErrPasscodeInvalid;
    }

    if (!validateTotp(credential.passcode, twoFactorSetting.secret)) {
        log.warnf(c, `[${logPrefix}] passcode is invalid for user "uid:${uid}"`);
        const failureCheckErr = checkAndIncreaseFailureCount(c, uid);

        if (failureCheckErr) {
            log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${failureCheckErr.message}`);
            throw failureCheckErr;
        }

        throw errs.ErrPasscodeInvalid;
    }

    update2FAPasscodeUsed(c, uid, passcodeHash);

    const user = await getVerifiedUser(c, uid, logPrefix);
    await revokeTemporaryToken(c, user, logPrefix);

    const [token, claims] = await createNormalToken(c, user, logPrefix);

    c.setTextualToken(token);
    c.setTokenClaims(claims);
    c.setTokenContext('');

    const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, logPrefix);

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has authorized two-factor via passcode, token will be expired at ${claims.expiresAt}`);

    return buildAuthResponse(c, token, false, user, applicationCloudSettings);
}

// twoFactorAuthorizeByRecoveryCodeHandler verifies and authorizes current 2fa login by recovery code
export async function twoFactorAuthorizeByRecoveryCodeHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'authorizations.TwoFactorAuthorizeByRecoveryCodeHandler';

    if (!currentConfig().enableInternalAuth) {
        throw errs.ErrCannotLoginByPassword;
    }

    let credential: TwoFactorRecoveryCodeLoginRequest;

    try {
        credential = await c.shouldBindJSON<TwoFactorRecoveryCodeLoginRequest>(TwoFactorRecoveryCodeLoginRequestSchema);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.ErrTwoFactorRecoveryCodeInvalid;
    }

    const uid = c.getCurrentUid();

    try {
        checkFailureCount(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrFailureCountLimitReached);
    }

    let enableTwoFactor: boolean;

    try {
        enableTwoFactor = await TwoFactorAuthorizations.existsTwoFactorSetting(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to get two-factor setting for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrSystemError);
    }

    if (!enableTwoFactor) {
        throw errs.ErrTwoFactorIsNotEnabled;
    }

    const user = await getVerifiedUser(c, uid, logPrefix);

    try {
        await TwoFactorAuthorizations.getAndUseUserTwoFactorRecoveryCode(c, uid, credential.recoveryCode, user.salt);
    } catch (err) {
        if (errs.isCustomError(err)) {
            const failureCheckErr = checkAndIncreaseFailureCount(c, uid);

            if (failureCheckErr) {
                log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${failureCheckErr.message}`);
                throw failureCheckErr;
            }
        }

        log.warnf(c, `[${logPrefix}] failed to get two-factor recovery code for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrTwoFactorRecoveryCodeNotExist);
    }

    await revokeTemporaryToken(c, user, logPrefix);

    const [token, claims] = await createNormalToken(c, user, logPrefix);

    c.setTextualToken(token);
    c.setTokenClaims(claims);
    c.setTokenContext('');

    const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, logPrefix);

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has authorized two-factor via recovery code "${credential.recoveryCode}", token will be expired at ${claims.expiresAt}`);

    return buildAuthResponse(c, token, false, user, applicationCloudSettings);
}

// oauth2CallbackAuthorizeHandler verifies and authorizes current oauth 2.0 callback login
export async function oauth2CallbackAuthorizeHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'authorizations.OAuth2CallbackAuthorizeHandler';

    if (!currentConfig().enableOAuth2Login) {
        throw errs.ErrOAuth2NotEnabled;
    }

    let credential: OAuth2CallbackLoginRequest;

    try {
        credential = await c.shouldBindJSON<OAuth2CallbackLoginRequest>(OAuth2CallbackLoginRequestSchema);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }

    let tokenContext: OAuth2CallbackTokenContext;

    try {
        const parsed = JSON.parse(c.getTokenContext()) as Record<string, unknown>;
        tokenContext = {
            externalAuthType: typeof parsed['externalAuthType'] === 'string' ? parsed['externalAuthType'] : '',
            externalUsername: typeof parsed['externalUsername'] === 'string' ? parsed['externalUsername'] : '',
            externalEmail: typeof parsed['externalEmail'] === 'string' ? parsed['externalEmail'] : '',
        };
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse token context failed, because ${errMsg(err)}`);
        throw errs.ErrOperationFailed;
    }

    if (!isValidUserExternalAuthType(tokenContext.externalAuthType)) {
        log.warnf(c, `[${logPrefix}] external auth type "${tokenContext.externalAuthType}" is invalid`);
        throw errs.ErrInvalidOAuth2Provider;
    }

    const uid = c.getCurrentUid();

    try {
        checkFailureCount(c, uid);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrFailureCountLimitReached);
    }

    const user = await getVerifiedUser(c, uid, logPrefix);
    const oldTokenClaims = c.getTokenClaims()!;

    if (oldTokenClaims.type === USER_TOKEN_TYPE_OAUTH2_CALLBACK_REQUIRE_VERIFY) {
        if (credential.password === '') {
            throw errs.ErrPasswordIsEmpty;
        }

        if (!Users.isPasswordEqualsUserPassword(credential.password, user)) {
            const failureCheckErr = checkAndIncreaseFailureCount(c, uid);

            if (failureCheckErr) {
                log.warnf(c, `[${logPrefix}] cannot login for user "uid:${user.uid}", because ${failureCheckErr.message}`);
                throw failureCheckErr;
            }

            throw errs.ErrUserPasswordWrong;
        }

        if (currentConfig().enableTwoFactor) {
            let twoFactorSetting: TwoFactor | null = null;

            try {
                twoFactorSetting = await TwoFactorAuthorizations.getUserTwoFactorSettingByUid(c, uid);
            } catch (err) {
                if (!(err instanceof errs.AppError && err.is(errs.ErrTwoFactorIsNotEnabled))) {
                    log.errorf(c, `[${logPrefix}] failed to check two-factor setting for user "uid:${user.uid}", because ${errMsg(err)}`);
                    throw errs.or(err, errs.ErrSystemError);
                }
            }

            if (twoFactorSetting) {
                if (credential.passcode === '') {
                    throw errs.ErrPasscodeEmpty;
                }

                const [passcodeUsed, passcodeHash] = is2FAPasscodeUsed(c, uid, credential.passcode);

                if (passcodeUsed) {
                    throw errs.ErrPasscodeInvalid;
                }

                if (!validateTotp(credential.passcode, twoFactorSetting.secret)) {
                    log.warnf(c, `[${logPrefix}] passcode is invalid for user "uid:${uid}"`);
                    const failureCheckErr = checkAndIncreaseFailureCount(c, uid);

                    if (failureCheckErr) {
                        log.warnf(c, `[${logPrefix}] cannot auth for user "uid:${uid}", because ${failureCheckErr.message}`);
                        throw failureCheckErr;
                    }

                    throw errs.ErrPasscodeInvalid;
                }

                update2FAPasscodeUsed(c, uid, passcodeHash);
            }
        }

        try {
            await UserExternalAuths.createUserExternalAuth(c, {
                uid: user.uid,
                externalAuthType: tokenContext.externalAuthType,
                externalUsername: tokenContext.externalUsername,
                externalEmail: tokenContext.externalEmail,
                createdUnixTime: 0,
            });
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to create user external auth for user "uid:${user.uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        log.infof(c, `[${logPrefix}] user external auth has been created for user "uid:${user.uid}"`);
    } else if (oldTokenClaims.type === USER_TOKEN_TYPE_OAUTH2_CALLBACK) {
        try {
            await UserExternalAuths.getUserExternalAuthByUid(c, uid, tokenContext.externalAuthType);
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to get user external auth for user "uid:${uid}", because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrUserExternalAuthNotFound);
        }
    } else {
        throw errs.ErrSystemError;
    }

    await revokeTemporaryToken(c, user, logPrefix);

    let token = '';
    let claims: UserTokenClaims | null = null;

    if (credential.token !== '') {
        let parsedClaims: UserTokenClaims;

        try {
            parsedClaims = (await Tokens.parseToken(c, credential.token)).claims;
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to parse token, because ${errMsg(err)}`);
            throw errs.ErrInvalidToken;
        }

        if (parsedClaims.type !== USER_TOKEN_TYPE_NORMAL) {
            log.warnf(c, `[${logPrefix}] token type "${parsedClaims.type}" is not allowed to login via oauth 2.0`);
        } else if (parsedClaims.uid !== user.uid) {
            log.warnf(c, `[${logPrefix}] oauth 2.0 user "uid:${user.uid}" does not match current user "uid:${parsedClaims.uid}"`);
        } else {
            token = credential.token;
            claims = parsedClaims;
        }
    }

    if (token === '') {
        [token, claims] = await createNormalToken(c, user, logPrefix);
    }

    c.setTextualToken(token);
    c.setTokenClaims(claims);
    c.setTokenContext('');

    const applicationCloudSettings = await getLatestApplicationCloudSettings(c, user.uid, logPrefix);

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has logged in, token will be expired at ${claims!.expiresAt}`);

    return buildAuthResponse(c, token, false, user, applicationCloudSettings);
}
