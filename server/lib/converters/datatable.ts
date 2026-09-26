import type { Context } from '../core/context';
import * as errs from '../errs/index';
import * as log from '../log/index';
import type { User } from '../models/index';

// TransactionDataTableColumn represents the data column type of transaction data table
export type TransactionDataTableColumn = number;

export const TRANSACTION_DATA_TABLE_TRANSACTION_TIME = 1;
export const TRANSACTION_DATA_TABLE_TRANSACTION_TIMEZONE = 2;
export const TRANSACTION_DATA_TABLE_TRANSACTION_TYPE = 3;
export const TRANSACTION_DATA_TABLE_CATEGORY = 4;
export const TRANSACTION_DATA_TABLE_SUB_CATEGORY = 5;
export const TRANSACTION_DATA_TABLE_ACCOUNT_NAME = 6;
export const TRANSACTION_DATA_TABLE_ACCOUNT_CURRENCY = 7;
export const TRANSACTION_DATA_TABLE_AMOUNT = 8;
export const TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_NAME = 9;
export const TRANSACTION_DATA_TABLE_RELATED_ACCOUNT_CURRENCY = 10;
export const TRANSACTION_DATA_TABLE_RELATED_AMOUNT = 11;
export const TRANSACTION_DATA_TABLE_GEOGRAPHIC_LOCATION = 12;
export const TRANSACTION_DATA_TABLE_TAGS = 13;
export const TRANSACTION_DATA_TABLE_DESCRIPTION = 14;
export const TRANSACTION_DATA_TABLE_PAYEE = 101;
export const TRANSACTION_DATA_TABLE_MEMBER = 102;
export const TRANSACTION_DATA_TABLE_PROJECT = 103;
export const TRANSACTION_DATA_TABLE_MERCHANT = 104;

export const TRANSACTION_DATA_TABLE_TIMEZONE_NOT_AVAILABLE = 'TIMEZONE_NOT_AVAILABLE';

export type RowData = Map<TransactionDataTableColumn, string>;

// BasicDataTable defines the structure of basic data table
export interface BasicDataTable {
    dataRowCount(): number;
    headerColumnNames(): string[];
    dataRowIterator(): BasicDataTableRowIterator;
}

// BasicDataTableRow defines the structure of basic data table row
export interface BasicDataTableRow {
    columnCount(): number;
    getData(columnIndex: number): string;
}

// BasicDataTableRowIterator defines the structure of basic data table row iterator
export interface BasicDataTableRowIterator {
    hasNext(): boolean;
    currentRowId(): string;
    next(): BasicDataTableRow | null;
}

// CommonDataTable defines the structure of common data table
export interface CommonDataTable {
    headerColumnCount(): number;
    hasColumn(columnName: string): boolean;
    dataRowCount(): number;
    dataRowIterator(): CommonDataTableRowIterator;
}

// CommonDataTableRow defines the structure of common data table row
export interface CommonDataTableRow {
    columnCount(): number;
    hasData(columnName: string): boolean;
    getData(columnName: string): string;
}

// CommonDataTableRowIterator defines the structure of common data table row iterator
export interface CommonDataTableRowIterator {
    hasNext(): boolean;
    currentRowId(): string;
    next(): CommonDataTableRow | null;
}

// TransactionDataTable defines the structure of transaction data table
export interface TransactionDataTable {
    hasColumn(column: TransactionDataTableColumn): boolean;
    transactionRowCount(): number;
    transactionRowIterator(): TransactionDataRowIterator;
}

// TransactionDataRow defines the structure of transaction data row
export interface TransactionDataRow {
    isValid(): boolean;
    getData(column: TransactionDataTableColumn): string;
}

// TransactionDataRowIterator defines the structure of transaction data row iterator
export interface TransactionDataRowIterator {
    hasNext(): boolean;
    next(ctx: Context, user: User): Promise<TransactionDataRow | null>;
}

