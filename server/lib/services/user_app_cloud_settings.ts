import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { type ApplicationCloudSetting, sortApplicationCloudSettings, type UserApplicationCloudSetting, UserApplicationCloudSettingTable } from '../models/index';
import { nowUnix, ServiceBase } from './base';

// UserApplicationCloudSettingsService represents user application cloud settings service
export class UserApplicationCloudSettingsService extends ServiceBase {
    // getUserApplicationCloudSettingsByUid returns the user application cloud settings model according to user uid
    public async getUserApplicationCloudSettingsByUid(c: Context, uid: bigint): Promise<UserApplicationCloudSetting | null> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDB().newSession(c).id(uid).get(UserApplicationCloudSettingTable);
    }

    // updateUserApplicationCloudSettings updates the user application cloud settings model
    public async updateUserApplicationCloudSettings(c: Context, uid: bigint, settings: ApplicationCloudSetting[], forceUpdate: boolean, lastUpdateTime: number): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        sortApplicationCloudSettings(settings);

        const userApplicationCloudSetting: UserApplicationCloudSetting = {
            uid: uid,
            settings: settings,
            updatedUnixTime: nowUnix(),
        };

        await this.userDB().doTransaction(c, async sess => {
            const exists = await sess.cols('uid').where('uid=?', uid).exist(UserApplicationCloudSettingTable);
            let updatedRows: number;

            if (!exists) {
                updatedRows = await sess.insert(UserApplicationCloudSettingTable, userApplicationCloudSetting);
            } else if (forceUpdate || lastUpdateTime <= 0) {
                updatedRows = await sess.id(uid).cols('settings', 'updated_unix_time').update(UserApplicationCloudSettingTable, userApplicationCloudSetting);
            } else {
                updatedRows = await sess.id(uid).cols('settings', 'updated_unix_time').where('updated_unix_time=?', lastUpdateTime).update(UserApplicationCloudSettingTable, userApplicationCloudSetting);
            }

            if (updatedRows < 1) {
                log.errorf(c, '[user_app_cloud_settings.UpdateUserApplicationCloudSettings] failed to update user application cloud settings');
                throw errs.ErrDatabaseOperationFailed;
            }
        });
    }

    // clearUserApplicationCloudSettings clears the user application cloud settings
    public async clearUserApplicationCloudSettings(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDB().doTransaction(c, async sess => {
            await sess.where('uid=?', uid).delete(UserApplicationCloudSettingTable);
        });
    }
}

export const UserApplicationCloudSettings = new UserApplicationCloudSettingsService();
