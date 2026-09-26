import { MATCH_MODE_DEFAULT, MATCH_MODE_IGNORE_CASE } from '../core/types';
import * as errs from '../errs/index';
import { Container as ExchangeRatesContainer } from '../exchangerates/index';
import * as log from '../log/index';
import {
    type Account,
    ACCOUNT_CATEGORY_CASH,
    ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT,
    ACCOUNT_CATEGORY_CHECKING_ACCOUNT,
    ACCOUNT_CATEGORY_CREDIT_CARD,
    ACCOUNT_CATEGORY_DEBT,
    ACCOUNT_CATEGORY_INVESTMENT,
    ACCOUNT_CATEGORY_RECEIVABLES,
    ACCOUNT_CATEGORY_SAVINGS_ACCOUNT,
    ACCOUNT_CATEGORY_VIRTUAL,
    ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS,
    canEditTransactionByTransactionTime,
    CATEGORY_TYPE_EXPENSE,
    CATEGORY_TYPE_INCOME,
    CATEGORY_TYPE_TRANSFER,
    LevelOneAccountParentId,
    LevelOneTransactionCategoryParentId,
    MaximumTagsCountOfTransaction,
    MaximumTransactionAmount,
    MinimumTransactionAmount,
    newTransaction,
    type Transaction,
    type TransactionCategory,
    toAccountInfoResponse,
    TRANSACTION_DB_TYPE_EXPENSE,
    TRANSACTION_DB_TYPE_INCOME,
    TRANSACTION_DB_TYPE_MODIFY_BALANCE,
    TRANSACTION_DB_TYPE_TRANSFER_OUT,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
    type User,
} from '../models/index';
import { Accounts } from '../services/accounts';
import { TransactionCategories } from '../services/transaction_categories';
import { TransactionTags } from '../services/transaction_tags';
import { type TransactionQueryFilter, Transactions } from '../services/transactions';
import type { Config } from '../settings/settings';
import { formatAmount, parseAmount } from '../utils/converter';
import { fixedZone, formatUnixTimeToLongDateTimeWithTimezoneRFC3339Format, getMaxTransactionTimeFromUnixTime, getMinTransactionTimeFromUnixTime, getTimezoneOffsetMinutes, getUnixTimeFromTransactionTime, loadLocation, parseFromLongDateTimeWithTimezoneRFC3339Format } from '../utils/datetimes';
import { goJsonField, goJsonNumber, goJsonString, goJsonStringArray } from '../utils/gojson';
import { addInt64 } from '../utils/numbers';
import type { WebContext } from '../web/context';
import { goJsonStringify } from '../web/json';
import { MCPToolsInfo } from './tools_schema';

export const MCPProtocolVersion20250618 = '2025-06-18';
export const MCPProtocolVersion20250326 = '2025-03-26';
export const MCPProtocolVersion20241105 = '2024-11-05';
export const LatestSupportedMCPVersion = MCPProtocolVersion20250618;
export const ToolResultStructuredContentMinVersion = MCPProtocolVersion20250618;
export const MCPProtocolVersionHeaderName = 'MCP-Protocol-Version';
export const SupportedMCPVersion = new Set<string>([MCPProtocolVersion20250618, MCPProtocolVersion20250326, MCPProtocolVersion20241105]);

const transactionTypeIncome = 'income';
const transactionTypeExpense = 'expense';
const transactionTypeTransfer = 'transfer';
const transactionTypeModifyBalance = 'balance_modification';

export interface MCPCallToolRequest {
    name: string;
    arguments: unknown; // undefined when absent (go json.RawMessage nil)
}

export interface MCPTextContent {
    type: string;
    text: string;
}

function newMCPTextContent(text: string): MCPTextContent {
    return { type: 'text', text: text };
}

type ToolResult = [unknown, MCPTextContent[]];

interface MCPToolHandler {
    name: string;
    handle(c: WebContext, request: MCPCallToolRequest, user: User, config: Config): Promise<ToolResult>;
}

