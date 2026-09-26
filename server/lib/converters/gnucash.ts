import { gunzipSync } from 'node:zlib';

import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER } from '../models/index';
import { formatAmount, parseAmount, stringToInt64 } from '../utils/converter';
import { formatTimezoneOffset, formatUnixTimeToLongDateTime, parseFromLongDateTimeWithTimezone2 } from '../utils/datetimes';
import { parseXml } from '../utils/xml';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRow,
    type TransactionDataRowIterator,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';
import { type DecodedObject, type DecodeSchema, decodeXmlElement, list, obj, sliceField, str, structField, textField } from './sgml';

const gnucashCommoditySchema: DecodeSchema = {
    space: ['space', textField],
    id: ['id', textField],
};

const gnucashDatabaseSchema: DecodeSchema = {
    book: ['books', sliceField({
        id: ['id', textField],
        account: ['accounts', sliceField({
            name: ['name', textField],
            id: ['id', textField],
            type: ['accountType', textField],
            description: ['description', textField],
            parent: ['parentId', textField],
            commodity: ['commodity', structField(gnucashCommoditySchema)],
            'slots>slot': ['slots', sliceField({
                key: ['key', textField],
                value: ['value', textField],
            })],
        })],
        transaction: ['transactions', sliceField({
            id: ['id', textField],
            currency: ['currency', structField(gnucashCommoditySchema)],
            'date-posted>date': ['postedDate', textField],
            'date-entered>date': ['enteredDate', textField],
            description: ['description', textField],
            'splits>split': ['splits', sliceField({
                id: ['id', textField],
                'reconciled-state': ['reconciledState', textField],
                value: ['value', textField],
                quantity: ['quantity', textField],
                account: ['account', textField],
            })],
        })],
    })],
};

const assetOrLiabilityAccountTypes = new Set(['ASSET', 'BANK', 'CASH', 'CREDIT', 'LIABILITY', 'MUTUAL', 'PAYABLE', 'RECEIVABLE', 'STOCK']);

const gnucashTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, String(TRANSACTION_TYPE_MODIFY_BALANCE)],
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

const gnucashTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

function parseQuantity(quantity: string): string {
    const items = quantity.split('/');

    if (items.length !== 2) {
        throw errs.ErrAmountInvalid;
    }

    let value: bigint;

    try {
        value = stringToInt64(items[0] as string);
    } catch {
        throw errs.ErrAmountInvalid;
    }

    if (items[1] === '100') {
        return formatAmount(value);
    }

    let factor: bigint;

    try {
        factor = stringToInt64(items[1] as string);
    } catch {
        throw errs.ErrAmountInvalid;
    }

    if (factor === 0n) {
        throw errs.ErrAmountInvalid;
    }

    return formatAmount(BigInt.asIntN(64, value * 100n) / factor);
}

function getCurrency(account: DecodedObject): string | null {
    const commodity = obj(account, 'commodity');
    return commodity && str(commodity, 'space') === 'CURRENCY' ? str(commodity, 'id') : null;
}

