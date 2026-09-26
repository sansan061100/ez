export function int64SliceEquals(s1: bigint[] | null | undefined, s2: bigint[] | null | undefined): boolean {
    if ((s1 == null) !== (s2 == null)) {
        return false;
    }

    if (!s1 || !s2) {
        return true;
    }

    if (s1.length !== s2.length) {
        return false;
    }

    for (let i = 0; i < s1.length; i++) {
        if (s1[i] !== s2[i]) {
            return false;
        }
    }

    return true;
}

export function int64SliceMinus(s1: bigint[] | null | undefined, s2: bigint[] | null | undefined): bigint[] | null {
    if (!s1) {
        return null;
    }

    const s2Items = new Set(s2 ?? []);
    return s1.filter(item => !s2Items.has(item));
}

export function toUniqueInt64Slice(items: bigint[]): bigint[] {
    return Array.from(new Set(items));
}

export function int64Sort(items: bigint[]): void {
    items.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function toSet<T>(items: T[]): Set<T> {
    return new Set(items);
}

export function compareBigInt(a: bigint, b: bigint): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export function mergeMaps<K, V>(...mapsToMerge: Map<K, V>[]): Map<K, V> {
    const m = new Map<K, V>();

    for (const src of mapsToMerge) {
        for (const [k, v] of src) {
            m.set(k, v);
        }
    }

    return m;
}

export function mergeRecords<V>(...recordsToMerge: Record<string, V>[]): Record<string, V> {
    return Object.assign({}, ...recordsToMerge) as Record<string, V>;
}