// TransactionDataRowParser defines the structure of transaction data row parser
export interface TransactionDataRowParser {
    getAddedColumns(): TransactionDataTableColumn[];
    parse(data: RowData): [RowData, boolean];
}

// CommonTransactionDataRowParser defines the structure of common transaction data row parser
export interface CommonTransactionDataRowParser {
    parse(ctx: Context, user: User, dataRow: CommonDataTableRow, rowId: string): Promise<[RowData, boolean]> | [RowData, boolean];
}

// TransactionDataTableBuilder defines the structure of transaction data table builder
export interface TransactionDataTableBuilder {
    appendTransaction(data: RowData): void;
    replaceDelimiters(text: string): string;
}

class SimpleTransactionDataRow implements TransactionDataRow {
    public constructor(private readonly columnSupported: (column: TransactionDataTableColumn) => boolean, private readonly rowData: RowData | null, private readonly rowDataValid: boolean) {
    }

    public isValid(): boolean {
        return this.rowDataValid;
    }

    public getData(column: TransactionDataTableColumn): string {
        if (!this.rowDataValid || !this.rowData) {
            return '';
        }

        if (!this.columnSupported(column)) {
            return '';
        }

        return this.rowData.get(column) ?? '';
    }
}

// basic data table -> common data table
class BasicDataTableToCommonDataTableWrapper implements CommonDataTable {
    public constructor(private readonly innerDataTable: BasicDataTable, private readonly dataColumnIndexes: Map<string, number>) {
    }

    public headerColumnCount(): number {
        return this.innerDataTable.headerColumnNames().length;
    }

    public hasColumn(columnName: string): boolean {
        const index = this.dataColumnIndexes.get(columnName);
        return index !== undefined && index >= 0;
    }

    public dataRowCount(): number {
        return this.innerDataTable.dataRowCount();
    }

    public dataRowIterator(): CommonDataTableRowIterator {
        const innerIterator = this.innerDataTable.dataRowIterator();
        const dataColumnIndexes = this.dataColumnIndexes;

        return {
            hasNext: () => innerIterator.hasNext(),
            currentRowId: () => innerIterator.currentRowId(),
            next: (): CommonDataTableRow | null => {
                const basicDataRow = innerIterator.next();

                if (!basicDataRow) {
                    return null;
                }

                const rowData = new Map<string, string>();

                for (const [column, columnIndex] of dataColumnIndexes) {
                    if (columnIndex < 0 || columnIndex >= basicDataRow.columnCount()) {
                        continue;
                    }

                    rowData.set(column, basicDataRow.getData(columnIndex));
                }

                return {
                    columnCount: () => rowData.size,
                    hasData: (columnName: string) => rowData.has(columnName),
                    getData: (columnName: string) => rowData.get(columnName) ?? '',
                };
            },
        };
    }
}

// createNewCommonDataTableFromBasicDataTable returns common data table from basic data table
export function createNewCommonDataTableFromBasicDataTable(dataTable: BasicDataTable): CommonDataTable {
    const headerLineItems = dataTable.headerColumnNames();
    const dataColumnIndexes = new Map<string, number>();

    for (let i = 0; i < headerLineItems.length; i++) {
        dataColumnIndexes.set(headerLineItems[i] as string, i);
    }

    return new BasicDataTableToCommonDataTableWrapper(dataTable, dataColumnIndexes);
}

// basic data table -> transaction data table
class BasicDataTableToTransactionDataTableWrapper implements TransactionDataTable {
    public constructor(
        private readonly innerDataTable: BasicDataTable,
        private readonly dataColumnIndexes: Map<TransactionDataTableColumn, number>,
        private readonly rowParser: TransactionDataRowParser | null,
        private readonly addedColumns: Set<TransactionDataTableColumn> | null,
    ) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        const index = this.dataColumnIndexes.get(column);

        if (index !== undefined && index >= 0) {
            return true;
        }

