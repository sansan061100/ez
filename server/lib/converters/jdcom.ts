import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import { decodeWithBOMOverride } from '../utils/encodings';
import { extractDataTable, trimSpaces } from './chinese_extractor';
import {
    createNewSimpleImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TransactionDataImporter,
    type TransactionTypeNameMapping,
} from './converter';
import { createNewCsvBasicDataTable } from './csv';
import {
    type CommonDataTableRow,
    type CommonTransactionDataRowParser,
    createNewCommonDataTableFromBasicDataTable,
    createNewTransactionDataTableFromCommonDataTable,
    type RowData,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    type TransactionDataTableColumn,
} from './datatable';

const fileHeader = '导出信息：';
const timeColumnName = '交易时间';
const merchantNameColumnName = '商户名称';
const memoColumnName = '交易说明';
const amountColumnName = '金额';
const relatedAccountColumnName = '收/付款方式';
const statusColumnName = '交易状态';
const typeColumnName = '收/支';
const categoryColumnName = '交易分类';
const descriptionColumnName = '备注';

const amountRefundAll = '(已全额退款)';
const memoTransferToWalletPrefix = '充值';
const memoTransferFromWalletPrefix = '提现';
const memoTransferInText = '转入';
const memoTransferOutText = '转出';
const memoRepaymentText = '还款';
const memoRefundText = '退款';

const statusSuccessName = '交易成功';
const statusRefundSuccessName = '退款成功';

const incomeTypeName = '收入';
const expenseTypeName = '支出';
const transferTypeName = '不计收支';

const supportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

const typeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, incomeTypeName],
    [TRANSACTION_TYPE_EXPENSE, expenseTypeName],
    [TRANSACTION_TYPE_TRANSFER, transferTypeName],
]);

class JDComFinanceTransactionDataRowParser implements CommonTransactionDataRowParser {
    private readonly existedOriginalDataColumns: Set<string>;

    public constructor(headerColumnNames: string[]) {
        this.existedOriginalDataColumns = new Set(headerColumnNames);
    }

    public parse(ctx: Context, _user: User, dataRow: CommonDataTableRow, rowId: string): [RowData, boolean] {
        const prefix = 'jdcom_finance_transaction_data_row_parser.Parse';
        const typeName = dataRow.getData(typeColumnName);

        if (typeName !== incomeTypeName && typeName !== expenseTypeName && typeName !== transferTypeName) {
            log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because type is "${typeName}"`);
            return [new Map(), false];
        }

        const statusName = dataRow.getData(statusColumnName);

        if (statusName !== statusSuccessName && statusName !== statusRefundSuccessName) {
            log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because status is "${statusName}"`);
            return [new Map(), false];
        }

        const data: RowData = new Map();
        const amountText = dataRow.getData(amountColumnName);
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, dataRow.getData(timeColumnName));
        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, typeName);
        data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, dataRow.getData(categoryColumnName));
        data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, dataRow.getData(relatedAccountColumnName));
        data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
        data.set(TRANSACTION_DATA_TABLE_AMOUNT, amountText.indexOf('(') >= 0 ? amountText.split('(')[0] as string : amountText);

        if (this.existedOriginalDataColumns.has(descriptionColumnName) && dataRow.getData(descriptionColumnName) !== '') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, dataRow.getData(descriptionColumnName));
        } else if (this.existedOriginalDataColumns.has(memoColumnName) && dataRow.getData(memoColumnName) !== '') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, dataRow.getData(memoColumnName));
        } else {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, '');
        }

        if (typeName === transferTypeName) {
            const memo = dataRow.getData(memoColumnName);
            const merchantName = dataRow.getData(merchantNameColumnName);

            if (statusName === statusRefundSuccessName || memo.indexOf(memoRefundText) >= 0) {
                try {
                    const amount = parseAmount(data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
                    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
                    data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
                } catch {
                    // keep original data
                }
            } else if (amountText.indexOf(amountRefundAll) > 0) {
                data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
            } else if (memo.indexOf(memoTransferToWalletPrefix) >= 0) {
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, merchantName);
            } else if (memo.indexOf(memoTransferFromWalletPrefix) >= 0) {
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) as string);
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, merchantName);
            } else if (memo.indexOf(memoTransferInText) >= 0) {
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, merchantName);
            } else if (memo.indexOf(memoTransferOutText) >= 0) {
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, data.get(TRANSACTION_DATA_TABLE_ACCOUNT_NAME) as string);
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, merchantName);
            } else if (memo.indexOf(memoRepaymentText) >= 0) {
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, merchantName);
            } else {
                log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because memo ("${memo}") of this transfer transaction is unknown`);
                return [new Map(), false];
            }
        }

        return [data, true];
    }
}

export const JDComFinanceTransactionDataCsvFileImporter: TransactionDataImporter = {
    async parseImportedData(ctx, user, data, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap): Promise<ImportedDataResult> {
        const csvDataTable = createNewCsvBasicDataTable(ctx, decodeWithBOMOverride(data), false);
        const dataTable = extractDataTable(ctx, csvDataTable, {
            logPrefix: 'jdcom_finance_transaction_data_extrator.createNewJDComFinanceTransactionBasicDataTable',
            fileHeader: fileHeader,
            isDataHeaderStart: firstColumn => firstColumn === timeColumnName,
            includeDataHeaderStartLine: true,
            trimItem: item => trimSpaces(item).replace(/\t+$/, ''),
        });

        const commonDataTable = createNewCommonDataTableFromBasicDataTable(dataTable);

        if (!commonDataTable.hasColumn(timeColumnName) ||
            !commonDataTable.hasColumn(merchantNameColumnName) ||
            !commonDataTable.hasColumn(memoColumnName) ||
            !commonDataTable.hasColumn(amountColumnName) ||
            !commonDataTable.hasColumn(relatedAccountColumnName) ||
            !commonDataTable.hasColumn(statusColumnName) ||
            !commonDataTable.hasColumn(typeColumnName)) {
            log.errorf(ctx, '[jdcom_finance_transaction_data_csv_file_importer.ParseImportedData] cannot parse jd.com finance csv data, because missing essential columns in header row');
            throw errs.ErrMissingRequiredFieldInHeaderRow;
        }

        const transactionRowParser = new JDComFinanceTransactionDataRowParser(dataTable.headerColumnNames());
        const transactionDataTable = createNewTransactionDataTableFromCommonDataTable(commonDataTable, supportedColumns, transactionRowParser);
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(typeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    },
};
