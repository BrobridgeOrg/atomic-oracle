# atomic-oracle

Oracle Database Module for Brobridge Atomic (Compatible with Node-RED).

## Overview

`@brobridge/atomic-oracle` is an Oracle database module designed specifically for Atomic, fully compatible with the Node-RED development environment. It provides three main nodes:

- **Oracle Connection**: Connection configuration and pool manager  
- **Oracle Execute**: Query execution  
- **Flow Control**: Control flow node for streaming data (requires `@brobridge/atomic-flowcontrol`)

## Installation

```sh
npm install @brobridge/atomic-oracle
```

For flow control functionality, also install:
   ```sh
npm install @brobridge/atomic-flowcontrol
```

## Features

- Efficient connection pool support with configurable options  
- Static or dynamic SQL execution via `msg.query`  
- Delivery options:  
  - `direct`: returns all results at once  
  - `streaming`: sends rows in batches  
- SQL Playground UI to test queries interactively  
- Supports `continue` and `break` controls for streaming sessions (with Flow Control node)

## Oracle Connection Node

### Oracle Connection

Manages database configuration and connection pool options.

- Required fields: `host`, `port`, `user`, `password`, `serviceName` or `database`
- Configurable: connection timeouts, pool settings
- Pool options: `min`, `max`, `increment`, `timeout`

Defines a reusable Oracle database connection.

### Oracle Execute

Executes SQL queries with flexible query sources and delivery modes.

- **Query Source**:
  - `auto`: Uses embedded SQL command
  - `dynamic`: Uses `msg.query` as input
- **Delivery Mode**:
  - `direct`: Entire result set is returned
  - `streaming`: Sends rows in batches with session control
- **Output**:
  - Output to `msg.payload` or custom property
- SQL Playground for testing queries interactively in the editor

### Flow Control

Controls flow when using `streaming` mode in Oracle Execute node.

- `continue`: Resume the session
- `break`: Cancel the session
- Supports targeting specific Execute nodes

**Note**: Flow Control functionality requires the `@brobridge/atomic-flowcontrol` package.

## SQL Playground

The `Oracle Execute` node includes a built-in SQL Playground, allowing you to write and run SQL queries interactively.

## Example Flow: Streaming Data Processing

The streaming mode allows you to process large datasets in batches:

1. Configure Oracle Execute node with `streaming` delivery method
2. Set appropriate batch size (Max Records)
3. Use Flow Control node to manage stream processing
4. Implement your data processing logic between batches

## Variable Substitution

SQL queries support variable substitution using `${variable}` syntax:

```sql
SELECT * FROM users WHERE id = ${msg.payload.userId}
```

## Flow Control Usage

When using streaming mode:

1. Set Oracle Execute node to "Streaming" delivery method
2. Connect your processing logic after the Oracle Execute node
3. Add a Flow Control node to continue or break the stream
4. Configure the Flow Control node to target your Oracle Execute node

Example message structure for streaming:
```javascript
{
  payload: {
    results: [...],      // Batch of rows
    rowsAffected: 100,   // Number of rows in this batch
    complete: false      // false for batches, true for final batch
  }
}
```

## Dependencies

- Node.js >= 18
- Node-RED >= 2.0.0
- Oracle Database Client Libraries
- @brobridge/atomic-sdk for flow control functionality

## License

This module is licensed under the Apache License.

## Authors

Copyright(c) 2025 Jhe Sue <<jhe@brobridge.com>>
