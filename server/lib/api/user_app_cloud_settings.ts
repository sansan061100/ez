import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_SYNC_APPLICATION_SETTINGS } from '../core/feature_restriction';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { ALL_ALLOWED_CLOUD_SYNC_APP_SETTING_KEY_TYPES, type ApplicationCloudSetting, type UserApplicationCloudSetting, type UserApplicationCloudSettingsUpdateRequest } from '../models/index';
import { UserApplicationCloudSettings } from '../services/user_app_cloud_settings';
import { stringToFloat64 } from '../utils/converter';
import type { WebContext } from '../web/context';
import { bindJson, errMsg } from './base';
import { getCurrentUserWarnWithUid, requireNormalToken } from './common';
import { UserApplicationCloudSettingsUpdateRequestSchema } from './schemas';

const P = 'user_app_cloud_settings';

function isStringBooleanMap(value: string): boolean {
    try {
        const parsed = JSON.parse(value) as unknown;

        if (parsed === null) {
            return true;
        }

        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false;
        }

        return Object.values(parsed as Record<string, unknown>).every(v => typeof v === 'boolean' || v === null);
    } catch {
        return false;
    }
}

// applicationSettingsGetHandler returns application cloud settings of current user
export async function applicationSettingsGetHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    requireNormalToken(c, `${P}.ApplicationSettingsGetHandler`, 'get application cloud settings');

    let userApplicationCloudSettings: UserApplicationCloudSetting | null;

    try {
        userApplicationCloudSettings = await UserApplicationCloudSettings.getUserApplicationCloudSettingsByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${P}.ApplicationSettingsGetHandler] failed to get latest user application cloud settings for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    if (!userApplicationCloudSettings || !userApplicationCloudSettings.settings || userApplicationCloudSettings.settings.length < 1) {
        return false;
    }

    return userApplicationCloudSettings.settings;
}

