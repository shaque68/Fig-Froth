// Owner sign-in for Behind the Counter. The password lives in the server's environment
// (OWNER_PASSWORD) and a signed, HTTP-only cookie keeps the owner signed in. Nothing secret
// is sent to the browser.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ff_owner";
const SESSION_HOURS = 12;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * `options` exist for tests: `password`, `secret`, `secureCookies`, and `now`.
 * By default they come from the environment.
 */
export function createOwnerAuth(options = {}) {
  const password = () => options.password ?? process.env.OWNER_PASSWORD ?? "";
  // Without SESSION_SECRET, sessions last until the server restarts.
  const secret = options.secret ?? process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
  const secureCookies = options.secureCookies ?? (process.env.APP_BASE_URL ?? "").startsWith("https:");
  const now = options.now ?? (() => Date.now());
  const attempts = new Map();

  const sign = (expires) => createHmac("sha256", secret).update(String(expires)).digest("base64url");

  function issueToken() {
    const expires = now() + SESSION_HOURS * 60 * 60 * 1000;
    return `${expires}.${sign(expires)}`;
  }

  function verifyToken(token) {
    if (!token) return false;
    const [expires, signature] = token.split(".");
    if (!expires || !signature || !/^\d+$/.test(expires)) return false;
    return safeEqual(signature, sign(expires)) && Number(expires) > now();
  }

  function readCookie(req) {
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === COOKIE_NAME) return rest.join("=");
    }
    return "";
  }

  function cookie(value, maxAgeSeconds) {
    return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureCookies ? "; Secure" : ""}`;
  }

  function passwordMatches(candidate) {
    const expected = password();
    if (!expected || typeof candidate !== "string") return false;
    // Compare fixed-length digests so the check takes the same time for any input.
    return safeEqual(createHash("sha256").update(candidate).digest(), createHash("sha256").update(expected).digest());
  }

  function isOwner(req) {
    return Boolean(password()) && verifyToken(readCookie(req));
  }

  function requireOwner(req, res, next) {
    if (isOwner(req)) return next();
    return res.status(401).json({ error: "Sign in to Behind the counter first." });
  }

  function limitAttempts(req, res, next) {
    const current = now();
    const entry = attempts.get(req.ip);
    if (!entry || entry.resetAt <= current) {
      attempts.set(req.ip, { count: 1, resetAt: current + ATTEMPT_WINDOW_MS });
      return next();
    }
    if (entry.count >= MAX_ATTEMPTS) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - current) / 1000)));
      return res.status(429).json({ error: "Too many sign-in attempts. Please wait a few minutes and try again." });
    }
    entry.count += 1;
    return next();
  }

  function register(app) {
    app.get("/api/admin/session", (req, res) => {
      res.json({ configured: Boolean(password()), signedIn: isOwner(req) });
    });

    app.post("/api/admin/login", limitAttempts, (req, res) => {
      if (!password()) return res.status(503).json({ error: "Sign-in isn’t set up yet. Add OWNER_PASSWORD to the server’s .env and restart." });
      if (!passwordMatches(req.body?.password)) return res.status(401).json({ error: "That password isn’t right." });
      attempts.delete(req.ip);
      res.set("Set-Cookie", cookie(issueToken(), SESSION_HOURS * 60 * 60));
      return res.json({ signedIn: true });
    });

    app.post("/api/admin/logout", (_req, res) => {
      res.set("Set-Cookie", cookie("", 0));
      res.json({ signedIn: false });
    });
  }

  return { register, requireOwner, isOwner };
}
