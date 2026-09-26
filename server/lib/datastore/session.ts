import type { DbExecutor, Dialect, RawRow } from './driver';
import { type ColumnDef, isZeroValue, type TableDef, zeroValueOf } from './schema';
import { decodeColumnValue, encodeColumnValue, toNumberValue } from './values';

export type Row<T> = T;

interface Condition {
    op: 'AND' | 'OR';
    sql: string;
    params: unknown[];
}

export function quoteIdentifier(dialect: Dialect, name: string): string {
    if (dialect === 'postgres') {
        return `"${name}"`;
    }

    return '`' + name + '`';
}

// SqlCond represents a sql condition fragment with parameters (like xorm builder.Cond)
export class SqlCond {
    public readonly sql: string;
    public readonly params: unknown[];

    public constructor(sql: string, params: unknown[] = []) {
        this.sql = sql;
        this.params = params;
    }

    public static and(...conds: (SqlCond | null | undefined)[]): SqlCond {
        const valid = conds.filter((c): c is SqlCond => !!c && c.sql !== '');

        if (valid.length === 0) {
            return new SqlCond('');
        }

        if (valid.length === 1) {
            return valid[0]!;
        }

        return new SqlCond(valid.map(c => `(${c.sql})`).join(' AND '), valid.flatMap(c => c.params));
    }

    public static or(...conds: (SqlCond | null | undefined)[]): SqlCond {
        const valid = conds.filter((c): c is SqlCond => !!c && c.sql !== '');

        if (valid.length === 0) {
            return new SqlCond('');
        }

        if (valid.length === 1) {
            return valid[0]!;
        }

        return new SqlCond(valid.map(c => `(${c.sql})`).join(' OR '), valid.flatMap(c => c.params));
    }

    public static eq(column: string, value: unknown): SqlCond {
        return new SqlCond(`${column}=?`, [value]);
    }

    public static in(column: string, values: readonly unknown[]): SqlCond {
        if (values.length < 1) {
            return new SqlCond('0=1');
        }

        return new SqlCond(`${column} IN (${values.map(() => '?').join(',')})`, [...values]);
    }

    public static notIn(column: string, values: readonly unknown[]): SqlCond {
        if (values.length < 1) {
            return new SqlCond('0=0');
        }

        return new SqlCond(`${column} NOT IN (${values.map(() => '?').join(',')})`, [...values]);
    }

    public and(cond: SqlCond): SqlCond {
        return SqlCond.and(this, cond);
    }

    public or(cond: SqlCond): SqlCond {
        return SqlCond.or(this, cond);
    }
}

// Session represents a database session (like xorm Session), it can be bound to a transaction
export class Session {
    public readonly executor: DbExecutor;
    public readonly contextId: string | undefined;

    public constructor(executor: DbExecutor, contextId?: string) {
        this.executor = executor;
        this.contextId = contextId;
    }

    public get dialect(): Dialect {
        return this.executor.dialect;
    }

    public newQuery(): Query {
        return new Query(this);
    }

    public id(...pkValues: unknown[]): Query {
        return this.newQuery().id(...pkValues);
    }

    public where(sql: string | SqlCond, ...params: unknown[]): Query {
        return this.newQuery().where(sql, ...params);
    }

    public in(column: string, values: readonly unknown[]): Query {
        return this.newQuery().in(column, values);
    }

    public notIn(column: string, values: readonly unknown[]): Query {
        return this.newQuery().notIn(column, values);
    }

    public cols(...columns: string[]): Query {
        return this.newQuery().cols(...columns);
    }

    public select(sql: string): Query {
        return this.newQuery().select(sql);
    }

    public orderBy(sql: string): Query {
        return this.newQuery().orderBy(sql);
    }

    public limit(limit: number, offset?: number): Query {
        return this.newQuery().limit(limit, offset);
    }

    public setExpr(column: string, expr: string): Query {
        return this.newQuery().setExpr(column, expr);
    }

    public async get<T>(table: TableDef<T>): Promise<T | null> {
        return this.newQuery().get(table);
    }

    public async find<T>(table: TableDef<T>): Promise<T[]> {
        return this.newQuery().find(table);
    }

    public async count<T>(table: TableDef<T>): Promise<number> {
        return this.newQuery().count(table);
    }

    public async insert<T>(table: TableDef<T>, rows: Partial<T> | Partial<T>[]): Promise<number> {
        return this.newQuery().insert(table, rows);
    }

    public async update<T>(table: TableDef<T>, obj: Partial<T>): Promise<number> {
        return this.newQuery().update(table, obj);
    }

    public async delete<T>(table: TableDef<T>): Promise<number> {
        return this.newQuery().delete(table);
    }

    public async exec(sql: string, ...params: unknown[]): Promise<number> {
        return this.executor.exec(sql, params, this.contextId);
    }

    public async query(sql: string, ...params: unknown[]): Promise<RawRow[]> {
        return this.executor.query(sql, params, this.contextId);
    }

