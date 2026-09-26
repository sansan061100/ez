import type { Context } from '../core/context';
import type { Database, Session } from '../datastore/index';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { type Transaction, TransactionTable } from '../models/index';
import { getMaxTransactionTimeFromUnixTime, getMinTransactionTimeFromUnixTime, getUnixTimeFromTransactionTime } from '../utils/datetimes';

// insertTransactionWithTimeRetry inserts the transaction, and if another transaction has the same time, regenerates the transaction time and inserts again
export async function insertTransactionWithTimeRetry(c: Context, userDataDb: Database, sess: Session, transaction: Transaction, logPrefix: string, typoTrasaction: boolean = false): Promise<void> {
    const insertTransactionSavePointName = 'insert_transaction';
    const transactionText = typoTrasaction ? 'trasaction' : 'transaction';

    try {
        await userDataDb.setSavePoint(sess, insertTransactionSavePointName);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to set save point "${insertTransactionSavePointName}", because ${(err as Error).message}`);
        throw err;
    }

    let createdRows = 0;
    let insertError: unknown = null;

    try {
        createdRows = await sess.insert(TransactionTable, transaction);
    } catch (err) {
        insertError = err;
    }

    if (insertError === null && createdRows >= 1) {
        return;
    }

    // maybe another transaction has same time
    if (insertError !== null) {
        log.warnf(c, `[${logPrefix}] cannot create ${transactionText}, because ${(insertError as Error).message}, regenerate transaction time value`);
    } else {
        log.warnf(c, `[${logPrefix}] cannot create ${transactionText}, regenerate transaction time value`);
    }

    try {
        await userDataDb.rollbackToSavePoint(sess, insertTransactionSavePointName);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to rollback to save point "${insertTransactionSavePointName}", because ${(err as Error).message}`);
        throw err;
    }

    const minTransactionTime = getMinTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));
    const maxTransactionTime = getMaxTransactionTimeFromUnixTime(getUnixTimeFromTransactionTime(transaction.transactionTime));

    const sameSecondLatestTransaction = await sess.where('uid=? AND transaction_time>=? AND transaction_time<=?', transaction.uid, minTransactionTime, maxTransactionTime).orderBy('transaction_time desc').limit(1).get(TransactionTable);

    if (!sameSecondLatestTransaction) {
        log.errorf(c, `[${logPrefix}] it should have transactions in ${minTransactionTime} - ${maxTransactionTime}, but result is empty`);
        throw errs.ErrDatabaseOperationFailed;
    } else if (sameSecondLatestTransaction.transactionTime === maxTransactionTime - 1) {
        throw errs.ErrTooMuchTransactionInOneSecond;
    }

    transaction.transactionTime = sameSecondLatestTransaction.transactionTime + 1;

    try {
        createdRows = await sess.insert(TransactionTable, transaction);
    } catch (err) {
        log.errorf(c, `[${logPrefix}] failed to add ${typoTrasaction ? 'transaction' : 'transaction'} again, because ${(err as Error).message}`);
        throw err;
    }

    if (createdRows < 1) {
        log.errorf(c, `[${logPrefix}] failed to add transaction again`);
        throw errs.ErrDatabaseOperationFailed;
    }
}
