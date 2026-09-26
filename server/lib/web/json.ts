function escapeJsonString(str: string): string {
    return JSON.stringify(str)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function serialize(value: unknown, key: string, holder: unknown): string | undefined {
    if (value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function' && !(value instanceof Map)) {
        value = (value as { toJSON: (key: string) => unknown }).toJSON(key);
    }

    void holder;

    switch (typeof value) {
        case 'string':
            return escapeJsonString(value);
        case 'number':
            return Number.isFinite(value) ? JSON.stringify(value) : 'null';
        case 'bigint':
            return escapeJsonString(value.toString());
        case 'boolean':
            return value ? 'true' : 'false';
        case 'undefined':
        case 'function':
        case 'symbol':
            return undefined;
    }

    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        const items: string[] = [];

        for (let i = 0; i < value.length; i++) {
            items.push(serialize(value[i], String(i), value) ?? 'null');
        }

        return '[' + items.join(',') + ']';
    }

    const entries: [string, unknown][] = value instanceof Map
        ? Array.from(value.entries(), ([k, v]) => [String(k), v] as [string, unknown])
        : Object.entries(value as Record<string, unknown>);
    const items: string[] = [];

    for (const [k, v] of entries) {
        const text = serialize(v, k, value);

        if (text !== undefined) {
            items.push(escapeJsonString(k) + ':' + text);
        }
    }

    return '{' + items.join(',') + '}';
}

// goJsonStringify serializes the value like go encoding/json (bigint as string, html characters escaped, map keeps insertion order)
export function goJsonStringify(value: unknown): string {
    return serialize(value, '', null) ?? 'null';
}

// sortedRecord returns a new object with keys sorted (go encoding/json sorts map keys)
export function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
    const ret: Record<string, T> = {};

    for (const key of Object.keys(record).sort()) {
        ret[key] = record[key]!;
    }

    return ret;
}

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeysDeep);
    }

    if (value !== null && typeof value === 'object' && !(value instanceof Map)) {
        const ret: Record<string, unknown> = {};

        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            ret[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        }

        return ret;
    }

    return value;
}

// goMarshalMap serializes the map value like go json.Marshal (keys of maps are sorted)
export function goMarshalMap(value: unknown): string {
    return goJsonStringify(sortKeysDeep(value));
}
