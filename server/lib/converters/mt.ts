import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { formatYearMonthDayToLongDateTime } from '../utils/datetimes';
import { decodeWithBOMOverride } from '../utils/encodings';
import { scanLines } from '../utils/strings';
import { createNewSimpleImporterWithTypeNameMapping, type ImportedDataResult, type TransactionDataImporter, type TransactionTypeNameMapping } from './converter';
import {
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTableColumn,
} from './datatable';
import { createListTransactionDataTable } from './ofx';

interface MtBalance {
    debitCreditMark: string;
    date: string;
    currency: string;
    amount: string;
}

interface MtStatement {
    valueDate: string;
    entryDate: string;
    creditDebitMark: string;
    fundsCode: string;
    amount: string;
    transactionTypeIdentificationCode: string;
    referenceForAccountOwner: string;
    referenceOfAccountServicingInstitution: string;
    informationToAccountOwner: string[];
}

interface Mt940Data {
    accountId: string;
    openingBalance: MtBalance | null;
    closingBalance: MtBalance | null;
    statements: MtStatement[];
}

const tagStatementReferenceNumber = ':20:';
const tagRelatedReference = ':21:';
const tagAccountId = ':25:';
const tagSequentialNumber = ':28C:';
const tagOpeningBalanceF = ':60F:';
const tagOpeningBalanceM = ':60M:';
const tagClosingBalanceF = ':62F:';
const tagClosingBalanceM = ':62M:';
const tagClosingAvailableBalance = ':64:';
const tagStatementLine = ':61:';
const tagInformationToAccountOwner = ':86:';
const informationToAccountOwnerMaxLines = 6;

function newData(): Mt940Data {
    return { accountId: '', openingBalance: null, closingBalance: null, statements: [] };
}

// goSlice returns the substring like go s[start:end] and throws if out of range (go panics)
function goSlice(s: string, start: number, end: number = s.length): string {
    if (start < 0 || end > s.length || start > end) {
        throw errs.ErrInvalidMT940File;
    }

    return s.substring(start, end);
}

function parseBalance(ctx: Context, data: string): MtBalance {
    if (data.length < 9) {
        throw errs.ErrInvalidMT940File;
    }

    if (data[0] !== 'D' && data[0] !== 'C') {
        log.errorf(ctx, `[mt_data_reader.parseBalance] cannot parse unknown debit/credit mark, current line is ${data}`);
        throw errs.ErrTransactionTypeInvalid;
    }

    return {
        debitCreditMark: goSlice(data, 0, 1),
        date: goSlice(data, 1, 7),
        currency: goSlice(data, 7, 10),
        amount: goSlice(data, 10),
    };
}

function isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
}

