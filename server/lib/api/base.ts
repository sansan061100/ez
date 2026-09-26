import { Container as AvatarContainer } from '../avatars/index';
import { Container as DuplicateCheckerContainer, type DuplicateCheckerType } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { UserApplicationCloudSettings } from '../services/user_app_cloud_settings';
import { type ApplicationCloudSetting, sortTransactionPictureInfoBasicResponses, type TransactionPictureInfo, type TransactionPictureInfoBasicResponse, toTransactionPictureInfoBasicResponse, toUserBasicInfo, type User, type UserBasicInfo } from '../models/index';
import { type Config, Container as ConfigContainer, type MultiLanguageContentConfig } from '../settings/settings';
import type { Schema } from '../web/binding';
import type { WebContext } from '../web/context';

export function currentConfig(): Config {
    return ConfigContainer.getCurrentConfig();
}

export function getTransactionPictureInfoResponse(pictureInfo: TransactionPictureInfo): TransactionPictureInfoBasicResponse {
    const originalUrl = `${currentConfig().rootUrl}pictures/${pictureInfo.pictureId}.${pictureInfo.pictureExtension}`;
    return toTransactionPictureInfoBasicResponse(pictureInfo, originalUrl);
}

export function getTransactionPictureInfoResponseList(pictureInfos: TransactionPictureInfo[]): TransactionPictureInfoBasicResponse[] {
    return sortTransactionPictureInfoBasicResponses(pictureInfos.map(getTransactionPictureInfoResponse));
}

function getNotificationContent(config: MultiLanguageContentConfig, userLanguage: string, clientLanguage: string): string {
    let language = userLanguage;

    if (language === '') {
        language = clientLanguage;
    }

    if (!config.enabled) {
        return '';
    }

    const multiLanguageContent = config.multiLanguageContent[language];

    if (multiLanguageContent !== undefined) {
        return multiLanguageContent;
    }

    return config.defaultContent;
}

export function getAfterRegisterNotificationContent(userLanguage: string, clientLanguage: string): string {
    return getNotificationContent(currentConfig().afterRegisterNotification, userLanguage, clientLanguage);
}

export function getAfterLoginNotificationContent(userLanguage: string, clientLanguage: string): string {
    return getNotificationContent(currentConfig().afterLoginNotification, userLanguage, clientLanguage);
}

export function getAfterOpenNotificationContent(userLanguage: string, clientLanguage: string): string {
    return getNotificationContent(currentConfig().afterOpenNotification, userLanguage, clientLanguage);
}

// duplicate checker helpers

export function getSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): [boolean, string] {
    return DuplicateCheckerContainer.getSubmissionRemark(checkerType, uid, identification);
}

export function setSubmissionRemarkWithCustomExpiration(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string, expirationSeconds: number): void {
    DuplicateCheckerContainer.setSubmissionRemarkWithCustomExpiration(checkerType, uid, identification, remark, expirationSeconds);
}

export function setSubmissionRemarkIfEnable(checkerType: DuplicateCheckerType, uid: bigint, identification: string, remark: string): void {
    if (currentConfig().enableDuplicateSubmissionsCheck) {
        DuplicateCheckerContainer.setSubmissionRemark(checkerType, uid, identification, remark);
    }
}

export function removeSubmissionRemark(checkerType: DuplicateCheckerType, uid: bigint, identification: string): void {
    DuplicateCheckerContainer.removeSubmissionRemark(checkerType, uid, identification);
}

export function removeSubmissionRemarkIfEnable(checkerType: DuplicateCheckerType, uid: bigint, identification: string): void {
    if (currentConfig().enableDuplicateSubmissionsCheck) {
        DuplicateCheckerContainer.removeSubmissionRemark(checkerType, uid, identification);
    }
}

// checkFailureCount checks whether the failure count reaches the limit
export function checkFailureCount(c: WebContext, uid: bigint): void {
    const config = currentConfig();

    if (config.maxFailuresPerIpPerMinute > 0) {
        const clientIp = c.clientIP();
        const ipFailureCount = DuplicateCheckerContainer.getFailureCount(clientIp);

        if (ipFailureCount >= config.maxFailuresPerIpPerMinute) {
            log.warnf(c, `[base.CheckFailureCount] operation failure via IP "${clientIp}", current failure count: ${ipFailureCount} reached the limit`);
            throw errs.ErrFailureCountLimitReached;
        }
    }

    if (config.maxFailuresPerUserPerMinute > 0 && uid > 0n) {
        const uidFailureCount = DuplicateCheckerContainer.getFailureCount(uid.toString());

        if (uidFailureCount >= config.maxFailuresPerUserPerMinute) {
            log.warnf(c, `[base.CheckFailureCount] operation failure via uid "${uid}", current failure count: ${uidFailureCount} reached the limit`);
            throw errs.ErrFailureCountLimitReached;
        }
    }
}

