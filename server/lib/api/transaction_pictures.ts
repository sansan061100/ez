import { DUPLICATE_CHECKER_TYPE_NEW_PICTURE } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { newTransactionPictureInfo, TransactionPictureNewPictureTransactionId } from '../models/index';
import { TransactionPictures } from '../services/transaction_pictures';
import { stringToInt64 } from '../utils/converter';
import { getFileNameExtension, getFileNameWithoutExtension, getImageContentType } from '../utils/io';
import type { WebContext } from '../web/context';
import { bindJson, currentConfig, errMsg, getSubmissionRemark, getTransactionPictureInfoResponse, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import { TransactionPictureUnusedDeleteRequestSchema } from './schemas';

const P = 'transaction_pictures';

// transactionPictureUploadHandler saves transaction picture by request parameters for current user
export async function transactionPictureUploadHandler(c: WebContext): Promise<unknown> {
    const handler = 'TransactionPictureUploadHandler';
    const uid = c.getCurrentUid();
    let form;

    try {
        form = await c.multipartForm();
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get multi-part form data for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrParameterInvalid;
    }

    const pictureFile = form.files['picture']?.[0];

    if (!pictureFile) {
        log.warnf(c, `[${P}.${handler}] there is no transaction picture in request for user "uid:${uid}"`);
        throw errs.ErrNoTransactionPicture;
    }

    if (pictureFile.size < 1) {
        log.warnf(c, `[${P}.${handler}] the size of transaction picture in request is zero for user "uid:${uid}"`);
        throw errs.ErrTransactionPictureIsEmpty;
    }

    const maxSize = currentConfig().maxTransactionPictureFileSize;

    if (pictureFile.size > maxSize) {
        log.warnf(c, `[${P}.${handler}] the upload file size "${pictureFile.size}" exceeds the maximum size "${maxSize}" of transaction picture for user "uid:${uid}"`);
        throw errs.ErrExceedMaxTransactionPictureFileSize;
    }

    const fileExtension = getFileNameExtension(pictureFile.name);

    if (getImageContentType(fileExtension) === '') {
        log.warnf(c, `[${P}.${handler}] the file extension "${fileExtension}" of transaction picture in request is not supported for user "uid:${uid}"`);
        throw errs.ErrImageTypeNotSupported;
    }

    let pictureInfo = newTransactionPictureInfo({
        uid: uid,
        transactionId: TransactionPictureNewPictureTransactionId,
        pictureExtension: fileExtension,
        createdIp: c.clientIP(),
    });

    const clientSessionId = form.values['clientSessionId']?.[0] ?? '';

    if (currentConfig().enableDuplicateSubmissionsCheck && clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_PICTURE, uid, clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another transaction picture "id:${remark}" has been uploaded for user "uid:${uid}"`);
            let pictureId: bigint | null = null;

            try {
                pictureId = stringToInt64(remark);
            } catch {
                pictureId = null;
            }

            if (pictureId !== null) {
                const id = pictureId;
                pictureInfo = await callOrFail(c, () => TransactionPictures.getPictureInfoByPictureId(c, uid, id), () => `[${P}.${handler}] failed to get existed transaction picture "id:${id}" for user "uid:${uid}"`);
                return getTransactionPictureInfoResponse(pictureInfo);
            }
        }
    }

    const info = pictureInfo;
    await callOrFail(c, () => TransactionPictures.uploadPicture(c, info, pictureFile.data), () => `[${P}.${handler}] failed to update transaction picture for user "uid:${uid}"`);
    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_PICTURE, uid, clientSessionId, info.pictureId.toString());

    return getTransactionPictureInfoResponse(info);
}

// transactionPictureGetHandler returns transaction picture data for current user
export async function transactionPictureGetHandler(c: WebContext): Promise<[Buffer, string]> {
    const fileName = c.param('fileName');
    const fileExtension = getFileNameExtension(fileName);
    const contentType = getImageContentType(fileExtension);

    if (contentType === '') {
        throw errs.ErrImageTypeNotSupported;
    }

    const fileBaseName = getFileNameWithoutExtension(fileName);
    let pictureId: bigint;

    try {
        pictureId = stringToInt64(fileBaseName);
    } catch {
        throw errs.ErrTransactionPictureIdInvalid;
    }

    const uid = c.getCurrentUid();

    try {
        const pictureData = await TransactionPictures.getPictureByPictureId(c, uid, pictureId, fileExtension);
        return [pictureData, contentType];
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${P}.TransactionPictureUploadHandler] failed to get transaction picture, because ${errMsg(err)}`);
        }

        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// transactionPictureRemoveUnusedHandler removes unused transaction picture by request parameters for current user
export async function transactionPictureRemoveUnusedHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, TransactionPictureUnusedDeleteRequestSchema, `${P}.TransactionPictureRemoveUnusedHandler`);
    const uid = c.getCurrentUid();
    await callOrFail(c, () => TransactionPictures.removeUnusedTransactionPicture(c, uid, req.id), () => `[${P}.TransactionPictureRemoveUnusedHandler] failed to remove unused transaction picture for user "uid:${uid}"`);
    return true;
}
