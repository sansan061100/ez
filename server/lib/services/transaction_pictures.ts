import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { type TransactionPictureInfo, TransactionPictureInfoTable, TransactionPictureNewPictureTransactionId } from '../models/index';
import { UUID_TYPE_USER } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';

// TransactionPictureService represents transaction picture service
export class TransactionPictureService extends ServiceBase {
    // getTotalTransactionPicturesCountByUid returns total transaction pictures count of user
    public async getTotalTransactionPicturesCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(TransactionPictureInfoTable);
    }

    // getPictureInfoByPictureId returns a transaction picture info model according to picture id
    public async getPictureInfoByPictureId(c: Context, uid: bigint, pictureId: bigint): Promise<TransactionPictureInfo> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (pictureId <= 0n) {
            throw errs.ErrTransactionPictureIdInvalid;
        }

        const pictureInfo = await this.userDataDB(uid).newSession(c).id(pictureId).where('uid=? AND deleted=?', uid, false).get(TransactionPictureInfoTable);

        if (!pictureInfo) {
            throw errs.ErrTransactionPictureNotFound;
        }

        return pictureInfo;
    }

    // getNewPictureInfosByPictureIds returns transaction picture info models (not attached to any transaction) according to picture ids
    public async getNewPictureInfosByPictureIds(c: Context, uid: bigint, pictureIds: bigint[] | null): Promise<TransactionPictureInfo[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (!pictureIds) {
            throw errs.ErrTransactionPictureIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND transaction_id=?', uid, false, TransactionPictureNewPictureTransactionId).in('picture_id', pictureIds).orderBy('picture_id asc').find(TransactionPictureInfoTable);
    }

    // getPictureInfosByTransactionId returns transaction picture info models according to transaction id
    public async getPictureInfosByTransactionId(c: Context, uid: bigint, transactionId: bigint): Promise<TransactionPictureInfo[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (transactionId <= 0n) {
            throw errs.ErrTransactionIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND transaction_id=?', uid, false, transactionId).orderBy('picture_id asc').find(TransactionPictureInfoTable);
    }

    // getPictureInfosByTransactionIds returns transaction picture info models map according to transaction ids
    public async getPictureInfosByTransactionIds(c: Context, uid: bigint, transactionIds: bigint[] | null): Promise<Map<bigint, TransactionPictureInfo[]>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (!transactionIds) {
            throw errs.ErrTransactionIdInvalid;
        }

        const pictureInfos = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('transaction_id', transactionIds).orderBy('picture_id asc').find(TransactionPictureInfoTable);
        return this.getPictureInfoListMapByList(pictureInfos);
    }

    // getAllPictureInfosOfAllTransactions returns all transaction picture info models map
    public async getAllPictureInfosOfAllTransactions(c: Context, uid: bigint): Promise<Map<bigint, TransactionPictureInfo[]>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const pictureInfos = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).orderBy('picture_id asc').find(TransactionPictureInfoTable);
        return this.getPictureInfoListMapByList(pictureInfos);
    }

    // getPictureByPictureId returns the picture data according to picture id
    public async getPictureByPictureId(c: Context, uid: bigint, pictureId: bigint, fileExtension: string): Promise<Buffer> {
        const pictureInfo = await this.getPictureInfoByPictureId(c, uid, pictureId);

        if (pictureInfo.pictureExtension === '') {
            throw errs.ErrTransactionPictureNotFound;
        }

        if (pictureInfo.pictureExtension !== fileExtension) {
            throw errs.ErrTransactionPictureExtensionInvalid;
        }

        const pictureData = await this.readTransactionPicture(c, pictureInfo.uid, pictureInfo.pictureId, pictureInfo.pictureExtension);

        if (!pictureData) {
            throw errs.ErrTransactionPictureNoExists;
        }

        return pictureData;
    }

    // uploadPicture saves the picture file and picture info model
    public async uploadPicture(c: Context, pictureInfo: TransactionPictureInfo, pictureFile: Buffer): Promise<void> {
        if (pictureInfo.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        pictureInfo.pictureId = this.generateUuid(UUID_TYPE_USER);

        if (pictureInfo.pictureId < 1n) {
            throw errs.ErrSystemIsBusy;
        }

        pictureInfo.transactionId = 0n;
        pictureInfo.deleted = false;
        pictureInfo.createdUnixTime = nowUnix();
        pictureInfo.updatedUnixTime = nowUnix();

        await this.saveTransactionPicture(c, pictureInfo.uid, pictureInfo.pictureId, pictureFile, pictureInfo.pictureExtension);

        await this.userDataDB(pictureInfo.uid).doTransaction(c, async sess => {
            await sess.insert(TransactionPictureInfoTable, pictureInfo);
        });
    }

    // removeUnusedTransactionPicture removes the picture which is not attached to any transaction
    public async removeUnusedTransactionPicture(c: Context, uid: bigint, pictureId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (pictureId <= 0n) {
            throw errs.ErrTransactionPictureIdInvalid;
        }

        const updateModel: Partial<TransactionPictureInfo> = {
            deleted: true,
            deletedUnixTime: nowUnix(),
        };

        await this.userDB().doTransaction(c, async sess => {
            const deletedRows = await sess.id(pictureId).cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND transaction_id=?', uid, false, TransactionPictureNewPictureTransactionId).update(TransactionPictureInfoTable, updateModel);

            if (deletedRows < 1) {
                throw errs.ErrTransactionPictureNotFound;
            }
        });
    }

    // getPictureInfoMapByList returns a picture info map by a list
    public getPictureInfoMapByList(pictureInfos: TransactionPictureInfo[]): Map<bigint, TransactionPictureInfo> {
        const pictureInfoMap = new Map<bigint, TransactionPictureInfo>();

        for (const pictureInfo of pictureInfos) {
            pictureInfoMap.set(pictureInfo.pictureId, pictureInfo);
        }

        return pictureInfoMap;
    }

    // getPictureInfoListMapByList returns a map of transaction id to picture infos by a list
    public getPictureInfoListMapByList(pictureInfos: TransactionPictureInfo[]): Map<bigint, TransactionPictureInfo[]> {
        const pictureInfoMap = new Map<bigint, TransactionPictureInfo[]>();

        for (const pictureInfo of pictureInfos) {
            let list = pictureInfoMap.get(pictureInfo.transactionId);

            if (!list) {
                list = [];
                pictureInfoMap.set(pictureInfo.transactionId, list);
            }

            list.push(pictureInfo);
        }

        return pictureInfoMap;
    }

    // getTransactionPictureIds returns picture ids of the picture infos
    public getTransactionPictureIds(pictureInfos: TransactionPictureInfo[]): bigint[] {
        return pictureInfos.map(pictureInfo => pictureInfo.pictureId);
    }
}

export const TransactionPictures = new TransactionPictureService();
