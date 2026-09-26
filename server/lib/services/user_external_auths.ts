import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { type UserExternalAuth, UserExternalAuthTable } from '../models/index';
import { nowUnix, ServiceBase } from './base';

// UserExternalAuthService represents user external auth service
export class UserExternalAuthService extends ServiceBase {
    // getUserAllExternalAuthsByUid returns all user external auth models of user
    public async getUserAllExternalAuthsByUid(c: Context, uid: bigint): Promise<UserExternalAuth[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDB().newSession(c).where('uid=?', uid).find(UserExternalAuthTable);
    }

    // getUserExternalAuthByUid returns the user external auth model according to user uid
    public async getUserExternalAuthByUid(c: Context, uid: bigint, externalAuthType: string): Promise<UserExternalAuth> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const userExternalAuth = await this.userDB().newSession(c).where('uid=? AND external_auth_type=?', uid, externalAuthType).get(UserExternalAuthTable);

        if (!userExternalAuth) {
            throw errs.ErrUserExternalAuthNotFound;
        }

        return userExternalAuth;
    }

    // getUserExternalAuthByExternalUserName returns the user external auth model according to external user name
    public async getUserExternalAuthByExternalUserName(c: Context, externalUserName: string, externalAuthType: string): Promise<UserExternalAuth> {
        const userExternalAuth = await this.userDB().newSession(c).where('external_auth_type=? AND external_username=?', externalAuthType, externalUserName).get(UserExternalAuthTable);

        if (!userExternalAuth) {
            throw errs.ErrUserExternalAuthNotFound;
        }

        return userExternalAuth;
    }

    // getUserExternalAuthByExternalEmail returns the user external auth model according to external email
    public async getUserExternalAuthByExternalEmail(c: Context, externalEmail: string, externalAuthType: string): Promise<UserExternalAuth> {
        const userExternalAuth = await this.userDB().newSession(c).where('external_auth_type=? AND external_email=?', externalAuthType, externalEmail).get(UserExternalAuthTable);

        if (!userExternalAuth) {
            throw errs.ErrUserExternalAuthNotFound;
        }

        return userExternalAuth;
    }

    // createUserExternalAuth saves a new user external auth model to database
    public async createUserExternalAuth(c: Context, userExternalAuth: UserExternalAuth): Promise<void> {
        if (userExternalAuth.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        userExternalAuth.createdUnixTime = nowUnix();

        await this.userDB().doTransaction(c, async sess => {
            const exists = await sess.where('uid=? AND external_auth_type=?', userExternalAuth.uid, userExternalAuth.externalAuthType).limit(1).exist(UserExternalAuthTable);

            if (exists) {
                throw errs.ErrUserExternalAuthAlreadyExists;
            }

            await sess.insert(UserExternalAuthTable, userExternalAuth);
        });
    }

    // deleteUserExternalAuth deletes the user external auth model
    public async deleteUserExternalAuth(c: Context, uid: bigint, externalAuthType: string): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDB().doTransaction(c, async sess => {
            const deletedRows = await sess.where('uid=? AND external_auth_type=?', uid, externalAuthType).delete(UserExternalAuthTable);

            if (deletedRows < 1) {
                throw errs.ErrUserExternalAuthNotFound;
            }
        });
    }
}

export const UserExternalAuths = new UserExternalAuthService();
