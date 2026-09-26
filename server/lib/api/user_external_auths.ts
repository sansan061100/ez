import { getExternalUserAuthType } from '../auth/oauth2/index';
import { containsFeatureRestriction, USER_FEATURE_RESTRICTION_TYPE_UNLINK_THIRD_PARTY_LOGIN } from '../core/feature_restriction';
import { getUserExternalAuthTypeCategory, isValidUserExternalAuthType } from '../core/types';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { sortUserExternalAuthInfoResponses, toUserExternalAuthInfoResponse, type UserExternalAuth, type UserExternalAuthInfoResponse, type UserExternalAuthUnlinkRequest } from '../models/index';
import { UserExternalAuths } from '../services/user_external_auths';
import { Users } from '../services/users';
import type { WebContext } from '../web/context';
import { bindJson, errMsg } from './base';
import { getCurrentUserWarnWithUid, requireNormalToken } from './common';
import { UserExternalAuthUnlinkRequestSchema } from './schemas';

const P = 'user_external_auths';

// externalAuthListHandler returns external authentication list of current user
export async function externalAuthListHandler(c: WebContext): Promise<unknown> {
    const uid = c.getCurrentUid();
    let userExternalAuths: UserExternalAuth[];

    try {
        userExternalAuths = await UserExternalAuths.getUserAllExternalAuthsByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${P}.ExternalAuthListHandler] failed to get all external authentications for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    const userExternalAuthResps: UserExternalAuthInfoResponse[] = [];
    const currentExternalAuthType = getExternalUserAuthType();
    let hasCurrentExternalAuth = false;

    for (const userExternalAuth of userExternalAuths) {
        if (userExternalAuth.externalAuthType === currentExternalAuthType) {
            hasCurrentExternalAuth = true;
        }

        userExternalAuthResps.push(toUserExternalAuthInfoResponse(userExternalAuth));
    }

    if (!hasCurrentExternalAuth) {
        userExternalAuthResps.push({
            externalAuthCategory: getUserExternalAuthTypeCategory(currentExternalAuthType),
            externalAuthType: currentExternalAuthType,
            linked: false,
        });
    }

    return sortUserExternalAuthInfoResponses(userExternalAuthResps);
}

// unlinkExternalAuthHandler unlinks an external authentication for current user
export async function unlinkExternalAuthHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.UnlinkExternalAuthHandler`;
    const unlinkReq = await bindJson<UserExternalAuthUnlinkRequest>(c, UserExternalAuthUnlinkRequestSchema, handler);
    const uid = c.getCurrentUid();

    requireNormalToken(c, handler, 'unlink external authentication');

    const user = await getCurrentUserWarnWithUid(c, handler);

    if (!Users.isPasswordEqualsUserPassword(unlinkReq.password, user)) {
        throw errs.ErrUserPasswordWrong;
    }

    if (containsFeatureRestriction(user.featureRestriction, USER_FEATURE_RESTRICTION_TYPE_UNLINK_THIRD_PARTY_LOGIN)) {
        throw errs.ErrNotPermittedToPerformThisAction;
    }

    if (!isValidUserExternalAuthType(unlinkReq.externalAuthType)) {
        throw errs.ErrUserExternalAuthNotFound;
    }

    try {
        await UserExternalAuths.deleteUserExternalAuth(c, uid, unlinkReq.externalAuthType);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to unlink external authentication "${unlinkReq.externalAuthType}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    return true;
}
