import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_AVATAR, USER_FEATURE_RESTRICTION_TYPE_UPDATE_EMAIL, USER_FEATURE_RESTRICTION_TYPE_UPDATE_PASSWORD, USER_FEATURE_RESTRICTION_TYPE_UPDATE_PROFILE_BASIC_INFO } from '../core/feature_restriction';
import { FISCAL_YEAR_START_DEFAULT, FISCAL_YEAR_START_INVALID } from '../core/fiscalyear';
import { USER_TOKEN_TYPE_EMAIL_VERIFY, USER_TOKEN_TYPE_NORMAL } from '../core/token_claims';
import {
    AccountCurrencyNotSetValue,
    CALENDAR_DISPLAY_TYPE_INVALID,
    COORDINATE_DISPLAY_TYPE_INVALID,
    CURRENCY_DISPLAY_TYPE_INVALID,
    DATE_DISPLAY_TYPE_INVALID,
    DECIMAL_SEPARATOR_INVALID,
    DIGIT_GROUPING_SYMBOL_INVALID,
    DIGIT_GROUPING_TYPE_INVALID,
    FISCAL_YEAR_FORMAT_INVALID,
    LONG_DATE_FORMAT_INVALID,
    LONG_TIME_FORMAT_INVALID,
    NUMERAL_SYSTEM_INVALID,
    SHORT_DATE_FORMAT_INVALID,
    SHORT_TIME_FORMAT_INVALID,
    WEEKDAY_INVALID,
} from '../core/types';
import * as errs from '../errs/index';
import { isDecimalSeparatorEqualsDigitGroupingSymbol } from '../locales/index';
import * as log from '../log/index';
import {
    AMOUNT_COLOR_TYPE_INVALID,
    type Account,
    newUser,
    type RegisterResponse,
    TRANSACTION_EDIT_SCOPE_ALL,
    TRANSACTION_EDIT_SCOPE_INVALID,
    toUserProfileResponse,
    type User,
    type UserProfileResponse,
    type UserProfileUpdateRequest,
    type UserProfileUpdateResponse,
    type UserRegisterRequest,
    type UserResendVerifyEmailRequest,
    type UserVerifyEmailRequest,
    type UserVerifyEmailResponse,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { Tokens } from '../services/tokens';
import { Users } from '../services/users';
import { getFileNameExtension, getFileNameWithoutExtension, getImageContentType } from '../utils/io';
import { bindJSON, type Schema } from '../web/binding';
import type { WebContext } from '../web/context';
import { bindJson, currentConfig, errMsg, getAfterLoginNotificationContent, getAfterRegisterNotificationContent, getUserBasicInfo } from './base';
import { UserProfileUpdateRequestSchema, UserRegisterRequestSchema, UserResendVerifyEmailRequestSchema, UserVerifyEmailRequestSchema } from './schemas';
import { createBatchCategories } from './transaction_categories';

function getUserProfileResponse(user: User): UserProfileResponse {
    return toUserProfileResponse(user, getUserBasicInfo(user));
}

// bindJsonIgnoreValidation binds the json request body and ignores the error (like go code which ignores the error of ShouldBindJSON)
async function bindJsonIgnoreError<T>(c: WebContext, s: Schema): Promise<T> {
    try {
        return await c.shouldBindJSON<T>(s);
    } catch {
        try {
            const body = (await c.rawBody()).toString('utf8');
            // decode again without validation
            return bindJSON<T>(body, { fields: s.fields.map(field => ({ ...field, rules: '' })) });
        } catch {
            return bindJSON<T>('null', s);
        }
    }
}

function sendVerifyEmailInBackground(c: WebContext, user: User, token: string, logPrefix: string, target: string): void {
    const clientLocale = c.getClientLocale();

    void Users.sendVerifyEmail(user, token, clientLocale).catch(err => {
        log.warnf(c, `[${logPrefix}] cannot send ${target} to "${user.email}", because ${errMsg(err)}`);
    });
}

async function getCurrentUserOrThrow(c: WebContext, logPrefix: string): Promise<User> {
    try {
        return await Users.getUserById(c, c.getCurrentUid());
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${logPrefix}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }
}

function checkNormalToken(c: WebContext, logPrefix: string, action: string): void {
    const claims = c.getTokenClaims();

    if (!claims) {
        log.warnf(c, `[${logPrefix}] current token is null`);
        throw errs.ErrInvalidToken;
    } else if (claims.type !== USER_TOKEN_TYPE_NORMAL) {
        log.warnf(c, `[${logPrefix}] token type "${claims.type}" is not allowed to ${action}`);
        throw errs.ErrInvalidToken;
    }
}

// userRegisterHandler saves a new user by request parameters
export async function userRegisterHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserRegisterHandler';
    const config = currentConfig();

    if (!config.enableUserRegister) {
        throw errs.ErrUserRegistrationNotAllowed;
    }

    const userRegisterReq = await bindJson<UserRegisterRequest>(c, UserRegisterRequestSchema, logPrefix);

    if (userRegisterReq.defaultCurrency === AccountCurrencyNotSetValue) {
        log.warnf(c, `[${logPrefix}] user default currency is invalid`);
        throw errs.ErrUserDefaultCurrencyIsInvalid;
    }

    userRegisterReq.username = userRegisterReq.username.trim();
    userRegisterReq.email = userRegisterReq.email.trim();
    userRegisterReq.nickname = userRegisterReq.nickname.trim();

    const user = newUser({
        username: userRegisterReq.username,
        email: userRegisterReq.email,
        nickname: userRegisterReq.nickname,
        password: userRegisterReq.password,
        language: userRegisterReq.language,
        defaultCurrency: userRegisterReq.defaultCurrency,
        firstDayOfWeek: userRegisterReq.firstDayOfWeek,
        fiscalYearStart: FISCAL_YEAR_START_DEFAULT,
        transactionEditScope: TRANSACTION_EDIT_SCOPE_ALL,
        featureRestriction: config.defaultFeatureRestrictions,
    });

    try {
        await Users.createUser(c, user, false);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create user "${user.username}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${logPrefix}] user "${user.username}" has registered successfully, uid is ${user.uid}`);

    let presetCategoriesSaved = false;

    if (userRegisterReq.categories && userRegisterReq.categories.length > 0) {
        try {
            await createBatchCategories(c, user.uid, { categories: userRegisterReq.categories });
            presetCategoriesSaved = true;
        } catch {
            presetCategoriesSaved = false;
        }
    }

    const authResp: Record<string, unknown> = {
        token: '',
        need2FA: false,
        user: getUserBasicInfo(user),
    };

    const notificationContent = getAfterRegisterNotificationContent(user.language, c.getClientLocale());

    if (notificationContent !== '') {
        authResp['notificationContent'] = notificationContent;
    }

    authResp['needVerifyEmail'] = config.enableUserVerifyEmail && config.enableUserForceVerifyEmail;
    authResp['presetCategoriesSaved'] = presetCategoriesSaved;

    if (config.enableUserVerifyEmail && config.enableSMTP) {
        try {
            const [token] = await Tokens.createEmailVerifyToken(c, user);
            sendVerifyEmailInBackground(c, user, token, logPrefix, 'verify email');
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to create email verify token for user "uid:${user.uid}", because ${errMsg(err)}`);
        }
    }

    if (config.enableUserForceVerifyEmail) {
        return authResp as unknown as RegisterResponse;
    }

    try {
        const [token, claims] = await Tokens.createToken(c, user);
        authResp['token'] = token;
        c.setTextualToken(token);
        c.setTokenClaims(claims);
        c.setTokenContext('');

        log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has logged in, token will be expired at ${claims.expiresAt}`);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
    }

    return authResp as unknown as RegisterResponse;
}

// userEmailVerifyHandler sets user email address verified
export async function userEmailVerifyHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserEmailVerifyHandler';
    const userVerifyEmailReq = await bindJsonIgnoreError<UserVerifyEmailRequest>(c, UserVerifyEmailRequestSchema);
    const uid = c.getCurrentUid();
    const user = await getCurrentUserOrThrow(c, logPrefix);

    if (user.disabled) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (user.emailVerified) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" email has been verified`);
        throw errs.ErrEmailIsVerified;
    }

    try {
        await Users.setUserEmailVerified(c, user.username);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to update user "uid:${user.uid}" email address verified, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    try {
        await Tokens.deleteTokensByType(c, uid, USER_TOKEN_TYPE_EMAIL_VERIFY);
        log.infof(c, `[${logPrefix}] revoke old email verify tokens for user "uid:${user.uid}"`);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to revoke old email verify tokens for user "uid:${user.uid}", because ${errMsg(err)}`);
    }

    const resp: Record<string, unknown> = {};

    if (userVerifyEmailReq.requestNewToken) {
        try {
            const [token, claims] = await Tokens.createToken(c, user);
            resp['newToken'] = token;
            resp['user'] = getUserBasicInfo(user);

            const notificationContent = getAfterLoginNotificationContent(user.language, c.getClientLocale());

            if (notificationContent !== '') {
                resp['notificationContent'] = notificationContent;
            }

            c.setTextualToken(token);
            c.setTokenClaims(claims);
            c.setTokenContext('');

            log.infof(c, `[${logPrefix}] user "uid:${user.uid}" token created, new token will be expired at ${claims.expiresAt}`);
        } catch (err) {
            log.warnf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
            return { user: null } as unknown as UserVerifyEmailResponse;
        }
    } else {
        resp['user'] = null;
    }

    return resp as unknown as UserVerifyEmailResponse;
}

// userProfileHandler returns user profile of current user
export async function userProfileHandler(c: WebContext): Promise<unknown> {
    const user = await getCurrentUserOrThrow(c, 'users.UserRegisterHandler');
    return getUserProfileResponse(user);
}

// userUpdateProfileHandler saves user profile by request parameters for current user
export async function userUpdateProfileHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserUpdateProfileHandler';
    const userUpdateReq = await bindJson<UserProfileUpdateRequest>(c, UserProfileUpdateRequestSchema, logPrefix);
    const uid = c.getCurrentUid();

    checkNormalToken(c, logPrefix, 'update user profile');

    const user = await getCurrentUserOrThrow(c, logPrefix);

    userUpdateReq.email = userUpdateReq.email.trim();
    userUpdateReq.nickname = userUpdateReq.nickname.trim();

    let modifyProfileBasicInfo = false;
    let modifyUseLastReconciledTime = false;
    let anythingUpdate = false;
    const userNew = newUser({ uid: user.uid, salt: user.salt });

    if (userUpdateReq.email !== '' && userUpdateReq.email !== user.email) {
        if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_EMAIL)) {
            throw errs.ErrNotPermittedToPerformThisAction;
        }

        user.email = userUpdateReq.email;
        userNew.email = userUpdateReq.email;
        anythingUpdate = true;
    }

    if (userUpdateReq.password !== '') {
        if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_PASSWORD)) {
            throw errs.ErrNotPermittedToPerformThisAction;
        }

        if (user.password !== '' && !Users.isPasswordEqualsUserPassword(userUpdateReq.oldPassword, user)) {
            throw errs.ErrUserPasswordWrong;
        }

        if (!Users.isPasswordEqualsUserPassword(userUpdateReq.password, user)) {
            userNew.password = userUpdateReq.password;
            anythingUpdate = true;
        }
    }

    if (userUpdateReq.nickname !== '' && userUpdateReq.nickname !== user.nickname) {
        user.nickname = userUpdateReq.nickname;
        userNew.nickname = userUpdateReq.nickname;
        modifyProfileBasicInfo = true;
        anythingUpdate = true;
    }

    if (userUpdateReq.defaultAccountId > 0n && userUpdateReq.defaultAccountId !== user.defaultAccountId) {
        let accountMap: Map<bigint, Account>;

        try {
            accountMap = await Accounts.getAccountsByAccountIds(c, uid, [userUpdateReq.defaultAccountId]);
        } catch (err) {
            throw errs.or(err, errs.ErrUserDefaultAccountIsInvalid);
        }

        if (accountMap.size < 1) {
            throw errs.ErrUserDefaultAccountIsInvalid;
        }

        const account = accountMap.get(userUpdateReq.defaultAccountId);

        if (!account) {
            log.warnf(c, `[${logPrefix}] account "id:${userUpdateReq.defaultAccountId}" does not exist for user "uid:${uid}"`);
            throw errs.ErrUserDefaultAccountIsInvalid;
        }

        if (account.hidden) {
            log.warnf(c, `[${logPrefix}] account "id:${userUpdateReq.defaultAccountId}" is hidden of user "uid:${uid}"`);
            throw errs.ErrUserDefaultAccountIsHidden;
        }

        user.defaultAccountId = userUpdateReq.defaultAccountId;
        userNew.defaultAccountId = userUpdateReq.defaultAccountId;
        modifyProfileBasicInfo = true;
        anythingUpdate = true;
    }

    if (userUpdateReq.useLastReconciledTime !== null && userUpdateReq.useLastReconciledTime !== user.useLastReconciledTime) {
        user.useLastReconciledTime = userUpdateReq.useLastReconciledTime;
        userNew.useLastReconciledTime = userUpdateReq.useLastReconciledTime;
        modifyProfileBasicInfo = true;
        modifyUseLastReconciledTime = true;
        anythingUpdate = true;
    } else {
        modifyUseLastReconciledTime = false;
    }

    type NumericUserField = 'transactionEditScope' | 'firstDayOfWeek' | 'fiscalYearStart' | 'calendarDisplayType' | 'dateDisplayType' | 'longDateFormat' | 'shortDateFormat' | 'longTimeFormat' | 'shortTimeFormat' | 'fiscalYearFormat' | 'currencyDisplayType' | 'numeralSystem' | 'decimalSeparator' | 'digitGroupingSymbol' | 'digitGrouping' | 'coordinateDisplayType' | 'expenseAmountColor' | 'incomeAmountColor';

    const updateNumericField = (field: NumericUserField, requestValue: number | null, invalidValue: number): void => {
        if (requestValue !== null && requestValue !== user[field]) {
            user[field] = requestValue;
            userNew[field] = requestValue;
            modifyProfileBasicInfo = true;
            anythingUpdate = true;
        } else {
            userNew[field] = invalidValue;
        }
    };

    updateNumericField('transactionEditScope', userUpdateReq.transactionEditScope, TRANSACTION_EDIT_SCOPE_INVALID);

    let modifyUserLanguage = false;

    if (userUpdateReq.language !== user.language) {
        user.language = userUpdateReq.language;
        userNew.language = userUpdateReq.language;
        modifyUserLanguage = true;
        modifyProfileBasicInfo = true;
        anythingUpdate = true;
    }

    if (userUpdateReq.defaultCurrency !== '' && userUpdateReq.defaultCurrency !== user.defaultCurrency) {
        user.defaultCurrency = userUpdateReq.defaultCurrency;
        userNew.defaultCurrency = userUpdateReq.defaultCurrency;
        modifyProfileBasicInfo = true;
        anythingUpdate = true;
    }

    updateNumericField('firstDayOfWeek', userUpdateReq.firstDayOfWeek, WEEKDAY_INVALID);
    updateNumericField('fiscalYearStart', userUpdateReq.fiscalYearStart, FISCAL_YEAR_START_INVALID);
    updateNumericField('calendarDisplayType', userUpdateReq.calendarDisplayType, CALENDAR_DISPLAY_TYPE_INVALID);
    updateNumericField('dateDisplayType', userUpdateReq.dateDisplayType, DATE_DISPLAY_TYPE_INVALID);
    updateNumericField('longDateFormat', userUpdateReq.longDateFormat, LONG_DATE_FORMAT_INVALID);
    updateNumericField('shortDateFormat', userUpdateReq.shortDateFormat, SHORT_DATE_FORMAT_INVALID);
    updateNumericField('longTimeFormat', userUpdateReq.longTimeFormat, LONG_TIME_FORMAT_INVALID);
    updateNumericField('shortTimeFormat', userUpdateReq.shortTimeFormat, SHORT_TIME_FORMAT_INVALID);
    updateNumericField('fiscalYearFormat', userUpdateReq.fiscalYearFormat, FISCAL_YEAR_FORMAT_INVALID);
    updateNumericField('currencyDisplayType', userUpdateReq.currencyDisplayType, CURRENCY_DISPLAY_TYPE_INVALID);
    updateNumericField('numeralSystem', userUpdateReq.numeralSystem, NUMERAL_SYSTEM_INVALID);
    updateNumericField('decimalSeparator', userUpdateReq.decimalSeparator, DECIMAL_SEPARATOR_INVALID);
    updateNumericField('digitGroupingSymbol', userUpdateReq.digitGroupingSymbol, DIGIT_GROUPING_SYMBOL_INVALID);
    updateNumericField('digitGrouping', userUpdateReq.digitGrouping, DIGIT_GROUPING_TYPE_INVALID);
    updateNumericField('coordinateDisplayType', userUpdateReq.coordinateDisplayType, COORDINATE_DISPLAY_TYPE_INVALID);
    updateNumericField('expenseAmountColor', userUpdateReq.expenseAmountColor, AMOUNT_COLOR_TYPE_INVALID);
    updateNumericField('incomeAmountColor', userUpdateReq.incomeAmountColor, AMOUNT_COLOR_TYPE_INVALID);

    if (modifyProfileBasicInfo && containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_PROFILE_BASIC_INFO)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (modifyUserLanguage || userNew.decimalSeparator !== DECIMAL_SEPARATOR_INVALID || userNew.digitGroupingSymbol !== DIGIT_GROUPING_SYMBOL_INVALID) {
        let decimalSeparator = userNew.decimalSeparator;
        let digitGroupingSymbol = userNew.digitGroupingSymbol;

        if (userNew.decimalSeparator === DECIMAL_SEPARATOR_INVALID) {
            decimalSeparator = user.decimalSeparator;
        }

        if (userNew.digitGroupingSymbol === DIGIT_GROUPING_SYMBOL_INVALID) {
            digitGroupingSymbol = user.digitGroupingSymbol;
        }

        let locale = user.language;

        if (modifyUserLanguage) {
            locale = userNew.language;
        }

        if (locale === '') {
            locale = c.getClientLocale();
        }

        if (isDecimalSeparatorEqualsDigitGroupingSymbol(decimalSeparator, digitGroupingSymbol, locale)) {
            throw errs.ErrDecimalSeparatorAndDigitGroupingSymbolCannotBeEqual;
        }
    }

    if (!anythingUpdate) {
        throw errs.ErrNothingWillBeUpdated;
    }

    let keyProfileUpdated: boolean;
    let emailSetToUnverified: boolean;

    try {
        [keyProfileUpdated, emailSetToUnverified] = await Users.updateUser(c, userNew, modifyUserLanguage, modifyUseLastReconciledTime);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to update user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    if (emailSetToUnverified) {
        user.emailVerified = false;
    }

    log.infof(c, `[${logPrefix}] user "uid:${user.uid}" has updated successfully`);

    const resp: UserProfileUpdateResponse = {
        user: getUserBasicInfo(user),
    };

    if (emailSetToUnverified && currentConfig().enableUserVerifyEmail && currentConfig().enableSMTP) {
        try {
            await Tokens.deleteTokensByType(c, uid, USER_TOKEN_TYPE_EMAIL_VERIFY);

            try {
                const [token] = await Tokens.createEmailVerifyToken(c, user);
                sendVerifyEmailInBackground(c, user, token, logPrefix, 'verify email');
            } catch (err) {
                log.errorf(c, `[${logPrefix}] failed to create email verify token for user "uid:${user.uid}", because ${errMsg(err)}`);
            }
        } catch (err) {
            log.errorf(c, `[${logPrefix}] failed to revoke old email verify tokens for user "uid:${user.uid}", because ${errMsg(err)}`);
        }
    }

    if (keyProfileUpdated) {
        const now = Math.floor(Date.now() / 1000);

        try {
            await Tokens.deleteTokensBeforeTime(c, uid, now);
            log.infof(c, `[${logPrefix}] revoke old tokens before unix time "${now}" for user "uid:${user.uid}"`);
        } catch (err) {
            log.warnf(c, `[${logPrefix}] failed to revoke old tokens for user "uid:${user.uid}", because ${errMsg(err)}`);
        }

        try {
            const [token, claims] = await Tokens.createToken(c, user);
            resp.newToken = token;
            c.setTextualToken(token);
            c.setTokenClaims(claims);
            c.setTokenContext('');

            log.infof(c, `[${logPrefix}] user "uid:${user.uid}" token refreshed, new token will be expired at ${claims.expiresAt}`);
        } catch (err) {
            log.warnf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        }
    }

    return resp;
}

// userUpdateAvatarHandler saves user avatar by request parameters for current user
export async function userUpdateAvatarHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserUpdateAvatarHandler';
    const uid = c.getCurrentUid();

    checkNormalToken(c, logPrefix, 'update user avatar');

    const user = await getCurrentUserOrThrow(c, logPrefix);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_AVATAR)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    let form: Awaited<ReturnType<WebContext['multipartForm']>>;

    try {
        form = await c.multipartForm();
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to get multi-part form data for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.ErrParameterInvalid;
    }

    const avatarFiles = form.files['avatar'] ?? [];

    if (avatarFiles.length < 1) {
        log.warnf(c, `[${logPrefix}] there is no user avatar in request for user "uid:${user.uid}"`);
        throw errs.ErrNoUserAvatar;
    }

    const avatarFile = avatarFiles[0]!;

    if (avatarFile.size < 1) {
        log.warnf(c, `[${logPrefix}] the size of user avatar in request is zero for user "uid:${user.uid}"`);
        throw errs.ErrUserAvatarIsEmpty;
    }

    if (avatarFile.size > currentConfig().maxAvatarFileSize) {
        log.warnf(c, `[${logPrefix}] the upload file size "${avatarFile.size}" exceeds the maximum size "${currentConfig().maxAvatarFileSize}" of user avatar for user "uid:${uid}"`);
        throw errs.ErrExceedMaxUserAvatarFileSize;
    }

    const fileExtension = getFileNameExtension(avatarFile.name);

    if (getImageContentType(fileExtension) === '') {
        log.warnf(c, `[${logPrefix}] the file extension "${fileExtension}" of user avatar in request is not supported for user "uid:${user.uid}"`);
        throw errs.ErrImageTypeNotSupported;
    }

    try {
        await Users.updateUserAvatar(c, user.uid, avatarFile.data, fileExtension, user.customAvatarType);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to update avatar for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    user.customAvatarType = fileExtension;
    return getUserProfileResponse(user);
}

// userRemoveAvatarHandler removes user avatar by request parameters for current user
export async function userRemoveAvatarHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserRemoveAvatarHandler';

    checkNormalToken(c, logPrefix, 'remove user avatar');

    const user = await getCurrentUserOrThrow(c, logPrefix);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPDATE_AVATAR)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (user.customAvatarType === '') {
        throw errs.ErrNothingWillBeUpdated;
    }

    try {
        await Users.removeUserAvatar(c, user.uid, user.customAvatarType);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to remove avatar for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    user.customAvatarType = '';
    return getUserProfileResponse(user);
}

// userSendVerifyEmailByUnloginUserHandler sends unlogin user verify email
export async function userSendVerifyEmailByUnloginUserHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserSendVerifyEmailByUnloginUserHandler';

    if (!currentConfig().enableUserVerifyEmail) {
        throw errs.ErrEmailValidationNotAllowed;
    }

    const userResendVerifyEmailReq = await bindJsonIgnoreError<UserResendVerifyEmailRequest>(c, UserResendVerifyEmailRequestSchema);
    let user: User;

    try {
        user = await Users.getUserByEmail(c, userResendVerifyEmailReq.email);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${logPrefix}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }

    if (!Users.isPasswordEqualsUserPassword(userResendVerifyEmailReq.password, user)) {
        log.warnf(c, `[${logPrefix}] request password not equals to the user password`);
        throw errs.ErrUserPasswordWrong;
    }

    if (user.disabled) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" is disabled`);
        throw errs.ErrUserIsDisabled;
    }

    if (user.emailVerified) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" email has been verified`);
        throw errs.ErrEmailIsVerified;
    }

    if (!currentConfig().enableSMTP) {
        throw errs.ErrSMTPServerNotEnabled;
    }

    let token: string;

    try {
        [token] = await Tokens.createEmailVerifyToken(c, user);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.ErrTokenGenerating;
    }

    sendVerifyEmailInBackground(c, user, token, logPrefix, 'email');
    return true;
}

