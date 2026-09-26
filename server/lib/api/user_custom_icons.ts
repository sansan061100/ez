import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPLOAD_CUSTOM_ICON } from '../core/feature_restriction';
import { DUPLICATE_CHECKER_TYPE_NEW_CUSTOM_ICON } from '../duplicatechecker/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { sortByDisplayOrder, toUserCustomIconInfoResponse, type UserCustomIcon, UserCustomIconFileExtension } from '../models/index';
import { UserCustomIcons } from '../services/user_custom_icons';
import { Users } from '../services/users';
import { stringToInt64 } from '../utils/converter';
import { getFileNameExtension, getFileNameWithoutExtension, getImageContentType } from '../utils/io';
import { decodeImageConfig } from '../utils/png';
import type { WebContext } from '../web/context';
import { bindJson, currentConfig, errMsg, getSubmissionRemark, setSubmissionRemarkIfEnable } from './base';
import { callOrFail } from './common';
import { IdDeleteRequestSchema, MoveRequestSchema } from './schemas';

const P = 'user_custom_icons';
const maximumUserCustomIconPixels = 256;
const allowedUserCustomIconContentType = 'image/png';

async function checkUploadPermission(c: WebContext, handler: string): Promise<void> {
    const uid = c.getCurrentUid();
    let user;

    try {
        user = await Users.getUserById(c, uid);
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${P}.${handler}] failed to get user, because ${errMsg(err)}`);
        }

        throw errs.ErrUserNotFound;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UPLOAD_CUSTOM_ICON)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }
}

// customIconListHandler returns custom icon list of current user
export async function customIconListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    const customIcons = await callOrFail(c, () => UserCustomIcons.getAllCustomIconInfosByUid(c, uid), () => `[${P}.CustomIconListHandler] failed to get custom icons for user "uid:${uid}"`);
    return sortByDisplayOrder(customIcons.map(toUserCustomIconInfoResponse));
}

// customIconUploadHandler saves custom icon by request parameters for current user
export async function customIconUploadHandler(c: WebContext): Promise<unknown> {
    const handler = 'CustomIconUploadHandler';
    const uid = c.getCurrentUid();
    await checkUploadPermission(c, handler);

    let form;

    try {
        form = await c.multipartForm();
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to get multi-part form data for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrParameterInvalid;
    }

    const customIconFile = form.files['icon']?.[0];

    if (!customIconFile) {
        log.warnf(c, `[${P}.${handler}] there is no custom icon in request for user "uid:${uid}"`);
        throw errs.ErrNoUserCustomIcon;
    }

    if (customIconFile.size < 1) {
        log.warnf(c, `[${P}.${handler}] the size of custom icon in request is zero for user "uid:${uid}"`);
        throw errs.ErrUserCustomIconIsEmpty;
    }

    const maxSize = currentConfig().maxUserCustomIconFileSize;

    if (customIconFile.size > maxSize) {
        log.warnf(c, `[${P}.${handler}] the upload file size "${customIconFile.size}" exceeds the maximum size "${maxSize}" of custom icon for user "uid:${uid}"`);
        throw errs.ErrExceedMaxUserCustomIconFileSize;
    }

    const fileExtension = getFileNameExtension(customIconFile.name);

    if (getImageContentType(fileExtension) !== allowedUserCustomIconContentType) {
        log.warnf(c, `[${P}.${handler}] the file extension "${fileExtension}" of custom icon in request is not supported for user "uid:${uid}"`);
        throw errs.ErrUserCustomIconExtensionInvalid;
    }

    let imageConfig, imageFormat;

    try {
        [imageConfig, imageFormat] = decodeImageConfig(customIconFile.data);
    } catch (err) {
        log.errorf(c, `[${P}.${handler}] failed to decode custom icon image config for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.ErrImageTypeNotSupported;
    }

    if (imageFormat !== UserCustomIconFileExtension) {
        log.warnf(c, `[${P}.${handler}] unsupported custom icon image format "${imageFormat}" for user "uid:${uid}"`);
        throw errs.ErrUserCustomIconExtensionInvalid;
    }

    if (imageConfig.width < 1 || imageConfig.height < 1 || imageConfig.width > maximumUserCustomIconPixels || imageConfig.height > maximumUserCustomIconPixels) {
        log.warnf(c, `[${P}.${handler}] invalid custom icon image dimensions "${imageConfig.width}x${imageConfig.height}" for user "uid:${uid}"`);
        throw errs.ErrUserCustomIconDimensionsInvalid;
    }

    const maxOrderId = await callOrFail(c, () => UserCustomIcons.getMaxDisplayOrder(c, uid), () => `[${P}.${handler}] failed to get max display order for user "uid:${uid}"`);
    let customIconInfo = { uid: uid, displayOrder: maxOrderId + 1 } as UserCustomIcon;

    const clientSessionId = form.values['clientSessionId']?.[0] ?? '';

    if (currentConfig().enableDuplicateSubmissionsCheck && clientSessionId !== '') {
        const [found, remark] = getSubmissionRemark(DUPLICATE_CHECKER_TYPE_NEW_CUSTOM_ICON, uid, clientSessionId);

        if (found) {
            log.infof(c, `[${P}.${handler}] another custom icon "id:${remark}" has been uploaded for user "uid:${uid}"`);
            let iconId: bigint | null = null;

            try {
                iconId = stringToInt64(remark);
            } catch {
                iconId = null;
            }

            if (iconId !== null) {
                const id = iconId;
                customIconInfo = await callOrFail(c, () => UserCustomIcons.getCustomIconInfoByIconId(c, uid, id), () => `[${P}.${handler}] failed to get existed custom icon "id:${id}" for user "uid:${uid}"`);
                return toUserCustomIconInfoResponse(customIconInfo);
            }
        }
    }

    const info = customIconInfo;
    await callOrFail(c, () => UserCustomIcons.uploadCustomIcon(c, info, customIconFile.data), () => `[${P}.${handler}] failed to upload custom icon for user "uid:${uid}"`);
    setSubmissionRemarkIfEnable(DUPLICATE_CHECKER_TYPE_NEW_CUSTOM_ICON, uid, clientSessionId, info.iconId.toString());

    return toUserCustomIconInfoResponse(info);
}

