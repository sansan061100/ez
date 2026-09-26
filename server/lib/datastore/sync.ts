import type { DbExecutor, Dialect } from './driver';
import type { ColumnDef, IndexDef, TableDef } from './schema';
import { quoteIdentifier } from './session';
import { toStringValue } from './values';

function columnSqlType(dialect: Dialect, column: ColumnDef): string {
    switch (column.kind) {
        case 'id':
        case 'i64':
        case 'ni64':
            return dialect === 'sqlite3' ? 'INTEGER' : dialect === 'mysql' ? 'BIGINT(20)' : 'BIGINT';
        case 'u64':
            return dialect === 'sqlite3' ? 'INTEGER' : dialect === 'mysql' ? 'BIGINT(20) UNSIGNED' : 'BIGINT';
        case 'i32':
            return dialect === 'sqlite3' ? 'INTEGER' : dialect === 'mysql' ? 'INT(11)' : 'INTEGER';
        case 'i16':
            return dialect === 'sqlite3' ? 'INTEGER' : 'SMALLINT';
        case 'u8':
            return dialect === 'sqlite3' ? 'INTEGER' : dialect === 'mysql' ? 'TINYINT(3) UNSIGNED' : 'SMALLINT';
        case 'bool':
            return dialect === 'sqlite3' ? 'INTEGER' : dialect === 'mysql' ? 'TINYINT(1)' : 'BOOL';
        case 'str':
            return dialect === 'sqlite3' ? 'TEXT' : `VARCHAR(${column.length ?? 255})`;
        case 'f64':
            return dialect === 'sqlite3' ? 'REAL' : dialect === 'mysql' ? 'DOUBLE' : 'DOUBLE PRECISION';
        case 'blob':
        case 'json':
            return dialect === 'postgres' ? 'BYTEA' : 'BLOB';
        case 'mblob':
            return dialect === 'postgres' ? 'BYTEA' : dialect === 'mysql' ? 'MEDIUMBLOB' : 'BLOB';
    }
}

function zeroDefault(column: ColumnDef): string {
    switch (column.kind) {
        case 'str':
            return '\'\'';
        case 'bool':
            return 'false';
        case 'blob':
        case 'mblob':
        case 'json':
            return 'NULL';
        default:
            return '0';
    }
}

function columnDefinition(dialect: Dialect, column: ColumnDef, singlePk: boolean, forAlter: boolean): string {
    let sql = `${quoteIdentifier(dialect, column.name)} ${columnSqlType(dialect, column)}`;

    if (singlePk && column.pk) {
        sql += ' PRIMARY KEY';
    }

    if (column.defaultValue !== undefined) {
        sql += ` DEFAULT ${column.defaultValue}`;
    } else if (forAlter && column.notNull) {
        sql += ` DEFAULT ${zeroDefault(column)}`;
    }

    sql += column.notNull ? ' NOT NULL' : ' NULL';

    return sql;
}

// indexName returns the index name like xorm Index.XName()
export function indexName(tableName: string, index: IndexDef): string {
    if (index.name.startsWith('UQE_') || index.name.startsWith('IDX_')) {
        return index.name;
    }

    return `${index.unique ? 'UQE_' : 'IDX_'}${tableName}_${index.name}`;
}

async function getExistingTables(executor: DbExecutor): Promise<Set<string>> {
    let rows;

    if (executor.dialect === 'sqlite3') {
        rows = await executor.query('SELECT name AS name FROM sqlite_master WHERE type=\'table\'', []);
    } else if (executor.dialect === 'mysql') {
        rows = await executor.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=DATABASE()', []);
    } else {
        rows = await executor.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema()', []);
    }

    return new Set(rows.map(r => toStringValue(r['name'] ?? r['NAME'] ?? r['TABLE_NAME']).toLowerCase()));
}

async function getExistingColumns(executor: DbExecutor, tableName: string): Promise<Set<string>> {
    let rows;

    if (executor.dialect === 'sqlite3') {
        rows = await executor.query(`PRAGMA table_info(${quoteIdentifier('sqlite3', tableName)})`, []);
    } else if (executor.dialect === 'mysql') {
        rows = await executor.query('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?', [tableName]);
    } else {
        rows = await executor.query('SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?', [tableName]);
    }

    return new Set(rows.map(r => toStringValue(r['name'] ?? r['NAME'] ?? r['COLUMN_NAME']).toLowerCase()));
}

async function getExistingIndexes(executor: DbExecutor, tableName: string): Promise<Set<string>> {
    let rows;

    if (executor.dialect === 'sqlite3') {
        rows = await executor.query('SELECT name AS name FROM sqlite_master WHERE type=\'index\' AND tbl_name=?', [tableName]);
    } else if (executor.dialect === 'mysql') {
        rows = await executor.query('SELECT DISTINCT index_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=?', [tableName]);
    } else {
        rows = await executor.query('SELECT indexname AS name FROM pg_indexes WHERE schemaname=current_schema() AND tablename=?', [tableName]);
    }

    return new Set(rows.map(r => toStringValue(r['name'] ?? r['NAME'] ?? r['INDEX_NAME']).toLowerCase()));
}

// syncTable creates the table if not exists, and adds missing columns and indexes (like xorm Sync2)
export async function syncTable<T>(executor: DbExecutor, table: TableDef<T>): Promise<void> {
    const dialect = executor.dialect;
    const q = (name: string): string => quoteIdentifier(dialect, name);
    const existingTables = await getExistingTables(executor);
    const singlePk = table.pkColumns.length === 1;

    if (!existingTables.has(table.name.toLowerCase())) {
        const definitions = table.columns.map(c => columnDefinition(dialect, c, singlePk, false));

        if (!singlePk && table.pkColumns.length > 1) {
            definitions.push(`PRIMARY KEY (${table.pkColumns.map(q).join(',')})`);
        }

        let sql = `CREATE TABLE IF NOT EXISTS ${q(table.name)} (${definitions.join(', ')})`;

        if (dialect === 'mysql') {
            sql += ' DEFAULT CHARSET utf8mb4 ROW_FORMAT=DYNAMIC';
        }

        await executor.exec(sql, []);
    } else {
        const existingColumns = await getExistingColumns(executor, table.name);

        for (const column of table.columns) {
            if (!existingColumns.has(column.name.toLowerCase())) {
                await executor.exec(`ALTER TABLE ${q(table.name)} ADD ${columnDefinition(dialect, column, false, true)}`, []);
            }
        }
    }

    const existingIndexes = await getExistingIndexes(executor, table.name);

    for (const index of table.indexes) {
        const name = indexName(table.name, index);

        if (existingIndexes.has(name.toLowerCase())) {
            continue;
        }

        const unique = index.unique ? 'UNIQUE ' : '';
        await executor.exec(`CREATE ${unique}INDEX ${q(name)} ON ${q(table.name)} (${index.columns.map(q).join(',')})`, []);
    }
}
