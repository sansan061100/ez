import iconv from 'iconv-lite';

import type { Context } from '../core/context';
import * as errs from '../errs/index';
import { getLocaleTextItems } from '../locales/index';
import * as log from '../log/index';
import { TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_TRANSFER, type User } from '../models/index';
import { formatAmount, parseAmount } from '../utils/converter';
import type { Timezone } from '../utils/datetimes';
import { containsAnyString, containsOnlyOneRune } from '../utils/strings';
import {
    type AccountNameMap,
    type CategoryNameMap,
    createNewSimpleImporterWithTypeNameMapping,
    type ImportedDataResult,
    type TagNameMap,
    type TransactionDataImporter,
    type TransactionDataImporterOptions,
    type TransactionTypeNameMapping,
} from './converter';
import { createNewCsvBasicDataTable, createNewCustomCsvBasicDataTable } from './csv';
import {
    type BasicDataTable,
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

const alipayTransactionSupportedColumns = new Set<TransactionDataTableColumn>([
    TRANSACTION_DATA_TABLE_TRANSACTION_TIME,
    TRANSACTION_DATA_TABLE_TRANSACTION_TYPE,
    TRANSACTION_DATA_TABLE_SUB_CATEGORY,
    TRANSACTION_DATA_TABLE_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_AMOUNT,
    TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME,
    TRANSACTION_DATA_TABLE_DESCRIPTION,
]);

const alipayTransactionTypeNameMapping: TransactionTypeNameMapping = new Map([
    [TRANSACTION_TYPE_INCOME, '收入'],
    [TRANSACTION_TYPE_EXPENSE, '支出'],
    [TRANSACTION_TYPE_TRANSFER, '不计收支'],
]);

const incomeTypeName = '收入';
const expenseTypeName = '支出';
const transferTypeName = '不计收支';

interface AlipayTransactionColumnNames {
    timeColumnName: string;
    categoryColumnName: string;
    targetNameColumnName: string;
    productNameColumnName: string;
    amountColumnName: string;
    typeColumnName: string;
    relatedAccountColumnName: string;
    statusColumnName: string;
    descriptionColumnName: string;
}

const alipayTransactionDataStatusSuccessName = '交易成功';
const alipayTransactionDataStatusPaymentSuccessName = '支付成功';
const alipayTransactionDataStatusPendingGoodsReceiptConfirmationName = '等待确认收货';
const alipayTransactionDataStatusRepaymentSuccessName = '还款成功';
const alipayTransactionDataStatusClosedName = '交易关闭';
const alipayTransactionDataStatusRefundSuccessName = '退款成功';
const alipayTransactionDataStatusTaxRefundSuccessName = '退税成功';

const alipayTransactionDataProductNameEarningText = '-收益发放';
const alipayTransactionDataProductNamePurchaseInvestmentText = '-买入';
const alipayTransactionDataProductNamePurchaseInvestmentRefundText = '-买入退款';
const alipayTransactionDataProductNameSellInvestmentRefundText = '-卖出';
const alipayTransactionDataProductNameTransferToAlipayPrefix = '充值-';
const alipayTransactionDataProductNameTransferFromAlipayPrefix = '提现-';
const alipayTransactionDataProductNameTransferInText = '转入';
const alipayTransactionDataProductNameTransferOutText = '转出';
const alipayTransactionDataProductNameTransferText = '转账';
const alipayTransactionDataProductNameRepaymentText = '还款';

// firstIndexIsSuffix returns whether the first occurrence of sub is at the end of s (and s is longer than sub)
export function firstIndexIsSuffix(s: string, sub: string): boolean {
    return s.length > sub.length && s.indexOf(sub) === s.length - sub.length;
}

function trimSpaces(s: string): string {
    return s.replace(/^ +| +$/g, '');
}

function createNewAlipayTransactionBasicDataTable(ctx: Context, originalDataTable: BasicDataTable, fileHeaderLine: string, dataHeaderStartContent: string[], dataBottomEndLineRune: string): BasicDataTable {
    const prefix = 'alipay_transaction_data_extrator.createNewAlipayTransactionBasicDataTable';
    const iterator = originalDataTable.dataRowIterator();
    const allOriginalLines: string[][] = [];
    let hasFileHeader = false;
    let foundContentBeforeDataHeaderLine = false;

    while (iterator.hasNext()) {
        const row = iterator.next();

        if (!row) {
            break;
        }

        if (!hasFileHeader) {
            if (row.columnCount() <= 0) {
                continue;
            } else if (row.getData(0).indexOf(fileHeaderLine) === 0) {
                hasFileHeader = true;
                continue;
            } else {
                log.warnf(ctx, `[${prefix}] read unexpected line in row "${iterator.currentRowId()}" before read file header`);
                continue;
            }
        }

        if (!foundContentBeforeDataHeaderLine) {
            if (row.columnCount() > 0 && containsAnyString(row.getData(0), dataHeaderStartContent)) {
                foundContentBeforeDataHeaderLine = true;
            }

            continue;
        }

        if (row.columnCount() <= 0) {
            continue;
        } else if (row.columnCount() === 1 && dataBottomEndLineRune !== '' && containsOnlyOneRune(row.getData(0), dataBottomEndLineRune)) {
            break;
        }

        const items: string[] = [];

        for (let i = 0; i < row.columnCount(); i++) {
            items.push(trimSpaces(row.getData(i)));
        }

        if (allOriginalLines.length > 0 && items.length < (allOriginalLines[0] as string[]).length) {
            log.errorf(ctx, `[${prefix}] cannot parse row "${iterator.currentRowId()}", because may missing some columns (column count ${items.length} in data row is less than header column count ${(allOriginalLines[0] as string[]).length})`);
            throw errs.ErrFewerFieldsInDataRowThanInHeaderRow;
        }

        allOriginalLines.push(items);
    }

    if (!hasFileHeader || !foundContentBeforeDataHeaderLine) {
        throw errs.ErrInvalidFileHeader;
    }

    if (allOriginalLines.length < 2) {
        log.errorf(ctx, `[${prefix}] cannot parse import data, because data table row count is less 1`);
        throw errs.ErrNotFoundTransactionDataInFile;
    }

    return createNewCustomCsvBasicDataTable(allOriginalLines, true);
}

class AlipayTransactionDataRowParser implements CommonTransactionDataRowParser {
    private readonly existedOriginalDataColumns: Set<string>;

    public constructor(private readonly columns: AlipayTransactionColumnNames, headerColumnNames: string[]) {
        this.existedOriginalDataColumns = new Set(headerColumnNames);
    }

    private hasOriginalColumn(columnName: string): boolean {
        return this.existedOriginalDataColumns.has(columnName);
    }

    public parse(ctx: Context, user: User, dataRow: CommonDataTableRow, rowId: string): [RowData, boolean] {
        const prefix = 'alipay_transaction_data_row_parser.Parse';
        const columns = this.columns;
        const typeName = dataRow.getData(columns.typeColumnName);
        const status = dataRow.getData(columns.statusColumnName);

        if (typeName !== incomeTypeName && typeName !== expenseTypeName && typeName !== transferTypeName) {
            log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because type is "${typeName}"`);
            return [new Map(), false];
        }

        if (status !== alipayTransactionDataStatusSuccessName &&
            status !== alipayTransactionDataStatusPaymentSuccessName &&
            status !== alipayTransactionDataStatusPendingGoodsReceiptConfirmationName &&
            status !== alipayTransactionDataStatusRepaymentSuccessName &&
            status !== alipayTransactionDataStatusClosedName &&
            status !== alipayTransactionDataStatusRefundSuccessName &&
            status !== alipayTransactionDataStatusTaxRefundSuccessName) {
            log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because status is "${status}"`);
            return [new Map(), false];
        }

        const data: RowData = new Map();

        if (this.hasOriginalColumn(columns.timeColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TIME, dataRow.getData(columns.timeColumnName));
        }

        data.set(TRANSACTION_DATA_TABLE_SUB_CATEGORY, this.hasOriginalColumn(columns.categoryColumnName) ? dataRow.getData(columns.categoryColumnName) : '');

        if (this.hasOriginalColumn(columns.amountColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_AMOUNT, dataRow.getData(columns.amountColumnName));
        }

        if (this.hasOriginalColumn(columns.descriptionColumnName) && dataRow.getData(columns.descriptionColumnName) !== '') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, dataRow.getData(columns.descriptionColumnName));
        } else if (this.hasOriginalColumn(columns.productNameColumnName) && dataRow.getData(columns.productNameColumnName) !== '') {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, dataRow.getData(columns.productNameColumnName));
        } else {
            data.set(TRANSACTION_DATA_TABLE_DESCRIPTION, '');
        }

        const relatedAccountName = this.hasOriginalColumn(columns.relatedAccountColumnName) ? dataRow.getData(columns.relatedAccountColumnName) : '';
        const statusName = this.hasOriginalColumn(columns.statusColumnName) ? dataRow.getData(columns.statusColumnName) : '';

        let locale = user.language;

        if (locale === '') {
            locale = ctx.getClientLocale();
        }

        const alipayName = getLocaleTextItems(locale).dataConverterTextItems.alipay;

        if (this.hasOriginalColumn(columns.typeColumnName)) {
            data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, typeName);

            if (typeName === incomeTypeName) {
                if (statusName === alipayTransactionDataStatusClosedName) {
                    log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because income transaction is closed`);
                    return [new Map(), false];
                }

                if (statusName === alipayTransactionDataStatusSuccessName) {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, alipayName);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
                } else {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, '');
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
                }
            } else if (typeName === transferTypeName) {
                if (statusName === alipayTransactionDataStatusClosedName) {
                    log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because non-income/expense transaction is closed`);
                    return [new Map(), false];
                }

                const targetName = this.hasOriginalColumn(columns.targetNameColumnName) ? dataRow.getData(columns.targetNameColumnName) : '';
                const productName = this.hasOriginalColumn(columns.productNameColumnName) ? dataRow.getData(columns.productNameColumnName) : '';
                const setAccounts = (account: string, relatedAccount: string): void => {
                    data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, account);
                    data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, relatedAccount);
                };

                if (statusName === alipayTransactionDataStatusRefundSuccessName) {
                    if (firstIndexIsSuffix(productName, alipayTransactionDataProductNamePurchaseInvestmentText)) {
                        setAccounts(relatedAccountName, targetName);
                    } else if (firstIndexIsSuffix(productName, alipayTransactionDataProductNamePurchaseInvestmentRefundText)) {
                        setAccounts(targetName, relatedAccountName);
                    } else {
                        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeTypeName);
                        setAccounts(relatedAccountName, '');
                    }
                } else {
                    if (firstIndexIsSuffix(productName, alipayTransactionDataProductNameEarningText)) {
                        data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, incomeTypeName);
                        setAccounts(relatedAccountName, targetName);
                    } else if (firstIndexIsSuffix(productName, alipayTransactionDataProductNamePurchaseInvestmentText)) {
                        setAccounts(relatedAccountName, targetName);
                    } else if (productName.indexOf(alipayTransactionDataProductNameSellInvestmentRefundText) >= 0) {
                        setAccounts(targetName, relatedAccountName);
                    } else if (productName.indexOf(alipayTransactionDataProductNameTransferToAlipayPrefix) === 0) {
                        setAccounts('', alipayName);
                    } else if (productName.indexOf(alipayTransactionDataProductNameTransferFromAlipayPrefix) === 0) {
                        setAccounts(alipayName, targetName);
                    } else if (productName.indexOf(alipayTransactionDataProductNameTransferInText) >= 0 ||
                        productName.indexOf(alipayTransactionDataProductNameTransferOutText) >= 0 ||
                        productName.indexOf(alipayTransactionDataProductNameTransferText) >= 0 ||
                        productName.indexOf(alipayTransactionDataProductNameRepaymentText) >= 0) {
                        setAccounts(relatedAccountName, targetName);
                    } else {
                        log.warnf(ctx, `[${prefix}] skip parsing transaction in row "${rowId}", because product name ("${productName}") is unknown`);
                        return [new Map(), false];
                    }
                }
            } else {
                data.set(TRANSACTION_DATA_TABLE_ACCOUNT_NAME, relatedAccountName);
                data.set(TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME, '');
            }
        }

        if (data.get(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE) === incomeTypeName && statusName !== '') {
            if (statusName === alipayTransactionDataStatusRefundSuccessName || statusName === alipayTransactionDataStatusTaxRefundSuccessName) {
                try {
                    const amount = parseAmount(data.get(TRANSACTION_DATA_TABLE_AMOUNT) ?? '');
                    data.set(TRANSACTION_DATA_TABLE_TRANSACTION_TYPE, expenseTypeName);
                    data.set(TRANSACTION_DATA_TABLE_AMOUNT, formatAmount(-amount));
                } catch {
                    // keep original data
                }
            }
        }

        return [data, true];
    }
}

