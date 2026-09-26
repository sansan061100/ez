import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import {
    type Account,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    ACCOUNT_TYPE_SINGLE_ACCOUNT,
    type AccountCategory,
    AccountTable,
    LevelOneAccountParentId,
    newTransaction,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED,
    TRANSACTION_TEMPLATE_TYPE_NORMAL,
    TRANSACTION_TEMPLATE_TYPE_SCHEDULE,
    type Transaction,
    TransactionTable,
    TransactionTemplateTable,
} from '../models/index';
import { stringArrayToInt64Array } from '../utils/converter';
import { getMinTransactionTimeFromUnixTime, getTimezoneOffsetMinutes, type Timezone } from '../utils/datetimes';
import { UUID_TYPE_ACCOUNT, UUID_TYPE_TRANSACTION } from '../uuid/index';
import { nowUnix, ServiceBase } from './base';
import { insertTransactionWithTimeRetry } from './transaction_insert';

// AccountService represents account service
export class AccountService extends ServiceBase {
    // getTotalAccountCountByUid returns total account count of user
    public async getTotalAccountCountByUid(c: Context, uid: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).count(AccountTable);
    }

    // getAllAccountsByUid returns all account models of user
    public async getAllAccountsByUid(c: Context, uid: bigint): Promise<Account[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).orderBy('parent_account_id asc, display_order asc').find(AccountTable);
    }

    // getAccountByAccountId returns account model according to account id
    public async getAccountByAccountId(c: Context, uid: bigint, accountId: bigint): Promise<Account> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (accountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        const account = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND account_id=?', uid, false, accountId).get(AccountTable);

        if (!account) {
            throw errs.ErrAccountNotFound;
        }

        return account;
    }

    // getAccountAndSubAccountsByAccountId returns account model and sub-account models according to account id
    public async getAccountAndSubAccountsByAccountId(c: Context, uid: bigint, accountId: bigint): Promise<Account[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (accountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND (account_id=? OR parent_account_id=?)', uid, false, accountId, accountId).orderBy('parent_account_id asc, display_order asc').find(AccountTable);
    }

    // getSubAccountsByAccountId returns sub-account models according to account id
    public async getSubAccountsByAccountId(c: Context, uid: bigint, accountId: bigint): Promise<Account[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (accountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        return this.userDataDB(uid).newSession(c).where('uid=? AND deleted=? AND parent_account_id=?', uid, false, accountId).orderBy('display_order asc').find(AccountTable);
    }

    // getSubAccountsByAccountIds returns sub-account models according to account ids
    public async getSubAccountsByAccountIds(c: Context, uid: bigint, accountIds: bigint[]): Promise<Account[]> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (accountIds.length <= 0) {
            throw errs.ErrAccountIdInvalid;
        }

        let condition = 'uid=? AND deleted=?';
        const conditionParams: unknown[] = [uid, false];
        const placeholders: string[] = [];

        for (const accountId of accountIds) {
            if (accountId <= 0n) {
                throw errs.ErrAccountIdInvalid;
            }

            placeholders.push('?');
            conditionParams.push(accountId);
        }

        if (placeholders.length > 1) {
            condition = condition + ' AND parent_account_id IN (' + placeholders.join(',') + ')';
        } else {
            condition = condition + ' AND parent_account_id = ' + placeholders.join(',');
        }

        return this.userDataDB(uid).newSession(c).where(condition, ...conditionParams).orderBy('display_order asc').find(AccountTable);
    }

    // getAccountsByAccountIds returns account models according to account ids
    public async getAccountsByAccountIds(c: Context, uid: bigint, accountIds: bigint[] | null): Promise<Map<bigint, Account>> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (!accountIds) {
            throw errs.ErrAccountIdInvalid;
        }

        const accounts = await this.userDataDB(uid).newSession(c).where('uid=? AND deleted=?', uid, false).in('account_id', accountIds).find(AccountTable);
        return this.getAccountMapByList(accounts);
    }

    // getMaxDisplayOrder returns the max display order according to account category
    public async getMaxDisplayOrder(c: Context, uid: bigint, category: AccountCategory): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const account = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'parent_account_id', 'display_order').where('uid=? AND deleted=? AND parent_account_id=? AND category=?', uid, false, LevelOneAccountParentId, category).orderBy('display_order desc').limit(1).get(AccountTable);
        return account ? account.displayOrder : 0;
    }

    // getMaxSubAccountDisplayOrder returns the max display order of sub-account according to account category and parent account id
    public async getMaxSubAccountDisplayOrder(c: Context, uid: bigint, category: AccountCategory, parentAccountId: bigint): Promise<number> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        if (parentAccountId <= 0n) {
            throw errs.ErrAccountIdInvalid;
        }

        const account = await this.userDataDB(uid).newSession(c).cols('uid', 'deleted', 'parent_account_id', 'display_order').where('uid=? AND deleted=? AND parent_account_id=? AND category=?', uid, false, parentAccountId, category).orderBy('display_order desc').limit(1).get(AccountTable);
        return account ? account.displayOrder : 0;
    }

    private newBalanceModificationTransaction(transactionId: bigint, account: Account, transactionTime: number, transactionUtcOffset: number, now: number): Transaction {
        return newTransaction({
            transactionId: transactionId,
            uid: account.uid,
            deleted: false,
            type: TRANSACTION_DB_TYPE_MODIFY_BALANCE,
            transactionTime: transactionTime,
            timezoneUtcOffset: transactionUtcOffset,
            accountId: account.accountId,
            amount: account.balance,
            relatedAccountId: account.accountId,
            relatedAccountAmount: account.balance,
            createdUnixTime: now,
            updatedUnixTime: now,
        });
    }

    // createAccounts saves a new account model to database
    public async createAccounts(c: Context, mainAccount: Account, mainAccountBalanceTime: number, childrenAccounts: Account[], childrenAccountBalanceTimes: number[], clientTimezone: Timezone): Promise<void> {
        if (mainAccount.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const needAccountUuidCount = childrenAccounts.length + 1;
        const accountUuids = this.generateUuids(UUID_TYPE_ACCOUNT, needAccountUuidCount);

        if (!accountUuids || accountUuids.length < needAccountUuidCount) {
            throw errs.ErrSystemIsBusy;
        }

        const now = nowUnix();
        const allAccounts: Account[] = [mainAccount];
        const allInitTransactions: Transaction[] = [];

        mainAccount.accountId = accountUuids[0]!;

        if (mainAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
            for (let i = 0; i < childrenAccounts.length; i++) {
                const childAccount = childrenAccounts[i]!;
                childAccount.accountId = accountUuids[i + 1]!;
                childAccount.parentAccountId = mainAccount.accountId;
                childAccount.uid = mainAccount.uid;
                childAccount.type = ACCOUNT_TYPE_SINGLE_ACCOUNT;

                allAccounts.push(childAccount);
            }
        }

        let defaultTransactionTime = getMinTransactionTimeFromUnixTime(now);

        for (let i = 0; i < allAccounts.length; i++) {
            const account = allAccounts[i]!;
            account.deleted = false;
            account.createdUnixTime = now;
            account.updatedUnixTime = now;

            if (account.balance !== 0) {
                const transactionId = this.generateUuid(UUID_TYPE_TRANSACTION);

                if (transactionId < 1n) {
                    throw errs.ErrSystemIsBusy;
                }

                let transactionTime = defaultTransactionTime;
                let transactionUtcOffset = getTimezoneOffsetMinutes(now, clientTimezone);

                if (i === 0 && mainAccountBalanceTime > 0) {
                    transactionTime = getMinTransactionTimeFromUnixTime(mainAccountBalanceTime);
                    transactionUtcOffset = getTimezoneOffsetMinutes(mainAccountBalanceTime, clientTimezone);
                } else if (i > 0 && childrenAccountBalanceTimes.length > i - 1 && childrenAccountBalanceTimes[i - 1]! > 0) {
                    transactionTime = getMinTransactionTimeFromUnixTime(childrenAccountBalanceTimes[i - 1]!);
                    transactionUtcOffset = getTimezoneOffsetMinutes(childrenAccountBalanceTimes[i - 1]!, clientTimezone);
                } else {
                    defaultTransactionTime++;
                }

                allInitTransactions.push(this.newBalanceModificationTransaction(transactionId, account, transactionTime, transactionUtcOffset, now));
            }
        }

        const userDataDb = this.userDataDB(mainAccount.uid);

        await userDataDb.doTransaction(c, async sess => {
            for (const account of allAccounts) {
                await sess.insert(AccountTable, account);
            }

            for (const transaction of allInitTransactions) {
                await insertTransactionWithTimeRetry(c, userDataDb, sess, transaction, 'accounts.CreateAccounts');
            }
        });
    }

    // modifyAccounts saves an existed account model to database
    public async modifyAccounts(c: Context, mainAccount: Account, updateAccounts: Account[], addSubAccounts: Account[], addSubAccountBalanceTimes: number[], removeSubAccountIds: bigint[], updateMainAccountCurrency: boolean, clientTimezone: Timezone): Promise<void> {
        if (mainAccount.uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const needAccountUuidCount = addSubAccounts.length;
        const newAccountUuids = this.generateUuids(UUID_TYPE_ACCOUNT, needAccountUuidCount);

        if (!newAccountUuids || newAccountUuids.length < needAccountUuidCount) {
            throw errs.ErrSystemIsBusy;
        }

        const now = nowUnix();
        const addInitTransactions: Transaction[] = [];

        for (const account of updateAccounts) {
            account.updatedUnixTime = now;
        }

        if (mainAccount.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
            let defaultTransactionTime = getMinTransactionTimeFromUnixTime(now);

            for (let i = 0; i < addSubAccounts.length; i++) {
                const childAccount = addSubAccounts[i]!;
                childAccount.accountId = newAccountUuids[i]!;
                childAccount.parentAccountId = mainAccount.accountId;
                childAccount.uid = mainAccount.uid;
                childAccount.type = ACCOUNT_TYPE_SINGLE_ACCOUNT;
                childAccount.deleted = false;
                childAccount.createdUnixTime = now;
                childAccount.updatedUnixTime = now;

                if (childAccount.balance !== 0) {
                    const transactionId = this.generateUuid(UUID_TYPE_TRANSACTION);

                    if (transactionId < 1n) {
                        throw errs.ErrSystemIsBusy;
                    }

                    let transactionTime = defaultTransactionTime;
                    let transactionUtcOffset = getTimezoneOffsetMinutes(now, clientTimezone);

                    if (addSubAccountBalanceTimes.length > i && addSubAccountBalanceTimes[i]! > 0) {
                        transactionTime = getMinTransactionTimeFromUnixTime(addSubAccountBalanceTimes[i]!);
                        transactionUtcOffset = getTimezoneOffsetMinutes(addSubAccountBalanceTimes[i]!, clientTimezone);
                    } else {
                        defaultTransactionTime++;
                    }

                    addInitTransactions.push(this.newBalanceModificationTransaction(transactionId, childAccount, transactionTime, transactionUtcOffset, now));
                }
            }
        }

        const userDataDb = this.userDataDB(mainAccount.uid);

        await userDataDb.doTransaction(c, async sess => {
            for (const account of updateAccounts) {
                const updateColumns = ['name', 'display_order', 'category', 'icon', 'icon_type', 'color', 'comment', 'extend', 'hidden', 'updated_unix_time'];

                if (updateMainAccountCurrency && account.accountId === mainAccount.accountId) {
                    updateColumns.push('currency');
                }

                const updatedRows = await sess.id(account.accountId).cols(...updateColumns).where('uid=? AND deleted=?', account.uid, false).update(AccountTable, account);

                if (updatedRows < 1) {
                    throw errs.ErrAccountNotFound;
                }
            }

            for (const account of addSubAccounts) {
                await sess.insert(AccountTable, account);
            }

            for (const transaction of addInitTransactions) {
                await insertTransactionWithTimeRetry(c, userDataDb, sess, transaction, 'accounts.ModifyAccounts', true);
            }

            if (removeSubAccountIds.length > 0) {
                const subAccountsCount = await sess.where('uid=? AND deleted=? AND parent_account_id=?', mainAccount.uid, false, mainAccount.accountId).count(AccountTable);

                if (subAccountsCount <= removeSubAccountIds.length) {
                    throw errs.ErrAccountHaveNoSubAccount;
                }

                const relatedTransactionsByAccount = await sess.cols('transaction_id', 'uid', 'deleted', 'account_id', 'type').where('uid=? AND deleted=?', mainAccount.uid, false).in('account_id', removeSubAccountIds).limit(removeSubAccountIds.length + 1).find(TransactionTable);

                if (relatedTransactionsByAccount.length > removeSubAccountIds.length) {
                    throw errs.ErrSubAccountInUseCannotBeDeleted;
                } else if (relatedTransactionsByAccount.length > 0) {
                    const accountTransactionExists = new Set<bigint>();

                    for (const transaction of relatedTransactionsByAccount) {
                        if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                            throw errs.ErrAccountInUseCannotBeDeleted;
                        } else if (accountTransactionExists.has(transaction.accountId)) {
                            throw errs.ErrAccountInUseCannotBeDeleted;
                        }

                        accountTransactionExists.add(transaction.accountId);
                    }
                }

                const deletedRows = await sess.cols('balance', 'deleted', 'deleted_unix_time').where('uid=? AND deleted=?', mainAccount.uid, false).in('account_id', removeSubAccountIds).update(AccountTable, { balance: 0, deleted: true, deletedUnixTime: now });

                if (deletedRows < 1) {
                    throw errs.ErrSubAccountNotFound;
                }

                if (relatedTransactionsByAccount.length > 0) {
                    const transactionIds = relatedTransactionsByAccount.map(transaction => transaction.transactionId);
                    const deletedTransactionRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', mainAccount.uid, false).in('transaction_id', transactionIds).update(TransactionTable, { deleted: true, deletedUnixTime: now });

                    if (deletedTransactionRows < transactionIds.length) {
                        log.errorf(c, `[accounts.ModifyAccounts] it should delete ${transactionIds.length} transactions, but have deleted ${deletedTransactionRows} actually`);
                        throw errs.ErrDatabaseOperationFailed;
                    }
                }
            }
        });
    }

    // updateAccountExtend updates the account extend data
    public async updateAccountExtend(c: Context, uid: bigint, account: Account): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        account.updatedUnixTime = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.id(account.accountId).cols('extend', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(AccountTable, account);

            if (updatedRows < 1) {
                throw errs.ErrAccountNotFound;
            }
        });
    }

    // hideAccount updates hidden field of given accounts
    public async hideAccount(c: Context, uid: bigint, ids: bigint[], hidden: boolean): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const updateModel: Partial<Account> = {
            hidden: hidden,
            updatedUnixTime: nowUnix(),
        };

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const updatedRows = await sess.cols('hidden', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).in('account_id', ids).update(AccountTable, updateModel);

            if (updatedRows < 1) {
                throw errs.ErrAccountNotFound;
            }
        });
    }

    // modifyAccountDisplayOrders updates display order of given accounts
    public async modifyAccountDisplayOrders(c: Context, uid: bigint, accounts: Account[]): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        for (const account of accounts) {
            account.updatedUnixTime = nowUnix();
        }

        await this.userDataDB(uid).doTransaction(c, async sess => {
            for (const account of accounts) {
                const updatedRows = await sess.id(account.accountId).cols('display_order', 'updated_unix_time').where('uid=? AND deleted=?', uid, false).update(AccountTable, account);

                if (updatedRows < 1) {
                    throw errs.ErrAccountNotFound;
                }
            }
        });
    }

    // deleteAccount deletes an existed account from database
    public async deleteAccount(c: Context, uid: bigint, accountId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const accountAndSubAccounts = await sess.where('uid=? AND deleted=? AND ((account_id=? AND parent_account_id=?) OR parent_account_id=?)', uid, false, accountId, LevelOneAccountParentId, accountId).find(AccountTable);

            if (accountAndSubAccounts.length < 1) {
                throw errs.ErrAccountNotFound;
            }

            const accountAndSubAccountIds = accountAndSubAccounts.map(account => account.accountId);
            const accountIdPlaceholders = accountAndSubAccountIds.map(() => '?').join(',');

            const relatedTransactionsByAccount = await sess.cols('transaction_id', 'uid', 'deleted', 'account_id', 'type').where('uid=? AND deleted=?', uid, false).in('account_id', accountAndSubAccountIds).limit(accountAndSubAccounts.length + 1).find(TransactionTable);

            if (relatedTransactionsByAccount.length > accountAndSubAccountIds.length) {
                throw errs.ErrAccountInUseCannotBeDeleted;
            } else if (relatedTransactionsByAccount.length > 0) {
                const accountTransactionExists = new Set<bigint>();

                for (const transaction of relatedTransactionsByAccount) {
                    if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                        throw errs.ErrAccountInUseCannotBeDeleted;
                    } else if (accountTransactionExists.has(transaction.accountId)) {
                        throw errs.ErrAccountInUseCannotBeDeleted;
                    }

                    accountTransactionExists.add(transaction.accountId);
                }
            }

            const transactionTemplateQueryCondition = `uid=? AND deleted=? AND (template_type=? OR (template_type=? AND scheduled_frequency_type<>? AND (scheduled_end_time IS NULL OR scheduled_end_time>=?))) AND (account_id IN (${accountIdPlaceholders}) OR related_account_id IN (${accountIdPlaceholders}))`;
            const transactionTemplateQueryConditionParams: unknown[] = [uid, false, TRANSACTION_TEMPLATE_TYPE_NORMAL, TRANSACTION_TEMPLATE_TYPE_SCHEDULE, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED, now, ...accountAndSubAccountIds, ...accountAndSubAccountIds];

            const exists = await sess.cols('uid', 'deleted', 'account_id', 'related_account_id', 'template_type', 'scheduled_frequency_type', 'scheduled_end_time').where(transactionTemplateQueryCondition, ...transactionTemplateQueryConditionParams).limit(1).exist(TransactionTemplateTable);

            if (exists) {
                throw errs.ErrAccountInUseCannotBeDeleted;
            }

            const deletedRows = await sess.cols('balance', 'deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('account_id', accountAndSubAccountIds).update(AccountTable, { balance: 0, deleted: true, deletedUnixTime: now });

            if (deletedRows < 1) {
                throw errs.ErrAccountNotFound;
            }

            if (relatedTransactionsByAccount.length > 0) {
                const transactionIds = relatedTransactionsByAccount.map(transaction => transaction.transactionId);
                const deletedTransactionRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('transaction_id', transactionIds).update(TransactionTable, { deleted: true, deletedUnixTime: now });

                if (deletedTransactionRows < transactionIds.length) {
                    log.errorf(c, `[accounts.DeleteAccount] it should delete ${transactionIds.length} transactions, but have deleted ${deletedTransactionRows} actually`);
                    throw errs.ErrDatabaseOperationFailed;
                }
            }
        });
    }

    // deleteSubAccount deletes an existed sub-account from database
    public async deleteSubAccount(c: Context, uid: bigint, accountId: bigint): Promise<void> {
        if (uid <= 0n) {
            throw errs.ErrUserIdInvalid;
        }

        const now = nowUnix();

        await this.userDataDB(uid).doTransaction(c, async sess => {
            const account = await sess.cols('account_id', 'uid', 'deleted', 'parent_account_id').where('uid=? AND deleted=? AND account_id=? AND parent_account_id<>?', uid, false, accountId, LevelOneAccountParentId).limit(1).get(AccountTable);

            if (!account) {
                throw errs.ErrSubAccountNotFound;
            }

            const subAccountsCount = await sess.where('uid=? AND deleted=? AND parent_account_id=?', uid, false, account.parentAccountId).count(AccountTable);

            if (subAccountsCount <= 1) {
                throw errs.ErrAccountHaveNoSubAccount;
            }

            const relatedTransactionsByAccount = await sess.cols('transaction_id', 'uid', 'deleted', 'account_id', 'type').where('uid=? AND deleted=? AND account_id=?', uid, false, accountId).limit(2).find(TransactionTable);

            if (relatedTransactionsByAccount.length > 1) {
                throw errs.ErrSubAccountInUseCannotBeDeleted;
            }

            for (const transaction of relatedTransactionsByAccount) {
                if (transaction.type !== TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                    throw errs.ErrSubAccountInUseCannotBeDeleted;
                }
            }

            const exists = await sess.cols('uid', 'deleted', 'account_id', 'related_account_id', 'template_type', 'scheduled_frequency_type', 'scheduled_end_time')
                .where('uid=? AND deleted=? AND (template_type=? OR (template_type=? AND scheduled_frequency_type<>? AND (scheduled_end_time IS NULL OR scheduled_end_time>=?))) AND (account_id=? OR related_account_id=?)', uid, false, TRANSACTION_TEMPLATE_TYPE_NORMAL, TRANSACTION_TEMPLATE_TYPE_SCHEDULE, TRANSACTION_SCHEDULE_FREQUENCY_TYPE_DISABLED, now, accountId, accountId)
                .limit(1).exist(TransactionTemplateTable);

            if (exists) {
                throw errs.ErrSubAccountInUseCannotBeDeleted;
            }

            const deletedRows = await sess.cols('balance', 'deleted', 'deleted_unix_time').where('uid=? AND deleted=? AND account_id=?', uid, false, accountId).update(AccountTable, { balance: 0, deleted: true, deletedUnixTime: now });

            if (deletedRows < 1) {
                throw errs.ErrSubAccountNotFound;
            }

            if (relatedTransactionsByAccount.length > 0) {
                const transactionIds = relatedTransactionsByAccount.map(transaction => transaction.transactionId);
                const deletedTransactionRows = await sess.cols('deleted', 'deleted_unix_time').where('uid=? AND deleted=?', uid, false).in('transaction_id', transactionIds).update(TransactionTable, { deleted: true, deletedUnixTime: now });

                if (deletedTransactionRows < transactionIds.length) {
                    log.errorf(c, `[accounts.DeleteSubAccount] it should delete ${transactionIds.length} transactions, but have deleted ${deletedTransactionRows} actually`);
                    throw errs.ErrDatabaseOperationFailed;
                }
            }
        });
    }

    // getAccountMapByList returns an account map by a list
    public getAccountMapByList(accounts: Account[]): Map<bigint, Account> {
        const accountMap = new Map<bigint, Account>();

        for (const account of accounts) {
            accountMap.set(account.accountId, account);
        }

        return accountMap;
    }

    // getVisibleAccountNameMapByList returns visible account map by a list
    public getVisibleAccountNameMapByList(accounts: Account[]): Map<string, Account> {
        const accountMap = new Map<string, Account>();

        for (const account of accounts) {
            if (account.hidden) {
                continue;
            }

            if (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
                continue;
            }

            accountMap.set(account.name, account);
        }

        return accountMap;
    }

    // getAccountNames returns a list with account names from account models list
    public getAccountNames(accounts: Account[]): string[] {
        return accounts.map(account => account.name);
    }

    // getAccountOrSubAccountIds returns a list of account ids or sub-account ids according to given account ids
    public async getAccountOrSubAccountIds(c: Context, accountIds: string, uid: bigint): Promise<bigint[] | null> {
        if (accountIds === '' || accountIds === '0') {
            return null;
        }

        let requestAccountIds: bigint[];

        try {
            requestAccountIds = stringArrayToInt64Array(accountIds.split(','));
        } catch (err) {
            throw errs.or(err, errs.ErrAccountIdInvalid);
        }

        const allAccountIds: bigint[] = [];

        if (requestAccountIds.length > 0) {
            const allSubAccounts = await this.getSubAccountsByAccountIds(c, uid, requestAccountIds);
            const accountIdsMap = new Map<bigint, number>();

            for (const accountId of requestAccountIds) {
                accountIdsMap.set(accountId, 0);
            }

            for (const subAccount of allSubAccounts) {
                const refCount = accountIdsMap.get(subAccount.parentAccountId);

                if (refCount !== undefined) {
                    accountIdsMap.set(subAccount.parentAccountId, refCount + 1);
                } else {
                    accountIdsMap.set(subAccount.parentAccountId, 1);
                }

                if (accountIdsMap.has(subAccount.accountId)) {
                    accountIdsMap.delete(subAccount.accountId);
                }

                allAccountIds.push(subAccount.accountId);
            }

            for (const [accountId, refCount] of accountIdsMap) {
                if (refCount < 1) {
                    allAccountIds.push(accountId);
                }
            }
        }

        return allAccountIds;
    }

    // getAccountOrSubAccountIdsByAccountName returns a list of account ids or sub-account ids according to given account name
    public getAccountOrSubAccountIdsByAccountName(accounts: Account[], accountName: string): bigint[] {
        const accountIds: bigint[] = [];
        const parentAccountIds: bigint[] = [];
        const childAccountByParentAccountId = new Map<bigint, Account[]>();

        for (const account of accounts) {
            if (account.name === accountName) {
                if (account.type === ACCOUNT_TYPE_SINGLE_ACCOUNT) {
                    accountIds.push(account.accountId);
                } else if (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS) {
                    parentAccountIds.push(account.accountId);
                }
            } else if (account.parentAccountId > 0n) {
                let childAccounts = childAccountByParentAccountId.get(account.parentAccountId);

                if (!childAccounts) {
                    childAccounts = [];
                    childAccountByParentAccountId.set(account.parentAccountId, childAccounts);
                }

                childAccounts.push(account);
            }
        }

        for (const parentAccountId of parentAccountIds) {
            const childAccounts = childAccountByParentAccountId.get(parentAccountId);

            if (childAccounts) {
                for (const childAccount of childAccounts) {
                    accountIds.push(childAccount.accountId);
                }
            }
        }

        return accountIds;
    }
}

export const Accounts = new AccountService();
