import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import * as errs from '../errs/index';
import * as log from '../log/index';
import { type DatabaseConfig, MySqlDbType, PostgresDbType, Sqlite3DbType } from '../settings/settings';

export type Dialect = 'sqlite3' | 'mysql' | 'postgres';

export type RawRow = Record<string, unknown>;

// DbExecutor executes sql statements
export interface DbExecutor {
    readonly dialect: Dialect;
    query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]>;
    exec(sql: string, params: unknown[], contextId?: string): Promise<number>;
}

// DbDriver represents a database connection (pool)
export interface DbDriver extends DbExecutor {
    transaction<R>(fn: (tx: DbExecutor) => Promise<R>): Promise<R>;
    close(): Promise<void>;
}

class AsyncMutex {
    private locked = false;
    private readonly waiters: (() => void)[] = [];

    public async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }

        await new Promise<void>(resolve => this.waiters.push(resolve));
    }

    public release(): void {
        const next = this.waiters.shift();

        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }

    public get isLocked(): boolean {
        return this.locked;
    }
}

function logQuery(sql: string, params: unknown[], startTime: number, contextId?: string): void {
    if (!log.isSqlQueryLogEnabled()) {
        return;
    }

    const args = params.map(p => (typeof p === 'bigint' ? p.toString() : Buffer.isBuffer(p) || p instanceof Uint8Array ? '<binary>' : p));
    const sessionPart = contextId ? `[${contextId}] ` : '';
    log.sqlQuery(`${sessionPart}[SQL] ${sql} ${JSON.stringify(args)} - ${Date.now() - startTime}ms`);
}

// convertPlaceholders converts "?" placeholders to "$n" placeholders for postgres
export function convertPlaceholders(sql: string): string {
    let index = 0;
    let result = '';
    let inString: string | null = null;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i]!;

        if (inString) {
            result += ch;

            if (ch === inString) {
                inString = null;
            }

            continue;
        }

        if (ch === '\'' || ch === '"') {
            inString = ch;
            result += ch;
        } else if (ch === '?') {
            index++;
            result += '$' + index;
        } else {
            result += ch;
        }
    }

    return result;
}

// ---------- sqlite ----------

type SqliteParam = null | number | bigint | string | Uint8Array;

function toSqliteParam(value: unknown): SqliteParam {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
        return value;
    }

    if (value instanceof Uint8Array) {
        return value;
    }

    return String(value);
}

class SqliteExecutor implements DbExecutor {
    public readonly dialect: Dialect = 'sqlite3';
    protected readonly db: DatabaseSync;
    private readonly statementCache = new Map<string, StatementSync>();

    public constructor(db: DatabaseSync) {
        this.db = db;
    }

    protected prepare(sql: string): StatementSync {
        let stmt = this.statementCache.get(sql);

        if (!stmt) {
            stmt = this.db.prepare(sql);
            stmt.setReadBigInts(true);

            if (this.statementCache.size > 500) {
                this.statementCache.clear();
            }

            this.statementCache.set(sql, stmt);
        }

        return stmt;
    }

    public querySync(sql: string, params: unknown[], contextId?: string): RawRow[] {
        const startTime = Date.now();
        const rows = this.prepare(sql).all(...params.map(toSqliteParam)) as RawRow[];
        logQuery(sql, params, startTime, contextId);
        return rows;
    }

    public execSync(sql: string, params: unknown[], contextId?: string): number {
        const startTime = Date.now();
        const result = this.prepare(sql).run(...params.map(toSqliteParam));
        logQuery(sql, params, startTime, contextId);
        return Number(result.changes);
    }

    public async query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]> {
        return this.querySync(sql, params, contextId);
    }

    public async exec(sql: string, params: unknown[], contextId?: string): Promise<number> {
        return this.execSync(sql, params, contextId);
    }
}

class SqliteDriver extends SqliteExecutor implements DbDriver {
    private readonly mutex = new AsyncMutex();
    private readonly txContext = new AsyncLocalStorage<boolean>();

    public constructor(path: string) {
        super(new DatabaseSync(path));
        this.db.exec('PRAGMA busy_timeout = 5000');
    }