// parseArguments parses the tool arguments like go json.Unmarshal into struct
function parseArguments(request: MCPCallToolRequest): Record<string, unknown> {
    if (request.arguments === undefined) {
        throw errs.ErrIncompleteOrIncorrectSubmission;
    }

    if (request.arguments === null) {
        return {};
    }

    if (typeof request.arguments !== 'object' || Array.isArray(request.arguments)) {
        throw errs.newIncompleteOrIncorrectSubmissionError(new Error('json: cannot unmarshal into Go value of struct type'));
    }

    return request.arguments as Record<string, unknown>;
}

function decodeArguments<T>(fn: () => T): T {
    try {
        return fn();
    } catch (err) {
        throw errs.newIncompleteOrIncorrectSubmissionError(err as Error);
    }
}

function goBool(obj: Record<string, unknown>, key: string): boolean {
    const value = goJsonField(obj, key);

    if (value === undefined || value === null) {
        return false;
    }

    if (typeof value !== 'boolean') {
        throw new Error(`json: cannot unmarshal ${typeof value} into Go struct field .${key} of type bool`);
    }

    return value;
}

function goInt32(obj: Record<string, unknown>, key: string): number {
    const value = goJsonNumber(obj, key);

    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw new Error(`json: cannot unmarshal number ${value} into Go struct field .${key} of type int32`);
    }

    return value;
}

function textResult(response: unknown): ToolResult {
    return [response, [newMCPTextContent(goJsonStringify(response))]];
}