// userSendVerifyEmailByLoginedUserHandler sends logined user verify email
export async function userSendVerifyEmailByLoginedUserHandler(c: WebContext): Promise<unknown> {
    const logPrefix = 'users.UserSendVerifyEmailByLoginedUserHandler';

    if (!currentConfig().enableUserVerifyEmail) {
        throw errs.ErrEmailValidationNotAllowed;
    }

    const user = await getCurrentUserOrThrow(c, logPrefix);

    if (user.emailVerified) {
        log.warnf(c, `[${logPrefix}] user "uid:${user.uid}" email has been verified`);
        throw errs.ErrEmailIsVerified;
    }

    if (!currentConfig().enableSMTP) {
        throw errs.ErrSMTPServerNotEnabled;
    }

    let token: string;

    try {
        [token] = await Tokens.createEmailVerifyToken(c, user);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to create token for user "uid:${user.uid}", because ${errMsg(err)}`);
        throw errs.ErrTokenGenerating;
    }

    sendVerifyEmailInBackground(c, user, token, logPrefix, 'email');
    return true;
}

// userGetAvatarHandler returns user avatar data for current user
export async function userGetAvatarHandler(c: WebContext): Promise<[Buffer, string]> {
    const fileName = c.param('fileName');
    const fileExtension = getFileNameExtension(fileName);
    const contentType = getImageContentType(fileExtension);

    if (contentType === '') {
        throw errs.ErrImageTypeNotSupported;
    }

    const uid = c.getCurrentUid();
    const fileBaseName = getFileNameWithoutExtension(fileName);

    if (uid.toString() !== fileBaseName) {
        log.warnf(c, `[users.UserGetAvatarHandler] cannot get other user avatar "uid:${fileBaseName}" for user "uid:${uid}"`);
        throw errs.ErrUserIdInvalid;
    }

    try {
        const avatarData = await Users.getUserAvatar(c, uid, fileExtension);
        return [avatarData, contentType];
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[users.UserGetAvatarHandler] failed to get user avatar, because ${errMsg(err)}`);
        }

        throw errs.or(err, errs.ErrOperationFailed);
    }
}