    public override async query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]> {
        if (this.txContext.getStore() || !this.mutex.isLocked) {
            return this.querySync(sql, params, contextId);
        }

        await this.mutex.acquire();

        try {
            return this.querySync(sql, params, contextId);
        } finally {
            this.mutex.release();
        }
    }

    public override async exec(sql: string, params: unknown[], contextId?: string): Promise<number> {
        if (this.txContext.getStore() || !this.mutex.isLocked) {
            return this.execSync(sql, params, contextId);
        }

        await this.mutex.acquire();

        try {
            return this.execSync(sql, params, contextId);
        } finally {
            this.mutex.release();
        }
    }

    public async transaction<R>(fn: (tx: DbExecutor) => Promise<R>): Promise<R> {
        if (this.txContext.getStore()) {
            // nested transaction runs in the outer transaction
            return fn(this);
        }

        await this.mutex.acquire();

        try {
            return await this.txContext.run(true, async () => {
                this.db.exec('BEGIN');

                try {
                    const result = await fn(this);
                    this.db.exec('COMMIT');
                    return result;
                } catch (err) {
                    try {
                        this.db.exec('ROLLBACK');
                    } catch {
                        // ignore rollback error
                    }

                    throw err;
                }
            });
        } finally {
            this.mutex.release();
        }
    }

    public async close(): Promise<void> {
        this.db.close();
    }
}

// ---------- mysql ----------

interface MySqlPoolConnection {
    query(sql: string, params: unknown[]): Promise<[unknown, unknown]>;
    beginTransaction(): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    release(): void;
}

interface MySqlPool {
    query(sql: string, params: unknown[]): Promise<[unknown, unknown]>;
    getConnection(): Promise<MySqlPoolConnection>;
    end(): Promise<void>;
}

function toMySqlParam(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    return value;
}

class MySqlExecutor implements DbExecutor {
    public readonly dialect: Dialect = 'mysql';
    protected readonly target: { query(sql: string, params: unknown[]): Promise<[unknown, unknown]> };

    public constructor(target: { query(sql: string, params: unknown[]): Promise<[unknown, unknown]> }) {
        this.target = target;
    }

    public async query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]> {
        const startTime = Date.now();
        const [rows] = await this.target.query(sql, params.map(toMySqlParam));
        logQuery(sql, params, startTime, contextId);
        return rows as RawRow[];
    }

    public async exec(sql: string, params: unknown[], contextId?: string): Promise<number> {
        const startTime = Date.now();
        const [result] = await this.target.query(sql, params.map(toMySqlParam));
        logQuery(sql, params, startTime, contextId);
        return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    }
}

class MySqlDriver extends MySqlExecutor implements DbDriver {
    private readonly pool: MySqlPool;
    private readonly txContext = new AsyncLocalStorage<MySqlExecutor>();

    public constructor(pool: MySqlPool) {
        super(pool);
        this.pool = pool;
    }

    public override async query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]> {
        return super.query(sql, params, contextId);
    }

    public async transaction<R>(fn: (tx: DbExecutor) => Promise<R>): Promise<R> {
        const current = this.txContext.getStore();

        if (current) {
            return fn(current);
        }

        const conn = await this.pool.getConnection();
        const executor = new MySqlExecutor(conn);

        try {
            await conn.beginTransaction();

            const result = await this.txContext.run(executor, () => fn(executor));
            await conn.commit();
            return result;
        } catch (err) {
            try {
                await conn.rollback();
            } catch {
                // ignore rollback error
            }

            throw err;
        } finally {
            conn.release();
        }
    }

    public async close(): Promise<void> {
        await this.pool.end();
    }
}

// ---------- postgres ----------

interface PgQueryResult {
    rows: RawRow[];
    rowCount: number | null;
}

interface PgClient {
    query(sql: string, params: unknown[]): Promise<PgQueryResult>;
}

interface PgPoolClient extends PgClient {
    release(): void;
}

interface PgPool extends PgClient {
    connect(): Promise<PgPoolClient>;
    end(): Promise<void>;
}

function toPgParam(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    return value;
}

class PgExecutor implements DbExecutor {
    public readonly dialect: Dialect = 'postgres';
    protected readonly client: PgClient;

    public constructor(client: PgClient) {
        this.client = client;
    }

    public async query(sql: string, params: unknown[], contextId?: string): Promise<RawRow[]> {
        const startTime = Date.now();
        const result = await this.client.query(convertPlaceholders(sql), params.map(toPgParam));
        logQuery(sql, params, startTime, contextId);
        return result.rows;
    }

    public async exec(sql: string, params: unknown[], contextId?: string): Promise<number> {
        const startTime = Date.now();
        const result = await this.client.query(convertPlaceholders(sql), params.map(toPgParam));
        logQuery(sql, params, startTime, contextId);
        return result.rowCount ?? 0;
    }
}

