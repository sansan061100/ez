import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { createUserCustomExchangeRate, type UserCustomExchangeRate, UserCustomExchangeRateTable } from '../models/index';
import { nowUnix, ServiceBase } from './base';

function emptyCustomExchangeRate(): UserCustomExchangeRate {
    return { uid: 0n, deletedUnixTime: 0, currency: '', rate: 0, createdUnixTime: 0, updatedUnixTime: 0 };
}

// UserCustomExchangeRatesService represents user custom exchange rates service
export class UserCustomExchangeRatesService extends ServiceBase {
    // getAllCustomExchangeRatesByUid returns all user custom exchange rates of user
    public async getAllCustomExchangeRatesByUid(c: Context, uid: bigint): Promise<UserCustomExchangeRate[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted_unix_time=?', uid, 0).find(UserCustomExchangeRateTable);
    }

    // updateCustomExchangeRate updates user custom exchange rate, returns [new exchange rate, default currency exchange rate]
    public async updateCustomExchangeRate(c: Context, uid: bigint, currency: string, rate: string, defaultCurrency: string): Promise<[UserCustomExchangeRate, UserCustomExchangeRate]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();
        let newCustomExchangeRate = emptyCustomExchangeRate();
        let defaultCurrencyExchangeRate = emptyCustomExchangeRate();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const oldCustomExchangeRate = await sess.where('uid=? AND deleted_unix_time=? AND currency=?', uid, 0, currency).get(UserCustomExchangeRateTable);

            if (oldCustomExchangeRate) {
                await sess.cols('deleted_unix_time').where('uid=? AND deleted_unix_time=? AND currency=?', uid, 0, currency).update(UserCustomExchangeRateTable, { deletedUnixTime: now });
            }

            if (currency !== defaultCurrency) {
                const existedDefaultCurrencyExchangeRate = await sess.where('uid=? AND deleted_unix_time=? AND currency=?', uid, 0, defaultCurrency).get(UserCustomExchangeRateTable);

                if (existedDefaultCurrencyExchangeRate) {
                    defaultCurrencyExchangeRate = existedDefaultCurrencyExchangeRate;
                } else {
                    defaultCurrencyExchangeRate = createUserCustomExchangeRate(uid, defaultCurrency, '1', 0);
                    defaultCurrencyExchangeRate.createdUnixTime = now;
                    defaultCurrencyExchangeRate.updatedUnixTime = now;
                    defaultCurrencyExchangeRate.deletedUnixTime = 0;

                    await sess.insert(UserCustomExchangeRateTable, defaultCurrencyExchangeRate);
                }
            } else {
                defaultCurrencyExchangeRate = oldCustomExchangeRate ?? emptyCustomExchangeRate();
            }

            newCustomExchangeRate = createUserCustomExchangeRate(uid, currency, rate, defaultCurrencyExchangeRate.rate);
            newCustomExchangeRate.createdUnixTime = now;
            newCustomExchangeRate.updatedUnixTime = now;
            newCustomExchangeRate.deletedUnixTime = 0;

            await sess.insert(UserCustomExchangeRateTable, newCustomExchangeRate);
        });

        return [newCustomExchangeRate, defaultCurrencyExchangeRate];
    }

    // deleteCustomExchangeRate deletes user custom exchange rate
    public async deleteCustomExchangeRate(c: Context, uid: bigint, currency: string): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const deletedRows = await sess.cols('deleted_unix_time').where('uid=? AND deleted_unix_time=? AND currency=?', uid, 0, currency).update(UserCustomExchangeRateTable, { deletedUnixTime: now });

            if (deletedRows < 1) {
                throw errs.ErrUserCustomExchangeRateNotFound;
            }
        });
    }

    // deleteAllCustomExchangeRates deletes all user custom exchange rates
    public async deleteAllCustomExchangeRates(c: Context, uid: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            await sess.cols('deleted_unix_time').where('uid=? AND deleted_unix_time=?', uid, 0).update(UserCustomExchangeRateTable, { deletedUnixTime: now });
        });
    }
}

export const UserCustomExchangeRates = new UserCustomExchangeRatesService();