// add_transaction
const addTransactionToolHandler: MCPToolHandler = {
    name: 'add_transaction',
    async handle(c: WebContext, request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        const prefix = 'add_transaction_tool_handler';
        const args = parseArguments(request);
        const req = decodeArguments(() => ({
            type: goJsonString(args, 'type'),
            time: goJsonString(args, 'time'),
            categoryName: goJsonString(args, 'category_name'),
            accountName: goJsonString(args, 'account_name'),
            amount: goJsonString(args, 'amount'),
            destinationAccountName: goJsonString(args, 'destination_account_name'),
            destinationAmount: goJsonString(args, 'destination_amount'),
            tags: goJsonStringArray(args, 'tags') ?? [],
            comment: goJsonString(args, 'comment'),
            dryRun: goBool(args, 'dry_run'),
        }));

        if (req.type !== transactionTypeIncome && req.type !== transactionTypeExpense && req.type !== transactionTypeTransfer) {
            throw errs.ErrTransactionTypeInvalid;
        }

        if (req.type === transactionTypeTransfer && (req.destinationAccountName === '' || req.destinationAmount === '')) {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        if (req.tags.length > MaximumTagsCountOfTransaction) {
            throw errs.ErrTransactionHasTooManyTags;
        }

        const uid = user.uid;
        let allAccounts: Account[];

        try {
            allAccounts = await Accounts.getAllAccountsByUid(c, uid);
        } catch (err) {
            log.warnf(c, `[${prefix}.Handle] get account error, because ${(err as Error).message}`);
            throw err;
        }

        const accountsMap = Accounts.getVisibleAccountNameMapByList(allAccounts);
        const sourceAccount = accountsMap.get(req.accountName);

        if (!sourceAccount) {
            log.warnf(c, `[${prefix}.Handle] source account "${req.accountName}" not found for user "uid:${uid}"`);
            throw errs.ErrSourceAccountNotFound;
        }

        let destinationAccount: Account | null = null;
        let destinationAccountId = 0n;

        if (req.type === transactionTypeTransfer) {
            destinationAccount = accountsMap.get(req.destinationAccountName) ?? null;

            if (!destinationAccount) {
                log.warnf(c, `[${prefix}.Handle] destination account "${req.destinationAccountName}" not found for user "uid:${uid}"`);
                throw errs.ErrDestinationAccountNotFound;
            }

            destinationAccountId = destinationAccount.accountId;
        }

        let allCategories: TransactionCategory[];

        try {
            allCategories = await TransactionCategories.getAllCategoriesByUid(c, uid, 0, -1n);
        } catch (err) {
            log.warnf(c, `[${prefix}.Handle] get transaction category error, because ${(err as Error).message}`);
            throw err;
        }

        let transactionCategory: TransactionCategory | null = null;

        for (const category of allCategories) {
            if (category.hidden || category.parentCategoryId === LevelOneTransactionCategoryParentId) {
                continue;
            }

            if (category.name === req.categoryName) {
                if ((category.type === CATEGORY_TYPE_INCOME && req.type === transactionTypeIncome) ||
                    (category.type === CATEGORY_TYPE_EXPENSE && req.type === transactionTypeExpense) ||
                    (category.type === CATEGORY_TYPE_TRANSFER && req.type === transactionTypeTransfer)) {
                    transactionCategory = category;
                    break;
                }
            }
        }

        if (!transactionCategory) {
            log.warnf(c, `[${prefix}.Handle] secondary category "${req.categoryName}" not found for user "uid:${uid}"`);
            throw errs.ErrTransactionCategoryNotFound;
        }

        const tagIds: bigint[] = [];

        if (req.tags.length > 0) {
            let allTags;

            try {
                allTags = await TransactionTags.getAllTagsByUid(c, uid);
            } catch (err) {
                log.warnf(c, `[${prefix}.Handle] get transaction tag ids error, because ${(err as Error).message}`);
                throw err;
            }

            const tagMaps = TransactionTags.getVisibleTagNameMapByList(allTags);

            for (const tagName of req.tags) {
                const tag = tagMaps.get(tagName);

                if (tag) {
                    tagIds.push(tag.tagId);
                } else {
                    log.warnf(c, `[${prefix}.Handle] transaction tag "${tagName}" not found for user "uid:${uid}"`);
                }
            }
        }

        const transaction = createNewTransactionModel(c, uid, req, transactionCategory.categoryId, sourceAccount.accountId, destinationAccountId, c.clientIP());
        const transactionEditable = canEditTransactionByTransactionTime(user, transaction.transactionTime, fixedZone(transaction.timezoneUtcOffset), sourceAccount, destinationAccount);

        if (!transactionEditable) {
            throw errs.ErrCannotCreateTransactionWithThisTransactionTime;
        }

        if (!req.dryRun) {
            try {
                await Transactions.createTransaction(c, transaction, tagIds, null);
            } catch (err) {
                log.errorf(c, `[${prefix}.Handle] failed to create transaction "id:${transaction.transactionId}" for user "uid:${uid}", because ${(err as Error).message}`);
                throw err;
            }

            log.infof(c, `[${prefix}.Handle] user "uid:${uid}" has created a new transaction "id:${transaction.transactionId}" successfully`);

            const accountIds = [sourceAccount.accountId];

            if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                accountIds.push(destinationAccountId);
            }

            let newAccounts = new Map<bigint, Account>();

            try {
                newAccounts = await Accounts.getAccountsByAccountIds(c, uid, accountIds);
            } catch (err) {
                log.warnf(c, `[${prefix}.Handle] failed to get latest accounts info after transaction created, because ${(err as Error).message}`);
            }

            return createAddTransactionResponse(transaction, newAccounts, false);
        }

        const newAccounts = new Map<bigint, Account>();
        newAccounts.set(sourceAccount.accountId, sourceAccount);

        if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE || transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
            sourceAccount.balance = getAccountBalanceAfterUpdate(sourceAccount.balance, -transaction.amount);
        } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
            sourceAccount.balance = getAccountBalanceAfterUpdate(sourceAccount.balance, transaction.amount);
        }

        if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && destinationAccount) {
            newAccounts.set(destinationAccount.accountId, destinationAccount);
            destinationAccount.balance = getAccountBalanceAfterUpdate(destinationAccount.balance, transaction.relatedAccountAmount);
        }

        return createAddTransactionResponse(transaction, newAccounts, true);
    },
};

function getAccountBalanceAfterUpdate(balance: number, delta: number): number {
    const [newBalance, ok] = addInt64(balance, delta);

    if (!ok) {
        throw errs.ErrAccountBalanceOverflow;
    }

    return Number(newBalance);
}

interface AddTransactionRequest {
    type: string;
    time: string;
    amount: string;
    destinationAmount: string;
    comment: string;
}