// AlipayTransactionDataCsvFileImporter defines the structure of alipay csv importer for transaction data
class AlipayTransactionDataCsvFileImporter implements TransactionDataImporter {
    public constructor(
        private readonly fileHeaderLine: string,
        private readonly dataHeaderStartContent: string[],
        private readonly dataBottomEndLineRune: string,
        private readonly originalColumnNames: AlipayTransactionColumnNames,
    ) {
    }

    public async parseImportedData(ctx: Context, user: User, data: Buffer, defaultTimezone: Timezone, additionalOptions: TransactionDataImporterOptions, accountMap: AccountNameMap | null, expenseCategoryMap: CategoryNameMap | null, incomeCategoryMap: CategoryNameMap | null, transferCategoryMap: CategoryNameMap | null, tagMap: TagNameMap | null): Promise<ImportedDataResult> {
        const content = iconv.decode(data, 'gb18030', { stripBOM: false });
        const csvDataTable = createNewCsvBasicDataTable(ctx, content, false);
        const dataTable = createNewAlipayTransactionBasicDataTable(ctx, csvDataTable, this.fileHeaderLine, this.dataHeaderStartContent, this.dataBottomEndLineRune);
        const commonDataTable = createNewCommonDataTableFromBasicDataTable(dataTable);
        const columns = this.originalColumnNames;

        if (!commonDataTable.hasColumn(columns.timeColumnName) ||
            !commonDataTable.hasColumn(columns.amountColumnName) ||
            !commonDataTable.hasColumn(columns.typeColumnName) ||
            !commonDataTable.hasColumn(columns.statusColumnName)) {
            log.errorf(ctx, '[alipay_transaction_data_csv_file_importer.ParseImportedData] cannot parse alipay csv data, because missing essential columns in header row');
            throw errs.ErrMissingRequiredFieldInHeaderRow;
        }

        const transactionRowParser = new AlipayTransactionDataRowParser(columns, dataTable.headerColumnNames());
        const transactionDataTable = createNewTransactionDataTableFromCommonDataTable(commonDataTable, alipayTransactionSupportedColumns, transactionRowParser);
        const dataTableImporter = createNewSimpleImporterWithTypeNameMapping(alipayTransactionTypeNameMapping);
        return dataTableImporter.parseImportedData(ctx, user, transactionDataTable, defaultTimezone, additionalOptions, accountMap, expenseCategoryMap, incomeCategoryMap, transferCategoryMap, tagMap);
    }
}

export const AlipayAppTransactionDataCsvFileImporter = new AlipayTransactionDataCsvFileImporter(
    '------------------------------------------------------------------------------------',
    ['支付宝（中国）网络技术有限公司  电子客户回单', '支付宝支付科技有限公司  电子客户回单'],
    '',
    {
        timeColumnName: '交易时间',
        categoryColumnName: '交易分类',
        targetNameColumnName: '交易对方',
        productNameColumnName: '商品说明',
        amountColumnName: '金额',
        typeColumnName: '收/支',
        relatedAccountColumnName: '收/付款方式',
        statusColumnName: '交易状态',
        descriptionColumnName: '备注',
    },
);

export const AlipayWebTransactionDataCsvFileImporter = new AlipayTransactionDataCsvFileImporter(
    '支付宝交易记录明细查询',
    ['交易记录明细列表'],
    '-',
    {
        timeColumnName: '交易创建时间',
        categoryColumnName: '',
        targetNameColumnName: '交易对方',
        productNameColumnName: '商品名称',
        amountColumnName: '金额（元）',
        typeColumnName: '收/支',
        relatedAccountColumnName: '',
        statusColumnName: '交易状态',
        descriptionColumnName: '备注',
    },
);
