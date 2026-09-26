// MCP tools info generated from go structs by invopop/jsonschema (anonymous, expanded struct, empty version)
// DO NOT EDIT: regenerate by running go program which marshals mcp.Container.GetMCPTools()

export const MCPToolsInfo: Record<string, unknown>[] = 
[
    {
        "name": "add_transaction",
        "inputSchema": {
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "income",
                        "expense",
                        "transfer"
                    ],
                    "description": "Transaction type (income, expense, transfer)"
                },
                "time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Transaction time in RFC 3339 format (e.g. 2023-01-01T12:00:00Z)"
                },
                "category_name": {
                    "type": "string",
                    "description": "Secondary category name for the transaction"
                },
                "account_name": {
                    "type": "string",
                    "description": "Account name for the transaction"
                },
                "amount": {
                    "type": "string",
                    "description": "Transaction amount (e.g. for an expense transaction, 12.34 represents an expense of 12.34)"
                },
                "destination_account_name": {
                    "type": "string",
                    "description": "Destination account name for transfer transactions (optional)"
                },
                "destination_amount": {
                    "type": "string",
                    "description": "Destination amount for transfer transactions (optional)"
                },
                "tags": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of tags associated with the transaction (optional, maximum 10 tags allowed)"
                },
                "comment": {
                    "type": "string",
                    "description": "Transaction description"
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "If true, the transaction will not be saved, only validated (optional)"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "type",
                "time",
                "category_name",
                "account_name",
                "amount"
            ]
        },
        "outputSchema": {
            "properties": {
                "success": {
                    "type": "boolean",
                    "description": "Indicates whether this operation is successful"
                },
                "dry_run": {
                    "type": "boolean",
                    "description": "Indicates whether this operation is a dry run (transaction not saved actually)"
                },
                "account_balance": {
                    "type": "string",
                    "description": "Account balance (or outstanding balance for debt accounts) after the transaction"
                },
                "destination_account_balance": {
                    "type": "string",
                    "description": "Destination account balance (or outstanding balance for debt accounts) after the transaction (only for transfer transactions)"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "success"
            ]
        },
        "description": "Add a new transaction in ezBookkeeping."
    },
    {
        "name": "query_transactions",
        "inputSchema": {
            "properties": {
                "start_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Start time for the query in RFC 3339 format (e.g. 2023-01-01T12:00:00Z)"
                },
                "end_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "End time for the query in RFC 3339 format or (e.g. 2023-01-01T12:00:00Z)"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "income",
                        "expense",
                        "transfer",
                        "balance_modification"
                    ],
                    "description": "Transaction type to filter by (income, expense, transfer, balance_modification) (optional)"
                },
                "category_name": {
                    "type": "string",
                    "description": "Primary or secondary category name to filter transactions by (optional)"
                },
                "account_name": {
                    "type": "string",
                    "description": "Account name to filter transactions by (optional)"
                },
                "keyword": {
                    "type": "string",
                    "description": "Keyword to search in transaction description (optional)"
                },
                "match_mode": {
                    "type": "string",
                    "enum": [
                        "default",
                        "ignore_case"
                    ],
                    "description": "Match mode for keyword search (optional, leave empty for database default setting, ignore_case for case-insensitive search)"
                },
                "count": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 100)",
                    "default": 100
                },
                "page": {
                    "type": "integer",
                    "description": "Page number for pagination (default: 1)",
                    "default": 1
                },
                "response_fields": {
                    "type": "string",
                    "description": "Comma-separated list of optional fields to include in the response (optional, leave empty for all fields, available fields: time, currency, category_name, account_name, comment)"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "start_time",
                "end_time"
            ]
        },
        "outputSchema": {
            "properties": {
                "total_count": {
                    "type": "integer",
                    "description": "Total number of transactions matching the query"
                },
                "current_page": {
                    "type": "integer",
                    "description": "Current page number of the results"
                },
                "total_page": {
                    "type": "integer",
                    "description": "Total number of pages available for the query, calculated based on total_count and count"
                },
                "transactions": {
                    "items": {
                        "properties": {
                            "time": {
                                "type": "string",
                                "description": "Time of the transaction in RFC 3339 format (e.g. 2023-01-01T12:00:00Z)"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "income",
                                    "expense",
                                    "transfer",
                                    "balance_modification"
                                ],
                                "description": "Transaction type (income, expense, transfer, balance_modification)"
                            },
                            "amount": {
                                "type": "string",
                                "description": "Amount of the transaction in the specified currency"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the transaction (e.g. USD, EUR)"
                            },
                            "category_name": {
                                "type": "string",
                                "description": "Secondary category name for the transaction"
                            },
                            "account_name": {
                                "type": "string",
                                "description": "Account name for the transaction"
                            },
                            "destination_amount": {
                                "type": "string",
                                "description": "Destination amount for transfer transactions (optional)"
                            },
                            "destination_currency": {
                                "type": "string",
                                "description": "Currency code of the destination amount for transfer transactions (optional)"
                            },
                            "destination_account_name": {
                                "type": "string",
                                "description": "Destination account name for transfer transactions (optional)"
                            },
                            "comment": {
                                "type": "string",
                                "description": "Description of the transaction"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "type",
                            "amount"
                        ]
                    },
                    "type": "array",
                    "description": "List of transactions matching the query"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "total_count",
                "current_page",
                "total_page",
                "transactions"
            ]
        },
        "description": "Query transactions based on various filters."
    },
    {
        "name": "query_all_accounts",
        "inputSchema": {
            "type": "object"
        },
        "outputSchema": {
            "properties": {
                "cashAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of cash account names"
                },
                "checkingAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of checking account names"
                },
                "savingsAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of savings account names"
                },
                "creditCardAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of credit card account names"
                },
                "virtualAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of virtual account names"
                },
                "debtAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of debt account names"
                },
                "receivableAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of receivable account names"
                },
                "certificateOfDepositAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of certificate of deposit account names"
                },
                "investmentAccounts": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of investment account names"
                }
            },
            "additionalProperties": false,
            "type": "object"
        },
        "description": "Query all accounts for the current user in ezBookkeeping."
    },
    {
        "name": "query_all_accounts_balance",
        "inputSchema": {
            "type": "object"
        },
        "outputSchema": {
            "properties": {
                "cashAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of cash account balances"
                },
                "checkingAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of checking account balances"
                },
                "savingsAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of savings account balances"
                },
                "creditCardAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of credit card account outstanding balances"
                },
                "virtualAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of virtual account balances"
                },
                "debtAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of debt account outstanding balances"
                },
                "receivableAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of receivable account balances"
                },
                "certificateOfDepositAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of certificate of deposit account balances"
                },
                "investmentAccounts": {
                    "items": {
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Account name"
                            },
                            "type": {
                                "type": "string",
                                "enum": [
                                    "asset",
                                    "liability"
                                ],
                                "description": "Account type (asset or liability)"
                            },
                            "balance": {
                                "type": "string",
                                "description": "Current balance of the account"
                            },
                            "outstandingBalance": {
                                "type": "string",
                                "description": "Current outstanding balance of the account (positive value indicates amount owed)"
                            },
                            "currency": {
                                "type": "string",
                                "description": "Currency code of the account (e.g. USD, EUR)"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "name",
                            "type",
                            "currency"
                        ]
                    },
                    "type": "array",
                    "description": "List of investment account balances"
                }
            },
            "additionalProperties": false,
            "type": "object"
        },
        "description": "Query all accounts balance for the current user in ezBookkeeping."
    },
    {
        "name": "query_all_transaction_categories",
        "inputSchema": {
            "type": "object"
        },
        "outputSchema": {
            "properties": {
                "incomeCategories": {
                    "additionalProperties": {
                        "items": {
                            "type": "string"
                        },
                        "type": "array"
                    },
                    "type": "object",
                    "description": "List of income categories, field key is the primary category name, field value is the list of secondary category names"
                },
                "expenseCategories": {
                    "additionalProperties": {
                        "items": {
                            "type": "string"
                        },
                        "type": "array"
                    },
                    "type": "object",
                    "description": "List of expense categories, field key is the primary category name, field value is the list of secondary category names"
                },
                "transferCategories": {
                    "additionalProperties": {
                        "items": {
                            "type": "string"
                        },
                        "type": "array"
                    },
                    "type": "object",
                    "description": "List of transfer categories, field key is the primary category name, field value is the list of secondary category names"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "incomeCategories",
                "expenseCategories",
                "transferCategories"
            ]
        },
        "description": "Query all transaction categories for the current user in ezBookkeeping."
    },
    {
        "name": "query_all_transaction_tags",
        "inputSchema": {
            "type": "object"
        },
        "outputSchema": {
            "properties": {
                "tags": {
                    "items": {
                        "type": "string"
                    },
                    "type": "array",
                    "description": "List of transaction tags"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "tags"
            ]
        },
        "description": "Query transaction tags for the current user in ezBookkeeping."
    },
    {
        "name": "query_latest_exchange_rates",
        "inputSchema": {
            "properties": {
                "currencies": {
                    "type": "string",
                    "description": "Comma-separated list of currencies to query exchange rates for (e.g. USD,CNY,EUR)"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "currencies"
            ]
        },
        "outputSchema": {
            "properties": {
                "base_currency": {
                    "type": "string",
                    "description": "Base currency code (e.g. USD)"
                },
                "update_time": {
                    "type": "string",
                    "description": "Last update time of the exchange rates in RFC 3339 format (e.g. '2023-01-01T12:00:00Z')"
                },
                "rates": {
                    "items": {
                        "properties": {
                            "currency": {
                                "type": "string",
                                "description": "Currency code (e.g. USD)"
                            },
                            "rate_to_base": {
                                "type": "string",
                                "description": "The amount of the base currency that can be obtained for 1 unit of this currency"
                            }
                        },
                        "additionalProperties": false,
                        "type": "object",
                        "required": [
                            "currency",
                            "rate_to_base"
                        ]
                    },
                    "type": "array",
                    "description": "Exchange rates for the specified currencies"
                }
            },
            "additionalProperties": false,
            "type": "object",
            "required": [
                "base_currency",
                "update_time",
                "rates"
            ]
        },
        "description": "Query latest exchange rates with specified currencies."
    }
]
;
