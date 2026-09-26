// Textual representations of core enums (generated from the String() methods of pkg/core)

const enumNames: Record<string, Record<number, string>> = {
    CalendarDisplayType: {
        0: "Default",
        1: "Gregorian",
        2: "Buddhist",
        3: "Gregorian with Chinese Calendar",
        4: "Gregorian with Persian Calendar",
        255: "Invalid",
    },
    CoordinateDisplayType: {
        0: "Default",
        1: "Latitude Longitude (Decimal Degrees)",
        2: "Longitude Latitude (Decimal Degrees)",
        3: "Latitude Longitude (Decimal Minutes)",
        4: "Longitude Latitude (Decimal Minutes)",
        5: "Latitude Longitude (Degrees Minutes Seconds)",
        6: "Longitude Latitude (Degrees Minutes Seconds)",
        255: "Invalid",
    },
    CurrencyDisplayType: {
        0: "Default",
        1: "None",
        2: "Symbol Before Amount",
        3: "Symbol After Amount",
        4: "Symbol Before Amount Without Space",
        5: "Symbol After Amount Without Space",
        6: "Code Before Amount",
        7: "Code After Amount",
        8: "Unit Before Amount",
        9: "Unit After Amount",
        10: "Name Before Amount",
        11: "Name After Amount",
        255: "Invalid",
    },
    DateDisplayType: {
        0: "Default",
        1: "Gregorian",
        2: "Buddhist",
        3: "Persian",
        255: "Invalid",
    },
    DecimalSeparator: {
        0: "Default",
        1: "Dot",
        2: "Comma",
        255: "Invalid",
    },
    DigitGroupingSymbol: {
        0: "Default",
        1: "Dot",
        2: "Comma",
        3: "Space",
        4: "Apostrophe",
        255: "Invalid",
    },
    DigitGroupingType: {
        0: "Default",
        1: "None",
        2: "Thousands Separator",
        3: "Indian Number Grouping",
        255: "Invalid",
    },
    FiscalYearFormat: {
        0: "Default",
        1: "StartYYYY-EndYYYY",
        2: "StartYYYY-EndYY",
        3: "StartYY-EndYY",
        4: "EndYYYY",
        5: "EndYY",
        255: "Invalid",
    },
    LongDateFormat: {
        0: "Default",
        1: "YYYY_MM_D",
        2: "M_D_YYYY",
        3: "D_M_YYYY",
        255: "Invalid",
    },
    LongTimeFormat: {
        0: "Default",
        1: "HH_MM_SS",
        2: "A_HH_MM_SS",
        3: "HH_MM_SS_A",
        255: "Invalid",
    },
    NumeralSystem: {
        0: "Default",
        1: "Western Arabic Numerals",
        2: "Eastern Arabic Numerals",
        3: "Persian Digits",
        4: "Burmese Numerals",
        5: "Devanagari Numerals",
    },
    ShortDateFormat: {
        0: "Default",
        1: "YYYY_MM_D",
        2: "M_D_YYYY",
        3: "D_M_YYYY",
        255: "Invalid",
    },
    ShortTimeFormat: {
        0: "Default",
        1: "HH_MM",
        2: "A_HH_MM",
        3: "HH_MM_A",
        255: "Invalid",
    },
    WeekDay: {
        0: "Sunday",
        1: "Monday",
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday",
        255: "Invalid",
    },
};

export type CoreEnumType = 'WeekDay' | 'CalendarDisplayType' | 'DateDisplayType' | 'LongDateFormat' | 'ShortDateFormat' | 'LongTimeFormat' | 'ShortTimeFormat' | 'FiscalYearFormat' | 'CurrencyDisplayType' | 'NumeralSystem' | 'DecimalSeparator' | 'DigitGroupingSymbol' | 'DigitGroupingType' | 'CoordinateDisplayType';

// coreEnumName returns the textual representation of the specified core enum value
export function coreEnumName(type: CoreEnumType, value: number): string {
    const names = enumNames[type];
    return names && Object.hasOwn(names, value) ? names[value]! : `Invalid(${value})`;
}