function createNewTransactionModel(c: WebContext, uid: bigint, req: AddTransactionRequest, categoryId: bigint, sourceAccountId: bigint, destinationAccountId: bigint, clientIp: string): Transaction {
    const prefix = 'add_transaction_tool_handler.createNewTransactionModel';
    let transactionDbType: number;

    if (req.type === transactionTypeExpense) {
        transactionDbType = TRANSACTION_DB_TYPE_EXPENSE;
    } else if (req.type === transactionTypeIncome) {
        transactionDbType = TRANSACTION_DB_TYPE_INCOME;
    } else if (req.type === transactionTypeTransfer) {
        transactionDbType = TRANSACTION_DB_TYPE_TRANSFER_OUT;
    } else {
        throw errs.ErrTransactionTypeInvalid;
    }

    let transactionTime;

    try {
        transactionTime = parseFromLongDateTimeWithTimezoneRFC3339Format(req.time);
    } catch (err) {
        log.warnf(c, `[${prefix}] parse transaction time "${req.time}" error, because ${(err as Error).message}`);
        throw errs.ErrTransactionTimeInvalid;
    }

    const parseTransactionAmount = (text: string, name: string): number => {
        let amount: number;

        try {
            amount = parseAmount(text);
        } catch (err) {
            log.warnf(c, `[${prefix}] parse transaction ${name} "${text}" error, because ${(err as Error).message}`);
            throw errs.ErrAmountInvalid;
        }

        if (amount < MinimumTransactionAmount || amount > MaximumTransactionAmount) {
            log.warnf(c, `[${prefix}] transaction ${name} "${text}" is out of range`);
            throw errs.ErrAmountInvalid;
        }

        return amount;
    };

    const amount = parseTransactionAmount(req.amount, 'amount');
    const unixTime = Math.floor(transactionTime.toSeconds());

    const transaction = newTransaction({
        uid: uid,
        type: transactionDbType,
        categoryId: categoryId,
        transactionTime: getMinTransactionTimeFromUnixTime(unixTime),
        timezoneUtcOffset: getTimezoneOffsetMinutes(unixTime, transactionTime.zone),
        accountId: sourceAccountId,
        amount: amount,
        hideAmount: false,
        comment: req.comment,
        createdIp: clientIp,
    });

    if (req.type === transactionTypeTransfer) {
        transaction.relatedAccountId = destinationAccountId;
        transaction.relatedAccountAmount = parseTransactionAmount(req.destinationAmount, 'destination amount');
    }

    return transaction;
}

function createAddTransactionResponse(transaction: Transaction, accountsMap: Map<bigint, Account>, dryRun: boolean): ToolResult {
    const response: Record<string, unknown> = { success: true };

    if (dryRun) {
        response['dry_run'] = true;
    }

    const getBalance = (account: Account | undefined): string => {
        if (!account) {
            return '';
        }

        const info = toAccountInfoResponse(account);

        if (info.isAsset) {
            return formatAmount(account.balance);
        } else if (info.isLiability) {
            return formatAmount(-BigInt(account.balance));
        }

        return '';
    };

    const accountBalance = getBalance(accountsMap.get(transaction.accountId));

    if (accountBalance !== '') {
        response['account_balance'] = accountBalance;
    }

    if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
        const destinationAccountBalance = getBalance(accountsMap.get(transaction.relatedAccountId));

        if (destinationAccountBalance !== '') {
            response['destination_account_balance'] = destinationAccountBalance;
        }
    }

    return textResult(response);
}

