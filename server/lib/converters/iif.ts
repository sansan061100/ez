import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { formatAmount, parseAmount as parseAmountValue } from '../utils/converter';
import { formatYearMonthDayToLongDateTime } from '../utils/datetimes';
import { readAllGoCsv } from '../utils/gocsv';
import { isValidMonthDayYearLongOrShortDateFormat, isValidYearMonthDayLongOrShortDateFormat } from '../utils/validators';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRow,
    type TransactionDataRowIterator,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';

interface IifAccountDataset {
    accountDataColumnIndexes: Map<string, number>;
    accounts: string[][];
}

interface IifTransactionData {
    dataItems: string[];
    splitData: string[][];
}

interface IifTransactionDataset {
    transactionDataColumnIndexes: Map<string, number>;
    splitDataColumnIndexes: Map<string, number>;
    transactions: IifTransactionData[];
}

function getItemValue(indexes: Map<string, number>, items: string[] | undefined, columnName: string): string {
    if (!items) {
        return '';
    }

    const index = indexes.get(columnName);

    if (index === undefined || index < 0 || index >= items.length) {
        return '';
    }

    return items[index] as string;
}

function buildColumnIndexes(items: string[]): Map<string, number> {
    const indexes = new Map<string, number>();

    for (let i = 1; i < items.length; i++) {
        indexes.set(items[i] as string, i);
    }

    return indexes;
}