        return this.addedColumns?.has(column) ?? false;
    }

    public transactionRowCount(): number {
        return this.innerDataTable.dataRowCount();
    }

    private isColumnSupported(column: TransactionDataTableColumn): boolean {
        return this.dataColumnIndexes.has(column) || (this.addedColumns?.has(column) ?? false);
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const innerIterator = this.innerDataTable.dataRowIterator();
        const columnSupported = (column: TransactionDataTableColumn): boolean => this.isColumnSupported(column);

        return {
            hasNext: () => innerIterator.hasNext(),
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                const basicDataRow = innerIterator.next();

                if (!basicDataRow) {
                    return null;
                }

                if (basicDataRow.columnCount() === 1 && basicDataRow.getData(0) === '') {
                    return new SimpleTransactionDataRow(columnSupported, null, false);
                }

                if (basicDataRow.columnCount() < this.dataColumnIndexes.size) {
                    log.errorf(ctx, `[basic_data_table_to_transaction_data_table_wrapper.Next] cannot parse data row, because may missing some columns (column count ${basicDataRow.columnCount()} in data row is less than header column count ${this.dataColumnIndexes.size})`);
                    throw errs.ErrFewerFieldsInDataRowThanInHeaderRow;
                }

                let rowData: RowData = new Map();
                let rowDataValid = true;

                for (const [column, columnIndex] of this.dataColumnIndexes) {
                    if (columnIndex < 0 || columnIndex >= basicDataRow.columnCount()) {
                        continue;
                    }

                    rowData.set(column, basicDataRow.getData(columnIndex));
                }

                if (this.rowParser) {
                    try {
                        [rowData, rowDataValid] = this.rowParser.parse(rowData);
                    } catch (err) {
                        log.errorf(ctx, `[basic_data_table_to_transaction_data_table_wrapper.Next] cannot parse data row, because ${(err as Error).message}`);
                        throw err;
                    }
                }

                return new SimpleTransactionDataRow(columnSupported, rowData, rowDataValid);
            },
        };
    }
}

// createNewTransactionDataTableFromBasicDataTable returns transaction data table from basic data table
export function createNewTransactionDataTableFromBasicDataTable(dataTable: BasicDataTable, dataColumnMapping: Map<TransactionDataTableColumn, string>): TransactionDataTable {
    return createNewTransactionDataTableFromBasicDataTableWithRowParser(dataTable, dataColumnMapping, null);
}

// createNewTransactionDataTableFromBasicDataTableWithRowParser returns transaction data table from basic data table with row parser
export function createNewTransactionDataTableFromBasicDataTableWithRowParser(dataTable: BasicDataTable, dataColumnMapping: Map<TransactionDataTableColumn, string>, rowParser: TransactionDataRowParser | null): TransactionDataTable {
    const headerLineItems = dataTable.headerColumnNames();
    const headerItemMap = new Map<string, number>();

    for (let i = 0; i < headerLineItems.length; i++) {
        headerItemMap.set(headerLineItems[i] as string, i);
    }

    const dataColumnIndexes = new Map<TransactionDataTableColumn, number>();

    for (const [column, columnName] of dataColumnMapping) {
        const columnIndex = headerItemMap.get(columnName);

        if (columnIndex !== undefined) {
            dataColumnIndexes.set(column, columnIndex);
        }
    }

    let addedColumns: Set<TransactionDataTableColumn> | null = null;

    if (rowParser) {
        addedColumns = new Set(rowParser.getAddedColumns());
    }

    return new BasicDataTableToTransactionDataTableWrapper(dataTable, dataColumnIndexes, rowParser, addedColumns);
}