function parseStatement(ctx: Context, data: string): MtStatement {
    const prefix = 'mt_data_reader.parseStatement';

    if (data.length < 6) {
        throw errs.ErrInvalidMT940File;
    }

    const statement: MtStatement = {
        valueDate: data.substring(0, 6),
        entryDate: '',
        creditDebitMark: '',
        fundsCode: '',
        amount: '',
        transactionTypeIdentificationCode: '',
        referenceForAccountOwner: '',
        referenceOfAccountServicingInstitution: '',
        informationToAccountOwner: [],
    };

    let currentIndex = 6;

    if (data.length >= currentIndex + 4 && isDigit(data[currentIndex])) {
        statement.entryDate = data.substring(6, 10);
        currentIndex += 4;
    }

    if (data.length >= currentIndex + 1 && (data[currentIndex] === 'D' || data[currentIndex] === 'C')) {
        statement.creditDebitMark = data[currentIndex] as string;
        currentIndex++;
    } else if (data.length >= currentIndex + 2 && (data.substring(currentIndex, currentIndex + 2) === 'RC' || data.substring(currentIndex, currentIndex + 2) === 'RD')) {
        statement.creditDebitMark = data.substring(currentIndex, currentIndex + 2);
        currentIndex += 2;
    } else {
        log.errorf(ctx, `[${prefix}] cannot parse unknown debit/credit mark, current line is ${data}`);
        throw errs.ErrTransactionTypeInvalid;
    }

    if (data.length >= currentIndex + 1 && (data[currentIndex] as string) >= 'A' && (data[currentIndex] as string) <= 'Z') {
        statement.fundsCode = data[currentIndex] as string;
        currentIndex++;
    }

    let amountValue = '';

    for (let i = currentIndex; i < data.length; i++) {
        if (amountValue.length < 15 && (isDigit(data[i]) || data[i] === ',')) {
            amountValue += data[i];
        } else {
            currentIndex = i;
            break;
        }
    }

    statement.amount = amountValue;

    if (statement.amount.length < 1) {
        log.errorf(ctx, `[${prefix}] cannot parse amount, current line is ${data}`);
        throw errs.ErrAmountInvalid;
    }

    if (data.length >= currentIndex + 4 && (data[currentIndex] === 'S' || data[currentIndex] === 'N' || data[currentIndex] === 'F')) {
        statement.transactionTypeIdentificationCode = data.substring(currentIndex, currentIndex + 4);
        currentIndex += 4;
    } else {
        log.errorf(ctx, `[${prefix}] cannot parse transaction type identification code, current line is ${data}`);
        throw errs.ErrInvalidMT940File;
    }

    let accountOwnerReference = '';

    for (let i = currentIndex; i < data.length; i++) {
        if (accountOwnerReference.length < 16 && (data[i] !== '/' || (data[i] === '/' && (i >= data.length - 1 || data[i + 1] !== '/')))) {
            accountOwnerReference += data[i];
        } else {
            currentIndex = i;
            break;
        }
    }

    statement.referenceForAccountOwner = accountOwnerReference;

    if (statement.referenceForAccountOwner.length < 1) {
        log.errorf(ctx, `[${prefix}] cannot parse reference for account owner, current line is ${data}`);
        throw errs.ErrInvalidMT940File;
    }

    if (data.length >= currentIndex + 3 && data[currentIndex] === '/' && data[currentIndex + 1] === '/') {
        let accountServicingInstitutionReference = '';
        currentIndex += 2;

        for (let i = currentIndex; i < data.length; i++) {
            if (accountServicingInstitutionReference.length < 16) {
                accountServicingInstitutionReference += data[i];
            } else {
                break;
            }
        }

        statement.referenceOfAccountServicingInstitution = accountServicingInstitutionReference;
    }

    return statement;
}

function readMt940Data(ctx: Context, allLines: string[]): Mt940Data {
    if (allLines.length < 1) {
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    let data = newData();
    let currentStatement: MtStatement | null = null;
    let lastTag = '';

    for (const originalLine of allLines) {
        const line = originalLine.trim();

        if (line.length < 1) {
            continue;
        }

        if (line.startsWith('{1:') && line.endsWith('{4:')) {
            data = newData();
            currentStatement = null;
            lastTag = '';
            continue;
        } else if (line.startsWith('-}')) {
            break;
        }

        if (line.startsWith(tagStatementReferenceNumber)) {
            lastTag = tagStatementReferenceNumber;
        } else if (line.startsWith(tagRelatedReference)) {
            lastTag = tagRelatedReference;
        } else if (line.startsWith(tagAccountId)) {
            data.accountId = line.substring(tagAccountId.length);
            lastTag = tagAccountId;
        } else if (line.startsWith(tagSequentialNumber)) {
            lastTag = tagSequentialNumber;
        } else if (line.startsWith(tagOpeningBalanceF) || line.startsWith(tagOpeningBalanceM)) {
            data.openingBalance = parseBalance(ctx, line.substring(tagOpeningBalanceF.length));
            lastTag = line.substring(0, tagOpeningBalanceF.length);
        } else if (line.startsWith(tagClosingBalanceF) || line.startsWith(tagClosingBalanceM)) {
            data.closingBalance = parseBalance(ctx, line.substring(tagClosingBalanceF.length));
            lastTag = line.substring(0, tagClosingBalanceF.length);
        } else if (line.startsWith(tagClosingAvailableBalance)) {
            parseBalance(ctx, line.substring(tagClosingAvailableBalance.length));
            lastTag = tagClosingAvailableBalance;
        } else if (line.startsWith(tagStatementLine)) {
            if (currentStatement) {
                data.statements.push(currentStatement);
            }

            currentStatement = parseStatement(ctx, line.substring(tagStatementLine.length));
            lastTag = tagStatementLine;
        } else if (line.startsWith(tagInformationToAccountOwner) && currentStatement) {
            currentStatement.informationToAccountOwner = [line.substring(tagInformationToAccountOwner.length)];
            lastTag = tagInformationToAccountOwner;
        } else if (line[0] !== ':' && lastTag === tagStatementLine && currentStatement) {
            currentStatement.referenceForAccountOwner += line;
            lastTag = '';
        } else if (line[0] !== ':' && lastTag === tagInformationToAccountOwner && currentStatement && currentStatement.informationToAccountOwner.length < informationToAccountOwnerMaxLines) {
            currentStatement.informationToAccountOwner.push(line);
            lastTag = tagInformationToAccountOwner;
        } else {
            log.warnf(ctx, `[mt_data_reader.read] unsupported line "${line}" and skip this line`);
        }
    }

    if (currentStatement) {
        data.statements.push(currentStatement);
    }

    return data;
}

function getInformationToAccountOwnerMap(statement: MtStatement): Map<string, string> {
    const additionalInfoMap = new Map<string, string>();

    for (const info of statement.informationToAccountOwner) {
        const items = info.split('/');

        if (items.length < 3) {
            continue;
        }

        for (let i = 2; i < items.length; i += 2) {
            const key = (items[i - 1] as string).trim();
            const value = (items[i] as string).trim();

            if (key.length > 0) {
                additionalInfoMap.set(key, value);
            }
        }
    }

    return additionalInfoMap;
}

const mt940TransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, String(TRANSACTION_TYPE_INCOME)],
    [TRANSACTION_TYPE_EXPENSE, String(TRANSACTION_TYPE_EXPENSE)],
    [TRANSACTION_TYPE_TRANSFER, String(TRANSACTION_TYPE_TRANSFER)],
]);

