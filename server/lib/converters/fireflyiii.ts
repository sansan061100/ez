import * as errs from '../errs/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatTimezoneOffset, formatUnixTimeToLongDateTime, parseFromLongDateTimeWithTimezoneRFC3339Format } from '../utils/datetimes';
import { trimTrailingZerosInDecimal } from '../utils/numbers';
import { createNewImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import { createNewCsvBasicDataTable } from './csv';
import {
    createNewTransactionDataTableFromBasicDataTableWithRowParser,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRowParser,
    type TransactionDataTableColumn,
} from './datatable';

const columnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, 'date'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, 'type'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, 'category'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, 'source_name'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, 'currency_code'],
    [TRANSACTION_DATA_TABLE_AMOUNT, 'amount'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, 'destination_name'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, 'foreign_currency_code'],
    [TRANSACTION_DATA_TABLE_RELATED_AMOUNT, 'foreign_amount'],
    [TRANSACTION_DATA_TABLE_TAGS, 'tags'],
    [TRANSACTION_DATA_TABLE_DESCRIPTION, 'description'],
]);

const openingBalanceTypeName = 'Opening balance';
const depositTypeName = 'Deposit';
const withdrawalTypeName = 'Withdrawal';

const typeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, openingBalanceTypeName],
    [TRANSACTION_TYPE_INCOME, depositTypeName],
    [TRANSACTION_TYPE_EXPENSE, withdrawalTypeName],
    [TRANSACTION_TYPE_TRANSFER, 'Transfer'],
]);

const rowParser: TransactionDataRowParser = {
    getAddedColumns: () => [TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE],
    parse(data: RowData): [RowData, boolean] {
        const rowData: RowData = new Map(data);
        const get = (column: TransactionDataTableColumn): string => rowData.get(column) ?? '';
        const type = get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE);

        if (get(TRANSACTION_DATA_TABLE_SUB_CATEGORY) === '') {
            if (type === depositTypeName) {
                rowData.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME));
            } else if (type === withdrawalTypeName) {
                rowData.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, get(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME));
            }
        }

        if (get(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) !== '') {
            let dateTime;

            try {
                dateTime = parseFromLongDateTimeWithTimezoneRFC3339Format(get(TRANSACTION_DATA_TABLE_TRANSACTION_TIME));
            } catch {
                throw errs.ErrTransactionTimeInvalid;
            }

            const unixTime = Math.floor(dateTime.toSeconds());
            rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, formatUnixTimeToLongDateTime(unixTime, dateTime.zone));
            rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(unixTime, dateTime.zone));
        }

        const normalizeAmount = (column: TransactionDataTableColumn): void => {
            const trimmed = trimTrailingZerosInDecimal(get(column));
            let amount: number;

            try {
                amount = parseAmount(trimmed);
            } catch {
                throw errs.ErrAmountInvalid;
            }

            rowData.set(column, formatAmount(type === withdrawalTypeName ? -amount : amount));
        };

        if (get(TRANSACTION_DATA_TABLE_AMOUNT) !== '') {
            normalizeAmount(TRANSACTION_DATA_TABLE_AMOUNT);
        }

        if (get(TRANSACTION_DATA_TABLE_RELATED_AMOUNT) !== '') {
            normalizeAmount(TRANSACTION_DATA_TABLE_RELATED_AMOUNT);
        } else {
            rowData.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, get(TRANSACTION_DATA_TABLE_AMOUNT));
        }

        if (get(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY) === '') {
            rowData.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY));
        }

        if (type === openingBalanceTypeName || type === depositTypeName) {
            rowData.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, get(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME));
        }

        return [rowData, true];
    },
};

export const FireflyIIITransactionDataCsvFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const dataTable = createNewCsvBasicDataTable(ctx, data.toString('utf8'), true);
        const transactionDataTable = createNewTransactionDataTableFromBasicDataTableWithRowParser(dataTable, columnNameMapping, rowParser);
        const dataTableImporter = createNewImporterWithTypeNameMapping(typeNameMapping, '', '', ',');
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
