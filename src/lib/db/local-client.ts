/**
 * OCL Nexus Local — PostgreSQL client wrapper
 *
 * Provides a Supabase-compatible API for local PostgreSQL database.
 * This wrapper mimics the Supabase query builder interface to minimize
 * code changes during the localization process.
 */

import postgres from "postgres";

// Lazy PostgreSQL connection (initialized on first use)
let sql: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!sql) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    sql = postgres(DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

// Helper to convert numeric string fields to numbers
function parseNumericFields<T = unknown>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row && typeof row === "object") {
      const parsed = { ...row } as Record<string, unknown>;
      // Parse balance field (NUMERIC(12,8))
      if ("balance" in parsed && typeof parsed.balance === "string") {
        parsed.balance = parseFloat(parsed.balance);
      }
      // Parse amount field (NUMERIC(12,8))
      if ("amount" in parsed && typeof parsed.amount === "string") {
        parsed.amount = parseFloat(parsed.amount);
      }
      return parsed as T;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Query Builder (Supabase-compatible API)
// ---------------------------------------------------------------------------

interface QueryBuilder<T = unknown> {
  select(columns?: string, options?: { count?: string; head?: boolean }): this;
  insert(data: Record<string, unknown> | Record<string, unknown>[]): this;
  update(data: Record<string, unknown>): this;
  delete(): this;
  upsert(data: Record<string, unknown> | Record<string, unknown>[]): this;
  eq(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  gt(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
  like(column: string, pattern: string): this;
  ilike(column: string, pattern: string): this;
  in(column: string, values: unknown[]): this;
  is(column: string, value: unknown): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(count: number): this;
  range(from: number, to: number): this;
  single(): Promise<{ data: T | null; error: unknown }>;
  then(
    onfulfilled?: (value: { data: T[] | null; error: unknown; count?: number | null }) => unknown,
    onrejected?: (reason: unknown) => unknown
  ): Promise<unknown>;
}

class PostgresQueryBuilder<T = unknown> implements QueryBuilder<T> {
  private tableName: string;
  private operation: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
  private selectColumns: string = "*";
  private whereConditions: string[] = [];
  private whereValues: unknown[] = [];
  private insertData: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private updateData: Record<string, unknown> | null = null;
  private orderColumn: string | null = null;
  private orderAscending: boolean = true;
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private countMode: boolean = false;
  private headMode: boolean = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(columns?: string, options?: { count?: string; head?: boolean }): this {
    // Only set operation to "select" if no operation is set yet
    // This allows select() to be called after insert/update/delete to specify RETURNING columns
    if (this.operation === null) {
      this.operation = "select";
    }
    if (columns) {
      this.selectColumns = columns;
    }
    if (options?.count === "exact") {
      this.countMode = true;
    }
    if (options?.head === true) {
      this.headMode = true;
    }
    return this;
  }

  insert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = "insert";
    this.insertData = data;
    return this;
  }

  update(data: Record<string, unknown>): this {
    this.operation = "update";
    this.updateData = data;
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  upsert(data: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = "upsert";
    this.insertData = data;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.whereConditions.push(`${column} = $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.whereConditions.push(`${column} != $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.whereConditions.push(`${column} > $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.whereConditions.push(`${column} >= $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.whereConditions.push(`${column} < $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.whereConditions.push(`${column} <= $${this.whereValues.length + 1}`);
    this.whereValues.push(value);
    return this;
  }

  like(column: string, pattern: string): this {
    this.whereConditions.push(`${column} LIKE $${this.whereValues.length + 1}`);
    this.whereValues.push(pattern);
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.whereConditions.push(`${column} ILIKE $${this.whereValues.length + 1}`);
    this.whereValues.push(pattern);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.whereConditions.push(`${column} = ANY($${this.whereValues.length + 1})`);
    this.whereValues.push(values);
    return this;
  }

  is(column: string, value: unknown): this {
    if (value === null) {
      this.whereConditions.push(`${column} IS NULL`);
    } else {
      this.whereConditions.push(`${column} IS NOT NULL`);
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  async single(): Promise<{ data: T | null; error: unknown }> {
    try {
      const result = await this.execute();
      if (result.error) {
        return { data: null, error: result.error };
      }
      const data = result.data && result.data.length > 0 ? result.data[0] : null;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async maybeSingle(): Promise<{ data: T | null; error: unknown }> {
    try {
      const result = await this.execute();
      if (result.error) {
        return { data: null, error: result.error };
      }
      if (!result.data || result.data.length === 0) {
        return { data: null, error: null };
      }
      if (result.data.length > 1) {
        return { data: null, error: new Error("Multiple rows returned") };
      }
      return { data: result.data[0], error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  then(
    onfulfilled?: (value: { data: T[] | null; error: unknown; count?: number | null }) => unknown,
    onrejected?: (reason: unknown) => unknown
  ): Promise<unknown> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: T[] | null; error: unknown; count?: number | null }> {
    try {
      let query = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values = [...this.whereValues] as any[];

      switch (this.operation) {
        case "select": {
          const whereClause = this.whereConditions.length > 0
            ? ` WHERE ${this.whereConditions.join(" AND ")}`
            : "";

          if (this.countMode && this.headMode) {
            // HEAD + count: return total count only, no rows
            const result = await getSql().unsafe(
              `SELECT COUNT(*) as count FROM ${this.tableName}${whereClause}`,
              values
            );
            return { data: null, error: null, count: parseInt(result[0]?.count || "0", 10) };
          }

          // Build the data query
          query = `SELECT ${this.selectColumns} FROM ${this.tableName}${whereClause}`;
          if (this.orderColumn) {
            query += ` ORDER BY ${this.orderColumn} ${this.orderAscending ? "ASC" : "DESC"}`;
          }
          if (this.rangeFrom !== null && this.rangeTo !== null) {
            query += ` LIMIT ${this.rangeTo - this.rangeFrom + 1} OFFSET ${this.rangeFrom}`;
          } else if (this.limitCount !== null) {
            query += ` LIMIT ${this.limitCount}`;
          }

          const rows = await getSql().unsafe(query, values);
          const data = parseNumericFields(rows as unknown as T[]);

          if (this.countMode) {
            // count=exact without head: return both data and total count
            const countResult = await getSql().unsafe(
              `SELECT COUNT(*) as count FROM ${this.tableName}${whereClause}`,
              values
            );
            return { data, error: null, count: parseInt(countResult[0]?.count || "0", 10) };
          }

          return { data, error: null };
        }

        case "insert": {
          const records = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
          if (records.length === 0 || !records[0]) {
            return { data: null, error: new Error("No data to insert") };
          }

          const columns = Object.keys(records[0]);
          const placeholders = records
            .map(
              (_, i) =>
                `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(", ")})`
            )
            .join(", ");

          const insertValues = records
            .filter((record): record is Record<string, unknown> => record !== null)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .flatMap((record) => columns.map((col) => record[col])) as any[];

          // Use selectColumns if specified, otherwise return all columns
          const returning = this.selectColumns !== "*" ? this.selectColumns : "*";
          query = `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES ${placeholders} RETURNING ${returning}`;
          const result = await getSql().unsafe(query, insertValues);
          return { data: parseNumericFields(result as unknown as T[]), error: null };
        }

        case "update": {
          if (!this.updateData) {
            return { data: null, error: new Error("No data to update") };
          }
          const updateData = this.updateData;
          const columns = Object.keys(updateData);
          const setClause = columns
            .map((col, i) => `${col} = $${values.length + i + 1}`)
            .join(", ");

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateValues = columns.map((col) => updateData[col]) as any[];

          query = `UPDATE ${this.tableName} SET ${setClause}`;
          if (this.whereConditions.length > 0) {
            query += ` WHERE ${this.whereConditions.join(" AND ")}`;
          }
          query += " RETURNING *";

          const result = await getSql().unsafe(query, [...values, ...updateValues]);
          return { data: parseNumericFields(result as unknown as T[]), error: null };
        }

        case "delete": {
          query = `DELETE FROM ${this.tableName}`;
          if (this.whereConditions.length > 0) {
            query += ` WHERE ${this.whereConditions.join(" AND ")}`;
          }
          query += " RETURNING *";
          const result = await getSql().unsafe(query, values);
          return { data: parseNumericFields(result as unknown as T[]), error: null };
        }

        case "upsert": {
          const records = Array.isArray(this.insertData) ? this.insertData : [this.insertData];
          if (records.length === 0 || !records[0]) {
            return { data: null, error: new Error("No data to upsert") };
          }

          const columns = Object.keys(records[0]);
          const placeholders = records
            .map(
              (_, i) =>
                `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(", ")})`
            )
            .join(", ");

          const upsertValues = records
            .filter((record): record is Record<string, unknown> => record !== null)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .flatMap((record) => columns.map((col) => record[col])) as any[];

          // Upsert using ON CONFLICT (assuming 'id' as conflict column)
          const updateClause = columns
            .filter((col) => col !== "id")
            .map((col) => `${col} = EXCLUDED.${col}`)
            .join(", ");

          query = `INSERT INTO ${this.tableName} (${columns.join(", ")}) VALUES ${placeholders} ON CONFLICT (id) DO UPDATE SET ${updateClause} RETURNING *`;
          const result = await getSql().unsafe(query, upsertValues);
          return { data: parseNumericFields(result as unknown as T[]), error: null };
        }

        default:
          return { data: null, error: new Error("No operation specified") };
      }
    } catch (error) {
      console.error("[local-client] Query error:", error);
      return { data: null, error };
    }
  }
}

// ---------------------------------------------------------------------------
// Main Client (Supabase-compatible interface)
// ---------------------------------------------------------------------------

export const localDb = {
  from<T = unknown>(tableName: string): QueryBuilder<T> {
    return new PostgresQueryBuilder<T>(tableName);
  },
};

// Export getSql for advanced raw queries if needed
export { getSql };
