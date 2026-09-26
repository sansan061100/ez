import * as errs from '../errs/index';
import * as log from '../log/index';
import { parseTransactionTagFilter, type TransactionTagFilter, TransactionNoTagFilterValue } from '../models/index';
import type { WebContext } from '../web/context';
import { errMsg } from './base';

export { formatUnixTimeToLongDateTimeWithoutSecond, getMaxTransactionTimeFromUnixTime, getMinTransactionTimeFromUnixTime, loadLocation, type Timezone } from '../utils/datetimes';

// parseTransactionTagFilterSafe parses the tag filter, returns [tag filters, no tags]
export function parseTransactionTagFilterSafe(c: WebContext, tagFilter: string, logPrefix: string): [TransactionTagFilter[] | null, boolean] {
    if (tagFilter === TransactionNoTagFilterValue) {
        return [null, true];
    }

    try {
        return [parseTransactionTagFilter(tagFilter), false];
    } catch (err) {
        log.warnf(c, `[${logPrefix}] parse transaction tag filters error, because ${errMsg(err)}`);
        throw errs.or(err, errs.ErrOperationFailed);
    }
}
