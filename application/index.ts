import { Pool } from "pg";

const db = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres_password",
    database: "postgres",
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
});

const boot = async () => {
    console.log("Booting application...");
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Application booted successfully.");
    } catch (error) {
        console.error("Error booting application:", error);
    }
};

const cleanup = async () => {
    console.log("Cleaning up application...");
    try {
        await db.query("DROP TABLE IF EXISTS logs");
        console.log("Application cleaned up successfully.");
    } catch (error) {
        console.error("Error cleaning up application:", error);
    } finally {
        process.exit(0);
    }
};

const insert = async (message: string) => {
    try {
        const result = await db.query(
            "INSERT INTO logs (message) VALUES ($1) RETURNING *;",
            [message]
        );

        return result.rows[0];
    } catch (error: any) {
        throw new Error(error.message);
    }
};

const count = async () => {
    try {
        const result = await db.query("SELECT COUNT(id) FROM logs;");
        return result.rows[0].count;
    } catch (error: any) {
        throw new Error(error.message);
    }
};

const simulate = async () => {
    console.log("Simulating data insertion and reading flip-flop...");

    setInterval(async () => {
        try {
            const message = `Log at ${new Date().toISOString()}`;

            const insertResult = await insert(message);
            console.log(`Inserted log with ID ${insertResult.id} and message "${insertResult.message}".`);

            const countResult = await count();
            console.log(`Current total logs: ${countResult}.`);
        } catch (error: any) {
            console.error("Error simulating data insertion and reading flip-flop:", error.message);
        } finally {
            console.log("--------------------------------------------------------------------------------");
        }
    }, 1000);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

await boot();
await simulate();