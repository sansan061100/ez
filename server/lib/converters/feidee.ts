import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER, type TransactionType } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { decodeWithBOMOverride } from '../utils/encodings';
import { isValidLongDateFormat, isValidLongDateTimeFormat, isValidLongDateTimeWithoutSecondFormat } from '../utils/validators';
import { trimSpaces } from './chinese_extractor';
import {
    createNewSimpleImporter,
    createNewSimpleImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TransactionDataImporter,
    type TransactionTypeNameMapping,
} from './converter';
import { createNewCsvBasicDataTable, createNewCustomCsvBasicDataTable } from './csv';
import {
    type BasicDataTable,
    type CommonDataTable,
    createNewCommonDataTableFromBasicDataTable,
    createNewMergedTransactionDataTable,
    createNewTransactionDataTableFromBasicDataTableWithRowParser,
    createNewWritableTransactionDataTableWithRowParser,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_MEMBER,
    TRANSACTION_DATA_TABLE_MERCHANT,
    TRANSACTION_DATA_TABLE_PROJECT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRowParser,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';
import { createNewExcelMSCFBFileBasicDataTables, createNewExcelOOXMLFileBasicDataTable } from './excel';

const modifyBalanceName = '余额变更';
const incomeName = '收入';
const expenseName = '支出';
const transferName = '转账';
const modifyOutstandingBalanceName = '负债变更';
const debtModificationName = '债务变更';
const receivableModificationName = '债权变更';

const feideeMymoneyTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, modifyBalanceName],
    [TRANSACTION_TYPE_INCOME, incomeName],
    [TRANSACTION_TYPE_EXPENSE, expenseName],
    [TRANSACTION_TYPE_TRANSFER, transferName],
]);

function getLongDateTime(str: string): string {
    if (isValidLongDateTimeFormat(str)) {
        return str;
    }

    if (isValidLongDateTimeWithoutSecondFormat(str)) {
        return str + ':00';
    }

    if (isValidLongDateFormat(str)) {
        return str + ' 00:00:00';
    }

    return str;
}

// convertBalanceModification converts the balance modification to income or expense by the sign of amount
function convertBalanceModification(rowData: RowData, positiveType: string, negativeType: string): void {
    let amount: number;

    try {
        amount = parseAmount(rowData.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
    } catch {
        throw errs.ErrAmountInvalid;
    }

    if (amount >= 0) {
        rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, positiveType);
    } else {
        rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, negativeType);
        rowData.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
    }
}

const feideeMymoneyTransactionDataRowParser: TransactionDataRowParser = {
    getAddedColumns: () => [],
    parse(data: RowData): [RowData, boolean] {
        const rowData: RowData = new Map(data);

        if ((rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) ?? '') !== '') {
            rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, getLongDateTime(rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) as string));
        }

        const type = rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ?? '';

        if (type === modifyBalanceName) {
            convertBalanceModification(rowData, incomeName, expenseName);
        } else if (type === modifyOutstandingBalanceName) {
            convertBalanceModification(rowData, expenseName, incomeName);
        } else if (type === debtModificationName) {
            convertBalanceModification(rowData, expenseName, incomeName);
        } else if (type === receivableModificationName) {
            convertBalanceModification(rowData, incomeName, expenseName);
        }

        return [rowData, true];
    },
};

// Feidee MyMoney app csv
const feideeMymoneyAppTransactionDataCsvFileHeader = '随手记导出文件(headers:v5;';
const appTimeColumnName = '日期';
const appTypeColumnName = '交易类型';
const appCategoryColumnName = '类别';
const appSubCategoryColumnName = '子类别';
const appAccountNameColumnName = '账户';
const appAccountCurrencyColumnName = '账户币种';
const appAmountColumnName = '金额';
const appDescriptionColumnName = '备注';
const appRelatedIdColumnName = '关联Id';
const appMemberColumnName = '成员';
const appProjectColumnName = '项目';
const appMerchantColumnName = '商家';

const appTypeModifyBalanceText = '余额变更';
const appTypeModifyOutstandingBalanceText = '负债变更';
const appTypeIncomeText = '收入';
const appTypeExpenseText = '支出';
const appTypeTransferInText = '转入';
const appTypeTransferOutText = '转出';

const feideeMymoneyAppDataColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, appTimeColumnName],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, appTypeColumnName],
    [TRANSACTION_DATA_TABLE_CATEGORY, appCategoryColumnName],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, appSubCategoryColumnName],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, appAccountNameColumnName],
    [TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, appAccountCurrencyColumnName],
    [TRANSACTION_DATA_TABLE_AMOUNT, appAmountColumnName],
    [TRANSACTION_DATA_TABLE_DESCRIPTION, appDescriptionColumnName],
    [TRANSACTION_DATA_TABLE_MEMBER, appMemberColumnName],
    [TRANSACTION_DATA_TABLE_PROJECT, appProjectColumnName],
    [TRANSACTION_DATA_TABLE_MERCHANT, appMerchantColumnName],
]);