// checkAndIncreaseFailureCount increases the failure count and returns error if the failure count reaches the limit
export function checkAndIncreaseFailureCount(c: WebContext, uid: bigint): errs.AppError | null {
    const config = currentConfig();
    const clientIp = c.clientIP();
    let ipFailureCount = 0;
    let uidFailureCount = 0;

    if (config.maxFailuresPerIpPerMinute > 0) {
        ipFailureCount = DuplicateCheckerContainer.getFailureCount(clientIp);
    }

    if (config.maxFailuresPerUserPerMinute > 0 && uid > 0n) {
        uidFailureCount = DuplicateCheckerContainer.getFailureCount(uid.toString());
    }

    if (config.maxFailuresPerIpPerMinute > 0 && ipFailureCount < config.maxFailuresPerIpPerMinute) {
        log.warnf(c, `[base.CheckAndIncreaseFailureCount] operation failure via IP "${clientIp}", previous failure count: ${ipFailureCount}`);
        DuplicateCheckerContainer.increaseFailureCount(clientIp);
    }

    if (config.maxFailuresPerUserPerMinute > 0 && uid > 0n && uidFailureCount < config.maxFailuresPerUserPerMinute) {
        log.warnf(c, `[base.CheckAndIncreaseFailureCount] operation failure via uid "${uid}", previous failure count: ${uidFailureCount}`);
        DuplicateCheckerContainer.increaseFailureCount(uid.toString());
    }

    if (config.maxFailuresPerIpPerMinute > 0 && ipFailureCount >= config.maxFailuresPerIpPerMinute) {
        log.warnf(c, `[base.CheckAndIncreaseFailureCount] operation failure via IP "${clientIp}", current failure count: ${ipFailureCount} reached the limit`);
        return errs.ErrFailureCountLimitReached;
    }

    if (config.maxFailuresPerUserPerMinute > 0 && uid > 0n && uidFailureCount >= config.maxFailuresPerUserPerMinute) {
        log.warnf(c, `[base.CheckAndIncreaseFailureCount] operation failure via uid "${uid}", current failure count: ${uidFailureCount} reached the limit`);
        return errs.ErrFailureCountLimitReached;
    }

    return null;
}

export function getAvatarUrl(user: User): string {
    return AvatarContainer.getAvatarUrl(user);
}

export function getUserBasicInfo(user: User): UserBasicInfo {
    return toUserBasicInfo(user, currentConfig().avatarProvider, getAvatarUrl(user));
}

// errorMessage returns the error message of the error
export function errMsg(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }

    return String(err);
}

// orFail returns the err if it is custom error, otherwise returns the default error
export function orFail(err: unknown, defaultErr: errs.AppError = errs.ErrOperationFailed): errs.AppError {
    return errs.or(err, defaultErr);
}

// getClientTimezoneOrThrow returns the client timezone, and throws ErrClientTimezoneOffsetInvalid if failed
export function getClientTimezoneOrThrow(c: WebContext, logPrefix: string) {
    try {
        return c.getClientTimezone();
    } catch (err) {
        log.warnf(c, `[${logPrefix}] cannot get client timezone, because ${errMsg(err)}`);
        throw errs.ErrClientTimezoneOffsetInvalid;
    }
}

// getLatestApplicationCloudSettings returns the user application cloud settings, returns null if not exists or failed
export async function getLatestApplicationCloudSettings(c: WebContext, uid: bigint, logPrefix: string): Promise<ApplicationCloudSetting[] | null> {
    try {
        const userApplicationCloudSettings = await UserApplicationCloudSettings.getUserApplicationCloudSettingsByUid(c, uid);

        if (userApplicationCloudSettings && userApplicationCloudSettings.settings && userApplicationCloudSettings.settings.length > 0) {
            return userApplicationCloudSettings.settings;
        }
    } catch (err) {
        log.warnf(c, `[${logPrefix}] failed to get latest user application cloud settings for user "uid:${uid}", because ${errMsg(err)}`);
    }

    return null;
}

// bindJson binds the json request body and throws incomplete or incorrect submission error if failed
export async function bindJson<T>(c: WebContext, schemaDef: Schema, logPrefix: string): Promise<T> {
    try {
        return await c.shouldBindJSON<T>(schemaDef);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }
}

export function bindQuery<T>(c: WebContext, schemaDef: Schema, logPrefix: string): T {
    try {
        return c.shouldBindQuery<T>(schemaDef);
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse request failed, because ${errMsg(err)}`);
        throw errs.newIncompleteOrIncorrectSubmissionError(err);
    }
}