// query_transactions
const queryTransactionsToolHandler: MCPToolHandler = {
    name: 'query_transactions',
    async handle(c: WebContext, request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        const prefix = 'query_transactions_tool_handler';
        const args = parseArguments(request);
        const req = decodeArguments(() => ({
            startTime: goJsonString(args, 'start_time'),
            endTime: goJsonString(args, 'end_time'),
            type: goJsonString(args, 'type'),
            categoryName: goJsonString(args, 'category_name'),
            accountName: goJsonString(args, 'account_name'),
            keyword: goJsonString(args, 'keyword'),
            matchMode: goJsonString(args, 'match_mode'),
            count: goInt32(args, 'count'),
            page: goInt32(args, 'page'),
            responseFields: goJsonString(args, 'response_fields'),
        }));

        const uid = user.uid;
        let maxTime, minTime;

        try {
            maxTime = parseFromLongDateTimeWithTimezoneRFC3339Format(req.endTime);
            minTime = parseFromLongDateTimeWithTimezoneRFC3339Format(req.startTime);
        } catch {
            throw errs.ErrIncompleteOrIncorrectSubmission;
        }

        const maxTransactionTime = getMaxTransactionTimeFromUnixTime(Math.floor(maxTime.toSeconds()));
        const minTransactionTime = getMinTransactionTimeFromUnixTime(Math.floor(minTime.toSeconds()));

        if (req.count <= 0) {
            req.count = 100;
        }

        if (req.page <= 0) {
            req.page = 1;
        }

        let transactionType = 0;

        if (req.type === transactionTypeExpense) {
            transactionType = TRANSACTION_TYPE_EXPENSE;
        } else if (req.type === transactionTypeIncome) {
            transactionType = TRANSACTION_TYPE_INCOME;
        } else if (req.type === transactionTypeTransfer) {
            transactionType = TRANSACTION_TYPE_TRANSFER;
        } else if (req.type === transactionTypeModifyBalance) {
            transactionType = TRANSACTION_TYPE_MODIFY_BALANCE;
        } else if (req.type !== '') {
            throw errs.ErrTransactionTypeInvalid;
        }

        let allAccounts: Account[];

        try {
            allAccounts = await Accounts.getAllAccountsByUid(c, uid);
        } catch (err) {
            log.warnf(c, `[${prefix}.Handle] get account error, because ${(err as Error).message}`);
            throw err;
        }

        let filterAccountIds: bigint[] = [];

        if (req.accountName !== '') {
            filterAccountIds = Accounts.getAccountOrSubAccountIdsByAccountName(allAccounts, req.accountName);

            if (filterAccountIds.length < 1) {
                throw errs.ErrAccountNotFound;
            }
        }

        let allCategories: TransactionCategory[];

        try {
            allCategories = await TransactionCategories.getAllCategoriesByUid(c, uid, 0, -1n);
        } catch (err) {
            log.warnf(c, `[${prefix}.Handle] get transaction category error, because ${(err as Error).message}`);
            throw err;
        }

        let filterCategoryIds: bigint[] = [];

        if (req.categoryName !== '') {
            filterCategoryIds = TransactionCategories.getCategoryOrSubCategoryIdsByCategoryName(allCategories, req.categoryName);

            if (filterCategoryIds.length < 1) {
                throw errs.ErrTransactionCategoryNotFound;
            }
        }

        const filter: TransactionQueryFilter = {
            transactionType: transactionType,
            categoryIds: filterCategoryIds,
            accountIds: filterAccountIds,
            tagFilters: null,
            noTags: false,
            amountFilter: '',
            keyword: req.keyword,
            matchMode: req.matchMode === 'ignore_case' ? MATCH_MODE_IGNORE_CASE : MATCH_MODE_DEFAULT,
            mustHavePictures: false,
        };

        let totalCount: number;

        try {
            totalCount = await Transactions.getTransactionCount(c, uid, maxTransactionTime, minTransactionTime, filter);
        } catch (err) {
            log.errorf(c, `[${prefix}.Handle] failed to get transaction count for user "uid:${uid}", because ${(err as Error).message}`);
            throw err;
        }

        let transactions: Transaction[] = [];

        try {
            transactions = await Transactions.getTransactionsByMaxTimeUpToCount(c, uid, maxTransactionTime, minTransactionTime, filter, req.page, req.count, 1000, false, true);
        } catch {
            transactions = [];
        }

        const accountsMap = Accounts.getAccountMapByList(allAccounts);
        const categoriesMap = TransactionCategories.getCategoryMapByList(allCategories);
        const filteredFields = new Set<string>(req.responseFields !== '' ? req.responseFields.split(',') : []);
        const allFields = filteredFields.size === 0;
        const transactionInfos: Record<string, unknown>[] = [];

        for (const transaction of transactions) {
            let type: string;

            if (transaction.type === TRANSACTION_DB_TYPE_EXPENSE) {
                type = transactionTypeExpense;
            } else if (transaction.type === TRANSACTION_DB_TYPE_INCOME) {
                type = transactionTypeIncome;
            } else if (transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT) {
                type = transactionTypeTransfer;
            } else if (transaction.type === TRANSACTION_DB_TYPE_MODIFY_BALANCE) {
                type = transactionTypeModifyBalance;
            } else {
                log.warnf(c, `[${prefix}.createNewMCPQueryTransactionsResponse] encountered transaction with unexpected type "${transaction.type}" for transaction "id:${transaction.transactionId}"`);
                continue;
            }

            const info = {
                time: '',
                type: type,
                amount: formatAmount(transaction.amount),
                currency: '',
                category_name: '',
                account_name: '',
                destination_amount: transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT ? formatAmount(transaction.relatedAccountAmount) : '',
                destination_currency: '',
                destination_account_name: '',
                comment: '',
            };

            const account = accountsMap.get(transaction.accountId);
            const destinationAccount = transaction.type === TRANSACTION_DB_TYPE_TRANSFER_OUT && transaction.relatedAccountId > 0n ? accountsMap.get(transaction.relatedAccountId) : undefined;

            if (allFields || filteredFields.has('time')) {
                info.time = formatUnixTimeToLongDateTimeWithTimezoneRFC3339Format(getUnixTimeFromTransactionTime(transaction.transactionTime), fixedZone(transaction.timezoneUtcOffset));
            }

            if (allFields || filteredFields.has('currency')) {
                info.currency = account?.currency ?? '';
                info.destination_currency = destinationAccount?.currency ?? '';
            }

            if (allFields || filteredFields.has('category_name')) {
                info.category_name = categoriesMap.get(transaction.categoryId)?.name ?? '';
            }

            if (allFields || filteredFields.has('account_name')) {
                info.account_name = account?.name ?? '';
                info.destination_account_name = destinationAccount?.name ?? '';
            }

            if (allFields || filteredFields.has('comment')) {
                info.comment = transaction.comment;
            }

            const finalInfo: Record<string, unknown> = {};

            for (const [key, value] of Object.entries(info)) {
                if (key === 'type' || key === 'amount' || value !== '') {
                    finalInfo[key] = value;
                }
            }

            transactionInfos.push(finalInfo);
        }

        return textResult({
            total_count: totalCount,
            current_page: req.page,
            total_page: Math.trunc((totalCount + req.count - 1) / req.count),
            transactions: transactionInfos,
        });
    },
};

