import type { ColumnDef } from './schema';

const textDecoder = new TextDecoder();

export function toBigIntValue(v: unknown): bigint {
    if (v === null || v === undefined) {
        return 0n;
    }

    if (typeof v === 'bigint') {
        return v;
    }

    if (typeof v === 'number') {
        return BigInt(Math.trunc(v));
    }

    if (typeof v === 'boolean') {
        return v ? 1n : 0n;
    }

    const str = toStringValue(v).trim();

    if (str === '') {
        return 0n;
    }

    const dotIndex = str.indexOf('.');
    return BigInt(dotIndex >= 0 ? str.substring(0, dotIndex) || '0' : str);
}

export function toNumberValue(v: unknown): number {
    if (v === null || v === undefined) {
        return 0;
    }

    if (typeof v === 'number') {
        return v;
    }

    if (typeof v === 'bigint') {
        return Number(v);
    }

    if (typeof v === 'boolean') {
        return v ? 1 : 0;
    }

    const num = Number(toStringValue(v));
    return Number.isNaN(num) ? 0 : num;
}

export function toBoolValue(v: unknown): boolean {
    if (v === null || v === undefined) {
        return false;
    }

    if (typeof v === 'boolean') {
        return v;
    }

    if (typeof v === 'number') {
        return v !== 0;
    }

    if (typeof v === 'bigint') {
        return v !== 0n;
    }

    const str = toStringValue(v).toLowerCase();
    return str === '1' || str === 't' || str === 'true';
}

export function toStringValue(v: unknown): string {
    if (v === null || v === undefined) {
        return '';
    }

    if (typeof v === 'string') {
        return v;
    }

    if (v instanceof Uint8Array) {
        return textDecoder.decode(v);
    }

    return String(v);
}

// decodeColumnValue converts a raw database value to the javascript value of the column
export function decodeColumnValue(column: ColumnDef, v: unknown): unknown {
    switch (column.kind) {
        case 'id':
            return toBigIntValue(v);
        case 'i64':
        case 'u64':
        case 'i32':
        case 'i16':
        case 'u8':
        case 'f64':
            return toNumberValue(v);
        case 'ni64':
            return v === null || v === undefined ? null : toNumberValue(v);
        case 'bool':
            return toBoolValue(v);
        case 'str':
        case 'blob':
        case 'mblob':
            return toStringValue(v);
        case 'json': {
            if (v === null || v === undefined) {
                return null;
            }

            const text = toStringValue(v);

            if (text === '') {
                return null;
            }

            try {
                return column.codec ? column.codec.decode(text) : JSON.parse(text);
            } catch {
                return null;
            }
        }
    }
}

// encodeColumnValue converts a javascript value to the database value of the column
export function encodeColumnValue(column: ColumnDef, v: unknown): unknown {
    switch (column.kind) {
        case 'id':
            if (v === null || v === undefined) {
                return 0n;
            }

            return typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)));
        case 'i64':
        case 'u64':
        case 'i32':
        case 'i16':
        case 'u8':
            if (v === null || v === undefined) {
                return 0;
            }

            return typeof v === 'bigint' ? Number(v) : Math.trunc(Number(v));
        case 'f64':
            return v === null || v === undefined ? 0 : Number(v);
        case 'ni64':
            return v === null || v === undefined ? null : Math.trunc(Number(v));
        case 'bool':
            return Boolean(v);
        case 'str':
            return v === null || v === undefined ? '' : String(v);
        case 'blob':
        case 'mblob':
            return v === null || v === undefined ? null : Buffer.from(String(v));
        case 'json':
            if (v === null || v === undefined) {
                return null;
            }

            return Buffer.from(column.codec ? column.codec.encode(v) : JSON.stringify(v));
    }
}
