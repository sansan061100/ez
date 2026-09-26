import iconv from 'iconv-lite';

import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type TransactionType, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatTimezoneOffsetFromHoursOffset } from '../utils/datetimes';
import { isStringOnlyContainsDigits, trimTrailingZerosInDecimal } from '../utils/numbers';
import { parseXml } from '../utils/xml';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
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
import { type DecodedObject, type DecodeSchema, decodeSgml, decodeXmlElement, list, obj, sliceField, str, structField, textField } from './sgml';

const ofxVersion1 = '100';
const ofxVersion2 = '200';
const ofxDefaultTimezoneOffset = '+00:00';
const ofxLineOfCreditAccount = 'CREDITLINE';
const ofxGenericCreditTransaction = 'CREDIT';

const ofxTransactionTypeMapping: Record<string, TransactionType> = {
    CREDIT: TRANSACTION_TYPE_EXPENSE,
    DEBIT: TRANSACTION_TYPE_EXPENSE,
    DIV: TRANSACTION_TYPE_INCOME,
    FEE: TRANSACTION_TYPE_EXPENSE,
    SRVCHG: TRANSACTION_TYPE_EXPENSE,
    DEP: TRANSACTION_TYPE_INCOME,
    XFER: TRANSACTION_TYPE_TRANSFER,
    CHECK: TRANSACTION_TYPE_EXPENSE,
    PAYMENT: TRANSACTION_TYPE_EXPENSE,
    CASH: TRANSACTION_TYPE_EXPENSE,
    DIRECTDEP: TRANSACTION_TYPE_INCOME,
    DIRECTDEBIT: TRANSACTION_TYPE_EXPENSE,
    REPEATPMT: TRANSACTION_TYPE_EXPENSE,
};

const incomeTypeName = String(TRANSACTION_TYPE_INCOME);
const expenseTypeName = String(TRANSACTION_TYPE_EXPENSE);
const transferTypeName = String(TRANSACTION_TYPE_TRANSFER);

const ofxTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, incomeTypeName],
    [TRANSACTION_TYPE_EXPENSE, expenseTypeName],
    [TRANSACTION_TYPE_TRANSFER, transferTypeName],
]);

const ofxPayeeSchema: DecodeSchema = {
    NAME: ['name', textField],
    ADDR1: ['address1', textField],
    ADDR2: ['address2', textField],
    ADDR3: ['address3', textField],
    CITY: ['city', textField],
    STATE: ['state', textField],
    POSTALCODE: ['postalCode', textField],
    COUNTRY: ['country', textField],
    PHONE: ['phone', textField],
};

const ofxBankAccountSchema: DecodeSchema = {
    BANKID: ['bankId', textField],
    BRANCHID: ['branchId', textField],
    ACCTID: ['accountId', textField],
    ACCTTYPE: ['accountType', textField],
    ACCTKEY: ['accountKey', textField],
};

const ofxCreditCardAccountSchema: DecodeSchema = {
    ACCTID: ['accountId', textField],
    ACCTKEY: ['accountKey', textField],
};

const ofxBaseStatementTransactionSchema: DecodeSchema = {
    FITID: ['transactionId', textField],
    TRNTYPE: ['transactionType', textField],
    DTPOSTED: ['postedDate', textField],
    TRNAMT: ['amount', textField],
    NAME: ['name', textField],
    PAYEE: ['payee', structField(ofxPayeeSchema)],
    MEMO: ['memo', textField],
    CURRENCY: ['currency', textField],
    ORIGCURRENCY: ['originalCurrency', textField],
};

function transactionListSchema(accountToTag: string, accountToSchema: DecodeSchema): DecodeSchema {
    return {
        DTSTART: ['startDate', textField],
        DTEND: ['endDate', textField],
        STMTTRN: ['statementTransactions', sliceField({ ...ofxBaseStatementTransactionSchema, [accountToTag]: ['accountTo', structField(accountToSchema)] })],
    };
}