const accountCategoryFields: [number, string][] = [
    [ACCOUNT_CATEGORY_CASH, 'cashAccounts'],
    [ACCOUNT_CATEGORY_CHECKING_ACCOUNT, 'checkingAccounts'],
    [ACCOUNT_CATEGORY_SAVINGS_ACCOUNT, 'savingsAccounts'],
    [ACCOUNT_CATEGORY_CREDIT_CARD, 'creditCardAccounts'],
    [ACCOUNT_CATEGORY_VIRTUAL, 'virtualAccounts'],
    [ACCOUNT_CATEGORY_DEBT, 'debtAccounts'],
    [ACCOUNT_CATEGORY_RECEIVABLES, 'receivableAccounts'],
    [ACCOUNT_CATEGORY_CERTIFICATE_OF_DEPOSIT, 'certificateOfDepositAccounts'],
    [ACCOUNT_CATEGORY_INVESTMENT, 'investmentAccounts'],
];

function groupAccountsByCategory<T>(accounts: Account[], mapper: (account: Account) => T): Record<string, T[]> {
    const groups = new Map<number, T[]>();

    for (const account of accounts) {
        if (account.hidden || (account.type === ACCOUNT_TYPE_MULTI_SUB_ACCOUNTS && account.parentAccountId === LevelOneAccountParentId)) {
            continue;
        }

        if (!accountCategoryFields.some(([category]) => category === account.category)) {
            continue;
        }

        const list = groups.get(account.category) ?? [];
        list.push(mapper(account));
        groups.set(account.category, list);
    }

    const response: Record<string, T[]> = {};

    for (const [category, field] of accountCategoryFields) {
        const list = groups.get(category);

        if (list && list.length > 0) {
            response[field] = list;
        }
    }

    return response;
}

