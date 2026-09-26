import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatTimezoneOffset, formatUnixTimeToLongDateTime, parseFromLongDateTimeWithTimezoneRFC3339Format } from '../utils/datetimes';
import { parseXml } from '../utils/xml';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TIMEZONE_NOT_AVAILABLE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataRow,
    type TransactionDataRowIterator,
    type TransactionDataTable,
    type TransactionDataTableColumn,
} from './datatable';
import { type DecodedObject, type DecodeSchema, decodeXmlElement, list, obj, sliceField, str, structField, textField, textSliceField } from './sgml';

const camtAmountSchema: DecodeSchema = {
    '#text': ['value', textField],
    '@Ccy': ['currency', textField],
};

const camtStatementSchema: DecodeSchema = {
    Acct: ['account', structField({
        'Id>IBAN': ['iban', textField],
        'Id>Othr>Id': ['otherIdentification', textField],
        'Ccy': ['currency', textField],
    })],
    Ntry: ['entries', sliceField({
        Amt: ['amount', structField(camtAmountSchema)],
        CdtDbtInd: ['creditDebitIndicator', textField],
        BookgDt: ['bookingDate', structField({
            Dt: ['date', textField],
            DtTm: ['dateTime', textField],
        })],
        NtryDtls: ['entryDetails', structField({
            TxDtls: ['transactionDetails', sliceField({
                AmtDtls: ['amountDetails', structField({
                    'InstdAmt>Amt': ['instructedAmount', structField(camtAmountSchema)],
                    'TxAmt>Amt': ['transactionAmount', structField(camtAmountSchema)],
                })],
                RmtInf: ['remittanceInformation', structField({ Ustrd: ['unstructured', textSliceField] })],
                AddtlTxInf: ['additionalTransactionInformation', textField],
            })],
        })],
        AddtlNtryInf: ['additionalEntryInformation', textField],
    })],
};

const camtTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

const camtTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

function getUnstructured(transactionDetails: DecodedObject | null): string[] | null {
    const unstructured = obj(transactionDetails, 'remittanceInformation')?.['unstructured'];
    return Array.isArray(unstructured) ? unstructured as string[] : null;
}

function parseCamtTransaction(account: DecodedObject | null, entry: DecodedObject, transactionDetails: DecodedObject | null, ctx: Context): RowData {
    const data: RowData = new Map();

    if (!account) {
        throw errs.ErrMissingAccountData;
    }

    const bookingDate = obj(entry, 'bookingDate');

    if (bookingDate && str(bookingDate, 'dateTime') !== '') {
        let dateTime;

        try {
            dateTime = parseFromLongDateTimeWithTimezoneRFC3339Format(str(bookingDate, 'dateTime'));
        } catch {
            throw errs.ErrTransactionTimeInvalid;
        }

        const unixTime = Math.floor(dateTime.toSeconds());
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, formatUnixTimeToLongDateTime(unixTime, dateTime.zone));
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, formatTimezoneOffset(unixTime, dateTime.zone));
    } else if (bookingDate && str(bookingDate, 'date') !== '') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, `${str(bookingDate, 'date')} 00:00:00`);
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE, TRANSACTION_DATA_TABLE_TIMEZONE_NOT_AVAILABLE);
    } else {
        throw errs.ErrMissingTransactionTime;
    }

    if (str(account, 'iban') !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, str(account, 'iban'));
    } else if (str(account, 'otherIdentification') !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, str(account, 'otherIdentification'));
    }

    const amountDetails = obj(transactionDetails, 'amountDetails');
    const transactionAmount = obj(amountDetails, 'transactionAmount');
    const instructedAmount = obj(amountDetails, 'instructedAmount');
    const entryAmount = obj(entry, 'amount');

    if (transactionAmount && str(transactionAmount, 'currency') !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, str(transactionAmount, 'currency'));
    } else if (entryAmount && str(entryAmount, 'currency') !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, str(entryAmount, 'currency'));
    } else if (str(account, 'currency') !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, str(account, 'currency'));
    } else {
        throw errs.ErrAccountCurrencyInvalid;
    }

    const entryDetails = obj(entry, 'entryDetails');
    let amountValue = '';

    if (entryDetails && list(entryDetails, 'transactionDetails').length > 1 && transactionDetails) {
        if (instructedAmount && str(instructedAmount, 'value') !== '') {
            amountValue = str(instructedAmount, 'value');
        } else if (transactionAmount && str(transactionAmount, 'value') !== '') {
            amountValue = str(transactionAmount, 'value');
        } else {
            throw errs.ErrAmountInvalid;
        }
    } else if (entryAmount && str(entryAmount, 'value') !== '') {
        amountValue = str(entryAmount, 'value');
    }

    if (amountValue === '') {
        throw errs.ErrAmountInvalid;
    }

    let amount: number;

    try {
        amount = parseAmount(amountValue);
    } catch (err) {
        log.errorf(ctx, `[camt_statement_transaction_data_table.parseTransaction] cannot parsing transaction amount "${amountValue}", because ${(err as Error).message}`);
        throw errs.ErrAmountInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));

    const indicator = str(entry, 'creditDebitIndicator');

    if (indicator === 'CRDT') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_INCOME));
    } else if (indicator === 'DBIT') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_EXPENSE));
    } else {
        throw errs.ErrTransactionTypeInvalid;
    }

    const unstructured = getUnstructured(transactionDetails);

    if (transactionDetails && str(transactionDetails, 'additionalTransactionInformation') !== '') {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(transactionDetails, 'additionalTransactionInformation'));
    } else if (transactionDetails && unstructured && unstructured.length > 0) {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, unstructured.join('\n'));
    } else if (str(entry, 'additionalEntryInformation') !== '') {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, str(entry, 'additionalEntryInformation'));
    } else {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, '');
    }

    return data;
}

