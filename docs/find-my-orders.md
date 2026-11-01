# Find My Orders (guest order recovery)

Guests who forget their order reference (`NB1011`) or custom cake reference (`CC1025`) can
open **`/orders/find`**, verify their phone number with a one-time code, and see their orders.

## How it works

```
/orders/find
  -> enter phone            sendFindOrdersOtpAction   -> supabase.auth.signInWithOtp({ phone })
  -> enter code             verifyFindOrdersOtpAction -> supabase.auth.verifyOtp({ type: "sms" })
  -> Supabase session (cookie)                         standard Supabase Auth session
  -> getMyOrdersAction()                               phone read from the VERIFIED session
       -> rpc list_orders_for_phone (service role only) last-10-digit phone match
  -> order card -> /orders/<token>                     existing order tracking page
  -> custom cake card -> /custom-cake/track            existing tracker (OTP also issues its signed session)
```

Security properties:

- The phone used for the lookup is always `auth.users.phone` of the verified session, never a
  request body / URL value. Nothing the browser sends can select another customer's orders.
- `list_orders_for_phone` is `SECURITY DEFINER` and executable by `service_role` only. The
  service-role key stays on the server.
- Rate limits: code requests (per IP and per phone) and verification attempts, in addition to
  Supabase's own OTP rate limits.
- Responses never reveal whether a phone number has orders before it is verified.
- No OTPs are stored or hard-coded in the application.

## Database

Migration `supabase/migrations/0011_list_orders_for_phone.sql` is required (guest orders have no
auth user and `orders` cannot be read by customers under RLS). Apply it in the Supabase SQL editor.

## Supabase configuration (free, development / testing)

No SMS provider keys or paid services are used by the application. Use Supabase's **test phone
numbers and fixed OTPs**, which never send an SMS:

1. Supabase dashboard -> **Authentication** -> **Sign In / Providers** -> **Phone** -> enable it.
2. In the same Phone provider settings, find **Test Phone Numbers and OTPs** and add entries, e.g.
   `919999900001` -> `123456` (digits only, with country code, as Supabase expects). Choose any
   fixed OTP; it is configured only in the dashboard.
3. (Optional) Set the OTP expiry / length as desired.

Note: depending on the Supabase dashboard version, enabling the Phone provider may require
selecting an SMS provider in the form. Test numbers do not send SMS, so placeholder values are
sufficient for development; do not enter real provider credentials until you go live.

Local Supabase CLI equivalent (`supabase/config.toml`):

```toml
[auth.sms]
enable_signup = true

[auth.sms.test_otp]
919999900001 = "123456"
```

## Testing with a test number

1. Place a guest order using a configured test phone number (e.g. `9999900001`).
2. Open `/orders/find`, enter the same number, press **Send OTP**.
3. Enter the fixed test OTP configured in Supabase -> your order appears.
4. Place or find a custom cake with the same number to see it under **Custom Cakes**.

Order phone numbers are matched on their last 10 digits, the same convention as the existing
order lookup.

## Going live later

Configure a real SMS provider in the same Supabase Phone settings. No application code changes
are needed; remove the test numbers.

## Notes

- Verifying a phone creates a normal Supabase Auth user (and the usual `profiles` row). These
  users have no staff role, so they gain no staff or admin access.
- Signing in with a phone replaces any other Supabase session in the same browser (for example
  a staff session). Staff should use a separate browser profile when testing as a customer.