const ofxFileSchema: DecodeSchema = {
    BANKMSGSRSV1: ['bankMessageResponseV1', structField({
        STMTTRNRS: ['statementTransactionResponse', structField({
            STMTRS: ['statementResponse', structField({
                CURDEF: ['defaultCurrency', textField],
                BANKACCTFROM: ['accountFrom', structField(ofxBankAccountSchema)],
                BANKTRANLIST: ['transactionList', structField(transactionListSchema('BANKACCTTO', ofxBankAccountSchema))],
            })],
        })],
    })],
    CREDITCARDMSGSRSV1: ['creditCardMessageResponseV1', structField({
        CCSTMTTRNRS: ['statementTransactionResponse', structField({
            CCSTMTRS: ['statementResponse', structField({
                CURDEF: ['defaultCurrency', textField],
                CCACCTFROM: ['accountFrom', structField(ofxCreditCardAccountSchema)],
                BANKTRANLIST: ['transactionList', structField(transactionListSchema('CCACCTTO', ofxCreditCardAccountSchema))],
            })],
        })],
    })],
};

interface OfxFileHeader {
    ofxDeclarationVersion: string;
    ofxDataVersion: string;
    security: string;
    oldFileUid: string;
    newFileUid: string;
}

function newFileHeader(): OfxFileHeader {
    return { ofxDeclarationVersion: '', ofxDataVersion: '', security: '', oldFileUid: '', newFileUid: '' };
}

// resolveCharsetLabel resolves the charset label to iconv encoding name (like golang.org/x/net/html/charset.Lookup)
function resolveCharsetLabel(label: string): string | null {
    const normalized = label.trim().toLowerCase();

    if (normalized === '' ) {
        return null;
    }

    if (normalized === 'us-ascii' || normalized === 'ascii' || normalized === 'iso-8859-1' || normalized === 'latin1' || normalized === 'iso8859-1') {
        return 'windows-1252';
    }

    if (normalized === 'unicode' || normalized === 'utf-16' || normalized === 'utf-16le') {
        return 'utf16le';
    }

    return iconv.encodingExists(normalized) ? normalized : null;
}

function readOFX1FileHeader(ctx: Context, data: Buffer): [OfxFileHeader, Buffer, string, string] {
    const prefix = 'ofx_data_reader.readOFX1FileHeader';
    const fileHeader = newFileHeader();
    let dataType = '';
    let fileEncoding = '';
    let fileCharset = '';
    let fileDataStartPosition = 0;
    let lastCrLf = -1;

    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0x0a && data[i] !== 0x0d) {
            continue;
        }

        if (lastCrLf === i - 1) {
            lastCrLf = i;
            continue;
        }

        const line = data.subarray(lastCrLf + 1, i).toString('utf8');

        if (line.indexOf('<OFX>') === 0) {
            fileDataStartPosition = lastCrLf + 1;
            break;
        }

        lastCrLf = i;

        if (line === '') {
            continue;
        }

        const items = line.split(':');

        if (items.length !== 2) {
            log.warnf(ctx, `[${prefix}] cannot parse line in ofx 1.x file header, because line is "${line}"`);
            continue;
        }

        const key = items[0] as string;
        const value = items[1] as string;

        switch (key) {
            case 'OFXHEADER': fileHeader.ofxDeclarationVersion = value; break;
            case 'DATA': dataType = value; break;
            case 'VERSION': fileHeader.ofxDataVersion = value; break;
            case 'SECURITY': fileHeader.security = value; break;
            case 'ENCODING': fileEncoding = value.toLowerCase(); break;
            case 'CHARSET': fileCharset = value.toLowerCase(); break;
            case 'COMPRESSION': break;
            case 'OLDFILEUID': fileHeader.oldFileUid = value; break;
            case 'NEWFILEUID': fileHeader.newFileUid = value; break;
            default:
                log.warnf(ctx, `[${prefix}] cannot parse unknown header line in ofx 1.x file header, because line is "${line}"`);
        }
    }

    let encoding: string;

    if (fileEncoding === 'usascii') {
        if (isStringOnlyContainsDigits(fileCharset)) {
            fileCharset = 'cp' + fileCharset;
        }

        encoding = resolveCharsetLabel(fileCharset) ?? 'windows-1252';
    } else if (fileEncoding === 'unicode') {
        encoding = 'utf16le';
    } else if (fileEncoding === 'utf-8') {
        encoding = 'utf8';
    } else {
        log.errorf(ctx, `[${prefix}] cannot parse ofx 1.x file, because encoding "${fileEncoding}" is unknown`);
        throw errs.ErrInvalidOFXFile;
    }

    return [fileHeader, data.subarray(fileDataStartPosition), dataType, encoding];
}