// applicationSettingsUpdateHandler updates application cloud settings of current user
export async function applicationSettingsUpdateHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.ApplicationSettingsUpdateHandler`;
    const updateReq = await bindJson<UserApplicationCloudSettingsUpdateRequest>(c, UserApplicationCloudSettingsUpdateRequestSchema, handler);
    const uid = c.getCurrentUid();

    requireNormalToken(c, handler, 'update application cloud settings');

    const user = await getCurrentUserWarnWithUid(c, handler);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_SYNC_APPLICATION_SETTINGS)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    const requestSettings = updateReq.settings ?? [];
    let lastError: unknown = null;

    for (let i = 0; i < 3; i++) {
        let userApplicationCloudSettings: UserApplicationCloudSetting | null;

        try {
            userApplicationCloudSettings = await UserApplicationCloudSettings.getUserApplicationCloudSettingsByUid(c, uid);
        } catch (err) {
            log.errorf(c, `[${handler}] failed to get latest user application cloud settings for user "uid:${uid}" (try count ${i + 1}), because ${errMsg(err)}`);
            throw errs.or(err, errs.ErrOperationFailed);
        }

        const oldApplicationCloudSettingsMap = new Map<string, ApplicationCloudSetting>();
        let lastUpdateTime = 0;

        if (userApplicationCloudSettings) {
            for (const setting of userApplicationCloudSettings.settings ?? []) {
                oldApplicationCloudSettingsMap.set(setting.settingKey, setting);
            }

            lastUpdateTime = userApplicationCloudSettings.updatedUnixTime;
        }

        if (updateReq.fullUpdate) {
            if (requestSettings.length === oldApplicationCloudSettingsMap.size) {
                let needUpdate = false;

                for (const setting of requestSettings) {
                    const oldSetting = oldApplicationCloudSettingsMap.get(setting.settingKey);

                    if (!oldSetting || oldSetting.settingValue !== setting.settingValue) {
                        needUpdate = true;
                        break;
                    }
                }

                if (!needUpdate) {
                    throw errs.ErrNothingWillBeUpdated;
                }
            }
        } else {
            let needUpdate = true;

            for (const setting of requestSettings) {
                const cloudSetting = oldApplicationCloudSettingsMap.get(setting.settingKey);

                if (!cloudSetting) {
                    needUpdate = false;
                    log.infof(c, `[${handler}] user application cloud setting key "${setting.settingKey}" is not set to sync (try count ${i + 1})`);
                } else if (cloudSetting.settingValue === setting.settingValue) {
                    needUpdate = false;
                    log.infof(c, `[${handler}] user application cloud setting key "${setting.settingKey}" value "${setting.settingValue}" is not changed, no need to update (try count ${i + 1})`);
                }
            }

            if (!needUpdate) {
                log.infof(c, `[${handler}] no user application cloud settings need to update for user "uid:${uid}" (try count ${i + 1})`);
                return true;
            }
        }

        let newApplicationCloudSettingsMap = new Map<string, ApplicationCloudSetting>();

        if (updateReq.fullUpdate) {
            log.infof(c, `[${handler}] user "uid:${uid}" application cloud settings force update, will overwrite all existing settings (try count ${i + 1})`);
        } else if (oldApplicationCloudSettingsMap.size > 0) {
            log.infof(c, `[${handler}] user "uid:${uid}" application cloud settings exists, try to merge it with request settings (try count ${i + 1})`);
            newApplicationCloudSettingsMap = oldApplicationCloudSettingsMap;
        }

        for (const setting of requestSettings) {
            newApplicationCloudSettingsMap.set(setting.settingKey, setting);
        }

        const newApplicationCloudSettingSlice: ApplicationCloudSetting[] = [];

        for (const [settingKey, setting] of newApplicationCloudSettingsMap) {
            const settingType = ALL_ALLOWED_CLOUD_SYNC_APP_SETTING_KEY_TYPES[settingKey];

            if (!settingType) {
                log.warnf(c, `[${handler}] user application cloud setting key "${settingKey}" is not supported to sync (try count ${i + 1})`);
                continue;
            }

            if (settingType === 'number') {
                try {
                    stringToFloat64(setting.settingValue);
                } catch {
                    log.warnf(c, `[${handler}] user application cloud setting key "${settingKey}" has invalid number value "${setting.settingValue}" (try count ${i + 1})`);
                    continue;
                }
            } else if (settingType === 'boolean') {
                if (setting.settingValue !== 'true' && setting.settingValue !== 'false') {
                    log.warnf(c, `[${handler}] user application cloud setting key "${settingKey}" has invalid boolean value "${setting.settingValue}" (try count ${i + 1})`);
                    continue;
                }
            } else if (settingType === 'string_boolean_map') {
                if (!isStringBooleanMap(setting.settingValue)) {
                    log.warnf(c, `[${handler}] user application cloud setting key "${settingKey}" has invalid map value "${setting.settingValue}" (try count ${i + 1})`);
                    continue;
                }
            }

            newApplicationCloudSettingSlice.push(setting);
        }

        try {
            await UserApplicationCloudSettings.updateUserApplicationCloudSettings(c, uid, newApplicationCloudSettingSlice, updateReq.fullUpdate, lastUpdateTime);
            lastError = null;
            break;
        } catch (err) {
            lastError = err;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (lastError !== null) {
        log.errorf(c, `[${handler}] failed to update user application cloud settings for user "uid:${uid}", because ${errMsg(lastError)}`);
        throw errs.or(lastError, errs.ErrOperationFailed);
    }

    return true;
}

// applicationSettingsDisableHandler disables application cloud settings of current user
export async function applicationSettingsDisableHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.ApplicationSettingsDisableHandler`;
    const uid = c.getCurrentUid();

    requireNormalToken(c, handler, 'disable application cloud settings');

    const user = await getCurrentUserWarnWithUid(c, handler);

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_SYNC_APPLICATION_SETTINGS)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    try {
        await UserApplicationCloudSettings.clearUserApplicationCloudSettings(c, uid);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to clear user application cloud settings for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return true;
}
