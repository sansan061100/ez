import type { Context } from '../core/context';
import * as errs from '../errs/index';
import {
    type Account,
    type Transaction,
    type TransactionCategory,
    type TransactionTag,
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_MODIFY_BALANCE,
    TRANSACTION_TYPE_TRANSFER,
    type User,
} from '../models/index';
import { stringToInt } from '../utils/converter';
import { fixedZone, formatTimezoneOffset, type Timezone } from '../utils/datetimes';
import { goJsonField, goJsonUnmarshalObject } from '../utils/gojson';
import {
    type AccountNameMap,
    type CategoryNameMap,
    createNewExporter,
    createNewImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TagNameMap,
    TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE,
    type TransactionDataExporter,
    type TransactionDataImporter,
    type TransactionDataImporterOptions,
    type TransactionTypeNameMapping,
} from './converter';
import {
    type BasicDataTable,
    type BasicDataTableRow,
    type BasicDataTableRowIterator,
    createNewTransactionDataTableFromBasicDataTable,
    createNewWritableTransactionDataTable,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTable,
    type TransactionDataTableBuilder,
    type TransactionDataTableColumn,
} from './datatable';

const ezbookkeepingLineSeparator = '\n';
const ezbookkeepingGeoLocationSeparator = ' ';
const ezbookkeepingGeoLocationOrder = TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE;
const ezbookkeepingTagSeparator = ';';

const ezbookkeepingDataColumnNameMapping = new Map<TransactionDataTableColumn, string>([
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, 'Time'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, 'Timezone'],
    [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, 'Type'],
    [TRANSACTION_DATA_TABLE_CATEGORY, 'Category'],
    [TRANSACTION_DATA_TABLE_SUB_CATEGORY, 'Sub Category'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, 'Account'],
    [TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, 'Account Currency'],
    [TRANSACTION_DATA_TABLE_AMOUNT, 'Amount'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, 'Account2'],
    [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, 'Account2 Currency'],
    [TRANSACTION_DATA_TABLE_RELATED_AMOUNT, 'Account2 Amount'],
    [TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION, 'Geographic Location'],
    [TRANSACTION_DATA_TABLE_TAGS, 'Tags'],
    [TRANSACTION_DATA_TABLE_DESCRIPTION, 'Description'],
]);

export const ezbookkeepingTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, 'Balance Modification'],
    [TRANSACTION_TYPE_INCOME, 'Income'],
    [TRANSACTION_TYPE_EXPENSE, 'Expense'],
    [TRANSACTION_TYPE_TRANSFER, 'Transfer'],
]);

const ezbookkeepingDataColumns: TransactionDataTableColumn[] = [
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
    TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
];

// default plain text data table (split by line separator and column separator)
class DefaultPlainTextDataTable implements BasicDataTable {
    public constructor(private readonly columnSeparator: string, private readonly allLines: string[], private readonly headerLineColumnNames: string[]) {
    }

    public dataRowCount(): number {
        return this.allLines.length < 1 ? 0 : this.allLines.length - 1;
    }

    public headerColumnNames(): string[] {
        return this.headerLineColumnNames;
    }

    public dataRowIterator(): BasicDataTableRowIterator {
        let currentIndex = 0;

        return {
            hasNext: () => currentIndex + 1 < this.allLines.length,
            currentRowId: () => `line#${currentIndex}`,
            next: (): BasicDataTableRow | null => {
                if (currentIndex + 1 >= this.allLines.length) {
                    return null;
                }

                currentIndex++;
                const rowItems = (this.allLines[currentIndex] as string).split(this.columnSeparator);

                return {
                    columnCount: () => rowItems.length,
                    getData: (columnIndex: number) => (columnIndex < rowItems.length ? rowItems[columnIndex] as string : ''),
                };
            },
        };
    }
}