function readIifData(ctx: Context, data: Buffer): [IifAccountDataset[], IifTransactionDataset[]] {
    const prefix = 'iif_data_reader.read';
    let records: string[][];

    try {
        records = readAllGoCsv(data.toString('utf8'), { comma: '\t' });
    } catch (err) {
        log.errorf(ctx, `[${prefix}] cannot parse tsv data, because ${(err as Error).message}`);
        throw errs.ErrInvalidIIFFile;
    }

    const allAccountDatasets: IifAccountDataset[] = [];
    const allTransactionDatasets: IifTransactionDataset[] = [];
    let currentDatasetType = '';
    let lastLineSign = '';
    let currentAccountDataset: IifAccountDataset | null = null;
    let currentTransactionDataset: IifTransactionDataset | null = null;
    let currentTransactionData: IifTransactionData | null = null;
    let index = 0;

    const readNext = (): string[] | null => (index < records.length ? records[index++] as string[] : null);

    while (true) {
        const items = readNext();

        if (items === null) {
            break;
        }

        if (items.length === 1 && items[0] === '') {
            continue;
        }

        const sign = items[0] as string;

        if (sign.length < 1) {
            log.errorf(ctx, `[${prefix}] line first column is empty`);
            throw errs.ErrInvalidIIFFile;
        }

        if (sign[0] === '!') {
            if (lastLineSign !== '') {
                log.errorf(ctx, `[${prefix}] iif missing transaction end line`);
                throw errs.ErrInvalidIIFFile;
            }

            if (currentAccountDataset) {
                allAccountDatasets.push(currentAccountDataset);
                currentAccountDataset = null;
            }

            if (currentTransactionDataset) {
                allTransactionDatasets.push(currentTransactionDataset);
                currentTransactionDataset = null;
            }

            if (sign === '!SPL' || sign === '!ENDTRNS') {
                log.errorf(ctx, `[${prefix}] read transaction split sample line or transaction end sample line sign before transaction sample line sign`);
                throw errs.ErrInvalidIIFFile;
            }

            currentDatasetType = sign;
            lastLineSign = '';

            if (currentDatasetType === '!ACCNT') {
                currentAccountDataset = { accountDataColumnIndexes: buildColumnIndexes(items), accounts: [] };
            } else if (currentDatasetType === '!TRNS') {
                const transactionDataColumnIndexes = buildColumnIndexes(items);
                const splitSampleItems = readNext();

                if (splitSampleItems === null) {
                    log.errorf(ctx, '[iif_data_reader.readTransactionSampleLines] expected reading transaction split sample line, but read eof');
                    throw errs.ErrInvalidIIFFile;
                }

                if (splitSampleItems.length < 1 || splitSampleItems[0] !== '!SPL') {
                    log.errorf(ctx, `[iif_data_reader.readTransactionSampleLines] expected reading transaction split sample line, but read "${splitSampleItems.join('\t')}"`);
                    throw errs.ErrInvalidIIFFile;
                }

                const transactionEndSampleItems = readNext();

                if (transactionEndSampleItems === null) {
                    log.errorf(ctx, '[iif_data_reader.readTransactionSampleLines] expected reading transaction end sample line, but read eof');
                    throw errs.ErrInvalidIIFFile;
                }

                if (transactionEndSampleItems.length < 1 || transactionEndSampleItems[0] !== '!ENDTRNS') {
                    log.errorf(ctx, `[iif_data_reader.readTransactionSampleLines] expected reading transaction end sample line, but read "${transactionEndSampleItems.join('\t')}"`);
                    throw errs.ErrInvalidIIFFile;
                }

                currentTransactionDataset = {
                    transactionDataColumnIndexes: transactionDataColumnIndexes,
                    splitDataColumnIndexes: buildColumnIndexes(splitSampleItems),
                    transactions: [],
                };
            }

            continue;
        }

        if (currentDatasetType === '') {
            log.errorf(ctx, `[${prefix}] cannot read data line before sample line`);
            throw errs.ErrInvalidIIFFile;
        } else if (currentDatasetType === '!ACCNT' && currentAccountDataset) {
            if (sign === 'ACCNT') {
                currentAccountDataset.accounts.push(items);
            } else {
                log.errorf(ctx, `[${prefix}] iif line expected reading account sign, but actual is "${sign}"`);
                throw errs.ErrInvalidIIFFile;
            }
        } else if (currentDatasetType === '!TRNS' && currentTransactionDataset) {
            if (lastLineSign === '') {
                if (sign === 'TRNS') {
                    currentTransactionData = { dataItems: items, splitData: [] };
                    lastLineSign = sign;
                } else {
                    log.errorf(ctx, `[${prefix}] iif line expected reading transaction sign, but actual is "${sign}"`);
                    throw errs.ErrInvalidIIFFile;
                }
            } else if (lastLineSign === 'TRNS' || lastLineSign === 'SPL') {
                if (sign === 'SPL') {
                    if (!currentTransactionData) {
                        log.errorf(ctx, `[${prefix}] expected current transaction data is not nil, but read "${sign}"`);
                        throw errs.ErrInvalidIIFFile;
                    }

                    currentTransactionData.splitData.push(items);
                    lastLineSign = sign;
                } else if (sign === 'ENDTRNS') {
                    if (!currentTransactionData) {
                        log.errorf(ctx, `[${prefix}] expected current transaction data is not nil, but read "${sign}"`);
                        throw errs.ErrInvalidIIFFile;
                    }

                    if (currentTransactionData.splitData.length < 1) {
                        log.errorf(ctx, `[${prefix}] expected reading transaction split line, but read "${sign}"`);
                        throw errs.ErrInvalidIIFFile;
                    }

                    currentTransactionDataset.transactions.push(currentTransactionData);
                    lastLineSign = '';
                } else {
                    log.errorf(ctx, `[${prefix}] iif line expected reading split sign or transaction end sign, but actual is "${sign}"`);
                    throw errs.ErrInvalidIIFFile;
                }
            } else {
                log.errorf(ctx, `[${prefix}] iif missing transaction sample end line`);
                throw errs.ErrInvalidIIFFile;
            }
        }
    }

    if (lastLineSign !== '') {
        log.errorf(ctx, `[${prefix}] iif missing transaction end line`);
        throw errs.ErrInvalidIIFFile;
    }

    if (currentAccountDataset) {
        allAccountDatasets.push(currentAccountDataset);
    }

    if (currentTransactionDataset) {
        allTransactionDatasets.push(currentTransactionDataset);
    }

    return [allAccountDatasets, allTransactionDatasets];
}

const modifyBalanceTypeName = String(TRANSACTION_TYPE_MODIFY_BALANCE);
const incomeTypeName = String(TRANSACTION_TYPE_INCOME);
const expenseTypeName = String(TRANSACTION_TYPE_EXPENSE);
const transferTypeName = String(TRANSACTION_TYPE_TRANSFER);

const iifTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, modifyBalanceTypeName],
    [TRANSACTION_TYPE_INCOME, incomeTypeName],
    [TRANSACTION_TYPE_EXPENSE, expenseTypeName],
    [TRANSACTION_TYPE_TRANSFER, transferTypeName],
]);

const iifTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

function parseIifAmount(amount: string): number {
    return parseAmountValue(amount.replaceAll(',', ''));
}