class GnuCashTransactionDataTable implements TransactionDataTable {
    public constructor(private readonly allData: DecodedObject[], private readonly accountMap: Map<string, DecodedObject>) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return gnucashTransactionSupportedColumns.has(column);
    }

    public transactionRowCount(): number {
        return this.allData.length;
    }

    private getCategoryName(account: DecodedObject): string {
        const parentId = str(account, 'parentId');

        if (parentId === '') {
            return '';
        }

        const parentAccount = this.accountMap.get(parentId);

        if (!parentAccount || str(parentAccount, 'accountType') === 'ROOT') {
            return '';
        }

        return str(parentAccount, 'name');
    }

    private parseTransaction(ctx: Context, transaction: DecodedObject): [RowData, boolean] {
        const prefix = 'gnucash_transaction_table.parseTransaction';
        const data: RowData = new Map();
        const postedDate = str(transaction, 'postedDate');
        const transactionId = str(transaction, 'id');

        if (postedDate === '') {
            throw errs.ErrMissingTransactionTime;
        }

        let dateTime;

        try {
            dateTime = parseFromLongDateTimeWithTimezone2(postedDate);
        } catch {
            throw errs.ErrTransactionTimeInvalid;
        }

        const unixTime = Math.floor(dateTime.toSeconds());
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, formatUnixTimeToLongDateTime(unixTime, dateTime.zone));
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(unixTime, dateTime.zone));

        const splits = list(transaction, 'splits');
        const isEquityOrIncome = (account: DecodedObject): boolean => str(account, 'accountType') === 'EQUITY' || str(account, 'accountType') === 'INCOME';
        const isAssetOrLiability = (account: DecodedObject): boolean => assetOrLiabilityAccountTypes.has(str(account, 'accountType'));

        if (splits.length === 2) {
            const splitData1 = splits[0] as DecodedObject;
            const splitData2 = splits[1] as DecodedObject;
            const account1 = this.accountMap.get(str(splitData1, 'account'));
            const account2 = this.accountMap.get(str(splitData2, 'account'));

            if (!account1 || !account2) {
                throw errs.ErrMissingAccountData;
            }

            if (str(splitData1, 'quantity') === '' || str(splitData2, 'quantity') === '') {
                throw errs.ErrAmountInvalid;
            }

            const amount1 = parseQuantity(str(splitData1, 'quantity'));
            const amount2 = parseQuantity(str(splitData2, 'quantity'));

            if ((isEquityOrIncome(account1) && isAssetOrLiability(account2)) || (isEquityOrIncome(account2) && isAssetOrLiability(account1))) {
                let fromAccount = account1;
                let toAccount = account2;
                let toAmount = amount2;

                if (isEquityOrIncome(account2) && isAssetOrLiability(account1)) {
                    fromAccount = account2;
                    toAccount = account1;
                    toAmount = amount1;
                }

                const isOpeningBalance = list(fromAccount, 'slots').some(slot => str(slot, 'key') === 'equity-type' && str(slot, 'value') === 'opening-balance');
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(isOpeningBalance ? TRANSACTION_TYPE_MODIFY_BALANCE : TRANSACTION_TYPE_INCOME));
                data.set(TRANSACTION_DATA_TABLE_CATEGORY, this.getCategoryName(fromAccount));
                data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, str(fromAccount, 'name'));
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, str(toAccount, 'name'));

                const currency = getCurrency(toAccount);

                if (currency === null) {
                    throw errs.ErrAccountCurrencyInvalid;
                }

                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, currency);
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, toAmount);
            } else if ((str(account1, 'accountType') === 'EXPENSE' && isAssetOrLiability(account2)) || (str(account2, 'accountType') === 'EXPENSE' && isAssetOrLiability(account1))) {
                let fromAccount = account1;
                let fromAmount = amount1;
                let toAccount = account2;

                if (str(account1, 'accountType') === 'EXPENSE' && isAssetOrLiability(account2)) {
                    fromAccount = account2;
                    fromAmount = amount2;
                    toAccount = account1;
                }

                let amount: number;

                try {
                    amount = parseAmount(fromAmount);
                } catch {
                    throw errs.ErrAmountInvalid;
                }

                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_EXPENSE));
                data.set(TRANSACTION_DATA_TABLE_CATEGORY, this.getCategoryName(toAccount));
                data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, str(toAccount, 'name'));
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, str(fromAccount, 'name'));

                const currency = getCurrency(fromAccount);

                if (currency === null) {
                    throw errs.ErrAccountCurrencyInvalid;
                }

                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, currency);
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
            } else if (isAssetOrLiability(account1) && isAssetOrLiability(account2)) {
                let fromAccount: DecodedObject;
                let toAccount: DecodedObject;
                let fromAmount: string;
                let toAmount: string;

                if (amount1.startsWith('-')) {
                    fromAccount = account1;
                    fromAmount = amount1.substring(1);
                    toAccount = account2;
                    toAmount = amount2;
                } else if (amount2.startsWith('-')) {
                    fromAccount = account2;
                    fromAmount = amount2.substring(1);
                    toAccount = account1;
                    toAmount = amount1;
                } else {
                    log.errorf(ctx, `[${prefix}] cannot parse transfer transaction "id:${transactionId}", because unexcepted account amounts "${amount1}" and "${amount2}"`);
                    throw errs.ErrInvalidGnuCashFile;
                }

                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_TRANSFER));
                data.set(TRANSACTION_DATA_TABLE_CATEGORY, '');
                data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, '');
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, str(fromAccount, 'name'));

                const fromCurrency = getCurrency(fromAccount);

                if (fromCurrency !== null) {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, fromCurrency);
                }

                data.set(TRANSACTION_DATA_TABLE_AMOUNT, fromAmount);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, str(toAccount, 'name'));

                const toCurrency = getCurrency(toAccount);

                if (toCurrency !== null) {
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, toCurrency);
                }

                data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, toAmount);
            } else {
                log.errorf(ctx, `[${prefix}] cannot parse transaction "id:${transactionId}", because unexcepted account types "${str(account1, 'accountType')}" and "${str(account2, 'accountType')}"`);
                throw errs.ErrThereAreNotSupportedTransactionType;
            }
        } else if (splits.length === 1) {
            const splitData = splits[0] as DecodedObject;
            const account = this.accountMap.get(str(splitData, 'account'));

            if (!account) {
                throw errs.ErrMissingAccountData;
            }

            if (str(splitData, 'quantity') === '') {
                throw errs.ErrAmountInvalid;
            }

            const amountNum = parseAmount(parseQuantity(str(splitData, 'quantity')));

            if (amountNum === 0) {
                log.warnf(ctx, `[${prefix}] skip parsing transaction "id:${transactionId}" with zero amount`);
                return [new Map(), false];
            }

            log.errorf(ctx, `[${prefix}] cannot parse transaction "id:${transactionId}", because split count is ${splits.length}`);
            throw errs.ErrThereAreNotSupportedTransactionType;
        } else if (splits.length < 1) {
            log.errorf(ctx, `[${prefix}] cannot parse transaction "id:${transactionId}", because split count is ${splits.length}`);
            throw errs.ErrInvalidGnuCashFile;
        } else {
            log.errorf(ctx, `[${prefix}] cannot parse split transaction "id:${transactionId}", because split count is ${splits.length}`);
            throw errs.ErrNotSupportedSplitTransactions;
        }

        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(transaction, 'description'));
        return [data, true];
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        let currentIndex = -1;

        return {
            hasNext: () => currentIndex + 1 < this.allData.length,
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                if (currentIndex + 1 >= this.allData.length) {
                    return null;
                }

                currentIndex++;
                let rowItems: RowData;
                let isValid: boolean;

                try {
                    [rowItems, isValid] = this.parseTransaction(ctx, this.allData[currentIndex] as DecodedObject);
                } catch (err) {
                    log.errorf(ctx, `[gnucash_transaction_table.Next] cannot parsing transaction in row#${currentIndex}, because ${(err as Error).message}`);
                    throw err;
                }

                return {
                    isValid: () => isValid,
                    getData: (column: TransactionDataTableColumn) => (gnucashTransactionSupportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                };
            },
        };
    }
}

export const GnuCashTransactionDataImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        let xmlData: Buffer;

        if (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) {
            xmlData = gunzipSync(data);
        } else if (data.length > 5 && data.subarray(0, 5).toString('latin1') === '<?xml') {
            xmlData = data;
        } else {
            throw errs.ErrInvalidGnuCashFile;
        }

        const root = parseXml(xmlData);

        if (root.name !== 'gnc-v2') {
            throw new Error(`expected element type <gnc-v2> but have <${root.name}>`);
        }

        const database = decodeXmlElement(root, gnucashDatabaseSchema);
        const books = list(database, 'books');

        if (books.length < 1) {
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const allData: DecodedObject[] = [];
        const gnucashAccountMap = new Map<string, DecodedObject>();

        for (const book of books) {
            allData.push(...list(book, 'transactions'));

            for (const account of list(book, 'accounts')) {
                gnucashAccountMap.set(str(account, 'id'), account);
            }
        }

        const transactionDataTable = new GnuCashTransactionDataTable(allData, gnucashAccountMap);
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(gnucashTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
