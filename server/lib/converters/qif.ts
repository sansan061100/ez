import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_MODIFY_BALANCE, TRANSACTION_TYPE_TRANSFER } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatYearMonthDayToLongDateTime } from '../utils/datetimes';
import { decodeWithBOMOverride } from '../utils/encodings';
import { scanLines } from '../utils/strings';
import { isValidDayMonthYearLongOrShortDateFormat, isValidMonthDayYearLongOrShortDateFormat, isValidYearMonthDayLongOrShortDateFormat } from '../utils/validators';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_PAYEE,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTableColumn,
} from './datatable';
import { createListTransactionDataTable } from './ofx';

const qifBankTransactionHeader = '!Type:Bank';
const qifCashTransactionHeader = '!Type:Cash';
const qifCreditCardTransactionHeader = '!Type:CCard';
const qifAssetAccountTransactionHeader = '!Type:Oth A';
const qifLiabilityAccountTransactionHeader = '!Type:Oth L';
const qifMemorizedTransactionHeader = '!Type:Memorized';
const qifMemorisedTransactionHeader = '!Type:Memorised';
const qifInvestmentTransactionHeader = '!Type:Invst';
const qifAccountHeader = '!Account';
const qifCategoryHeader = '!Type:Cat';
const qifClassHeader = '!Type:Class';
const qifTypeHeaderPrefix = '!Type:';

const supportedHeaders = new Set([
    qifBankTransactionHeader, qifCashTransactionHeader, qifCreditCardTransactionHeader, qifAssetAccountTransactionHeader, qifLiabilityAccountTransactionHeader,
    qifMemorizedTransactionHeader, qifMemorisedTransactionHeader, qifInvestmentTransactionHeader, qifAccountHeader, qifCategoryHeader, qifClassHeader,
]);

const transactionHeaders = [qifBankTransactionHeader, qifCashTransactionHeader, qifCreditCardTransactionHeader, qifAssetAccountTransactionHeader, qifLiabilityAccountTransactionHeader];

interface QifAccountData {
    name: string;
}

interface QifTransactionData {
    date: string;
    amount: string;
    payee: string;
    memo: string;
    category: string;
    account: QifAccountData | null;
}

// parseClearedStatus only logs the unsupported cleared status like go
function parseClearedStatus(ctx: Context, value: string): void {
    if (value === '' || value === '*' || value.toUpperCase() === 'C' || value.toUpperCase() === 'R' || value.toUpperCase() === 'X') {
        return;
    }

    log.warnf(ctx, `[qif_data_reader.parseClearedStatus] read unsupported transaction cleared status "${value}" and skip this value`);
}

function parseTransaction(ctx: Context, data: string[], ignoreUnknown: boolean): QifTransactionData | null {
    if (data.length < 1) {
        return null;
    }

    const transactionData: QifTransactionData = { date: '', amount: '', payee: '', memo: '', category: '', account: null };

    for (const line of data) {
        if (line.length < 1) {
            continue;
        }

        const value = line.substring(1);

        switch (line[0]) {
            case 'D': transactionData.date = value; break;
            case 'T': transactionData.amount = value; break;
            case 'C': parseClearedStatus(ctx, value); break;
            case 'N': break;
            case 'P': transactionData.payee = value; break;
            case 'M': transactionData.memo = value; break;
            case 'A': break;
            case 'L': transactionData.category = value; break;
            case 'S': case 'E': case '$': break;
            default:
                if (!ignoreUnknown) {
                    log.warnf(ctx, `[qif_data_reader.parseTransaction] read unsupported line "${line}" and skip this line`);
                }
        }
    }

    return transactionData;
}

function logUnsupportedLines(ctx: Context, data: string[], supportedFirstChars: string, logPrefix: string): void {
    for (const line of data) {
        if (line.length < 1) {
            continue;
        }

        if (!supportedFirstChars.includes(line[0] as string)) {
            log.warnf(ctx, `[${logPrefix}] read unsupported line "${line}" and skip this line`);
        }
    }
}

