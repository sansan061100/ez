import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { getLocaleTextItems } from '../locales/index';
import { type TwoFactor, type TwoFactorRecoveryCode, TwoFactorRecoveryCodeTable, TwoFactorTable, type User } from '../models/index';
import { decryptSecret, encodePassword, encryptSecret, getRandomNumberOrLowercaseLetter } from '../utils/strings';
import { nowUnix, ServiceBase } from './base';
import { generateTotpKey, type TotpKey } from './totp';

const twoFactorRecoveryCodeCount = 10;
const twoFactorRecoveryCodeLength = 10; // bytes

// TwoFactorAuthorizationService represents 2fa service
export class TwoFactorAuthorizationService extends ServiceBase {
    // getUserTwoFactorSettingByUid returns the 2fa setting model according to user uid
    public async getUserTwoFactorSettingByUid(c: Context, uid: bigint): Promise<TwoFactor> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const twoFactor = await this.userDB().newSession(c).where('uid=?', uid).get(TwoFactorTable);

        if (!twoFactor) {
            throw errs.ErrTwoFactorIsNotEnabled;
        }

        twoFactor.secret = decryptSecret(twoFactor.secret, this.currentConfig().secretKey);
        return twoFactor;
    }

    // generateTwoFactorSecret generates a new 2fa secret
    public generateTwoFactorSecret(_c: Context, user: User | null, backupLocale: string): TotpKey {
        if (!user) {
            throw errs.ErrUserNotFound;
        }

        let locale = user.language;

        if (locale === '') {
            locale = backupLocale;
        }

        const localeTextItems = getLocaleTextItems(locale);
        return generateTotpKey(localeTextItems.globalTextItems.appName, user.username);
    }

    // createTwoFactorSetting saves a new 2fa setting to database
    public async createTwoFactorSetting(c: Context, twoFactor: TwoFactor): Promise<void> {
        if (twoFactor.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        twoFactor.secret = encryptSecret(twoFactor.secret, this.currentConfig().secretKey);
        twoFactor.createdUnixTime = nowUnix();

        await this.userDB().doTransaction(c, async sess => {
            await sess.insert(TwoFactorTable, twoFactor);
        });
    }

    // deleteTwoFactorSetting deletes an existed 2fa setting from database
    public async deleteTwoFactorSetting(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDB().doTransaction(c, async sess => {
            const deletedRows = await sess.where('uid=?', uid).delete(TwoFactorTable);

            if (deletedRows < 1) {
                throw errs.ErrTwoFactorIsNotEnabled;
            }
        });
    }

    // existsTwoFactorSetting returns whether the given user has existed 2fa setting
    public async existsTwoFactorSetting(c: Context, uid: bigint): Promise<boolean> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDB().newSession(c).cols('uid').where('uid=?', uid).exist(TwoFactorTable);
    }

    // getAndUseUserTwoFactorRecoveryCode checks whether the given 2fa recovery code exists and marks it used
    public async getAndUseUserTwoFactorRecoveryCode(c: Context, uid: bigint, recoveryCode: string, salt: string): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        recoveryCode = encodePassword(recoveryCode, salt);

        const exists = await this.userDB().newSession(c).cols('uid', 'recovery_code').where('uid=? AND recovery_code=? AND used=?', uid, recoveryCode, false).exist(TwoFactorRecoveryCodeTable);

        if (!exists) {
            throw errs.ErrTwoFactorRecoveryCodeNotExist;
        }

        await this.userDB().doTransaction(c, async sess => {
            await sess.cols('used', 'used_unix_time').where('uid=? AND recovery_code=?', uid, recoveryCode).update(TwoFactorRecoveryCodeTable, { used: true, usedUnixTime: nowUnix() });
        });
    }

    // generateTwoFactorRecoveryCodes generates new 2fa recovery codes
    public generateTwoFactorRecoveryCodes(): string[] {
        const recoveryCodes: string[] = [];

        for (let i = 0; i < twoFactorRecoveryCodeCount; i++) {
            const recoveryCode = getRandomNumberOrLowercaseLetter(twoFactorRecoveryCodeLength);
            recoveryCodes.push(recoveryCode.substring(0, 5) + '-' + recoveryCode.substring(5));
        }

        return recoveryCodes;
    }

    // createTwoFactorRecoveryCodes saves new 2fa recovery codes to database
    public async createTwoFactorRecoveryCodes(c: Context, uid: bigint, recoveryCodes: string[], salt: string): Promise<void> {
        const twoFactorRecoveryCodes: TwoFactorRecoveryCode[] = recoveryCodes.map(code => ({
            uid: uid,
            used: false,
            recoveryCode: encodePassword(code, salt),
            createdUnixTime: nowUnix(),
            usedUnixTime: 0,
        }));

        await this.userDB().doTransaction(c, async sess => {
            await sess.where('uid=?', uid).delete(TwoFactorRecoveryCodeTable);

            for (const twoFactorRecoveryCode of twoFactorRecoveryCodes) {
                await sess.insert(TwoFactorRecoveryCodeTable, twoFactorRecoveryCode);
            }
        });
    }

    // deleteTwoFactorRecoveryCodes deletes existed 2fa recovery codes from database
    public async deleteTwoFactorRecoveryCodes(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        await this.userDB().doTransaction(c, async sess => {
            await sess.where('uid=?', uid).delete(TwoFactorRecoveryCodeTable);
        });
    }
}

export const TwoFactorAuthorizations = new TwoFactorAuthorizationService();
