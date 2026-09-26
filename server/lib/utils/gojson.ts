// Helpers to emulate go encoding/json unmarshalling into structs (case-insensitive key matching, type checking)

export class GoJsonTypeError extends Error {
    public constructor(field: string, actual: unknown, expected: string) {
        super(`json: cannot unmarshal ${goJsonTypeName(actual)} into Go struct field .${field} of type ${expected}`);
        this.name = 'GoJsonTypeError';
    }
}

function goJsonTypeName(value: unknown): string {
    if (Array.isArray(value)) {
        return 'array';
    }

    if (value === null) {
        return 'null';
    }

    if (typeof value === 'object') {
        return 'object';
    }

    return typeof value;
}

// goJsonField returns the value of the key in object like go encoding/json (exact match first, then case-insensitive match)
export function goJsonField(obj: Record<string, unknown>, key: string): unknown {
    if (Object.hasOwn(obj, key)) {
        return obj[key];
    }

    const lowerKey = key.toLowerCase();
    let result: unknown = undefined;

    for (const [k, v] of Object.entries(obj)) {
        if (k.toLowerCase() === lowerKey) {
            // go uses the last matched value when multiple keys match
            result = v;
        }
    }

    return result;
}

// goJsonString returns the string field value, empty string for null / missing, throws for other types
export function goJsonString(obj: Record<string, unknown>, key: string): string {
    const value = goJsonField(obj, key);

    if (value === undefined || value === null) {
        return '';
    }

    if (typeof value !== 'string') {
        throw new GoJsonTypeError(key, value, 'string');
    }

    return value;
}

// goJsonStringArray returns the string array field value, null for null / missing, throws for other types
export function goJsonStringArray(obj: Record<string, unknown>, key: string): string[] | null {
    const value = goJsonField(obj, key);

    if (value === undefined || value === null) {
        return null;
    }

    if (!Array.isArray(value)) {
        throw new GoJsonTypeError(key, value, '[]string');
    }

    return value.map(item => {
        if (item === null) {
            return '';
        }

        if (typeof item !== 'string') {
            throw new GoJsonTypeError(key, item, 'string');
        }

        return item;
    });
}

// goJsonNumber returns the number field value, 0 for null / missing, throws for other types
export function goJsonNumber(obj: Record<string, unknown>, key: string): number {
    const value = goJsonField(obj, key);

    if (value === undefined || value === null) {
        return 0;
    }

    if (typeof value !== 'number') {
        throw new GoJsonTypeError(key, value, 'number');
    }

    return value;
}

// goJsonUnmarshalObject parses the json text to object, returns null for json null, throws for non-object value
export function goJsonUnmarshalObject(text: string, typeName: string): Record<string, unknown> | null {
    const value = JSON.parse(text) as unknown;

    if (value === null) {
        return null;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`json: cannot unmarshal ${goJsonTypeName(value)} into Go value of type ${typeName}`);
    }

    return value as Record<string, unknown>;
}
