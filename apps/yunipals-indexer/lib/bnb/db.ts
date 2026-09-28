import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
