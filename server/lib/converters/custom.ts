import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER, type TransactionType, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatTimezoneOffset, formatUnixTimeToLongDateTime, loadLocation, type Timezone } from '../utils/datetimes';
import { decodeWithFileEncoding, isSupportedFileEncoding } from '../utils/encodings';
import { parseGoTime } from '../utils/golayout';
import { GoCsvParseError, readAllGoCsv } from '../utils/gocsv';
import { trimTrailingZerosInDecimal } from '../utils/numbers';
import {
    type AccountNameMap,
    type CategoryNameMap,
    createNewImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TagNameMap,
    TRANSACTION_GEO_LOCATION_ORDER_LATITUDE_LONGITUDE,
    TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE,
    type TransactionDataImporter,
    type TransactionDataImporterOptions,
    type TransactionGeoLocationOrder,
    type TransactionTypeNameMapping,
} from './converter';
import { createNewCustomCsvBasicDataTable } from './csv';
import {
    type BasicDataTable,
    type BasicDataTableRow,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
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
import { createNewExcelMSCFBFileBasicDataTable, createNewExcelOOXMLFileBasicDataTable } from './excel';

// CustomTransactionDataParser defines the structure of custom transaction data parser
export interface CustomTransactionDataParser {
    parseDataLines(ctx: Context, data: Buffer): string[][];
}

const supportedFileTypeSeparators: Record<string, string> = {
    custom_csv: ',',
    custom_tsv: '\t',
    custom_ssv: ';',
};

const customOOXMLExcelFileType = 'custom_xlsx';
const customMSCFBExcelFileType = 'custom_xls';

const customTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, String(TRANSACTION_TYPE_MODIFY_BALANCE)],
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

// trimSpaces trims the leading and trailing spaces like go strings.Trim(s, " ")
function trimSpaces(s: string): string {
    return s.replace(/^ +| +$/g, '');
}

interface CustomImporterSettings {
    columnIndexMapping: Map<TransactionDataTableColumn, number>;
    transactionTypeNameMapping: Map<string, TransactionType>;
    hasHeaderLine: boolean;
    timeFormat: string;
    timezoneFormat: string;
    amountDecimalSeparator: string;
    amountDigitGroupingSymbol: string;
    geoLocationSeparator: string;
    geoLocationOrder: TransactionGeoLocationOrder;
    transactionTagSeparator: string;
}

abstract class CustomTransactionDataImporterBase implements CustomTransactionDataParser, TransactionDataImporter {
    public constructor(protected readonly settings: CustomImporterSettings | null) {
    }

    public abstract parseDataLines(ctx: Context, data: Buffer): string[][];

    public async parseImportedData(ctx: Context, user: User, data: Buffer, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
        const settings = this.settings as CustomImporterSettings;
        const allLines = this.parseDataLines(ctx, data);
        const dataTable = createNewCustomCsvBasicDataTable(allLines, settings.hasHeaderLine);
        const transactionDataTable = createNewCustomPlainTextDataTable(dataTable, settings.columnIndexMapping, settings.transactionTypeNameMapping, settings.timeFormat, settings.timezoneFormat, settings.amountDecimalSeparator, settings.amountDigitGroupingSymbol);
        const dataTableImporter = createNewImporterWithTypeNameMapping(customTransactionTypeNameMapping, settings.geoLocationSeparator, settings.geoLocationOrder, settings.transactionTagSeparator);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    }
}

class CustomTransactionDataDsvFileImporter extends CustomTransactionDataImporterBase {
    public constructor(private readonly fileEncoding: string, private readonly separator: string, settings: CustomImporterSettings | null) {
        super(settings);
    }

    public parseDataLines(ctx: Context, data: Buffer): string[][] {
        let records: string[][];

        try {
            records = readAllGoCsv(decodeWithFileEncoding(data, this.fileEncoding), { comma: this.separator });
        } catch (err) {
            log.errorf(ctx, `[custom_transaction_data_dsv_file_importer.ParseDataLines] cannot parse dsv data, because ${(err as Error).message}`);

            if (err instanceof GoCsvParseError) {
                throw errs.ErrInvalidCSVFile;
            }

            throw errs.ErrInvalidCSVFile;
        }

        return records
            .filter(items => !(items.length === 1 && items[0] === ''))
            .map(items => items.map(trimSpaces));
    }
}

class CustomTransactionDataExcelFileImporter extends CustomTransactionDataImporterBase {
    public constructor(private readonly fileType: string, settings: CustomImporterSettings | null) {
        super(settings);
    }

