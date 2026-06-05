const crypto = require("crypto");
const { pool } = require("../config/db");

const sessions = new Map();

function hashPassword(password) {
    return crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
}

async function seedDefaultUsers() {
    const users = [
        ["System Administrator", "admin@flowai.local", "admin123", "admin"],
        ["Security Operator", "operator@flowai.local", "operator123", "operator"],
        ["Facility Analyst", "analyst@flowai.local", "analyst123", "analyst"]
    ];

    for (const [fullName, email, password, role] of users) {
        await pool.query(
            `
            INSERT INTO users (full_name, email, password_hash, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO NOTHING
            `,
            [fullName, email, hashPassword(password), role]
        );
    }
}

async function login(email, password) {
    const result = await pool.query(
        `
        SELECT id, full_name, email, role, status, password_hash
        FROM users
        WHERE email = $1
        `,
        [email]
    );

    const user = result.rows[0];

    if (!user || user.status !== "active") {
        return null;
    }

    if (user.password_hash !== hashPassword(password)) {
        return null;
    }

    const token = crypto.randomUUID();
    const sessionUser = {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role
    };

    sessions.set(token, sessionUser);

    return {
        token,
        user: sessionUser
    };
}

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token || !sessions.has(token)) {
        return res.status(401).json({
            error: "Authentication required"
        });
    }

    req.user = sessions.get(token);
    next();
}

function authorize(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: "Permission denied"
            });
        }

        next();
    };
}

module.exports = {
    authenticate,
    authorize,
    hashPassword,
    login,
    seedDefaultUsers
};