class CamtStatementTransactionDataTable implements TransactionDataTable {
    public constructor(private readonly allStatements: DecodedObject[]) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return camtTransactionSupportedColumns.has(column);
    }

    public transactionRowCount(): number {
        let total = 0;

        for (const statement of this.allStatements) {
            for (const entry of list(statement, 'entries')) {
                const entryDetails = obj(entry, 'entryDetails');
                total += entryDetails ? list(entryDetails, 'transactionDetails').length : 1;
            }
        }

        return total;
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const allStatements = this.allStatements;
        let currentStatementIndex = 0;
        let currentEntryIndex = 0;
        let currentTransactionDetailsIndex = -1;

        return {
            hasNext: (): boolean => {
                if (currentStatementIndex >= allStatements.length) {
                    return false;
                }

                const entries = list(allStatements[currentStatementIndex], 'entries');

                if (currentEntryIndex + 1 < entries.length) {
                    return true;
                } else if (currentEntryIndex < entries.length) {
                    const entryDetails = obj(entries[currentEntryIndex], 'entryDetails');

                    if (entryDetails) {
                        if (currentTransactionDetailsIndex + 1 < list(entryDetails, 'transactionDetails').length) {
                            return true;
                        }
                    } else if (currentTransactionDetailsIndex < 0) {
                        return true;
                    }
                }

                for (let i = currentStatementIndex + 1; i < allStatements.length; i++) {
                    if (list(allStatements[i], 'entries').length > 0) {
                        return true;
                    }
                }

                return false;
            },
            next: async (ctx: Context, _user: User): Promise<TransactionDataRow | null> => {
                for (let i = currentStatementIndex; i < allStatements.length; i++) {
                    let foundNextRow = false;
                    const entries = list(allStatements[i], 'entries');

                    for (let j = currentEntryIndex; j < entries.length; j++) {
                        const entryDetails = obj(entries[j], 'entryDetails');

                        if (entryDetails) {
                            if (currentTransactionDetailsIndex + 1 < list(entryDetails, 'transactionDetails').length) {
                                currentTransactionDetailsIndex++;
                                foundNextRow = true;
                                break;
                            }
                        } else if (currentTransactionDetailsIndex < 0) {
                            currentTransactionDetailsIndex++;
                            foundNextRow = true;
                            break;
                        }

                        currentEntryIndex++;
                        currentTransactionDetailsIndex = -1;
                    }

                    if (foundNextRow) {
                        break;
                    }

                    currentStatementIndex++;
                    currentEntryIndex = 0;
                    currentTransactionDetailsIndex = -1;
                }

                if (currentStatementIndex >= allStatements.length) {
                    return null;
                }

                const currentStatement = allStatements[currentStatementIndex] as DecodedObject;
                const entries = list(currentStatement, 'entries');

                if (currentEntryIndex >= entries.length) {
                    return null;
                }

                const entry = entries[currentEntryIndex] as DecodedObject;
                const entryDetails = obj(entry, 'entryDetails');
                let transactionDetails: DecodedObject | null = null;

                if (entryDetails) {
                    const allDetails = list(entryDetails, 'transactionDetails');

                    if (currentTransactionDetailsIndex >= allDetails.length) {
                        return null;
                    }

                    transactionDetails = allDetails[currentTransactionDetailsIndex] as DecodedObject;
                } else if (currentTransactionDetailsIndex >= 1) {
                    return null;
                }

                let rowItems: RowData;

                try {
                    rowItems = parseCamtTransaction(obj(currentStatement, 'account'), entry, transactionDetails, ctx);
                } catch (err) {
                    log.errorf(ctx, `[camt_statement_transaction_data_table.Next] cannot parsing transaction in entry#${currentEntryIndex}-transaction_detail#${currentTransactionDetailsIndex} (statement#${currentStatementIndex}), because ${(err as Error).message}`);
                    throw err;
                }

                return {
                    isValid: () => true,
                    getData: (column: TransactionDataTableColumn) => (camtTransactionSupportedColumns.has(column) ? rowItems.get(column) ?? '' : ''),
                };
            },
        };
    }
}

function createCamtImporter(containerTag: string, statementTag: string): TransactionDataImporter {
    return {
        async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
            if (!(data.length > 5 && data.subarray(0, 5).toString('latin1') === '<?xml')) {
                throw errs.ErrInvalidXmlFile;
            }

            let root;

            try {
                root = parseXml(data);

                if (root.name !== 'Document') {
                    throw new Error(`expected element type <Document> but have <${root.name}>`);
                }
            } catch (err) {
                log.errorf(ctx, `[camt_transaction_data_file_importer.ParseImportedData] cannot read camt file, because ${(err as Error).message}`);
                throw err;
            }

            const container = decodeXmlElement(root, { [containerTag]: ['container', structField({ [statementTag]: ['statements', sliceField(camtStatementSchema)] })] });
            const statements = list(obj(container, 'container'), 'statements');

            if (!obj(container, 'container') || statements.length < 1) {
                throw errs.ErrNotFoundTransactionDataInFile;
            }

            const transactionDataTable = new CamtStatementTransactionDataTable(statements);
            const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(camtTransactionTypeNameMapping);
            return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
        },
    };
}

export const Camt052TransactionDataImporter = createCamtImporter('BkToCstmrAcctRpt', 'Rpt');
export const Camt053TransactionDataImporter = createCamtImporter('BkToCstmrStmt', 'Stmt');
