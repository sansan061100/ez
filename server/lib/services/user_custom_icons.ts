import type { Context } from '../core/context';
import { ICON_TYPE_USER_CUSTOM } from '../core/types';
import * as errs from '../errs/index';
import { AccountTable, TransactionCategoryTable, type UserCustomIcon, UserCustomIconTable } from '../models/index';
import { toUniqueInt64Slice } from '../utils/slices';
import { UUID_TYPE_CUSTOM_ICON } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

// UserCustomIconService represents user custom icon service
export class UserCustomIconService extends ServiceBase {
    // getTotalCustomIconsCountByUid returns total custom icons count of user
    public async getTotalCustomIconsCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(UserCustomIconTable);
    }

    // getAllCustomIconInfosByUid returns all custom icon infos of user
    public async getAllCustomIconInfosByUid(c: Context, uid: bigint): Promise<UserCustomIcon[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).find(UserCustomIconTable);
    }

    // getCustomIconInfoByIconId returns the custom icon info according to icon id
    public async getCustomIconInfoByIconId(c: Context, uid: bigint, iconId: bigint): Promise<UserCustomIcon> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (iconId <= 0n) {
            throw errs.ErrUserCustomIconIdInvalid;
        }

        const customIconInfo = await this.userDataDB(uid).newSession(c).id(iconId).where('uid=? AND deleted=?', uid, false).get(UserCustomIconTable);

        if (!customIconInfo) {
            throw errs.ErrUserCustomIconNotFound;
        }

        return customIconInfo;
    }

    // getCustomIconByIconId returns the custom icon image data according to icon id
    public async getCustomIconByIconId(c: Context, uid: bigint, iconId: bigint): Promise<Buffer> {
        await this.getCustomIconInfoByIconId(c, uid, iconId);

        const customIconData = await this.readUserCustomIcon(c, uid, iconId);

        if (!customIconData) {
            throw errs.ErrUserCustomIconeNotExists;
        }

        return customIconData;
    }

    // getMaxDisplayOrder returns the max display order
    public async getMaxDisplayOrder(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const customIcon = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'display_order').where('uid=? AND deleted=?', uid, false).orderBy('display_order desc').limit(1).get(UserCustomIconTable);
        return customIcon ? customIcon.displayOrder : 0;
    }

    // uploadCustomIcon saves the custom icon file and model
    public async uploadCustomIcon(c: Context, customIcon: UserCustomIcon, customIconFile: Buffer): Promise<void> {
        if (customIcon.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        customIcon.iconId = this.generateUuid(UUID_TYPE_CUSTOM_ICON);

        if (customIcon.iconId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        customIcon.deleted = false;
        customIcon.createdUnixTime = nowUnix();
        customIcon.updatedUnixTime = nowUnix();

        await this.saveUserCustomIcon(c, customIcon.uid, customIcon.iconId, customIconFile);

        await this.userDataDB(customIcon.uid).doTransaction(c, async sess => {
            await sess.insert(UserCustomIconTable, customIcon);
        });
    }

    // modifyCustomIconDisplayOrders updates display order of given custom icons
    public async modifyCustomIconDisplayOrders(c: Context, uid: bigint, customIcons: UserCustomIcon[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const customIcon of customIcons) {
            customIcon.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const customIcon of customIcons) {
                const updatedRows = await sess.id(customIcon.iconId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(UserCustomIconTable, customIcon);

                if (updatedRows < 1) {
                    throw errs.ErrUserCustomIconNotFound;
                }
            }
        });
    }

    // deleteCustomIcon deletes an existed custom icon
    public async deleteCustomIcon(c: Context, uid: bigint, iconId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<UserCustomIcon> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const accountUsed = await sess.where('uid=? AND deleted=? AND icon_type=? AND icon=?', uid, false, ICON_TYPE_USER_CUSTOM, iconId).exist(AccountTable);

            if (accountUsed) {
                throw errs.ErrUserCustomIconInUse;
            }

            const categoryUsed = await sess.where('uid=? AND deleted=? AND icon_type=? AND icon=?', uid, false, ICON_TYPE_USER_CUSTOM, iconId).exist(TransactionCategoryTable);

            if (categoryUsed) {
                throw errs.ErrUserCustomIconInUse;
            }

            const deletedRows = await sess.id(iconId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(UserCustomIconTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrUserCustomIconNotFound;
            }
        });
    }

    // deleteAllCustomIcons deletes all existed custom icons
    public async deleteAllCustomIcons(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<UserCustomIcon> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).update(UserCustomIconTable, updateModel);
        });
    }

    // existsCustomIcon returns whether the given custom icon exists
    public async existsCustomIcon(c: Context, uid: bigint, iconId: bigint): Promise<boolean> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (iconId <= 0n) {
            throw errs.ErrUserCustomIconIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).id(iconId).where('uid=? AND deleted=?', uid, false).exist(UserCustomIconTable);
    }

    // existsCustomIcons returns whether all the given custom icons exist
    public async existsCustomIcons(c: Context, uid: bigint, iconIds: bigint[]): Promise<boolean> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (iconIds.length === 0) {
            throw errs.ErrUserCustomIconIdInvalid;
        }

        const uniqueIconIds = toUniqueInt64Slice(iconIds);
        const count = await this.userDataDB(uid).newSession(c).in('icon_id', uniqueIconIds).where('uid=? AND deleted=?', uid, false).count(UserCustomIconTable);

        return count === uniqueIconIds.length;
    }
}

export const UserCustomIcons = new UserCustomIconService();
