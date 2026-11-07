<?php
declare(strict_types=1);

namespace DXN\Controllers;

use DXN\Auth;
use DXN\Database;
use DXN\Request;
use DXN\Response;
use DXN\Store;
use DXN\Util;

final class CustomerController
{
    // ── Admin customer book ─────────────────────────────────────────────────

    public static function index(): void
    {
        Auth::requireAdmin();

        $customers = Store::customers([
            'q'     => Request::query('q'),
            'limit' => Util::int(Request::query('limit', 200), 200),
        ]);

        Response::ok(['customers' => $customers, 'count' => count($customers)]);
    }

    public static function show(array $params): void
    {
        Auth::requireAdmin();
        $row = Database::one('SELECT * FROM customers WHERE id = ?', [(int) $params['id']]);
        if ($row === null) {
            Response::error('Customer not found', 404, 'not_found');
        }

        $orders = Database::all(
            'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50',
            [(int) $params['id']]
        );

        Response::ok([
            'customer' => Store::mapCustomer($row),
            'orders'   => array_map(static fn (array $o): array => Store::mapOrder($o), $orders),
        ]);
    }

    // ── Customer self-service accounts ──────────────────────────────────────

    /** POST /api/v1/auth/register */
    public static function register(): void
    {
        $phone = Util::clean(Request::input('phone', ''), 40);
        $password = (string) Request::input('password', '');
        $name = Util::clean(Request::input('name', ''), 160);
        $email = Util::clean(Request::input('email', ''), 120);

        if ($phone === '') {
            Response::error('Phone is required', 422, 'validation_error');
        }
        if (strlen($password) < 6) {
            Response::error('Password must be at least 6 characters', 422, 'validation_error');
        }
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            Response::error('Please enter a valid email address', 422, 'validation_error');
        }
        if (Store::customerAccountByPhone($phone) !== null) {
            Response::error('An account with this phone already exists', 409, 'duplicate_account');
        }