async function getAllAccounts(c: WebContext, uid: bigint, prefix: string): Promise<Account[]> {
    try {
        return await Accounts.getAllAccountsByUid(c, uid);
    } catch (err) {
        log.errorf(c, `[${prefix}.Handle] failed to get all accounts for user "uid:${uid}", because ${(err as Error).message}`);
        throw err;
    }
}

// query_all_accounts
const queryAllAccountsToolHandler: MCPToolHandler = {
    name: 'query_all_accounts',
    async handle(c: WebContext, _request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        const accounts = await getAllAccounts(c, user.uid, 'query_all_accounts_tool_handler');
        return textResult(groupAccountsByCategory(accounts, account => account.name));
    },
};

// query_all_accounts_balance
const queryAllAccountsBalanceToolHandler: MCPToolHandler = {
    name: 'query_all_accounts_balance',
    async handle(c: WebContext, _request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        const accounts = await getAllAccounts(c, user.uid, 'query_all_accounts_balance_tool_handler');

        return textResult(groupAccountsByCategory(accounts, account => {
            const accountResp = toAccountInfoResponse(account);
            const info: Record<string, unknown> = { name: accountResp.name, type: '' };

            if (accountResp.isAsset) {
                info['type'] = 'asset';
                info['balance'] = formatAmount(account.balance);
            } else if (accountResp.isLiability) {
                info['type'] = 'liability';
                info['outstandingBalance'] = formatAmount(-BigInt(account.balance));
            }

            info['currency'] = accountResp.currency;
            return info;
        }));
    },
};

function sortedGroups(groups: Map<string, string[]>): Record<string, string[]> {
    const ret: Record<string, string[]> = {};

    for (const key of Array.from(groups.keys()).sort()) {
        ret[key] = groups.get(key) as string[];
    }

    return ret;
}

// query_all_transaction_categories
const queryAllTransactionCategoriesToolHandler: MCPToolHandler = {
    name: 'query_all_transaction_categories',
    async handle(c: WebContext, _request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        const prefix = 'query_all_transaction_categories_tool_handler';
        let categories: TransactionCategory[];

        try {
            categories = await TransactionCategories.getAllCategoriesByUid(c, user.uid, 0, -1n);
        } catch (err) {
            log.errorf(c, `[${prefix}.Handle] failed to get categories for user "uid:${user.uid}", because ${(err as Error).message}`);
            throw err;
        }

        const categoriesMap = new Map<bigint, TransactionCategory>();

        for (const category of categories) {
            if (!category.hidden) {
                categoriesMap.set(category.categoryId, category);
            }
        }

        const incomeCategories = new Map<string, string[]>();
        const expenseCategories = new Map<string, string[]>();
        const transferCategories = new Map<string, string[]>();

        for (const category of categories) {
            if (category.hidden || category.parentCategoryId === LevelOneTransactionCategoryParentId) {
                continue;
            }

            const parentCategory = categoriesMap.get(category.parentCategoryId);

            if (!parentCategory) {
                log.warnf(c, `[${prefix}.createNewMCPQueryAllTransactionCategoriesResponse] category "id:${category.categoryId}" has no parent category`);
                continue;
            }

            let target: Map<string, string[]> | null = null;

            if (category.type === CATEGORY_TYPE_INCOME) {
                target = incomeCategories;
            } else if (category.type === CATEGORY_TYPE_EXPENSE) {
                target = expenseCategories;
            } else if (category.type === CATEGORY_TYPE_TRANSFER) {
                target = transferCategories;
            }

            if (target) {
                const list = target.get(parentCategory.name) ?? [];
                list.push(category.name);
                target.set(parentCategory.name, list);
            }
        }

        return textResult({
            incomeCategories: sortedGroups(incomeCategories),
            expenseCategories: sortedGroups(expenseCategories),
            transferCategories: sortedGroups(transferCategories),
        });
    },
};

