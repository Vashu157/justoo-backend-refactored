import express from "express";
import session from "express-session";
import cors from "cors";
import connectPgSimple from "connect-pg-simple";

import adminRouter from "./routes/admin/index.js";
import customerRouter from "./routes/customer/index.js";
import riderRouter from "./routes/rider/index.js";
import { pool } from "./db/index.js";
import { env, isProd } from "./config/env.js";

const app = express();

app.use(express.json());

const frontendOrigin = env.FRONTEND_ORIGIN;
if (frontendOrigin) {
    app.use(
        cors({
            origin: frontendOrigin,
            credentials: true,
        })
    );
}

const sessionSecret = env.SESSION_SECRET;
if (isProd && sessionSecret === "dev-session-secret") {
    throw new Error("SESSION_SECRET is required in production");
}

const PgSessionStore = connectPgSimple(session);
const cookieName = env.SESSION_COOKIE_NAME;
const sessionTableName = env.SESSION_TABLE_NAME;
const sameSite = env.SESSION_SAMESITE;
const cookieSecure = isProd || env.SESSION_COOKIE_SECURE;

app.use(
    session({
        name: cookieName,
        store: new PgSessionStore({
            pool,
            tableName: sessionTableName,
            createTableIfMissing: true,
        }),
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: cookieSecure,
            sameSite,
            maxAge: 1000 * 60 * 60 * 24 * 7,
        },
    })
);

app.use("/admin", adminRouter);
app.use("/customer", customerRouter);
app.use("/rider", riderRouter);

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});

const port = Number(env.PORT || 4000);
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

export default app;