const mt940TransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

function parseMtTransaction(ctx: Context, mt940Data: Mt940Data, statement: MtStatement, index: number): RowData {
    const data: RowData = new Map();
    let transactionTime: string;

    try {
        transactionTime = formatYearMonthDayToLongDateTime(statement.valueDate.substring(0, 2), statement.valueDate.substring(2, 4), statement.valueDate.substring(4, 6));
    } catch (err) {
        log.errorf(ctx, `[mt_transaction_data_table.parseTransaction] cannot format transaction time in row#${index}, because ${(err as Error).message}`);
        throw errs.ErrTransactionTimeInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, transactionTime);
    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, mt940Data.accountId);

    if (mt940Data.openingBalance && mt940Data.openingBalance.currency !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, mt940Data.openingBalance.currency);
    } else if (mt940Data.closingBalance && mt940Data.closingBalance.currency !== '') {
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY, mt940Data.closingBalance.currency);
    } else {
        throw errs.ErrAccountCurrencyInvalid;
    }

    let amountValue = statement.amount.replaceAll(',', '.');

    if (amountValue.length > 0 && amountValue.endsWith('.')) {
        amountValue = amountValue.substring(0, amountValue.length - 1);
    }

    let amount: number;

    try {
        amount = parseAmount(amountValue);
    } catch (err) {
        log.errorf(ctx, `[mt_transaction_data_table.parseTransaction] cannot parsing transaction amount "${statement.amount}", because ${(err as Error).message}`);
        throw errs.ErrAmountInvalid;
    }

    data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(amount));

    if (statement.creditDebitMark === 'C' || statement.creditDebitMark === 'RD') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_INCOME));
    } else if (statement.creditDebitMark === 'D' || statement.creditDebitMark === 'RC') {
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, String(TRANSACTION_TYPE_EXPENSE));
    } else {
        throw errs.ErrTransactionTypeInvalid;
    }

    const informationToAccountOwnerMap = getInformationToAccountOwnerMap(statement);

    if (informationToAccountOwnerMap.size > 0) {
        const remittance = informationToAccountOwnerMap.get('REMI');

        if (remittance !== undefined) {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, remittance);
        }
    } else {
        data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, statement.informationToAccountOwner.join('\n'));
    }

    return data;
}

export const MT940TransactionDataFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const mt940Data = readMt940Data(ctx, scanLines(decodeWithBOMOverride(data)));

        if (mt940Data.statements.length < 1) {
            throw errs.ErrNotFoundTransactionDataInFile;
        }

        const transactionDataTable = createListTransactionDataTable(mt940Data.statements, mt940TransactionSupportedColumns, (c, _user, item, index) => parseMtTransaction(c, mt940Data, item, index), 'mt_transaction_data_table.Next');
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(mt940TransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
