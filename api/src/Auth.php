<?php
declare(strict_types=1);

namespace DXN;

/**
 * Stateless HMAC tokens.
 *
 * Two ways in:
 *  1. `POST /auth/login` with the shop PIN  -> short-lived bearer token
 *  2. `X-Api-Key: <admin_key>` header        -> machine access (scripts, CI)
 *
 * No sessions, no token table, nothing to garbage-collect on shared hosting.
 */
final class Auth
{
    public const ROLE_ADMIN = 'admin';
    public const ROLE_CUSTOMER = 'customer';

    /** @var array<string,mixed>|null */
    private static ?array $claims = null;

    public static function login(string $pin): array
    {
        self::guardBruteForce();

        $hash = Store::setting('admin_pin_hash');
        if ($hash === null || $hash === '') {
            throw new ApiException(
                'No shop PIN configured yet. Run the installer or set ADMIN_PIN.',
                409,
                'not_installed'
            );
        }

        if (!password_verify($pin, $hash)) {
            Store::logAttempt(Request::ip(), false);
            throw new ApiException('Invalid PIN', 401, 'invalid_credentials');
        }

        Store::logAttempt(Request::ip(), true);

        $ttl = (int) Config::get('token_ttl', 2592000);
        $expires = time() + $ttl;

        return [
            'token'      => self::sign(['role' => self::ROLE_ADMIN, 'exp' => $expires]),
            'expires_at' => gmdate('c', $expires),
            'role'       => self::ROLE_ADMIN,
            'ttl'        => $ttl,
        ];
    }

    public static function customerLogin(string $phone, string $password): array
    {
        self::guardCustomerBruteForce();

        $account = Store::customerAccountByPhone($phone);
        if ($account === null) {
            Store::logCustomerAttempt(Request::ip(), false);
            throw new ApiException('No account found with this phone', 401, 'invalid_credentials');
        }

        if (!password_verify($password, (string) $account['password_hash'])) {
            Store::logCustomerAttempt(Request::ip(), false);
            throw new ApiException('Incorrect password', 401, 'invalid_credentials');
        }

        Store::logCustomerAttempt(Request::ip(), true);

        return self::customerSession($account, Store::customer((int) $account['customer_id']));
    }

    /** Issues a customer bearer token for a freshly registered account. */
    public static function customerSession(array $account, ?array $customer): array
    {
        $ttl = (int) Config::get('token_ttl', 2592000);
        $expires = time() + $ttl;

        return [
            'token' => self::sign([
                'role'        => self::ROLE_CUSTOMER,
                'account_id'  => (int) $account['id'],
                'customer_id' => (int) $account['customer_id'],
                'exp'         => $expires,
            ]),
            'expires_at' => gmdate('c', $expires),
            'role'       => self::ROLE_CUSTOMER,
            'ttl'        => $ttl,
            'customer'   => $customer !== null ? Store::mapCustomer($customer) : null,
        ];
    }

    public static function isCustomer(): bool
    {
        $claims = self::claims();
        return $claims !== null && ($claims['role'] ?? null) === self::ROLE_CUSTOMER;
    }

    /** @return array<string,mixed> */
    public static function requireCustomer(): array
    {
        $claims = self::claims();
        if ($claims === null || ($claims['role'] ?? null) !== self::ROLE_CUSTOMER) {
            throw new ApiException('Sign in with a customer account', 401, 'unauthorized');
        }
        return $claims;
    }

    public static function sign(array $claims): string
    {
        $payload = self::b64(json_encode($claims, JSON_UNESCAPED_SLASHES) ?: '{}');
        $signature = hash_hmac('sha256', $payload, Config::tokenSecret(), true);
        return $payload . '.' . self::b64($signature);
    }

    public static function verify(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return null;
        }
        [$payload, $signature] = $parts;

        $expected = self::b64(hash_hmac('sha256', $payload, Config::tokenSecret(), true));
        if (!hash_equals($expected, $signature)) {
            return null;
        }

        $claims = json_decode(self::unb64($payload), true);
        if (!is_array($claims)) {
            return null;
        }
        if (isset($claims['exp']) && (int) $claims['exp'] < time()) {
            return null;
        }
        return $claims;
    }

    public static function claims(): ?array
    {
        if (self::$claims !== null) {
            return self::$claims;
        }

        $token = Request::bearerToken();
        if ($token !== null) {
            self::$claims = self::verify($token);
        }

        return self::$claims;
    }

    public static function isAdmin(): bool
    {
        $key = Request::header('X-Api-Key');
        $adminKey = (string) Config::get('admin_key', '');
        if ($key !== null && $adminKey !== '' && hash_equals($adminKey, $key)) {
            return true;
        }

        $claims = self::claims();
        return $claims !== null && ($claims['role'] ?? null) === self::ROLE_ADMIN;
    }

    /** Throws 401 unless the caller proved they are the shop owner. */
    public static function requireAdmin(): void
    {
        if (!self::isAdmin()) {
            throw new ApiException('Admin authentication required', 401, 'unauthorized');
        }
    }

    private static function guardBruteForce(): void
    {
        $since = gmdate('Y-m-d H:i:s', time() - 900);
        $failures = (int) Database::scalar(
            'SELECT COUNT(*) FROM auth_attempts WHERE ip = ? AND ok = 0 AND attempted_at >= ?',
            [Request::ip(), $since]
        );
        if ($failures >= 8) {
            throw new ApiException('Too many failed PIN attempts. Try again in 15 minutes.', 429, 'rate_limited');
        }
    }

    private static function guardCustomerBruteForce(): void
    {
        $since = gmdate('Y-m-d H:i:s', time() - 900);
        $failures = (int) Database::scalar(
            'SELECT COUNT(*) FROM customer_auth_attempts WHERE ip = ? AND ok = 0 AND attempted_at >= ?',
            [Request::ip(), $since]
        );
        if ($failures >= 8) {
            throw new ApiException('Too many failed sign-in attempts. Try again in 15 minutes.', 429, 'rate_limited');
        }
    }

    private static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function unb64(string $encoded): string
    {
        $padded = $encoded . str_repeat('=', (4 - strlen($encoded) % 4) % 4);
        return (string) base64_decode(strtr($padded, '-_', '+/'));
    }
}