    public quote(name: string): string {
        return quoteIdentifier(this.dialect, name);
    }
}

// Query represents a query statement builder (like xorm Statement)
export class Query {
    private readonly session: Session;
    private pkValues: unknown[] | null = null;
    private readonly conditions: Condition[] = [];
    private columns: string[] | null = null;
    private selectSql: string | null = null;
    private orderBySql: string | null = null;
    private groupBySql: string | null = null;
    private havingSql: string | null = null;
    private limitValue: number | null = null;
    private offsetValue: number | null = null;
    private readonly setExprs: [string, string][] = [];

    public constructor(session: Session) {
        this.session = session;
    }

    public id(...pkValues: unknown[]): this {
        this.pkValues = pkValues;
        return this;
    }

    public where(sql: string | SqlCond, ...params: unknown[]): this {
        return this.addCondition('AND', sql, params);
    }

    public and(sql: string | SqlCond, ...params: unknown[]): this {
        return this.addCondition('AND', sql, params);
    }

    public or(sql: string | SqlCond, ...params: unknown[]): this {
        return this.addCondition('OR', sql, params);
    }

    public in(column: string, values: readonly unknown[]): this {
        const cond = SqlCond.in(column, values);
        return this.addCondition('AND', cond.sql, cond.params);
    }

    public notIn(column: string, values: readonly unknown[]): this {
        const cond = SqlCond.notIn(column, values);
        return this.addCondition('AND', cond.sql, cond.params);
    }

    public cols(...columns: string[]): this {
        this.columns = [...(this.columns ?? []), ...columns];
        return this;
    }

    public select(sql: string): this {
        this.selectSql = sql;
        return this;
    }

    public orderBy(sql: string): this {
        this.orderBySql = this.orderBySql ? `${this.orderBySql}, ${sql}` : sql;
        return this;
    }

    public groupBy(sql: string): this {
        this.groupBySql = sql;
        return this;
    }

    public having(sql: string): this {
        this.havingSql = sql;
        return this;
    }

    public limit(limit: number, offset?: number): this {
        this.limitValue = limit;
        this.offsetValue = offset ?? null;
        return this;
    }

    public setExpr(column: string, expr: string): this {
        this.setExprs.push([column, expr]);
        return this;
    }

    public async get<T>(table: TableDef<T>): Promise<T | null> {
        const limitValue = this.limitValue;
        this.limitValue = 1;
        const [sql, params] = this.buildSelect(table);
        this.limitValue = limitValue;
        const rows = await this.session.executor.query(sql, params, this.session.contextId);

        if (rows.length < 1) {
            return null;
        }

        return decodeRow(table, rows[0]!);
    }

    public async find<T>(table: TableDef<T>): Promise<T[]> {
        const [sql, params] = this.buildSelect(table);
        const rows = await this.session.executor.query(sql, params, this.session.contextId);
        return rows.map(row => decodeRow(table, row));
    }

    public async count<T>(table: TableDef<T>): Promise<number> {
        const [where, params] = this.buildWhere(table);
        const sql = `SELECT count(*) AS cnt FROM ${this.q(table.name)}${where}`;
        const rows = await this.session.executor.query(sql, params, this.session.contextId);
        return toNumberValue(rows[0]?.['cnt'] ?? Object.values(rows[0] ?? {})[0]);
    }

    public async exist<T>(table: TableDef<T>): Promise<boolean> {
        const [where, params] = this.buildWhere(table);
        const sql = `SELECT 1 AS existed FROM ${this.q(table.name)}${where} LIMIT 1`;
        const rows = await this.session.executor.query(sql, params, this.session.contextId);
        return rows.length > 0;
    }

    public async insert<T>(table: TableDef<T>, rows: Partial<T> | Partial<T>[]): Promise<number> {
        const items = Array.isArray(rows) ? rows : [rows];

        if (items.length < 1) {
            return 0;
        }

        const columns = this.columns ? table.columns.filter(c => this.columns!.includes(c.name)) : table.columns;
        const columnList = columns.map(c => this.q(c.name)).join(', ');
        let affected = 0;
        const batchSize = Math.max(1, Math.floor(900 / columns.length));

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const params: unknown[] = [];
            const valuesSql: string[] = [];

            for (const item of batch) {
                const record = item as Record<string, unknown>;
                valuesSql.push(`(${columns.map(() => '?').join(', ')})`);

                for (const column of columns) {
                    const value = record[column.prop];
                    params.push(encodeColumnValue(column, value === undefined ? zeroValueOf(column.kind) : value));
                }
            }

            const sql = `INSERT INTO ${this.q(table.name)} (${columnList}) VALUES ${valuesSql.join(', ')}`;
            affected += await this.session.executor.exec(sql, params, this.session.contextId);
        }