function createNewFeideeMymoneyAppTransactionBasicDataTable(ctx: Context, originalDataTable: BasicDataTable): BasicDataTable {
    const prefix = 'feidee_mymoney_app_transaction_data_extrator.createNewFeideeMymoneyAppTransactionBasicDataTable';
    const iterator = originalDataTable.dataRowIterator();
    const allOriginalLines: string[][] = [];
    let hasFileHeader = false;

    while (iterator.hasNext()) {
        const row = iterator.next();

        if (!row) {
            break;
        }

        if (!hasFileHeader) {
            if (row.columnCount() <= 0) {
                continue;
            } else if (row.getData(0).indexOf(feideeMymoneyAppTransactionDataCsvFileHeader) === 0) {
                hasFileHeader = true;
                continue;
            } else {
                log.warnf(ctx, `[${prefix}] read unexpected line in row "${iterator.currentRowId()}" before read file header`);
                continue;
            }
        }

        const items: string[] = [];

        for (let i = 0; i < row.columnCount(); i++) {
            items.push(trimSpaces(row.getData(i)));
        }

        allOriginalLines.push(items);
    }

    if (!hasFileHeader) {
        throw errs.ErrInvalidFileHeader;
    }

    if (allOriginalLines.length < 2) {
        log.errorf(ctx, `[${prefix}] cannot parse import data, because data table row count is less 1`);
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    return createNewCustomCsvBasicDataTable(allOriginalLines, true);
}

function createNewFeideeMymoneyAppTransactionDataTable(ctx: Context, commonDataTable: CommonDataTable): TransactionDataTable {
    const prefix = 'feidee_mymoney_app_transaction_data_csv_file_importer.createNewFeideeMymoneyAppTransactionDataTable';
    const hasCurrency = commonDataTable.hasColumn(appAccountCurrencyColumnName);
    const newColumns: TransactionDataTableColumn[] = [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, TRANSACTION_DATA_TABLE_TRANSACTION_TIME];

    if (commonDataTable.hasColumn(appCategoryColumnName)) {
        newColumns.push(TRANSACTION_DATA_TABLE_CATEGORY);
    }

    newColumns.push(TRANSACTION_DATA_TABLE_SUB_CATEGORY, TRANSACTION_DATA_TABLE_ACCOUNT_NAME);

    if (hasCurrency) {
        newColumns.push(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY);
    }

    newColumns.push(TRANSACTION_DATA_TABLE_AMOUNT, TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME);

    if (hasCurrency) {
        newColumns.push(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY);
    }

    newColumns.push(TRANSACTION_DATA_TABLE_RELATED_AMOUNT);

    for (const [columnName, column] of [[appDescriptionColumnName, TRANSACTION_DATA_TABLE_DESCRIPTION], [appMemberColumnName, TRANSACTION_DATA_TABLE_MEMBER], [appProjectColumnName, TRANSACTION_DATA_TABLE_PROJECT], [appMerchantColumnName, TRANSACTION_DATA_TABLE_MERCHANT]] as [string, number][]) {
        if (commonDataTable.hasColumn(columnName)) {
            newColumns.push(column);
        }
    }

    const transactionDataTable = createNewWritableTransactionDataTableWithRowParser(newColumns, feideeMymoneyTransactionDataRowParser);
    const transferTransactionsMap = new Map<string, RowData>();
    const iterator = commonDataTable.dataRowIterator();

    while (iterator.hasNext()) {
        const dataRow = iterator.next();

        if (!dataRow) {
            break;
        }

        const rowId = iterator.currentRowId();

        if (dataRow.columnCount() < commonDataTable.headerColumnCount()) {
            log.errorf(ctx, `[${prefix}] cannot parse row "${rowId}", because may missing some columns (column count ${dataRow.columnCount()} in data row is less than header column count ${commonDataTable.headerColumnCount()})`);
            throw errs.ErrFewerFieldsInDataRowThanInHeaderRow;
        }

        const data: RowData = new Map();

        for (const [columnType, columnName] of feideeMymoneyAppDataColumnNameMapping) {
            if (dataRow.hasData(columnName)) {
                data.set(columnType, dataRow.getData(columnName));
            }
        }

        const transactionType = data.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ?? '';

        if (transactionType === appTypeModifyBalanceText || transactionType === appTypeModifyOutstandingBalanceText || transactionType === appTypeIncomeText || transactionType === appTypeExpenseText) {
            if (transactionType === appTypeModifyBalanceText) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, modifyBalanceName);
            } else if (transactionType === appTypeModifyOutstandingBalanceText) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, modifyOutstandingBalanceName);
            } else if (transactionType === appTypeIncomeText) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeName);
            } else {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseName);
            }

            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, '');
            data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, '');
            transactionDataTable.add(data);
        } else if (transactionType === appTypeTransferInText || transactionType === appTypeTransferOutText) {
            const relatedId = dataRow.hasData(appRelatedIdColumnName) ? dataRow.getData(appRelatedIdColumnName) : '';

            if (relatedId === '') {
                log.errorf(ctx, `[${prefix}] transfer transaction has blank related id in row "${rowId}"`);
                throw errs.ErrRelatedIdCannotBeBlank;
            }

            const relatedData = transferTransactionsMap.get(relatedId);

            if (!relatedData) {
                transferTransactionsMap.set(relatedId, data);
                continue;
            }

            const relatedType = relatedData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ?? '';

            if (transactionType === appTypeTransferInText && relatedType === appTypeTransferOutText) {
                relatedData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, transferName);
                relatedData.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) ?? '');
                relatedData.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) ?? '');
                relatedData.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
                transactionDataTable.add(relatedData);
                transferTransactionsMap.delete(relatedId);
            } else if (transactionType === appTypeTransferOutText && relatedType === appTypeTransferInText) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, transferName);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, relatedData.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) ?? '');
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, relatedData.get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) ?? '');
                data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, relatedData.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
                transactionDataTable.add(data);
                transferTransactionsMap.delete(relatedId);
            } else {
                log.errorf(ctx, `[${prefix}] transfer transaction type "${transactionType}" is not expected in row "${rowId}"`);
                throw errs.ErrTransactionTypeInvalid;
            }
        } else {
            log.errorf(ctx, `[${prefix}] cannot parse transaction type "${transactionType}" in row "${rowId}"`);
            throw errs.ErrTransactionTypeInvalid;
        }
    }

    if (transferTransactionsMap.size > 0) {
        log.errorf(ctx, `[${prefix}] there are ${transferTransactionsMap.size} transactions (related id is ${Array.from(transferTransactionsMap.keys()).join(',')}) which don't have related records`);
        throw errs.ErrFoundRecordNotHasRelatedRecord;
    }

    return transactionDataTable;
}