function readOFX2FileHeader(ctx: Context, data: Buffer): OfxFileHeader {
    const fileHeader = newFileHeader();
    let headerLine = '';

    for (const line of data.toString('utf8').split(/(?<=\n)/)) {
        if (line.indexOf('<?OFX ') >= 0) {
            const match = /<\?OFX( +[A-Z]+="[^=]*")* *\?>/.exec(line);
            headerLine = match ? match[0] : '';
            break;
        }
    }

    if (headerLine === '') {
        log.errorf(ctx, '[ofx_data_reader.readOFX2FileHeader] cannot find ofx 2.x file header');
        throw errs.ErrInvalidOFXFile;
    }

    for (const match of headerLine.matchAll(/ +([A-Z]+)="([^=]*)"/g)) {
        const name = match[1] as string;
        const value = match[2] as string;

        switch (name) {
            case 'OFXHEADER': fileHeader.ofxDeclarationVersion = value; break;
            case 'VERSION': fileHeader.ofxDataVersion = value; break;
            case 'SECURITY': fileHeader.security = value; break;
            case 'OLDFILEUID': fileHeader.oldFileUid = value; break;
            case 'NEWFILEUID': fileHeader.newFileUid = value; break;
            default:
                log.warnf(ctx, `[ofx_data_reader.readOFX2FileHeader] cannot parse unknown header line in ofx 2.x file header, because item is "${match[0]}"`);
        }
    }

    return fileHeader;
}

function readOFX1File(ctx: Context, data: Buffer): DecodedObject {
    const [fileHeader, fileData, dataType, encoding] = readOFX1FileHeader(ctx, data);

    if (fileHeader.ofxDeclarationVersion !== ofxVersion1) {
        log.errorf(ctx, `[ofx_data_reader.createNewOFX1FileReader] cannot parse ofx 1.x file header, because declaration version is "${fileHeader.ofxDeclarationVersion}"`);
        throw errs.ErrInvalidOFXFile;
    }

    if (dataType !== 'OFXSGML') {
        log.errorf(ctx, `[ofx_data_reader.createNewOFX1FileReader] cannot parse ofx 1.x file header, because data type is "${dataType}"`);
        throw errs.ErrInvalidOFXFile;
    }

    const sgmlData = iconv.decode(fileData, encoding, { stripBOM: false });

    try {
        return decodeSgml(sgmlData, 'OFX', ofxFileSchema) ?? {};
    } catch (err) {
        log.errorf(ctx, `[ofxVersion1FileReader.read] cannot read ofx 1.x file, because ${(err as Error).message}`);
        throw errs.ErrInvalidOFXFile;
    }
}

function readOFX2File(ctx: Context, data: Buffer, withHeader: boolean): DecodedObject {
    if (withHeader) {
        const fileHeader = readOFX2FileHeader(ctx, data);

        if (fileHeader.ofxDeclarationVersion !== ofxVersion2) {
            log.errorf(ctx, `[ofx_data_reader.createNewOFX2FileReader] cannot parse ofx 2.x file header, because declaration version is "${fileHeader.ofxDeclarationVersion}"`);
            throw errs.ErrInvalidOFXFile;
        }
    }

    try {
        const root = parseXml(data);

        if (root.name !== 'OFX') {
            throw new Error(`expected element type <OFX> but have <${root.name}>`);
        }

        return decodeXmlElement(root, ofxFileSchema);
    } catch (err) {
        log.errorf(ctx, `[ofxVersion2FileReader.read] cannot read ofx 2.x file, because ${(err as Error).message}`);
        throw errs.ErrInvalidOFXFile;
    }
}

