import { networkInterfaces } from 'node:os';

import { ErrGettingLocalAddress } from '../errs/index';

export function getLocalIPAddresses(): string[] {
    const ret: string[] = [];
    const interfaces = networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const addr of interfaces[name] ?? []) {
            if (addr.internal) {
                continue;
            }

            if (addr.family === 'IPv4' && addr.address.startsWith('169.254.')) {
                continue;
            }

            if (addr.family === 'IPv6' && addr.address.toLowerCase().startsWith('fe80:')) {
                continue;
            }

            ret.push(addr.address);
        }
    }

    return ret;
}

export function getLocalIPAddressesString(): string {
    const localAddrs = getLocalIPAddresses();

    if (localAddrs.length < 1) {
        throw ErrGettingLocalAddress;
    }

    return localAddrs.join(',');
}