export const FeideeMymoneyAppTransactionDataCsvFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const csvDataTable = createNewCsvBasicDataTable(ctx, decodeWithBOMOverride(data), false);
        const dataTable = createNewFeideeMymoneyAppTransactionBasicDataTable(ctx, csvDataTable);
        const commonDataTable = createNewCommonDataTableFromBasicDataTable(dataTable);

        if (!commonDataTable.hasColumn(appTimeColumnName) ||
            !commonDataTable.hasColumn(appTypeColumnName) ||
            !commonDataTable.hasColumn(appSubCategoryColumnName) ||
            !commonDataTable.hasColumn(appAccountNameColumnName) ||
            !commonDataTable.hasColumn(appAmountColumnName) ||
            !commonDataTable.hasColumn(appRelatedIdColumnName)) {
            log.errorf(ctx, '[feidee_mymoney_app_transaction_data_csv_file_importer.ParseImportedData] cannot parse import data, because missing essential columns in header row');
            throw errs.ErrMissingRequiredFieldInHeaderRow;
        }

        const transactionDataTable = createNewFeideeMymoneyAppTransactionDataTable(ctx, commonDataTable);
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(feideeMymoneyTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};

// Feidee MyMoney elecloud xlsx
const elecloudModifyBalanceName = '余额变更';
const elecloudOutstandingModifyBalanceName = '负债变更';
const elecloudIncomeName = '收入';
const elecloudExpenseName = '支出';

const feideeMymoneyElecloudTransactionTypeNameMapping = new Map<string, TransactionType>([
    [elecloudModifyBalanceName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [elecloudOutstandingModifyBalanceName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [elecloudIncomeName, TRANSACTION_TYPE_INCOME],
    [elecloudExpenseName, TRANSACTION_TYPE_EXPENSE],
    ['转账', TRANSACTION_TYPE_TRANSFER],
    ['借入', TRANSACTION_TYPE_TRANSFER],
    ['借出', TRANSACTION_TYPE_TRANSFER],
    ['收债', TRANSACTION_TYPE_TRANSFER],
    ['还债', TRANSACTION_TYPE_TRANSFER],
    ['代付', TRANSACTION_TYPE_TRANSFER],
    ['报销', TRANSACTION_TYPE_TRANSFER],
    ['退款', TRANSACTION_TYPE_EXPENSE],
]);

const feideeMymoneyElecloudDataColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_CATEGORY, '分类'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, '子分类'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '账户1'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, '账户币种'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '账户2'],
    [TRANSACTION_DATA_TABLE_DESCRIPTION, '备注'],
    [TRANSACTION_DATA_TABLE_MEMBER, '成员'],
    [TRANSACTION_DATA_TABLE_PROJECT, '项目'],
    [TRANSACTION_DATA_TABLE_MERCHANT, '商家'],
]);