function readOFXFile(ctx: Context, data: Buffer): DecodedObject {
    let firstNonCrLfIndex = 0;

    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0x0a && data[i] !== 0x0d) {
            firstNonCrLfIndex = i;
            break;
        }
    }

    const startsWith = (text: string): boolean => data.length > text.length && data.subarray(firstNonCrLfIndex, firstNonCrLfIndex + text.length).toString('latin1') === text;

    if (startsWith('<?xml')) {
        return readOFX2File(ctx, data, true);
    } else if (startsWith('OFXHEADER:')) {
        return readOFX1File(ctx, data);
    } else if (startsWith('<OFX>')) {
        return readOFX2File(ctx, data, false);
    }

    throw errs.ErrInvalidOFXFile;
}

interface OfxTransactionData {
    transaction: DecodedObject;
    defaultCurrency: string;
    fromAccountId: string;
    fromCreditAccount: boolean;
    toAccountId: string;
}

function collectTransactions(file: DecodedObject): OfxTransactionData[] {
    const allData: OfxTransactionData[] = [];
    const sources: [DecodedObject | null, boolean][] = [
        [obj(obj(obj(file, 'bankMessageResponseV1'), 'statementTransactionResponse'), 'statementResponse'), false],
        [obj(obj(obj(file, 'creditCardMessageResponseV1'), 'statementTransactionResponse'), 'statementResponse'), true],
    ];

    for (const [statement, isCreditCard] of sources) {
        const transactionList = obj(statement, 'transactionList');

        if (!statement || !transactionList) {
            continue;
        }

        const accountFrom = obj(statement, 'accountFrom');
        const fromAccountId = str(accountFrom, 'accountId');
        const fromCreditAccount = isCreditCard || str(accountFrom, 'accountType') === ofxLineOfCreditAccount;

        for (const transaction of list(transactionList, 'statementTransactions')) {
            allData.push({
                transaction: transaction,
                defaultCurrency: str(statement, 'defaultCurrency'),
                fromAccountId: fromAccountId,
                fromCreditAccount: fromCreditAccount,
                toAccountId: str(obj(transaction, 'accountTo'), 'accountId'),
            });
        }
    }

    return allData;
}

function parseTransactionTimeAndTimeZone(ctx: Context, datetime: string): [string, string] {
    const prefix = 'ofx_transaction_table.parseTransactionTimeAndTimeZone';

    if (datetime.length < 8) {
        throw errs.ErrTransactionTimeInvalid;
    }

    let hour = '00';
    let minute = '00';
    let second = '00';
    let tzOffset = ofxDefaultTimezoneOffset;

    if (!isStringOnlyContainsDigits(datetime.substring(0, 8))) {
        log.errorf(ctx, `[${prefix}] cannot parse time "${datetime}", because contains non-digit character`);
        throw errs.ErrTransactionTimeInvalid;
    }

    const year = datetime.substring(0, 4);
    const month = datetime.substring(4, 6);
    const day = datetime.substring(6, 8);

    if (datetime.length >= 14) {
        if (!isStringOnlyContainsDigits(datetime.substring(8, 14))) {
            log.errorf(ctx, `[${prefix}] cannot parse time "${datetime}", because contains non-digit character`);
            throw errs.ErrTransactionTimeInvalid;
        }

        hour = datetime.substring(8, 10);
        minute = datetime.substring(10, 12);
        second = datetime.substring(12, 14);
    }

    const squareBracketStartIndex = datetime.indexOf('[');

    if (squareBracketStartIndex > 0) {
        if (squareBracketStartIndex + 1 > datetime.length - 1) {
            throw errs.ErrTransactionTimeZoneInvalid;
        }

        const timezoneInfo = datetime.substring(squareBracketStartIndex + 1, datetime.length - 1);

        try {
            tzOffset = formatTimezoneOffsetFromHoursOffset(timezoneInfo.split(':')[0] as string);
        } catch (err) {
            log.errorf(ctx, `[${prefix}] cannot parse timezone offset "${timezoneInfo}", because ${(err as Error).message}`);
            throw errs.ErrTransactionTimeZoneInvalid;
        }
    }

    return [`${year}-${month}-${day} ${hour}:${minute}:${second}`, tzOffset];
}