// common data table -> transaction data table
class CommonDataTableToTransactionDataTableWrapper implements TransactionDataTable {
    public constructor(
        private readonly innerDataTable: CommonDataTable,
        private readonly supportedDataColumns: Set<TransactionDataTableColumn>,
        private readonly rowParser: CommonTransactionDataRowParser,
    ) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return this.supportedDataColumns.has(column);
    }

    public transactionRowCount(): number {
        return this.innerDataTable.dataRowCount();
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const innerIterator = this.innerDataTable.dataRowIterator();
        const columnSupported = (column: TransactionDataTableColumn): boolean => this.supportedDataColumns.has(column);

        return {
            hasNext: () => innerIterator.hasNext(),
            next: async (ctx: Context, user: User): Promise<TransactionDataRow | null> => {
                const commonDataRow = innerIterator.next();

                if (!commonDataRow) {
                    return null;
                }

                const rowId = innerIterator.currentRowId();
                let rowData: RowData;
                let rowDataValid: boolean;

                try {
                    [rowData, rowDataValid] = await this.rowParser.parse(ctx, user, commonDataRow, rowId);
                } catch (err) {
                    log.errorf(ctx, `[common_data_table_to_transaction_data_table_wrapper.Next] cannot parse data row, because ${(err as Error).message}`);
                    throw err;
                }

                return new SimpleTransactionDataRow(columnSupported, rowData, rowDataValid);
            },
        };
    }
}

// createNewTransactionDataTableFromCommonDataTable returns transaction data table from common data table
export function createNewTransactionDataTableFromCommonDataTable(dataTable: CommonDataTable, supportedDataColumns: Set<TransactionDataTableColumn>, rowParser: CommonTransactionDataRowParser): TransactionDataTable {
    return new CommonDataTableToTransactionDataTableWrapper(dataTable, supportedDataColumns, rowParser);
}

// merged transaction data table
class MergedTransactionDataTable implements TransactionDataTable {
    public constructor(private readonly dataTables: TransactionDataTable[]) {
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return this.dataTables.some(dt => dt.hasColumn(column));
    }

    public transactionRowCount(): number {
        return this.dataTables.reduce((sum, dt) => sum + dt.transactionRowCount(), 0);
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        const iterators = this.dataTables.map(dt => dt.transactionRowIterator());
        let currentIndex = 0;

        return {
            hasNext: (): boolean => {
                if (currentIndex >= iterators.length) {
                    return false;
                }

                for (let i = currentIndex; i < iterators.length; i++) {
                    if ((iterators[i] as TransactionDataRowIterator).hasNext()) {
                        return true;
                    }
                }

                return false;
            },
            next: async (ctx: Context, user: User): Promise<TransactionDataRow | null> => {
                if (currentIndex >= iterators.length) {
                    return null;
                }

                if ((iterators[currentIndex] as TransactionDataRowIterator).hasNext()) {
                    return (iterators[currentIndex] as TransactionDataRowIterator).next(ctx, user);
                }

                while (currentIndex < iterators.length) {
                    currentIndex++;

                    if (currentIndex >= iterators.length) {
                        break;
                    }

                    if ((iterators[currentIndex] as TransactionDataRowIterator).hasNext()) {
                        return (iterators[currentIndex] as TransactionDataRowIterator).next(ctx, user);
                    }
                }

                return null;
            },
        };
    }
}

// createNewMergedTransactionDataTable returns a transaction data table which merges multiple data tables
export function createNewMergedTransactionDataTable(dataTables: TransactionDataTable[]): TransactionDataTable {
    return new MergedTransactionDataTable(dataTables);
}

// SubBasicDataTable represents a sub range of basic data table
export class SubBasicDataTable implements BasicDataTable {
    public constructor(private readonly baseTable: BasicDataTable, private readonly fromIndex: number, private readonly toIndex: number) {
    }

    public dataRowCount(): number {
        return this.toIndex - this.fromIndex;
    }

    public headerColumnNames(): string[] {
        return this.baseTable.headerColumnNames();
    }

    public dataRowIterator(): BasicDataTableRowIterator {
        const innerIterator = this.baseTable.dataRowIterator();
        let currentIndex = -1;

        for (currentIndex = -1; currentIndex < this.fromIndex - 1 && innerIterator.hasNext(); currentIndex++) {
            innerIterator.next();
        }

        return {
            hasNext: () => currentIndex + 1 < this.toIndex && innerIterator.hasNext(),
            currentRowId: () => innerIterator.currentRowId(),
            next: (): BasicDataTableRow | null => {
                if (currentIndex + 1 >= this.toIndex) {
                    return null;
                }

                currentIndex++;
                return innerIterator.next();
            },
        };
    }
}