    public parseDataLines(_ctx: Context, data: Buffer): string[][] {
        let excelDataTable: BasicDataTable;

        if (this.fileType === customOOXMLExcelFileType) {
            excelDataTable = createNewExcelOOXMLFileBasicDataTable(data, false);
        } else if (this.fileType === customMSCFBExcelFileType) {
            excelDataTable = createNewExcelMSCFBFileBasicDataTable(data, false);
        } else {
            throw errs.ErrImportFileTypeNotSupported;
        }

        const iterator = excelDataTable.dataRowIterator();
        const allLines: string[][] = [];

        while (iterator.hasNext()) {
            const row = iterator.next() as BasicDataTableRow;
            const items: string[] = [];

            for (let i = 0; i < row.columnCount(); i++) {
                items.push(trimSpaces(row.getData(i)));
            }

            allLines.push(items);
        }

        return allLines;
    }
}

// isDelimiterSeparatedValuesFileType returns whether the file type is the delimiter-separated values file type
export function isDelimiterSeparatedValuesFileType(fileType: string): boolean {
    return Object.hasOwn(supportedFileTypeSeparators, fileType);
}

// isCustomExcelFileType returns whether the file type is the custom excel file type
export function isCustomExcelFileType(fileType: string): boolean {
    return fileType === customOOXMLExcelFileType || fileType === customMSCFBExcelFileType;
}

function getSeparatorAndCheckEncoding(fileType: string, fileEncoding: string): string {
    const separator = supportedFileTypeSeparators[fileType];

    if (separator === undefined) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    if (fileEncoding === '') {
        throw errs.ErrImportFileEncodingIsEmpty;
    }

    if (!isSupportedFileEncoding(fileEncoding)) {
        throw errs.ErrImportFileEncodingNotSupported;
    }

    return separator;
}

