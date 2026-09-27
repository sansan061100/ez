export enum ThemeType {
    Light = 'light',
    Dark = 'dark',
    Ledger = 'ledger',
    Brutalist = 'brutalist',
    Terminal = 'terminal',
    Aurora = 'aurora'
}

export const DARK_THEMES: ReadonlySet<string> = new Set([ThemeType.Dark, ThemeType.Terminal, ThemeType.Aurora]);

export function isKnownTheme(value: string): value is ThemeType {
    return (Object.values(ThemeType) as string[]).includes(value);
}