// customIconGetHandler returns custom icon data for current user
export async function customIconGetHandler(c: WebContext): Promise<[Buffer, string]> {
    const fileName = c.param('fileName');
    const fileExtension = getFileNameExtension(fileName);
    const contentType = getImageContentType(fileExtension);

    if (contentType !== allowedUserCustomIconContentType || fileExtension !== UserCustomIconFileExtension) {
        throw errs.ErrUserCustomIconExtensionInvalid;
    }

    const fileBaseName = getFileNameWithoutExtension(fileName);
    let iconId: bigint;

    try {
        iconId = stringToInt64(fileBaseName);
    } catch {
        throw errs.ErrUserCustomIconIdInvalid;
    }

    const uid = c.getCurrentUid();

    try {
        const customIconData = await UserCustomIcons.getCustomIconByIconId(c, uid, iconId);
        return [customIconData, allowedUserCustomIconContentType];
    } catch (err) {
        if (!errs.isCustomError(err)) {
            log.errorf(c, `[${P}.CustomIconGetHandler] failed to get custom icon "id:${iconId}", because ${errMsg(err)}`);
        }

        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// customIconMoveHandler moves display order of existed custom icons by request parameters for current user
export async function customIconMoveHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ newDisplayOrders: { id: bigint; displayOrder: number }[] }>(c, MoveRequestSchema, `${P}.CustomIconMoveHandler`);
    const uid = c.getCurrentUid();
    const customIcons = req.newDisplayOrders.map(item => ({ iconId: item.id, uid: uid, displayOrder: item.displayOrder } as UserCustomIcon));

    await callOrFail(c, () => UserCustomIcons.modifyCustomIconDisplayOrders(c, uid, customIcons), () => `[${P}.CustomIconMoveHandler] failed to modify custom icon display orders for user "uid:${uid}"`);
    log.infof(c, `[${P}.CustomIconMoveHandler] user "uid:${uid}" has moved custom icons`);
    return true;
}

// customIconDeleteHandler deletes an existed custom icon by request parameters for current user
export async function customIconDeleteHandler(c: WebContext): Promise<unknown> {
    const req = await bindJson<{ id: bigint }>(c, IdDeleteRequestSchema, `${P}.CustomIconDeleteHandler`);
    const uid = c.getCurrentUid();
    await checkUploadPermission(c, 'CustomIconDeleteHandler');

    await callOrFail(c, () => UserCustomIcons.deleteCustomIcon(c, uid, req.id), () => `[${P}.CustomIconDeleteHandler] failed to delete custom icon "id:${req.id}" for user "uid:${uid}"`);
    log.infof(c, `[${P}.CustomIconDeleteHandler] user "uid:${uid}" has deleted custom icon "id:${req.id}"`);
    return true;
}