        return affected;
    }

    public async update<T>(table: TableDef<T>, obj: Partial<T>): Promise<number> {
        const record = obj as Record<string, unknown>;
        const setParts: string[] = [];
        const params: unknown[] = [];
        let updateColumns: ColumnDef[];

        if (this.columns) {
            updateColumns = [];

            for (const name of this.columns) {
                const column = table.columnMap.get(name);

                if (column) {
                    updateColumns.push(column);
                }
            }
        } else {
            updateColumns = table.columns.filter(c => {
                const value = record[c.prop];
                return value !== undefined && !isZeroValue(c.kind, value);
            });
        }

        const setExprColumns = new Set(this.setExprs.map(([column]) => column));

        for (const column of updateColumns) {
            if (setExprColumns.has(column.name)) {
                continue;
            }

            const value = record[column.prop];
            setParts.push(`${this.q(column.name)} = ?`);
            params.push(encodeColumnValue(column, value === undefined ? zeroValueOf(column.kind) : value));
        }

        for (const [column, expr] of this.setExprs) {
            setParts.push(`${this.q(column)} = ${expr}`);
        }

        if (setParts.length < 1) {
            throw new Error('No content found to be updated');
        }

        const [where, whereParams] = this.buildWhere(table);
        const sql = `UPDATE ${this.q(table.name)} SET ${setParts.join(', ')}${where}`;
        return this.session.executor.exec(sql, [...params, ...whereParams], this.session.contextId);
    }

    public async delete<T>(table: TableDef<T>): Promise<number> {
        const [where, params] = this.buildWhere(table);
        const sql = `DELETE FROM ${this.q(table.name)}${where}`;
        return this.session.executor.exec(sql, params, this.session.contextId);
    }

    private addCondition(op: 'AND' | 'OR', sql: string | SqlCond, params: unknown[]): this {
        if (sql instanceof SqlCond) {
            if (sql.sql !== '') {
                this.conditions.push({ op: op, sql: sql.sql, params: sql.params });
            }
        } else if (sql !== '') {
            this.conditions.push({ op: op, sql: sql, params: params });
        }

        return this;
    }

    private q(name: string): string {
        return quoteIdentifier(this.session.dialect, name);
    }

    private buildWhere<T>(table: TableDef<T>): [string, unknown[]] {
        const parts: string[] = [];
        const params: unknown[] = [];

        if (this.pkValues) {
            const pkParts: string[] = [];

            table.pkColumns.forEach((pkColumn, index) => {
                if (index < this.pkValues!.length) {
                    pkParts.push(`${this.q(pkColumn)}=?`);
                    params.push(encodeColumnValue(table.columnMap.get(pkColumn)!, this.pkValues![index]));
                }
            });

            if (pkParts.length > 0) {
                parts.push(pkParts.join(' AND '));
            }
        }

        let conditionSql = '';

        for (const condition of this.conditions) {
            if (conditionSql === '') {
                conditionSql = `(${condition.sql})`;
            } else {
                conditionSql = `${conditionSql} ${condition.op} (${condition.sql})`;
            }

            params.push(...condition.params);
        }

        if (conditionSql !== '') {
            parts.push(conditionSql);
        }

        if (parts.length < 1) {
            return ['', params];
        }

        return [` WHERE ${parts.join(' AND ')}`, params];
    }

    private buildSelect<T>(table: TableDef<T>): [string, unknown[]] {
        let selectPart: string;

        if (this.selectSql) {
            selectPart = this.selectSql;
        } else if (this.columns) {
            selectPart = this.columns.map(c => this.q(c)).join(', ');
        } else {
            selectPart = table.columns.map(c => this.q(c.name)).join(', ');
        }

        const [where, params] = this.buildWhere(table);
        let sql = `SELECT ${selectPart} FROM ${this.q(table.name)}${where}`;

        if (this.groupBySql) {
            sql += ` GROUP BY ${this.groupBySql}`;
        }

        if (this.havingSql) {
            sql += ` HAVING ${this.havingSql}`;
        }

        if (this.orderBySql) {
            sql += ` ORDER BY ${this.orderBySql}`;
        }

        if (this.limitValue !== null) {
            sql += ` LIMIT ${Math.trunc(this.limitValue)}`;

            if (this.offsetValue !== null) {
                sql += ` OFFSET ${Math.trunc(this.offsetValue)}`;
            }
        }

        return [sql, params];
    }
}

// decodeRow converts a raw database row to a model object
export function decodeRow<T>(table: TableDef<T>, raw: RawRow): T {
    const result: Record<string, unknown> = {};
    const lowerKeyMap = new Map<string, unknown>();

    for (const [key, value] of Object.entries(raw)) {
        lowerKeyMap.set(key.toLowerCase(), value);
    }

    for (const column of table.columns) {
        if (lowerKeyMap.has(column.name)) {
            result[column.prop] = decodeColumnValue(column, lowerKeyMap.get(column.name));
        } else {
            result[column.prop] = zeroValueOf(column.kind);
        }
    }

    return result as T;
}
