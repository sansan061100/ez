import * as errs from '../errs/index';
import { Container as ExchangeRatesContainer } from '../exchangerates/index';
import * as log from '../log/index';
import { toUserCustomExchangeRateUpdateResponse, type UserCustomExchangeRateDeleteRequest, type UserCustomExchangeRateUpdateRequest } from '../models/index';
import { UserCustomExchangeRates } from '../services/user_custom_exchange_rates';
import type { WebContext } from '../web/context';
import { bindJson, currentConfig, errMsg } from './base';
import { getCurrentUserOrOperationFailed } from './common';
import { UserCustomExchangeRateDeleteRequestSchema, UserCustomExchangeRateUpdateRequestSchema } from './schemas';

const P = 'exchange_rates';

// latestExchangeRateHandler returns latest exchange rate data
export async function latestExchangeRateHandler(c: WebContext): Promise<unknown> {
    try {
        return await ExchangeRatesContainer.getLatestExchangeRates(c, c.getCurrentUid(), currentConfig());
    } catch (err) {
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// userCustomExchangeRateUpdateHandler updates user custom exchange rate by request parameters for current user
export async function userCustomExchangeRateUpdateHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.UserCustomExchangeRateUpdateHandler`;
    const updateReq = await bindJson<UserCustomExchangeRateUpdateRequest>(c, UserCustomExchangeRateUpdateRequestSchema, handler);
    const uid = c.getCurrentUid();
    const user = await getCurrentUserOrOperationFailed(c, handler);

    if (updateReq.currency === user.defaultCurrency) {
        throw errs.ErrCannotUpdateExchangeRateForDefaultCurrency;
    }

    try {
        const [newCustomExchangeRate, defaultCurrencyExchangeRate] = await UserCustomExchangeRates.updateCustomExchangeRate(c, uid, updateReq.currency, updateReq.rate, user.defaultCurrency);
        log.infof(c, `[${handler}] user "uid:${uid}" has updated user custom exchange rate "currency:${updateReq.currency}" successfully`);
        return toUserCustomExchangeRateUpdateResponse(newCustomExchangeRate, defaultCurrencyExchangeRate.rate);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to update user custom exchange rate "currency:${updateReq.currency}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}

// userCustomExchangeRateDeleteHandler deletes user custom exchange rate by request parameters for current user
export async function userCustomExchangeRateDeleteHandler(c: WebContext): Promise<unknown> {
    const handler = `${P}.UserCustomExchangeRateDeleteHandler`;
    const deleteReq = await bindJson<UserCustomExchangeRateDeleteRequest>(c, UserCustomExchangeRateDeleteRequestSchema, handler);
    const uid = c.getCurrentUid();
    const user = await getCurrentUserOrOperationFailed(c, handler);

    if (deleteReq.currency === user.defaultCurrency) {
        throw errs.ErrCannotDeleteExchangeRateForDefaultCurrency;
    }

    try {
        await UserCustomExchangeRates.deleteCustomExchangeRate(c, uid, deleteReq.currency);
    } catch (err) {
        log.errorf(c, `[${handler}] failed to delete user custom exchange rate "currency:${deleteReq.currency}" for user "uid:${uid}", because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }

    log.infof(c, `[${handler}] user "uid:${uid}" has deleted user custom exchange rate "currency:${deleteReq.currency}"`);
    return true;
}