        try {
            [$account, $customer] = Database::transaction(static function () use ($phone, $password, $name, $email): array {
                $now = Util::now();
                $existing = Store::customerByPhone($phone);

                if ($existing === null) {
                    $rev = Store::nextRev();
                    Database::run(
                        'INSERT INTO customers (name, phone, dxn_member_id, is_member, total_orders, total_spent, total_pv, last_order_at, created_at, updated_at, rev)
                         VALUES (?, ?, NULL, 0, 0, 0, 0, NULL, ?, ?, ?)',
                        [$name !== '' ? $name : 'Customer', $phone, $now, $now, $rev]
                    );
                    $customerId = Database::lastId();
                } else {
                    $customerId = (int) $existing['id'];
                    $newName = $name !== '' ? $name : (string) $existing['name'];
                    Database::run(
                        'UPDATE customers SET name = ?, updated_at = ?, rev = ? WHERE id = ?',
                        [$newName, $now, Store::nextRev(), $customerId]
                    );
                }

                $customerRow = Store::customer($customerId);
                if ($customerRow === null) {
                    throw new \RuntimeException('Customer record could not be created');
                }

                Database::run(
                    'INSERT INTO customer_accounts (customer_id, phone, email, name, password_hash, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        $customerId,
                        $phone,
                        $email !== '' ? $email : null,
                        $name !== '' ? $name : (string) $customerRow['name'],
                        password_hash($password, PASSWORD_DEFAULT),
                        $now,
                        $now,
                    ]
                );

                return [Store::customerAccount(Database::lastId()), $customerRow];
            });
        } catch (\PDOException $e) {
            // The unique phone index is the final guard against two simultaneous signups.
            if (($e->getCode() ?? '') === '23000' || str_contains(strtolower($e->getMessage()), 'duplicate')) {
                Response::error('An account with this phone already exists', 409, 'duplicate_account');
            }
            throw $e;
        }

        Store::audit('customer_registered', 'customer', (string) $customer['id'], $phone);

        Response::ok(Auth::customerSession($account, $customer), 201);
    }

    /** POST /api/v1/auth/customer/login */
    public static function login(): void
    {
        $phone = Util::clean(Request::input('phone', ''), 40);
        $password = (string) Request::input('password', '');

        if ($phone === '') {
            Response::error('Phone is required', 422, 'validation_error');
        }
        if ($password === '') {
            Response::error('Password is required', 422, 'validation_error');
        }

        Response::ok(Auth::customerLogin($phone, $password));
    }

    /** GET /api/v1/my/profile */
    public static function profile(): void
    {
        $claims = Auth::requireCustomer();
        $customer = Store::customer((int) $claims['customer_id']);
        if ($customer === null) {
            Response::error('Customer record not found', 404, 'not_found');
        }

        Response::ok(['profile' => Store::mapCustomer($customer)]);
    }

    /** PUT|PATCH /api/v1/my/profile */
    public static function updateProfile(): void
    {
        $claims = Auth::requireCustomer();
        $customerId = (int) $claims['customer_id'];
        $accountId = (int) $claims['account_id'];

        $customer = Store::customer($customerId);
        if ($customer === null) {
            Response::error('Customer record not found', 404, 'not_found');
        }
        $account = Store::customerAccount($accountId);

        $patch = Request::json();
        $now = Util::now();
        $name = (string) $customer['name'];
        $memberId = $customer['dxn_member_id'] ?? null;
        $email = $account['email'] ?? null;

        if (array_key_exists('name', $patch)) {
            $cleanName = Util::clean($patch['name'], 160);
            if ($cleanName !== '') {
                $name = $cleanName;
            }
        }

        if (array_key_exists('dxn_member_id', $patch)) {
            $cleanMember = strtoupper(Util::clean($patch['dxn_member_id'], 40));
            if ($cleanMember !== '') {
                $memberId = $cleanMember;
            }
        }

        if (array_key_exists('email', $patch)) {
            $cleanEmail = Util::clean($patch['email'], 120);
            if ($cleanEmail !== '' && filter_var($cleanEmail, FILTER_VALIDATE_EMAIL) === false) {
                Response::error('Please enter a valid email address', 422, 'validation_error');
            }
            $email = $cleanEmail !== '' ? $cleanEmail : null;
        }

        try {
            Database::transaction(static function () use ($customerId, $accountId, $name, $memberId, $email, $now): void {
                Database::run(
                    'UPDATE customers SET name = ?, dxn_member_id = ?, updated_at = ?, rev = ? WHERE id = ?',
                    [$name, $memberId, $now, Store::nextRev(), $customerId]
                );
                Database::run(
                    'UPDATE customer_accounts SET name = ?, email = ?, updated_at = ? WHERE id = ?',
                    [$name, $email, $now, $accountId]
                );
            });
        } catch (\PDOException $e) {
            if (($e->getCode() ?? '') === '23000' || str_contains(strtolower($e->getMessage()), 'duplicate')) {
                Response::error('That DXN member ID is already linked to another customer', 409, 'duplicate_member_id');
            }
            throw $e;
        }

        Store::audit('customer_profile_updated', 'customer', (string) $customerId);

        Response::ok(['profile' => Store::mapCustomer(Store::customer($customerId) ?? $customer)]);
    }

    /** GET /api/v1/my/orders */
    public static function myOrders(): void
    {
        $claims = Auth::requireCustomer();

        $orders = Store::orders([
            'customer_id' => (int) $claims['customer_id'],
            'limit'       => 200,
        ]);

        Response::ok(['orders' => $orders, 'count' => count($orders)]);
    }

    /** GET /api/v1/my/track?order_number=…&phone=… */
    public static function track(): void
    {
        $orderNumber = Util::clean(Request::query('order_number', ''), 40);
        $phone = Util::clean(Request::query('phone', ''), 40);

        if ($orderNumber === '' || $phone === '') {
            Response::error('order_number and phone are required', 422, 'validation_error');
        }

        $row = Database::one(
            'SELECT id FROM orders WHERE order_number = ? AND customer_phone = ? LIMIT 1',
            [$orderNumber, $phone]
        );
        if ($row === null) {
            Response::error('Order not found', 404, 'not_found');
        }

        Response::ok(['order' => Store::order((int) $row['id'])]);
    }
}