class PgDriver extends PgExecutor implements DbDriver {
    private readonly pool: PgPool;
    private readonly txContext = new AsyncLocalStorage<PgExecutor>();

    public constructor(pool: PgPool) {
        super(pool);
        this.pool = pool;
    }

    public async transaction<R>(fn: (tx: DbExecutor) => Promise<R>): Promise<R> {
        const current = this.txContext.getStore();

        if (current) {
            return fn(current);
        }

        const client = await this.pool.connect();
        const executor = new PgExecutor(client);

        try {
            await client.query('BEGIN', []);
            const result = await this.txContext.run(executor, () => fn(executor));
            await client.query('COMMIT', []);
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK', []);
            } catch {
                // ignore rollback error
            }

            throw err;
        } finally {
            client.release();
        }
    }

    public async close(): Promise<void> {
        await this.pool.end();
    }
}

function splitHostPort(hostPort: string): [string, string] {
    if (hostPort.startsWith('[')) {
        const end = hostPort.indexOf(']');

        if (end < 0 || hostPort[end + 1] !== ':') {
            throw errs.ErrDatabaseHostInvalid;
        }

        return [hostPort.substring(1, end), hostPort.substring(end + 2)];
    }

    const index = hostPort.lastIndexOf(':');

    if (index < 0 || hostPort.indexOf(':') !== index) {
        throw errs.ErrDatabaseHostInvalid;
    }

    return [hostPort.substring(0, index), hostPort.substring(index + 1)];
}

// createDriver creates a database driver according to the database config
export async function createDriver(dbConfig: DatabaseConfig): Promise<DbDriver> {
    if (dbConfig.databaseType === Sqlite3DbType) {
        if (!existsSync(dbConfig.databasePath)) {
            writeFileSync(dbConfig.databasePath, '');
        }

        return new SqliteDriver(dbConfig.databasePath);
    } else if (dbConfig.databaseType === MySqlDbType) {
        const mysql = await import('mysql2/promise');
        const isUnixSocket = dbConfig.databaseHost.startsWith('/');
        let host = '';
        let port = 3306;

        if (!isUnixSocket) {
            const [h, p] = splitHostPort(dbConfig.databaseHost);
            host = h;
            port = parseInt(p, 10);
        }

        const pool = mysql.createPool({
            host: isUnixSocket ? undefined : host,
            port: isUnixSocket ? undefined : port,
            socketPath: isUnixSocket ? dbConfig.databaseHost : undefined,
            user: dbConfig.databaseUser,
            password: dbConfig.databasePassword,
            database: dbConfig.databaseName,
            charset: 'utf8mb4',
            supportBigNumbers: true,
            bigNumberStrings: true,
            dateStrings: true,
            flags: ['-FOUND_ROWS'],
            connectionLimit: dbConfig.maxOpenConnection > 0 ? dbConfig.maxOpenConnection : 10,
            maxIdle: dbConfig.maxIdleConnection,
            idleTimeout: dbConfig.connectionMaxLifeTime * 1000,
        });

        return new MySqlDriver(pool as unknown as MySqlPool);
    } else if (dbConfig.databaseType === PostgresDbType) {
        const pgModule = await import('pg');
        const pg = pgModule.default ?? pgModule;
        let ssl: boolean | { rejectUnauthorized: boolean } = false;

        if (dbConfig.databaseSSLMode === 'require') {
            ssl = { rejectUnauthorized: false };
        } else if (dbConfig.databaseSSLMode === 'verify-full' || dbConfig.databaseSSLMode === 'verify-ca') {
            ssl = true;
        }

        let host: string;
        let port: number | undefined;

        if (dbConfig.databaseHost.startsWith('/')) {
            host = dbConfig.databaseHost;
        } else {
            const [h, p] = splitHostPort(dbConfig.databaseHost);
            host = h;
            port = parseInt(p, 10);
        }

        const pool = new pg.Pool({
            host: host,
            port: port,
            user: dbConfig.databaseUser,
            password: dbConfig.databasePassword,
            database: dbConfig.databaseName,
            ssl: ssl,
            max: dbConfig.maxOpenConnection > 0 ? dbConfig.maxOpenConnection : 10,
            idleTimeoutMillis: dbConfig.connectionMaxLifeTime * 1000,
        });

        return new PgDriver(pool as unknown as PgPool);
    }

    throw errs.ErrDatabaseTypeInvalid;
}