function parseTransactionTime(dataset: IifTransactionDataset, transactionData: IifTransactionData): string {
    const date = getItemValue(dataset.transactionDataColumnIndexes, transactionData.dataItems, 'DATE');
    const dateParts = date.split('/');

    if (dateParts.length !== 3) {
        throw errs.ErrTransactionTimeInvalid;
    }

    let [month, day, year] = dateParts as [string, string, string];

    if (isValidYearMonthDayLongOrShortDateFormat(date) && !isValidMonthDayYearLongOrShortDateFormat(date)) {
        [year, month, day] = dateParts as [string, string, string];
    }

    return formatYearMonthDayToLongDateTime(year, month, day);
}

class IifTransactionDataTable implements TransactionDataTable {
    public constructor(
        private readonly incomeAccountNames: Set<string>,
        private readonly expenseAccountNames: Set<string>,
        private readonly transactionDatasets: IifTransactionDataset[],
    ) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return iifTransactionSupportedColumns.has(column);
    }

    public transactionRowCount(): number {
        let total = 0;

        for (const dataset of this.transactionDatasets) {
            for (const transaction of dataset.transactions) {
                total += transaction.splitData.length;
            }
        }

        return total;
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const allDatasets = this.transactionDatasets;
        let currentDatasetIndex = 0;
        let currentIndexInDataset = 0;
        let currentSplitDataIndex = -1;

        return {
            hasNext: (): boolean => {
                if (currentDatasetIndex >= allDatasets.length) {
                    return false;
                }

                const currentDataset = allDatasets[currentDatasetIndex] as IifTransactionDataset;

                if (currentIndexInDataset + 1 < currentDataset.transactions.length) {
                    return true;
                } else if (currentIndexInDataset < currentDataset.transactions.length && currentSplitDataIndex + 1 < (currentDataset.transactions[currentIndexInDataset] as IifTransactionData).splitData.length) {
                    return true;
                }

                for (let i = currentDatasetIndex + 1; i < allDatasets.length; i++) {
                    if ((allDatasets[i] as IifTransactionDataset).transactions.length > 0) {
                        return true;
                    }
                }

                return false;
            },
            next: async (ctx: Context, user: User): Promise<TransactionDataRow | null> => {
                for (let i = currentDatasetIndex; i < allDatasets.length; i++) {
                    let foundNextRow = false;
                    const dataset = allDatasets[i] as IifTransactionDataset;

                    for (let j = currentIndexInDataset; j < dataset.transactions.length; j++) {
                        if (currentSplitDataIndex + 1 < (dataset.transactions[j] as IifTransactionData).splitData.length) {
                            currentSplitDataIndex++;
                            foundNextRow = true;
                            break;
                        }

                        currentIndexInDataset++;
                        currentSplitDataIndex = -1;
                    }

                    if (foundNextRow) {
                        break;
                    }

                    currentDatasetIndex++;
                    currentIndexInDataset = 0;
                    currentSplitDataIndex = -1;
                }

                if (currentDatasetIndex >= allDatasets.length) {
                    return null;
                }

                const currentDataset = allDatasets[currentDatasetIndex] as IifTransactionDataset;

                if (currentIndexInDataset >= currentDataset.transactions.length) {
                    return null;
                }

                const data = currentDataset.transactions[currentIndexInDataset] as IifTransactionData;

                if (data.splitData.length < 1) {
                    log.errorf(ctx, `[iif_transaction_data_table.Next] cannot parsing transaction in row#${currentIndexInDataset} (dataset#${currentDatasetIndex}), because split data is empty`);
                    throw errs.ErrInvalidIIFFile;
                }

                if (currentSplitDataIndex >= data.splitData.length) {
                    return null;
                }

                if (data.splitData.length > 1) {
                    this.checkSplitTransactionSupported(ctx, currentDataset, data, currentIndexInDataset, currentDatasetIndex);
                }

                let rowItems: RowData;

                try {
                    rowItems = this.parseTransaction(ctx, user, currentDataset, data, currentSplitDataIndex);
                } catch (err) {
                    log.errorf(ctx, `[iif_transaction_data_table.Next] cannot parsing transaction in row#${currentIndexInDataset}-split#${currentSplitDataIndex} (dataset#${currentDatasetIndex}), because ${(err as Error).message}`);
                    throw err;
                }

                return {
                    isValid: () => true,
                    getData: (column: TransactionDataTableColumn) => (iifTransactionSupportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                };
            },
        };
    }

    private checkSplitTransactionSupported(ctx: Context, dataset: IifTransactionDataset, transactionData: IifTransactionData, transactionIndex: number, datasetIndex: number): void {
        const prefix = 'iif_transaction_data_table.isSplitTransactionSupported';
        let supportSplitTransactions = true;
        const transactionType = getItemValue(dataset.transactionDataColumnIndexes, transactionData.dataItems, 'TRNSTYPE');

        if (transactionType === 'BEGINBALCHECK') {
            supportSplitTransactions = false;
            log.errorf(ctx, `[${prefix}] cannot parse split balance modification transaction#${transactionIndex} (dataset#${datasetIndex})`);
        } else {
            const transactionAmountStr = getItemValue(dataset.transactionDataColumnIndexes, transactionData.dataItems, 'AMOUNT');
            let transactionAmount: number;

            try {
                transactionAmount = parseIifAmount(transactionAmountStr);
            } catch {
                log.errorf(ctx, `[${prefix}] cannot parsing transaction in row#${transactionIndex} (dataset#${datasetIndex}), because transaction amount "${transactionAmountStr}" is invalid`);
                throw errs.ErrAmountInvalid;
            }

            let splitTotalAmount = 0;

            for (let i = 0; i < transactionData.splitData.length; i++) {
                const splitAmountStr = getItemValue(dataset.splitDataColumnIndexes, transactionData.splitData[i], 'AMOUNT');

                try {
                    splitTotalAmount += parseIifAmount(splitAmountStr);
                } catch {
                    log.errorf(ctx, `[${prefix}] cannot parsing transaction in row#${transactionIndex}-split#${i} (dataset#${datasetIndex}), because split amount "${splitAmountStr}" is invalid`);
                    throw errs.ErrAmountInvalid;
                }
            }

            if (splitTotalAmount !== -transactionAmount) {
                supportSplitTransactions = false;
                log.errorf(ctx, `[${prefix}] cannot parse split transaction#${transactionIndex} (dataset#${datasetIndex}), because the sum amount of each split data "${splitTotalAmount}" not equal to the transaction amount "${-transactionAmount}"`);
            }
        }

        if (transactionData.splitData.length > 1 && !supportSplitTransactions) {
            throw errs.ErrNotSupportedSplitTransactions;
        }
    }

    private parseTransaction(ctx: Context, _user: User, dataset: IifTransactionDataset, transactionData: IifTransactionData, splitDataIndex: number): RowData {
        const data: RowData = new Map();
        const split = transactionData.splitData[splitDataIndex];
        const mainValue = (columnName: string): string => getItemValue(dataset.transactionDataColumnIndexes, transactionData.dataItems, columnName);
        const splitValue = (columnName: string): string => getItemValue(dataset.splitDataColumnIndexes, split, columnName);
        const isIncome = (name: string): boolean => this.incomeAccountNames.has(name);
        const isExpense = (name: string): boolean => this.expenseAccountNames.has(name);
        const hasMultipleSplits = transactionData.splitData.length > 1;

        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, parseTransactionTime(dataset, transactionData));

        const transactionType = splitValue('TRNSTYPE');
        const mainAccountName = mainValue('ACCNT');
        const splitAccountName = splitValue('ACCNT');
        let mainAmountNum: number;
        let splitAmountNum: number;

        try {
            mainAmountNum = parseIifAmount(mainValue('AMOUNT'));
            splitAmountNum = parseIifAmount(splitValue('AMOUNT'));
        } catch {
            throw errs.ErrAmountInvalid;
        }

        const setCategory = (categoryName: string): void => {
            const categoryNames = categoryName.split(':');

            if (categoryNames.length > 1) {
                data.set(TRANSACTION_DATA_TABLE_CATEGORY, categoryNames[0] as string);
                data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, categoryNames[categoryNames.length - 1] as string);
            } else {
                data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, categoryName);
            }
        };

        if (transactionType === 'BEGINBALCHECK') {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, modifyBalanceTypeName);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, mainAccountName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(mainAmountNum));
        } else if ((isIncome(mainAccountName) && !isIncome(splitAccountName) && !isExpense(splitAccountName)) ||
            (isIncome(splitAccountName) && !isIncome(mainAccountName) && !isExpense(mainAccountName))) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeTypeName);
            let categoryName: string;
            let accountName: string;
            let amountNum: number;

            if (isIncome(mainAccountName) && !isIncome(splitAccountName)) {
                categoryName = mainAccountName;
                accountName = splitAccountName;
                amountNum = hasMultipleSplits ? splitAmountNum : -mainAmountNum;
            } else if (isIncome(splitAccountName) && !isIncome(mainAccountName)) {
                categoryName = splitAccountName;
                accountName = mainAccountName;
                amountNum = hasMultipleSplits ? -splitAmountNum : mainAmountNum;
            } else {
                log.errorf(ctx, `[iif_transaction_data_table.parseTransaction] cannot parse transaction, because main account "${mainAccountName}" and split account "${splitAccountName}" are all income account`);
                throw errs.ErrInvalidIIFFile;
            }

            setCategory(categoryName);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amountNum));
        } else if ((isExpense(mainAccountName) && !isExpense(splitAccountName) && !isIncome(splitAccountName)) ||
            (isExpense(splitAccountName) && !isExpense(mainAccountName) && !isIncome(mainAccountName))) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
            let categoryName: string;
            let accountName: string;
            let amountNum: number;

            if (isExpense(mainAccountName) && !isExpense(splitAccountName)) {
                categoryName = mainAccountName;
                accountName = splitAccountName;
                amountNum = hasMultipleSplits ? -splitAmountNum : mainAmountNum;
            } else if (isExpense(splitAccountName) && !isExpense(mainAccountName)) {
                categoryName = splitAccountName;
                accountName = mainAccountName;
                amountNum = hasMultipleSplits ? splitAmountNum : -mainAmountNum;
            } else {
                log.errorf(ctx, `[iif_transaction_data_table.parseTransaction] cannot parse transaction, because main account "${mainAccountName}" and split account "${splitAccountName}" are all expense account`);
                throw errs.ErrInvalidIIFFile;
            }

            setCategory(categoryName);
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amountNum));
        } else {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, transferTypeName);
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, '');
            let amountNum = 0;
            let relatedAmountNum = 0;
            let mainAccountTransferToSplitAccount = false;

            if (hasMultipleSplits) {
                amountNum = splitAmountNum;
                relatedAmountNum = splitAmountNum;
                mainAccountTransferToSplitAccount = amountNum >= 0;
            } else if (mainAmountNum >= 0) {
                amountNum = splitAmountNum;
                relatedAmountNum = mainAmountNum;
                mainAccountTransferToSplitAccount = false;
            } else if (splitAmountNum >= 0) {
                amountNum = mainAmountNum;
                relatedAmountNum = splitAmountNum;
                mainAccountTransferToSplitAccount = true;
            }

            if (mainAccountTransferToSplitAccount) {
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, mainAccountName);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, splitAccountName);
            } else {
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, splitAccountName);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, mainAccountName);
            }

            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amountNum >= 0 ? amountNum : -amountNum));
            data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, formatAmount(relatedAmountNum >= 0 ? relatedAmountNum : -relatedAmountNum));
        }

        const splitMemo = splitValue('MEMO');
        const memo = mainValue('MEMO');
        const splitName = splitValue('NAME');
        const name = mainValue('NAME');

        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, splitMemo !== '' ? splitMemo : memo !== '' ? memo : splitName !== '' ? splitName : name);

        return data;
    }
}