function createNewDefaultPlainTextDataTable(content: string, columnSeparator: string, lineSeparator: string): DefaultPlainTextDataTable {
    const allLines = content.split(lineSeparator);

    if (allLines.length < 2) {
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    const headerLine = (allLines[0] as string).replaceAll('\r', '');
    return new DefaultPlainTextDataTable(columnSeparator, allLines, headerLine.split(columnSeparator));
}

// default plain text data table builder
class DefaultTransactionPlainTextDataTableBuilder implements TransactionDataTableBuilder {
    private content = '';

    public constructor(
        private readonly columns: TransactionDataTableColumn[],
        private readonly dataColumnNameMapping: Map<TransactionDataTableColumn, string>,
        private readonly columnSeparator: string,
        private readonly lineSeparator: string,
    ) {
        this.content = this.columns.map(column => this.dataColumnNameMapping.get(column) ?? '').join(this.columnSeparator) + this.lineSeparator;
    }

    public appendTransaction(data: RowData): void {
        this.content += this.columns.map(column => data.get(column) ?? '').join(this.columnSeparator) + this.lineSeparator;
    }

    public replaceDelimiters(text: string): string {
        return text
            .replaceAll('\r\n', ' ')
            .replaceAll('\r', ' ')
            .replaceAll('\n', ' ')
            .split(this.columnSeparator).join(' ')
            .split(this.lineSeparator).join(' ');
    }

    public toString(): string {
        return this.content;
    }
}

// DefaultTransactionDataPlainTextConverter defines the structure of ezbookkeeping default csv / tsv converter
class DefaultTransactionDataPlainTextConverter implements TransactionDataExporter, TransactionDataImporter {
    public constructor(private readonly columnSeparator: string) {
    }

    public async toExportedContent(ctx: Context, uid: bigint, transactions: Transaction[], accountMap: Map<bigint, Account>, categoryMap: Map<bigint, TransactionCategory>, tagMap: Map<bigint, TransactionTag>, allTagIndexes: Map<bigint, bigint[]>): Promise<Buffer> {
        const dataTableBuilder = new DefaultTransactionPlainTextDataTableBuilder(ezbookkeepingDataColumns, ezbookkeepingDataColumnNameMapping, this.columnSeparator, ezbookkeepingLineSeparator);
        const dataTableExporter = createNewExporter(ezbookkeepingTransactionTypeNameMapping, ezbookkeepingGeoLocationSeparator, ezbookkeepingTagSeparator);
        dataTableExporter.buildExportedContent(ctx, dataTableBuilder, uid, transactions, accountMap, categoryMap, tagMap, allTagIndexes);
        return Buffer.from(dataTableBuilder.toString(), 'utf8');
    }

    public async parseImportedData(ctx: Context, user: User, data: Buffer, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
        const dataTable = createNewDefaultPlainTextDataTable(data.toString('utf8'), this.columnSeparator, ezbookkeepingLineSeparator);
        const transactionDataTable = createNewTransactionDataTableFromBasicDataTable(dataTable, ezbookkeepingDataColumnNameMapping);
        const dataTableImporter = createNewImporterWithTypeNameMapping(ezbookkeepingTransactionTypeNameMapping, ezbookkeepingGeoLocationSeparator, ezbookkeepingGeoLocationOrder, ezbookkeepingTagSeparator);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    }
}

export const DefaultTransactionDataCSVFileConverter = new DefaultTransactionDataPlainTextConverter(',');
export const DefaultTransactionDataTSVFileConverter = new DefaultTransactionDataPlainTextConverter('\t');

const allJsonDataSupportedColumns: TransactionDataTableColumn[] = [
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION,
    TRANSACTION_DATA_TABLE_TAGS,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
];

function jsonStringField(item: Record<string, unknown>, key: string): string {
    const value = goJsonField(item, key);

    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value !== 'string') {
        throw errs.ErrInvalidJSONFile;
    }

    return value;
}

// DefaultTransactionDataJsonImporter defines the structure of ezbookkeeping json importer
class DefaultTransactionDataJsonImporter implements TransactionDataImporter {
    public async parseImportedData(ctx: Context, user: User, data: Buffer, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
        let items: Record<string, unknown>[] | null = null;

        try {
            const request = goJsonUnmarshalObject(data.toString('utf8'), 'models.ImportTransactionRequest');
            const transactions = request ? goJsonField(request, 'Transactions') : null;

            if (transactions !== undefined && transactions !== null) {
                if (!Array.isArray(transactions)) {
                    throw errs.ErrInvalidJSONFile;
                }

                items = transactions.map(item => {
                    if (item === null) {
                        return {};
                    }

                    if (typeof item !== 'object' || Array.isArray(item)) {
                        throw errs.ErrInvalidJSONFile;
                    }

                    return item as Record<string, unknown>;
                });

                // validate the types of fields
                for (const item of items) {
                    for (const key of ['time', 'utcOffset', 'type', 'categoryName', 'sourceAccountName', 'destinationAccountName', 'sourceAmount', 'destinationAmount', 'geoLocation', 'tagNames', 'comment']) {
                        jsonStringField(item, key);
                    }
                }
            }
        } catch {
            throw errs.ErrInvalidJSONFile;
        }

        const transactionDataTable = this.createNewDefaultTransactionDataTable(items);
        const dataTableImporter = createNewImporterWithTypeNameMapping(ezbookkeepingTransactionTypeNameMapping, ezbookkeepingGeoLocationSeparator, ezbookkeepingGeoLocationOrder, ezbookkeepingTagSeparator);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    }

    private createNewDefaultTransactionDataTable(items: Record<string, unknown>[] | null): TransactionDataTable {
        const transactionDataTable = createNewWritableTransactionDataTable(allJsonDataSupportedColumns);

        if (!items || items.length < 1) {
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        for (const item of items) {
            let utcOffset: number;

            try {
                utcOffset = stringToInt(jsonStringField(item, 'utcOffset'));
            } catch {
                throw errs.ErrTransactionTimeZoneInvalid;
            }

            const timezoneOffset = formatTimezoneOffset(Math.floor(Date.now() / 1000), fixedZone(utcOffset));

            transactionDataTable.add(new Map([
                [TRANSACTION_DATA_TABLE_TRANSACTION_TIME, jsonStringField(item, 'time')],
                [TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, timezoneOffset],
                [TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, jsonStringField(item, 'type')],
                [TRANSACTION_DATA_TABLE_SUB_CATEGORY, jsonStringField(item, 'categoryName')],
                [TRANSACTION_DATA_TABLE_ACCOUNT_NAME, jsonStringField(item, 'sourceAccountName')],
                [TRANSACTION_DATA_TABLE_AMOUNT, jsonStringField(item, 'sourceAmount')],
                [TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, jsonStringField(item, 'destinationAccountName')],
                [TRANSACTION_DATA_TABLE_RELATED_AMOUNT, jsonStringField(item, 'destinationAmount')],
                [TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION, jsonStringField(item, 'geoLocation')],
                [TRANSACTION_DATA_TABLE_TAGS, jsonStringField(item, 'tagNames')],
                [TRANSACTION_DATA_TABLE_DESCRIPTION, jsonStringField(item, 'comment')],
            ]));
        }

        return transactionDataTable;
    }
}

export const DefaultTransactionDataJsonFileImporter = new DefaultTransactionDataJsonImporter();