function parseOfxTransaction(ctx: Context, ofxTransaction: OfxTransactionData): RowData {
    const t = ofxTransaction.transaction;
    const data: RowData = new Map();
    const postedDate = str(t, 'postedDate');

    if (postedDate === '') {
        throw errs.ErrMissingTransactionTime;
    }

    const [datetime, timezone] = parseTransactionTimeAndTimeZone(ctx, postedDate);
    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, datetime);
    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, timezone);

    const transactionType = str(t, 'transactionType');

    if (transactionType === '') {
        throw errs.ErrTransactionTypeInvalid;
    }

    if (ofxTransaction.fromAccountId === '') {
        throw errs.ErrMissingAccountData;
    }

    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, ofxTransaction.fromAccountId);
    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, str(t, 'currency') !== '' ? str(t, 'currency') : ofxTransaction.defaultCurrency);

    if (data.get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) === '') {
        throw errs.ErrAccountCurrencyInvalid;
    }

    const amountText = str(t, 'amount');

    if (amountText === '') {
        throw errs.ErrAmountInvalid;
    }

    let amount: number;

    try {
        amount = parseAmount(trimTrailingZerosInDecimal(amountText.replaceAll(',', '.')));
    } catch (err) {
        log.errorf(ctx, `[ofx_transaction_table.parseTransaction] cannot parsing transaction amount "${amountText}", because ${(err as Error).message}`);
        throw errs.ErrAmountInvalid;
    }

    const setTransferFromSelf = (): void => {
        data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
        data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) ?? '');
        data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) ?? '');
        data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '');
    };

    const knownType = Object.hasOwn(ofxTransactionTypeMapping, transactionType) ? ofxTransactionTypeMapping[transactionType] : undefined;

    if (knownType !== undefined) {
        const typeName = String(knownType);
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, typeName);

        if (typeName === incomeTypeName) {
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
        } else if (typeName === expenseTypeName) {
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
        } else if (amount >= 0) {
            setTransferFromSelf();
        } else {
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, ofxTransaction.toAccountId);
            data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY) ?? '');
            data.set(TRANSACTION_DATA_TABLE_RELATED_AMOUNT, data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
        }
    } else if (amount >= 0) {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeTypeName);
        data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
    } else {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
        data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
    }

    if (data.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) !== transferTypeName) {
        if (ofxTransaction.fromCreditAccount || transactionType === ofxGenericCreditTransaction) {
            if (amount >= 0) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, transferTypeName);
                setTransferFromSelf();
            } else {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
            }
        }
    }

    const payee = obj(t, 'payee');

    if (str(t, 'memo') !== '') {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(t, 'memo'));
    } else if (str(t, 'name') !== '') {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(t, 'name'));
    } else if (payee) {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(payee, 'name'));
    } else {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, '');
    }

    return data;
}

const ofxTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_RELATED_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

// createListTransactionDataTable returns a transaction data table which parses each item lazily
export function createListTransactionDataTable<T>(allData: T[], supportedColumns: Set<TransactionDataTableColumn>, parse: (ctx: Context, user: User, item: T, index: number) => RowData | Promise<RowData>, logPrefix: string): TransactionDataTable {
    return {
        hasColumn: (column: TransactionDataTableColumn) => supportedColumns.has(column),
        transactionRowCount: () => allData.length,
        transactionRowIterator: (): TransactionDataRowIterator => {
            let currentIndex = -1;

            return {
                hasNext: () => currentIndex + 1 < allData.length,
                next: async (ctx: Context, user: User): Promise<TransactionDataRow | null> => {
                    if (currentIndex + 1 >= allData.length) {
                        return null;
                    }

                    currentIndex++;
                    let rowItems: RowData;

                    try {
                        rowItems = await parse(ctx, user, allData[currentIndex] as T, currentIndex);
                    } catch (err) {
                        log.errorf(ctx, `[${logPrefix}] cannot parsing transaction in row#${currentIndex}, because ${(err as Error).message}`);
                        throw err;
                    }

                    return {
                        isValid: () => true,
                        getData: (column: TransactionDataTableColumn) => (supportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                    };
                },
            };
        },
    };
}

export const OFXTransactionDataImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const ofxFile = readOFXFile(ctx, data);
        const allData = collectTransactions(ofxFile);
        const transactionDataTable = createListTransactionDataTable(allData, ofxTransactionSupportedColumns, (c, _user, item) => parseOfxTransaction(c, item), 'ofx_transaction_table.Next');
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(ofxTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