const feideeMymoneyElecloudTransactionDataRowParser: TransactionDataRowParser = {
    getAddedColumns: () => [],
    parse(data: RowData): [RowData, boolean] {
        const rowData: RowData = new Map(data);
        rowData.set(TRANSACTION_DATA_TABLE_AMOUNT, (rowData.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '').replaceAll(',', ''));
        const type = rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ?? '';

        if (type === elecloudModifyBalanceName) {
            convertBalanceModification(rowData, elecloudIncomeName, elecloudExpenseName);
        } else if (type === elecloudOutstandingModifyBalanceName) {
            convertBalanceModification(rowData, elecloudExpenseName, elecloudIncomeName);
        }

        return [rowData, true];
    },
};

export const FeideeMymoneyElecloudTransactionDataXlsxFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const dataTable = createNewExcelOOXMLFileBasicDataTable(data, true);
        const transactionDataTable = createNewTransactionDataTableFromBasicDataTableWithRowParser(dataTable, feideeMymoneyElecloudDataColumnNameMapping, feideeMymoneyElecloudTransactionDataRowParser);
        const dataTableImporter = createNewSimpleImporter(feideeMymoneyElecloudTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};

// Feidee MyMoney web xls
const webLegacyColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_CATEGORY, '分类'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, '子分类'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '账户1'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '账户2'],
    [TRANSACTION_DATA_TABLE_DESCRIPTION, '备注'],
    [TRANSACTION_DATA_TABLE_MEMBER, '成员'],
    [TRANSACTION_DATA_TABLE_PROJECT, '项目'],
    [TRANSACTION_DATA_TABLE_MERCHANT, '商家'],
]);

const webCommonColumns: [TransactionDataTableColumn, string][] = [
    [TRANSACTION_DATA_TABLE_DESCRIPTION, '备注'],
    [TRANSACTION_DATA_TABLE_MEMBER, '成员'],
    [TRANSACTION_DATA_TABLE_MERCHANT, '商家'],
    [TRANSACTION_DATA_TABLE_PROJECT, '项目'],
];

const webExpenseColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_CATEGORY, '一级分类'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, '二级分类'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '支出账户'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    ...webCommonColumns,
]);

const webIncomeColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_CATEGORY, '一级分类'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, '二级分类'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '收入账户'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    ...webCommonColumns,
]);

const webTransferColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '转出账户'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '转入账户'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    ...webCommonColumns,
]);

const webBalanceModificationColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, '日期'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, '交易类型'],
    [TRANSACTION_DATA_TABLE_CATEGORY, '一级分类'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, '二级分类'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '账户1'],
    [TRANSACTION_DATA_TABLE_AMOUNT, '金额'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '账户2'],
    ...webCommonColumns,
]);

const feideeMymoneyWebTransactionTypeNames = new Map<string, TransactionType>([
    [modifyBalanceName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [modifyOutstandingBalanceName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [debtModificationName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [receivableModificationName, TRANSACTION_TYPE_MODIFY_BALANCE],
    [incomeName, TRANSACTION_TYPE_INCOME],
    [expenseName, TRANSACTION_TYPE_EXPENSE],
    [transferName, TRANSACTION_TYPE_TRANSFER],
]);

function getFeideeMymoneyWebColumnNameMapping(headerColumns: string[]): Map<TransactionDataTableColumn, string> {
    const headerSet = new Set(headerColumns);

    if (headerSet.has('转出账户')) {
        return webTransferColumnNameMapping;
    } else if (headerSet.has('一级分类')) {
        if (headerSet.has('支出账户')) {
            return webExpenseColumnNameMapping;
        }

        if (headerSet.has('收入账户')) {
            return webIncomeColumnNameMapping;
        }

        return webBalanceModificationColumnNameMapping;
    }

    return webLegacyColumnNameMapping;
}

export const FeideeMymoneyWebTransactionDataXlsFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const dataTables = createNewExcelMSCFBFileBasicDataTables(data, true);
        const transactionDataTables = dataTables.map(dataTable => createNewTransactionDataTableFromBasicDataTableWithRowParser(dataTable, getFeideeMymoneyWebColumnNameMapping(dataTable.headerColumnNames()), feideeMymoneyTransactionDataRowParser));
        const mergedTransactionDataTable = createNewMergedTransactionDataTable(transactionDataTables);
        const dataTableImporter = createNewSimpleImporter(feideeMymoneyWebTransactionTypeNames);
        return dataTableImporter.parseImportedData(ctx, user, mergedTransactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