export const IifTransactionDataFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const [accountDatasets, transactionDatasets] = readIifData(ctx, data);

        if (transactionDatasets.length < 1) {
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const incomeAccountNames = new Set<string>();
        const expenseAccountNames = new Set<string>();

        for (const accountDataset of accountDatasets) {
            const nameIndex = accountDataset.accountDataColumnIndexes.get('NAME');
            const typeIndex = accountDataset.accountDataColumnIndexes.get('ACCNTTYPE');

            if (nameIndex === undefined || nameIndex < 0 || typeIndex === undefined || typeIndex < 0) {
                continue;
            }

            for (const items of accountDataset.accounts) {
                if (nameIndex >= items.length || typeIndex >= items.length) {
                    continue;
                }

                if (items[typeIndex] === 'INC') {
                    incomeAccountNames.add(items[nameIndex] as string);
                } else if (items[typeIndex] === 'EXP') {
                    expenseAccountNames.add(items[nameIndex] as string);
                }
            }
        }

        for (const transactionDataset of transactionDatasets) {
            for (const requiredColumnName of ['DATE', 'ACCNT', 'AMOUNT']) {
                if (!transactionDataset.transactionDataColumnIndexes.has(requiredColumnName)) {
                    throw errs.ErrMissingRequiredFieldInHeaderRow;
                }
            }
        }

        const transactionDataTable = new IifTransactionDataTable(incomeAccountNames, expenseAccountNames, transactionDatasets);
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(iifTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
