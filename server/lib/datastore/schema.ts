// Table schema definitions compatible with the xorm struct mappings of the original go models

export type ColumnKind =
    | 'id' // int64, read as bigint
    | 'i64' // int64, read as number
    | 'ni64' // nullable int64 (pointer), read as number | null
    | 'u64' // uint64, read as number
    | 'i32'
    | 'i16'
    | 'u8' // byte / tinyint
    | 'bool'
    | 'str'
    | 'f64'
    | 'blob' // string stored as blob
    | 'mblob' // string stored as medium blob
    | 'json'; // json value stored as blob

export interface JsonCodec {
    encode(value: unknown): string;
    decode(text: string): unknown;
}

export interface ColumnDef {
    name: string;
    prop: string;
    kind: ColumnKind;
    codec?: JsonCodec;
    length?: number;
    pk?: boolean;
    notNull?: boolean;
    defaultValue?: string;
}

export interface IndexDef {
    name: string;
    unique: boolean;
    columns: string[];
}

export interface TableDef<T> {
    name: string;
    columns: ColumnDef[];
    indexes: IndexDef[];
    pkColumns: string[];
    columnMap: Map<string, ColumnDef>;
    propMap: Map<string, ColumnDef>;
    // phantom type
    readonly __type?: T;
}

export interface ColumnOptions {
    codec?: JsonCodec;
    length?: number;
    pk?: boolean;
    notNull?: boolean;
    defaultValue?: string;
    index?: string[];
    unique?: string[];
}

export type ColumnSpec = [name: string, kind: ColumnKind, options?: ColumnOptions];

export function snakeToCamel(name: string): string {
    return name.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

export function defineTable<T>(name: string, specs: ColumnSpec[]): TableDef<T> {
    const columns: ColumnDef[] = [];
    const indexMap = new Map<string, IndexDef>();

    for (const [columnName, kind, options] of specs) {
        const opts = options ?? {};

        columns.push({
            name: columnName,
            prop: snakeToCamel(columnName),
            kind: kind,
            codec: opts.codec,
            length: opts.length,
            pk: opts.pk,
            notNull: opts.notNull || opts.pk,
            defaultValue: opts.defaultValue,
        });

        for (const indexName of opts.index ?? []) {
            let index = indexMap.get(indexName);

            if (!index) {
                index = { name: indexName, unique: false, columns: [] };
                indexMap.set(indexName, index);
            }

            index.columns.push(columnName);
        }

        for (const uniqueName of opts.unique ?? []) {
            let index = indexMap.get(uniqueName);

            if (!index) {
                index = { name: uniqueName, unique: true, columns: [] };
                indexMap.set(uniqueName, index);
            }

            index.columns.push(columnName);
        }
    }

    return {
        name: name,
        columns: columns,
        indexes: Array.from(indexMap.values()),
        pkColumns: columns.filter(c => c.pk).map(c => c.name),
        columnMap: new Map(columns.map(c => [c.name, c])),
        propMap: new Map(columns.map(c => [c.prop, c])),
    };
}

// zeroValueOf returns the go zero value of a column kind
export function zeroValueOf(kind: ColumnKind): unknown {
    switch (kind) {
        case 'id':
            return 0n;
        case 'i64':
        case 'u64':
        case 'i32':
        case 'i16':
        case 'u8':
        case 'f64':
            return 0;
        case 'ni64':
        case 'json':
            return null;
        case 'bool':
            return false;
        case 'str':
        case 'blob':
        case 'mblob':
            return '';
    }
}

// isZeroValue returns whether the value is the go zero value (used by xorm to skip fields when updating without cols)
export function isZeroValue(kind: ColumnKind, value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }

    switch (kind) {
        case 'id':
            return value === 0n || value === 0;
        case 'i64':
        case 'u64':
        case 'i32':
        case 'i16':
        case 'u8':
        case 'f64':
            return value === 0;
        case 'ni64':
        case 'json':
            return false;
        case 'bool':
            return value === false;
        case 'str':
        case 'blob':
        case 'mblob':
            return value === '';
    }
}