function checkImporterSettings(columnIndexMapping: Map<TransactionDataTableColumn, number>, geoLocationOrder: string): TransactionGeoLocationOrder {
    if (geoLocationOrder === '') {
        geoLocationOrder = TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE;
    } else if (geoLocationOrder !== TRANSACTION_GEO_LOCATION_ORDER_LONGITUDE_LATITUDE && geoLocationOrder !== TRANSACTION_GEO_LOCATION_ORDER_LATITUDE_LONGITUDE) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    if (!columnIndexMapping.has(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) ||
        !columnIndexMapping.has(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ||
        !columnIndexMapping.has(TRANSACTION_DATA_TABLE_AMOUNT)) {
        throw errs.ErrMissingRequiredFieldInHeaderRow;
    }

    return geoLocationOrder;
}

// createNewCustomTransactionDataDsvFileParser returns a new custom dsv file parser
export function createNewCustomTransactionDataDsvFileParser(fileType: string, fileEncoding: string): CustomTransactionDataParser {
    const separator = getSeparatorAndCheckEncoding(fileType, fileEncoding);
    return new CustomTransactionDataDsvFileImporter(fileEncoding, separator, null);
}

// createNewCustomTransactionDataExcelFileParser returns a new custom excel file parser
export function createNewCustomTransactionDataExcelFileParser(fileType: string): CustomTransactionDataParser {
    if (!isCustomExcelFileType(fileType)) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    return new CustomTransactionDataExcelFileImporter(fileType, null);
}

// createNewCustomTransactionDataDsvFileImporter returns a new custom dsv file importer
export function createNewCustomTransactionDataDsvFileImporter(fileType: string, fileEncoding: string, columnIndexMapping: Map<TransactionDataTableColumn, number>, transactionTypeNameMapping: Map<string, TransactionType>, hasHeaderLine: boolean, timeFormat: string, timezoneFormat: string, amountDecimalSeparator: string, amountDigitGroupingSymbol: string, geoLocationSeparator: string, geoLocationOrder: string, transactionTagSeparator: string): TransactionDataImporter {
    const separator = getSeparatorAndCheckEncoding(fileType, fileEncoding);
    const finalGeoLocationOrder = checkImporterSettings(columnIndexMapping, geoLocationOrder);

    return new CustomTransactionDataDsvFileImporter(fileEncoding, separator, {
        columnIndexMapping, transactionTypeNameMapping, hasHeaderLine, timeFormat, timezoneFormat, amountDecimalSeparator, amountDigitGroupingSymbol, geoLocationSeparator, geoLocationOrder: finalGeoLocationOrder, transactionTagSeparator,
    });
}

// createNewCustomTransactionDataExcelFileImporter returns a new custom excel file importer
export function createNewCustomTransactionDataExcelFileImporter(fileType: string, columnIndexMapping: Map<TransactionDataTableColumn, number>, transactionTypeNameMapping: Map<string, TransactionType>, hasHeaderLine: boolean, timeFormat: string, timezoneFormat: string, amountDecimalSeparator: string, amountDigitGroupingSymbol: string, geoLocationSeparator: string, geoLocationOrder: string, transactionTagSeparator: string): TransactionDataImporter {
    if (!isCustomExcelFileType(fileType)) {
        throw errs.ErrImportFileTypeNotSupported;
    }

    const finalGeoLocationOrder = checkImporterSettings(columnIndexMapping, geoLocationOrder);

    return new CustomTransactionDataExcelFileImporter(fileType, {
        columnIndexMapping, transactionTypeNameMapping, hasHeaderLine, timeFormat, timezoneFormat, amountDecimalSeparator, amountDigitGroupingSymbol, geoLocationSeparator, geoLocationOrder: finalGeoLocationOrder, transactionTagSeparator,
    });
}

// getDateTimeFormat converts the moment like date time format to go time layout (same sequential replacements as go)
export function getDateTimeFormat(format: string): string {
    format = format.replaceAll('YYYY', '2006');
    format = format.replaceAll('YY', '06');
    format = format.replaceAll('MMMM', 'January');
    format = format.replaceAll('MMM', 'Jan');
    format = format.replaceAll('MM', '01');
    format = format.replaceAll('M', '1');
    format = format.replaceAll('DD', '02');
    format = format.replaceAll('D', '2');
    format = format.replaceAll('dddd', 'Monday');
    format = format.replaceAll('ddd', 'Mon');
    format = format.replaceAll('HH', '15');
    format = format.replaceAll('H', '15');
    format = format.replaceAll('hh', '03');
    format = format.replaceAll('h', '3');
    format = format.replaceAll('mm', '04');
    format = format.replaceAll('m', '4');
    format = format.replaceAll('ss', '05');
    format = format.replaceAll('s', '5');

    for (let i = 9; i >= 1; i--) {
        format = format.replaceAll('.' + 'S'.repeat(i), '.' + '9'.repeat(i));
    }

    format = format.replaceAll('A', 'PM');
    format = format.replaceAll('a', 'pm');
    format = format.replaceAll('zz', 'MST');
    format = format.replaceAll('z', 'MST');

    if (format.includes('ZZ')) {
        format = format.replaceAll('ZZ', 'Z0700');
    } else if (format.includes('Z')) {
        format = format.replaceAll('Z', 'Z07:00');
    }

    return format;
}

// CustomPlainTextDataTable defines the structure of custom plain text transaction data table
class CustomPlainTextDataTable implements TransactionDataTable {
    public constructor(
        private readonly innerDataTable: BasicDataTable,
        private readonly columnIndexMapping: Map<TransactionDataTableColumn, number>,
        private readonly transactionTypeNameMapping: Map<string, TransactionType>,
        private readonly timeFormat: string,
        private readonly timezoneFormat: string,
        private readonly timeFormatIncludeTimezone: boolean,
        private readonly amountDecimalSeparator: string,
        private readonly amountDigitGroupingSymbol: string,
    ) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        if (column === TRANSACTION_DATA_TABLE_SUB_CATEGORY || column === TRANSACTION_DATA_TABLE_ACCOUNT_NAME || column === TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME) {
            return true;
        }

        if (this.timeFormatIncludeTimezone && column === TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE) {
            return true;
        }

        return this.columnIndexMapping.has(column);
    }

    public transactionRowCount(): number {
        return this.innerDataTable.dataRowCount();
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const innerIterator = this.innerDataTable.dataRowIterator();

        return {
            hasNext: () => innerIterator.hasNext(),
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                const importedRow = innerIterator.next();

                if (!importedRow) {
                    return null;
                }

                let rowData: RowData | null;
                let isValid: boolean;

                try {
                    [rowData, isValid] = this.parseTransaction(ctx, importedRow);
                } catch (err) {
                    log.errorf(ctx, `[custom_transaction_plain_text_data_table.Next] cannot parsing transaction in row "${innerIterator.currentRowId()}", because ${(err as Error).message}`);
                    throw err;
                }

                return {
                    isValid: () => isValid,
                    getData: (column: TransactionDataTableColumn) => rowData?.get(column) ?? '',
                };
            },
        };
    }

    private parseTransaction(ctx: Context, row: BasicDataTableRow): [RowData | null, boolean] {
        const prefix = 'custom_transaction_plain_text_data_table.parseTransaction';
        const rowData: RowData = new Map();
        let transactionUnixTime: number | null = null;

        for (const [column, columnIndex] of this.columnIndexMapping) {
            if (columnIndex < 0 || columnIndex >= row.columnCount()) {
                continue;
            }

            rowData.set(column, row.getData(columnIndex));
        }

        const typeName = rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) ?? '';

        if (typeName !== '') {
            const transactionType = this.transactionTypeNameMapping.get(typeName);

            if (transactionType === undefined) {
                log.warnf(ctx, `[${prefix}] skip parsing this transaction, because transaction type "${typeName}" mapping not defined`);
                return [null, false];
            }

            const mappedTransactionType = customTransactionTypeNameMapping.get(transactionType);

            if (mappedTransactionType === undefined) {
                log.errorf(ctx, `[${prefix}] cannot parsing transaction type "${typeName}", because type "${transactionType}" is invalid`);
                throw errs.ErrTransactionTypeInvalid;
            }

            rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, mappedTransactionType);
        }

        const timeText = rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TIME) ?? '';

        if (timeText !== '') {
            let dateTime;

            try {
                dateTime = parseGoTime(this.timeFormat, timeText, null);
            } catch {
                throw errs.ErrTransactionTimeInvalid;
            }

            transactionUnixTime = Math.floor(dateTime.toSeconds());
            rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, formatUnixTimeToLongDateTime(transactionUnixTime, dateTime.zone));

            if (this.timeFormatIncludeTimezone) {
                rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(transactionUnixTime, dateTime.zone));
            }
        }

        const timezoneText = rowData.get(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE) ?? '';

        if (timezoneText !== '') {
            if (this.timezoneFormat === 'Z' || this.timezoneFormat === '') {
                // -HH:mm
            } else if (this.timezoneFormat === 'ZZ') {
                // -HHmm
                if (Buffer.byteLength(timezoneText, 'utf8') !== 5) {
                    throw errs.ErrTransactionTimeZoneInvalid;
                }

                rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, timezoneText.substring(0, 3) + ':' + timezoneText.substring(3));
            } else if (this.timezoneFormat === 'zzz') {
                // IANA Timezone Name
                const timezone = loadLocation(timezoneText);

                if (!timezone) {
                    throw errs.ErrTransactionTimeZoneInvalid;
                }

                if (transactionUnixTime === null) {
                    throw errs.ErrTransactionTimeInvalid;
                }

                rowData.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(transactionUnixTime, timezone));
            } else {
                throw errs.ErrImportFileTransactionTimezoneFormatInvalid;
            }
        }

        if ((rowData.get(TRANSACTION_DATA_TABLE_SUB_CATEGORY) ?? '') === '' && (rowData.get(TRANSACTION_DATA_TABLE_CATEGORY) ?? '') !== '') {
            rowData.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, rowData.get(TRANSACTION_DATA_TABLE_CATEGORY) as string);
        }

        for (const [column, name] of [[TRANSACTION_DATA_TABLE_AMOUNT, 'amount'], [TRANSACTION_DATA_TABLE_RELATED_AMOUNT, 'related amount']] as [number, string][]) {
            const amountText = rowData.get(column) ?? '';

            if (amountText !== '') {
                try {
                    rowData.set(column, this.parseAmount(amountText));
                } catch (err) {
                    log.errorf(ctx, `[${prefix}] cannot parsing transaction ${name} "${amountText}", because ${(err as Error).message}`);
                    throw err;
                }
            }
        }

        for (const column of [TRANSACTION_DATA_TABLE_SUB_CATEGORY, TRANSACTION_DATA_TABLE_ACCOUNT_NAME, TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME]) {
            if (!rowData.has(column)) {
                rowData.set(column, '');
            }
        }

        return [rowData, true];
    }

    private parseAmount(amountValue: string): string {
        if (this.amountDigitGroupingSymbol !== '') {
            amountValue = amountValue.split(this.amountDigitGroupingSymbol).join('');

            if (this.amountDigitGroupingSymbol === ' ') {
                amountValue = amountValue.replaceAll(' ', '').replaceAll(' ', '').replaceAll(' ', '');
            }
        }

        if (this.amountDecimalSeparator !== '' && this.amountDecimalSeparator !== '.') {
            if (amountValue.includes('.')) {
                throw errs.ErrAmountInvalid;
            }

            amountValue = amountValue.split(this.amountDecimalSeparator).join('.');
        }

        amountValue = trimTrailingZerosInDecimal(amountValue);

        let amount: number;

        try {
            amount = parseAmount(amountValue);
        } catch {
            throw errs.ErrAmountInvalid;
        }

        return formatAmount(amount);
    }
}

// createNewCustomPlainTextDataTable returns transaction data table from basic data table
export function createNewCustomPlainTextDataTable(dataTable: BasicDataTable, columnIndexMapping: Map<TransactionDataTableColumn, number>, transactionTypeNameMapping: Map<string, TransactionType>, timeFormat: string, timezoneFormat: string, amountDecimalSeparator: string, amountDigitGroupingSymbol: string): TransactionDataTable {
    const timeFormatIncludeTimezone = timeFormat.includes('z') || timeFormat.includes('Z');
    return new CustomPlainTextDataTable(dataTable, columnIndexMapping, transactionTypeNameMapping, getDateTimeFormat(timeFormat), timezoneFormat, timeFormatIncludeTimezone, amountDecimalSeparator, amountDigitGroupingSymbol);
}