// createSubBasicTable returns a sub range of basic data table
export function createSubBasicTable(dataTable: BasicDataTable, fromIndex: number, toIndex: number): SubBasicDataTable {
    if (fromIndex < 0) {
        fromIndex = 0;
    }

    if (fromIndex > dataTable.dataRowCount()) {
        fromIndex = dataTable.dataRowCount();
    }

    if (toIndex > dataTable.dataRowCount()) {
        toIndex = dataTable.dataRowCount();
    }

    if (toIndex < fromIndex) {
        toIndex = fromIndex;
    }

    return new SubBasicDataTable(dataTable, fromIndex, toIndex);
}

// WritableTransactionDataTable represents a transaction data table which can be written
export class WritableTransactionDataTable implements TransactionDataTable {
    private readonly allData: RowData[] = [];
    private readonly supportedColumns: Set<TransactionDataTableColumn>;
    private readonly addedColumns: Set<TransactionDataTableColumn> | null;

    public constructor(columns: TransactionDataTableColumn[], private readonly rowParser: TransactionDataRowParser | null = null) {
        this.supportedColumns = new Set(columns);
        this.addedColumns = rowParser ? new Set(rowParser.getAddedColumns()) : null;
    }

    public add(data: RowData): void {
        const finalData: RowData = new Map();

        for (const [column, value] of data) {
            if (this.supportedColumns.has(column)) {
                finalData.set(column, value);
            }
        }

        this.allData.push(finalData);
    }

    public get(index: number): TransactionDataRow | null {
        if (index >= this.allData.length) {
            return null;
        }

        let rowData = this.allData[index] as RowData;
        let rowDataValid = true;

        if (this.rowParser) {
            [rowData, rowDataValid] = this.rowParser.parse(rowData);
        }

        return new SimpleTransactionDataRow(column => this.isColumnSupported(column), rowData, rowDataValid);
    }

    private isColumnSupported(column: TransactionDataTableColumn): boolean {
        return this.supportedColumns.has(column) || (this.addedColumns?.has(column) ?? false);
    }

    public hasColumn(column: TransactionDataTableColumn): boolean {
        return this.isColumnSupported(column);
    }

    public transactionRowCount(): number {
        return this.allData.length;
    }

    public transactionRowIterator(): TransactionDataRowIterator {
        let nextIndex = 0;

        return {
            hasNext: () => nextIndex < this.allData.length,
            next: async (ctx: Context): Promise<TransactionDataRow | null> => {
                if (nextIndex >= this.allData.length) {
                    return null;
                }

                let rowData = this.allData[nextIndex] as RowData;
                let rowDataValid = true;

                if (this.rowParser) {
                    try {
                        [rowData, rowDataValid] = this.rowParser.parse(rowData);
                    } catch (err) {
                        log.errorf(ctx, `[writable_transaction_data_table.Next] cannot parse data row, because ${(err as Error).message}`);
                        throw err;
                    }
                }

                nextIndex++;
                return new SimpleTransactionDataRow(column => this.isColumnSupported(column), rowData, rowDataValid);
            },
        };
    }
}

// createNewWritableTransactionDataTable returns a new writable transaction data table
export function createNewWritableTransactionDataTable(columns: TransactionDataTableColumn[]): WritableTransactionDataTable {
    return new WritableTransactionDataTable(columns, null);
}

// createNewWritableTransactionDataTableWithRowParser returns a new writable transaction data table with row parser
export function createNewWritableTransactionDataTableWithRowParser(columns: TransactionDataTableColumn[], rowParser: TransactionDataRowParser | null): WritableTransactionDataTable {
    return new WritableTransactionDataTable(columns, rowParser);
}
