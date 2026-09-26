import { getExternalUserAuthType, getOAuth2AuthUrl, getOAuth2Token, getOAuth2UserInfo } from '../auth/oauth2/index';
import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_OAUTH2_LOGIN } from '../core/feature_restriction';
import { FISCAL_YEAR_START_DEFAULT } from '../core/fiscalyear';
import { USER_TOKEN_TYPE_NORMAL } from '../core/token_claims';
import { DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import { AllLanguages } from '../locales/index';
import * as log from '../log/index';
import { newUser, type OAuth2CallbackRequest, type OAuth2LoginRequest, TRANSACTION_EDIT_SCOPE_ALL, type User, type UserExternalAuth } from '../models/index';
import { OAuth2UserIdentifierEmail, OAuth2UserIdentifierUsername } from '../settings/settings';
import { Tokens } from '../services/tokens';
import { UserExternalAuths } from '../services/user_external_auths';
import { goQueryEscape, Users } from '../services/users';
import { stringToInt64 } from '../utils/converter';
import { getRandomNumberOrLowercaseLetter, md5EncodeToString } from '../utils/strings';
import { isValidEmail, isValidNickName, isValidUsername } from '../utils/validators';
import { allCurrencyNames, BindingError, getDisplayErrorMessage, ValidationErrors } from '../web/binding';
import type { WebContext } from '../web/context';
import { goJsonStringify } from '../web/json';
import { currentConfig, errMsg, getSubmissionRemark, removeSubmissionRemark, setSubmissionRemarkWithCustomExpiration } from './base';
import { OAuth2CallbackRequestSchema, OAuth2LoginRequestSchema } from './schemas';

const P = 'oauth2_authentications';

function toAppError(err: unknown, defaultErr: errs.AppError): errs.AppError {
    return errs.or(err, defaultErr);
}

function redirectToSuccessCallbackPage(platform: string, externalAuthType: string, token: string): string {
    return `${currentConfig().rootUrl}desktop/oauth2_callback?platform=${platform}&provider=${externalAuthType}&token=${goQueryEscape(token)}`;
}

function redirectToVerifyCallbackPage(platform: string, externalAuthType: string, userName: string, token: string): string {
    return `${currentConfig().rootUrl}desktop/oauth2_callback?platform=${platform}&provider=${externalAuthType}&userName=${userName}&token=${goQueryEscape(token)}`;
}

function redirectToFailedCallbackPage(err: errs.AppError): string {
    return `${currentConfig().rootUrl}desktop/oauth2_callback?errorCode=${err.code}&errorMessage=${goQueryEscape(getDisplayErrorMessage(err))}`;
}

function redirectToErrorMessageCallbackPage(message: string): string {
    return `${currentConfig().rootUrl}desktop/oauth2_callback?errorMessage=${goQueryEscape(message)}`;
}

function bindQueryOrError<T>(c: WebContext, schemaDef: Parameters<WebContext['shouldBindQuery']>[0], handler: string): T | errs.AppError {
    try {
        return c.shouldBindQuery<T>(schemaDef);
    } catch (err) {
        log.warnf(c, `[${P}.${handler}] parse request failed, because ${errMsg(err)}`);

        if (err instanceof BindingError || err instanceof ValidationErrors) {
            return errs.newIncompleteOrIncorrectSubmissionError(err);
        }

        return errs.newIncompleteOrIncorrectSubmissionError(err as Error);
    }
}

// loginHandler redirects to the oauth 2.0 provider login page
export async function loginHandler(c: WebContext): Promise<string> {
    const handler = 'LoginHandler';
    const req = bindQueryOrError<OAuth2LoginRequest>(c, OAuth2LoginRequestSchema, handler);

    if (req instanceof errs.AppError) {
        return redirectToFailedCallbackPage(req);
    }

    if (req.platform !== 'mobile' && req.platform !== 'desktop') {
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2LoginRequest);
    }

    const [found, existedRemark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT, 0n, req.clientSessionId);

    if (found) {
        log.errorf(c, `[${P}.${handler}] another oauth 2.0 state "${existedRemark}" has been processing for client session id "${req.clientSessionId}"`);
        return redirectToFailedCallbackPage(errs.ErrRepeatedRequest);
    }

    let uid = 0n;

    if (req.token !== '') {
        let claims;

        try {
            ({ claims } = await Tokens.parseToken(c, req.token));
        } catch (err) {
            log.errorf(c, `[${P}.${handler}] failed to parse token, because ${errMsg(err)}`);
            return redirectToFailedCallbackPage(errs.ErrInvalidToken);
        }

        if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
            log.errorf(c, `[${P}.${handler}] token type "${claims.type}" is not allowed to login via oauth 2.0`);
            return redirectToFailedCallbackPage(errs.ErrInvalidToken);
        }

        uid = claims.uid;
        let user: User | null = null;

        try {
            user = await Users.getUserById(c, uid);
        } catch (err) {
            if (!(err instanceof errs.AppError && err.is(errs.ErrUserNotFound))) {
                log.errorf(c, `[${P}.${handler}] failed to get user by id ${uid}, because ${errMsg(err)}`);
                return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
            }
        }

        if (user && containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_OAUTH2_LOGIN)) {
            return redirectToFailedCallbackPage(errs.ErrNotPermittedToPerformThisAction);
        }
    }

    const verifier = getRandomNumberOrLowercaseLetter(64);
    const remark = `${req.platform}|${req.clientSessionId}|${uid}|${verifier}`;
    const state = `${req.platform}|${req.clientSessionId}|${md5EncodeToString(remark)}`;
    let redirectUrl: string;

    try {
        redirectUrl = await getOAuth2AuthUrl(c, state, verifier);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get oauth 2.0 auth url, because ${errMsg(err)}`);
        return redirectToFailedCallbackPage(toAppError(err, errs.ErrSystemError));
    }

    setSubmissionRemarkWithCustomExpiration(DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT, 0n, req.clientSessionId, remark, currentConfig().oauth2StateExpiredTime);
    return redirectUrl;
}

// callbackHandler handles the callback of oauth 2.0 provider
export async function callbackHandler(c: WebContext): Promise<string> {
    try {
        return await callbackHandlerInternal(c);
    } catch (err) {
        return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
    }
}

async function callbackHandlerInternal(c: WebContext): Promise<string> {
    const handler = 'CallbackHandler';
    const config = currentConfig();
    const req = bindQueryOrError<OAuth2CallbackRequest>(c, OAuth2CallbackRequestSchema, handler);

    if (req instanceof errs.AppError) {
        return redirectToFailedCallbackPage(req);
    }

    if (req.state === '') {
        return redirectToFailedCallbackPage(errs.ErrMissingOAuth2State);
    }

    if (req.code === '') {
        if (req.errorDescription !== '') {
            log.errorf(c, `[${P}.${handler}] oauth 2.0 provider returned error: ${req.error}, description: ${req.errorDescription}`);
            return redirectToErrorMessageCallbackPage(req.errorDescription);
        }

        return redirectToFailedCallbackPage(errs.ErrMissingOAuth2Code);
    }

    const stateParts = req.state.split('|');

    if (stateParts.length !== 3) {
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2State);
    }

    const platform = stateParts[0] as string;
    const clientSessionId = stateParts[1] as string;

    if (platform !== 'mobile' && platform !== 'desktop') {
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2LoginRequest);
    }

    const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT, 0n, clientSessionId);

    if (!found) {
        log.errorf(c, `[${P}.${handler}] cannot find oauth 2.0 state in duplicate checker for client session id "${clientSessionId}"`);
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2Callback);
    }

    const remarkParts = remark.split('|');

    if (remarkParts.length !== 4 || remarkParts[0] !== platform || remarkParts[1] !== clientSessionId) {
        log.errorf(c, `[${P}.${handler}] invalid oauth 2.0 state "${remark}" in duplicate checker for client session id "${clientSessionId}"`);
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2State);
    }

    let uid: bigint;

    try {
        uid = stringToInt64(remarkParts[2] as string);
    } catch {
        log.errorf(c, `[${P}.${handler}] invalid uid "${remarkParts[2]}" in oauth 2.0 state "${remark}"`);
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2State);
    }

    const verifier = remarkParts[3] as string;
    const expectedRemark = `${platform}|${clientSessionId}|${uid}|${verifier}`;
    const expectedState = `${platform}|${clientSessionId}|${md5EncodeToString(expectedRemark)}`;

    if (req.state !== expectedState) {
        log.errorf(c, `[${P}.${handler}] mismatched random string in oauth 2.0 state, expected "${expectedState}", got "${req.state}"`);
        return redirectToFailedCallbackPage(errs.ErrInvalidOAuth2State);
    }

    removeSubmissionRemark(DUPLICATE_CHECKER_TYPE_OAUTH2_REDIRECT, 0n, clientSessionId);

    let oauth2Token;

    try {
        oauth2Token = await getOAuth2Token(c, req.code, verifier);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to retrieve oauth 2.0 token, because ${errMsg(err)}`);
        return redirectToFailedCallbackPage(toAppError(err, errs.ErrCannotRetrieveOAuth2Token));
    }

    let oauth2UserInfo;

    try {
        oauth2UserInfo = await getOAuth2UserInfo(c, oauth2Token);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to retrieve oauth 2.0 user info, because ${errMsg(err)}`);
        return redirectToFailedCallbackPage(toAppError(err, errs.ErrInvalidOAuth2Token));
    }

    log.infof(c, `[${P}.${handler}] oauth 2.0 user info, userName: ${oauth2UserInfo.userName}, email: ${oauth2UserInfo.email}`);

    if (oauth2UserInfo.userName === '' && oauth2UserInfo.email === '') {
        return redirectToFailedCallbackPage(errs.ErrOAuth2UserNameAndEmailEmpty);
    }

    if (config.oauth2UserIdentifier === OAuth2UserIdentifierEmail && oauth2UserInfo.email === '') {
        log.errorf(c, `[${P}.${handler}] invalid oauth 2.0 user info, email is empty`);
        return redirectToFailedCallbackPage(errs.ErrOAuth2EmailEmpty);
    }

    if (config.oauth2UserIdentifier === OAuth2UserIdentifierUsername && oauth2UserInfo.userName === '') {
        log.errorf(c, `[${P}.${handler}] invalid oauth 2.0 user info, userName is empty`);
        return redirectToFailedCallbackPage(errs.ErrOAuth2UserNameEmpty);
    }

    const userExternalAuthType = getExternalUserAuthType();
    let userExternalAuth: UserExternalAuth | null = null;
    let externalAuthNotFound = false;

    try {
        if (config.oauth2UserIdentifier === OAuth2UserIdentifierEmail) {
            userExternalAuth = await UserExternalAuths.getUserExternalAuthByExternalEmail(c, oauth2UserInfo.email, userExternalAuthType);
        } else if (config.oauth2UserIdentifier === OAuth2UserIdentifierUsername) {
            userExternalAuth = await UserExternalAuths.getUserExternalAuthByExternalUserName(c, oauth2UserInfo.userName, userExternalAuthType);
        } else {
            return redirectToFailedCallbackPage(errs.ErrNotSupported);
        }
    } catch (err) {
        if (err instanceof errs.AppError && err.is(errs.ErrUserExternalAuthNotFound)) {
            externalAuthNotFound = true;
        } else {
            log.errorf(c, `[${P}.${handler}] failed to get user external auth, because ${errMsg(err)}`);
            return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
        }
    }

    if (uid !== 0n && userExternalAuth && userExternalAuth.uid !== uid) {
        log.errorf(c, `[${P}.${handler}] oauth 2.0 external auth has been bound to another user "uid:${userExternalAuth.uid}", current user "uid:${uid}"`);
        return redirectToFailedCallbackPage(errs.ErrOAuth2UserAlreadyBoundToAnotherUser);
    }

    let user: User | null = null;

    const isUserNotFound = (err: unknown): boolean => err instanceof errs.AppError && err.is(errs.ErrUserNotFound);

    if (!externalAuthNotFound && userExternalAuth) {
        const boundUid = userExternalAuth.uid;

        try {
            user = await Users.getUserById(c, boundUid);
        } catch (err) {
            log.errorf(c, `[${P}.${handler}] failed to get user by id ${boundUid}, because ${errMsg(err)}`);
            return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
        }
    } else {
        if (uid !== 0n) {
            try {
                user = await Users.getUserById(c, uid);
            } catch (err) {
                if (!isUserNotFound(err)) {
                    log.errorf(c, `[${P}.${handler}] failed to get user by id ${uid}, because ${errMsg(err)}`);
                    return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
                }
            }
        } else {
            try {
                if (config.oauth2UserIdentifier === OAuth2UserIdentifierEmail) {
                    user = await Users.getUserByEmail(c, oauth2UserInfo.email);
                } else if (config.oauth2UserIdentifier === OAuth2UserIdentifierUsername) {
                    user = await Users.getUserByUsername(c, oauth2UserInfo.userName);
                } else {
                    throw errs.ErrNotSupported;
                }
            } catch (err) {
                if (!isUserNotFound(err)) {
                    log.errorf(c, `[${P}.${handler}] failed to get user, because ${errMsg(err)}`);
                    return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
                }
            }
        }

        if (!user && config.enableUserRegister && config.oauth2AutoRegister) {
            if (oauth2UserInfo.userName === '') {
                return redirectToFailedCallbackPage(errs.ErrOAuth2UserNameEmptyCannotRegister);
            }

            if (oauth2UserInfo.email === '') {
                return redirectToFailedCallbackPage(errs.ErrOAuth2EmailEmptyCannotRegister);
            }

            const userName = oauth2UserInfo.userName.trim();
            const email = oauth2UserInfo.email.trim();
            let nickName = oauth2UserInfo.nickName.trim();
            let languageCode = '';
            let currencyCode = 'USD';

            if (nickName === '') {
                nickName = userName;
            }

            if (!isValidUsername(userName)) {
                return redirectToFailedCallbackPage(errs.ErrUserNameIsInvalid);
            }

            if (!isValidEmail(email)) {
                return redirectToFailedCallbackPage(errs.ErrEmailIsInvalid);
            }

            if (!isValidNickName(nickName)) {
                return redirectToFailedCallbackPage(errs.ErrNickNameIsInvalid);
            }

            if (Object.hasOwn(AllLanguages, oauth2UserInfo.languageCode)) {
                languageCode = oauth2UserInfo.languageCode;
            }

            if (allCurrencyNames.has(oauth2UserInfo.currencyCode)) {
                currencyCode = oauth2UserInfo.currencyCode;
            }

            const newUserModel = newUser({
                username: userName,
                email: email,
                nickname: nickName,
                language: languageCode,
                defaultCurrency: currencyCode,
                firstDayOfWeek: oauth2UserInfo.firstDayOfWeek,
                fiscalYearStart: FISCAL_YEAR_START_DEFAULT,
                transactionEditScope: TRANSACTION_EDIT_SCOPE_ALL,
                featureRestriction: config.defaultFeatureRestrictions,
            });

            if (containsFeatureRestriction(newUserModel.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_OAUTH2_LOGIN)) {
                return redirectToFailedCallbackPage(errs.ErrNotPermittedToPerformThisAction);
            }

            try {
                await Users.createUser(c, newUserModel, true);
            } catch (err) {
                log.errorf(c, `[${P}.${handler}] failed to create user "${newUserModel.username}", because ${errMsg(err)}`);
                return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
            }

            user = newUserModel;
            log.infof(c, `[${P}.${handler}] user "${user.username}" has registered successfully, uid is ${user.uid}`);

            const newExternalAuth = {
                uid: user.uid,
                externalAuthType: userExternalAuthType,
                externalUsername: oauth2UserInfo.userName,
                externalEmail: oauth2UserInfo.email,
                createdUnixTime: 0,
            } as UserExternalAuth;

            try {
                await UserExternalAuths.createUserExternalAuth(c, newExternalAuth);
            } catch (err) {
                log.errorf(c, `[${P}.${handler}] failed to create user external auth for user "uid:${user.uid}", because ${errMsg(err)}`);
                return redirectToFailedCallbackPage(toAppError(err, errs.ErrOperationFailed));
            }

            userExternalAuth = newExternalAuth;
            log.infof(c, `[${P}.${handler}] user external auth has been created for user "uid:${user.uid}"`);
        } else if (!user) {
            return redirectToFailedCallbackPage(errs.ErrOAuth2AutoRegistrationNotEnabled);
        }
    }

    if (!user) {
        return redirectToFailedCallbackPage(errs.ErrUserNotFound);
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_OAUTH2_LOGIN)) {
        return redirectToFailedCallbackPage(errs.ErrNotPermittedToPerformThisAction);
    }

    if (!userExternalAuth) {
        const tokenContext = goJsonStringify({
            externalAuthType: userExternalAuthType,
            externalUsername: oauth2UserInfo.userName,
            externalEmail: oauth2UserInfo.email,
        });

        let token: string;

        try {
            [token] = await Tokens.createOAuth2CallbackRequireVerifyToken(c, user, tokenContext);
        } catch (err) {
            log.errorf(c, `[${P}.${handler}] failed to create oauth 2.0 callback verify token, because ${errMsg(err)}`);
            return redirectToFailedCallbackPage(errs.ErrTokenGenerating);
        }

        return redirectToVerifyCallbackPage(platform, userExternalAuthType, user.username, token);
    } else {
        const tokenContext = goJsonStringify({
            externalAuthType: userExternalAuthType,
            externalUsername: '',
            externalEmail: '',
        });

        let token: string;

        try {
            [token] = await Tokens.createOAuth2CallbackToken(c, user, tokenContext);
        } catch (err) {
            log.errorf(c, `[${P}.${handler}] failed to create oauth 2.0 callback token, because ${errMsg(err)}`);
            return redirectToFailedCallbackPage(errs.ErrTokenGenerating);
        }

        return redirectToSuccessCallbackPage(platform, userExternalAuthType, token);
    }
}