function readQifTransactions(ctx: Context, allLines: string[]): QifTransactionData[] {
    if (allLines.length < 1) {
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    const transactionsByHeader = new Map<string, QifTransactionData[]>(transactionHeaders.map(header => [header, []]));
    let currentEntryHeader = '';
    let currentEntryData: string[] = [];
    let currentAccount: QifAccountData | null = null;

    for (let line of allLines) {
        if (line.length < 1) {
            continue;
        }

        if (line[0] === '!') {
            if (currentEntryData.length > 0) {
                log.errorf(ctx, `[qif_data_reader.read] read new entry header "${line}" after unclosed entry`);
                throw errs.ErrInvalidQIFFile;
            }

            line = line.replace(/ +$/, '');

            if (supportedHeaders.has(line)) {
                currentEntryHeader = line;
            } else if (line.indexOf(qifTypeHeaderPrefix) === 0) {
                currentEntryHeader = line;
                log.warnf(ctx, `[qif_data_reader.read] read unsupported entry header line "${line}" and skip the following entries`);
            } else {
                log.warnf(ctx, `[qif_data_reader.read] read unsupported entry header line "${line}" and skip this line`);
            }
        } else if (line[0] === '^') {
            const entryData = currentEntryData;
            currentEntryData = [];

            const transactionList = transactionsByHeader.get(currentEntryHeader);

            if (transactionList) {
                const transactionData = parseTransaction(ctx, entryData, false);

                if (!transactionData) {
                    continue;
                }

                transactionData.account = currentAccount;
                transactionList.push(transactionData);
            } else if (currentEntryHeader === qifMemorizedTransactionHeader || currentEntryHeader === qifMemorisedTransactionHeader) {
                if (entryData.length > 0) {
                    parseTransaction(ctx, entryData, true);

                    for (const entryLine of entryData) {
                        if (entryLine.length < 1 || 'DTCNPMALSE$1234567'.includes(entryLine[0] as string)) {
                            continue;
                        }

                        if (entryLine[0] === 'K') {
                            if (!['KC', 'KD', 'KP', 'KI', 'KE'].includes(entryLine)) {
                                log.warnf(ctx, `[qif_data_reader.parseMemorizedTransaction] read unsupported transaction type "${entryLine}" and skip this line`);
                            }
                        } else {
                            log.warnf(ctx, `[qif_data_reader.parseMemorizedTransaction] read unsupported line "${entryLine}" and skip this line`);
                        }
                    }
                }
            } else if (currentEntryHeader === qifInvestmentTransactionHeader) {
                for (const entryLine of entryData) {
                    if (entryLine[0] === 'C') {
                        parseClearedStatus(ctx, entryLine.substring(1));
                    }
                }

                logUnsupportedLines(ctx, entryData, 'DNYIQTCPMOL$', 'qif_data_reader.parseInvestmentTransaction');
            } else if (currentEntryHeader === qifAccountHeader) {
                if (entryData.length < 1) {
                    continue;
                }

                const accountData: QifAccountData = { name: '' };

                for (const entryLine of entryData) {
                    if (entryLine[0] === 'N') {
                        accountData.name = entryLine.substring(1);
                    }
                }

                logUnsupportedLines(ctx, entryData, 'NTDL/$', 'qif_data_reader.parseAccount');
                currentAccount = accountData;
            } else if (currentEntryHeader === qifCategoryHeader) {
                logUnsupportedLines(ctx, entryData, 'NDTIEBR', 'qif_data_reader.parseCategory');
            } else if (currentEntryHeader === qifClassHeader) {
                logUnsupportedLines(ctx, entryData, 'ND', 'qif_data_reader.parseClass');
            } else {
                log.warnf(ctx, `[qif_data_reader.read] read unsupported entry header "${currentEntryHeader}" and skip this entry`);
            }
        } else if (currentEntryHeader !== '') {
            currentEntryData.push(line);
        } else {
            log.warnf(ctx, `[qif_data_reader.read] read unsupported line "${line}" and skip this line`);
        }
    }

    const allData: QifTransactionData[] = [];

    for (const header of transactionHeaders) {
        allData.push(...(transactionsByHeader.get(header) as QifTransactionData[]));
    }

    return allData;
}

const qifOpeningBalancePayeeText = 'Opening Balance';

const modifyBalanceTypeName = String(TRANSACTION_TYPE_MODIFY_BALANCE);
const incomeTypeName = String(TRANSACTION_TYPE_INCOME);
const expenseTypeName = String(TRANSACTION_TYPE_EXPENSE);
const transferTypeName = String(TRANSACTION_TYPE_TRANSFER);

const qifTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_MODIFY_BALANCE, modifyBalanceTypeName],
    [TRANSACTION_TYPE_INCOME, incomeTypeName],
    [TRANSACTION_TYPE_EXPENSE, expenseTypeName],
    [TRANSACTION_TYPE_TRANSFER, transferTypeName],
]);

const qifTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_CATEGORY,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_PAYEE,
]);

type QifDateFormatType = 0 | 1 | 2;

const qifYearMonthDayDateFormat: QifDateFormatType = 0;
const qifMonthDayYearDateFormat: QifDateFormatType = 1;
const qifDayMonthYearDateFormat: QifDateFormatType = 2;

function parseQifTransactionTime(ctx: Context, dateFormatType: QifDateFormatType, date: string): string {
    let year = '';
    let month = '';
    let day = '';

    if ((dateFormatType === qifYearMonthDayDateFormat && isValidYearMonthDayLongOrShortDateFormat(date)) ||
        (dateFormatType === qifMonthDayYearDateFormat && isValidMonthDayYearLongOrShortDateFormat(date)) ||
        (dateFormatType === qifDayMonthYearDateFormat && isValidDayMonthYearLongOrShortDateFormat(date))) {
        date = date.replaceAll('.', '-').replaceAll('/', '-').replaceAll('\'', '-');
        const items = date.split('-');

        if (dateFormatType === qifYearMonthDayDateFormat) {
            [year, month, day] = [items[0] ?? '', items[1] ?? '', items[2] ?? ''];
        } else if (dateFormatType === qifMonthDayYearDateFormat) {
            [month, day, year] = [items[0] ?? '', items[1] ?? '', items[2] ?? ''];
        } else {
            [day, month, year] = [items[0] ?? '', items[1] ?? '', items[2] ?? ''];
        }
    }

    if (year === '' || month === '' || day === '') {
        log.errorf(ctx, `[qif_transaction_data_table.parseTransactionTime] cannot parse date "${date}"`);
        throw errs.ErrTransactionTimeInvalid;
    }

    return formatYearMonthDayToLongDateTime(year, month, day);
}

function parseQifTransaction(ctx: Context, dateFormatType: QifDateFormatType, qifTransaction: QifTransactionData): RowData {
    const data: RowData = new Map();

    if (qifTransaction.date === '') {
        throw errs.ErrMissingTransactionTime;
    }

    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, parseQifTransactionTime(ctx, dateFormatType, qifTransaction.date));

    if (qifTransaction.amount === '') {
        throw errs.ErrAmountInvalid;
    }

    let amount: number;

    try {
        amount = parseAmount(qifTransaction.amount.replaceAll(',', ''));
    } catch {
        throw errs.ErrAmountInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, qifTransaction.account ? qifTransaction.account.name : '');
    const category = qifTransaction.category;

    if (category.length > 0 && category.startsWith('[') && category.endsWith(']')) {
        const accountName = category.substring(1, category.length - 1);

        if (qifTransaction.payee === qifOpeningBalancePayeeText) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, modifyBalanceTypeName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
            data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName);
        } else {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, transferTypeName);

            if (amount >= 0) {
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) as string);
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, accountName);
            } else {
                data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, accountName);
            }
        }
    } else {
        if (amount >= 0) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeTypeName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));
        } else {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
        }

        if (category.indexOf(':') > 0) {
            const categories = category.split(':');
            data.set(TRANSACTION_DATA_TABLE_CATEGORY, categories[0] as string);
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, categories[categories.length - 1] as string);
        } else {
            data.set(TRANSACTION_DATA_TABLE_CATEGORY, '');
            data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, category);
        }
    }

    if (qifTransaction.memo !== '') {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, qifTransaction.memo);
    }

    if (qifTransaction.payee !== '' && qifTransaction.payee !== qifOpeningBalancePayeeText) {
        data.set(TRANSACTION_DATA_TABLE_PAYEE, qifTransaction.payee);
    }

    return data;
}

function createQifImporter(dateFormatType: QifDateFormatType): TransactionDataImporter {
    return {
        async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
            const allLines = scanLines(decodeWithBOMOverride(data));
            const allData = readQifTransactions(ctx, allLines);
            const transactionDataTable = createListTransactionDataTable(allData, qifTransactionSupportedColumns, (c, _user, item) => parseQifTransaction(c, dateFormatType, item), 'qif_transaction_data_table.Next');
            const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(qifTransactionTypeNameMapping);
            return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
        },
    };
}

export const QifYearMonthDayTransactionDataImporter = createQifImporter(qifYearMonthDayDateFormat);
export const QifMonthDayYearTransactionDataImporter = createQifImporter(qifMonthDayYearDateFormat);
export const QifDayMonthYearTransactionDataImporter = createQifImporter(qifDayMonthYearDateFormat);