// query_all_transaction_tags
const queryAllTransactionTagsToolHandler: MCPToolHandler = {
    name: 'query_all_transaction_tags',
    async handle(c: WebContext, _request: MCPCallToolRequest, user: User): Promise<ToolResult> {
        let tags;

        try {
            tags = await TransactionTags.getAllTagsByUid(c, user.uid);
        } catch (err) {
            log.errorf(c, `[query_all_transaction_tags_tool_handler.Handle] failed to get tags for user "uid:${user.uid}", because ${(err as Error).message}`);
            throw err;
        }

        return textResult({
            tags: tags.filter(tag => !tag.hidden).map(tag => tag.name),
        });
    },
};

// query_latest_exchange_rates
const queryLatestExchangeRatesToolHandler: MCPToolHandler = {
    name: 'query_latest_exchange_rates',
    async handle(c: WebContext, request: MCPCallToolRequest, user: User, config: Config): Promise<ToolResult> {
        const args = parseArguments(request);
        const currencies = decodeArguments(() => goJsonString(args, 'currencies'));
        const exchangeRatesResp = await ExchangeRatesContainer.getLatestExchangeRates(c, user.uid, config);
        const queryCurrencies = new Set<string>();

        for (const currency of currencies.split(',')) {
            const trimmed = currency.trim();

            if (trimmed !== '') {
                queryCurrencies.add(trimmed);
            }
        }

        const rates: Record<string, string>[] = [];

        for (const rate of exchangeRatesResp.exchangeRates) {
            if (rate.currency !== exchangeRatesResp.baseCurrency && !queryCurrencies.has(rate.currency)) {
                continue;
            }

            rates.push({ currency: rate.currency, rate_to_base: rate.rate });
        }

        return textResult({
            base_currency: exchangeRatesResp.baseCurrency,
            update_time: formatUnixTimeToLongDateTimeWithTimezoneRFC3339Format(exchangeRatesResp.updateTime, loadLocation('UTC')),
            rates: rates,
        });
    },
};

class MCPContainer {
    private readonly handlers = new Map<string, MCPToolHandler>();

    public register(handler: MCPToolHandler): void {
        if (!this.handlers.has(handler.name)) {
            this.handlers.set(handler.name, handler);
        }
    }

    // getMCPTools returns the tools info (null if no tools)
    public getMCPTools(): Record<string, unknown>[] | null {
        const tools = MCPToolsInfo.filter(tool => this.handlers.has(tool['name'] as string));
        return tools.length > 0 ? tools : null;
    }

    // handleTool calls the tool handler and returns the tool response
    public async handleTool(c: WebContext, request: MCPCallToolRequest, user: User, config: Config): Promise<unknown> {
        const handler = this.handlers.get(request.name);

        if (!handler) {
            throw errs.ErrApiNotFound;
        }

        let structuredResponse: unknown;
        let content: MCPTextContent[];

        try {
            [structuredResponse, content] = await handler.handle(c, request, user, config);
        } catch (err) {
            throw errs.or(err, errs.ErrOperationFailed);
        }

        const response: Record<string, unknown> = { content: content };

        if (c.getHeader(MCPProtocolVersionHeaderName) >= ToolResultStructuredContentMinVersion && structuredResponse !== null && structuredResponse !== undefined) {
            response['structuredContent'] = structuredResponse;
        }

        return response;
    }
}

export let Container = new MCPContainer();

// initializeMCPHandlers registers all mcp tool handlers
export function initializeMCPHandlers(_config: Config): void {
    const container = new MCPContainer();
    container.register(addTransactionToolHandler);
    container.register(queryTransactionsToolHandler);
    container.register(queryAllAccountsToolHandler);
    container.register(queryAllAccountsBalanceToolHandler);
    container.register(queryAllTransactionCategoriesToolHandler);
    container.register(queryAllTransactionTagsToolHandler);
    container.register(queryLatestExchangeRatesToolHandler);
    Container = container;
}
