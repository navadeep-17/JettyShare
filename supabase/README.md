# Supabase

The JettyShare production project is configured in `ap-south-1`.

The deployed database currently includes:

- public `listings` table
- private `listing_capabilities` table
- server-derived effective state
- retry-safe `create_listing`
- atomic `claim_listing`
- claimant/provider release
- provider collection confirmation
- public-safe `get_board_snapshot`
- capability-protected activity reads

Do not expose service-role/secret keys to the browser. The app uses only the project URL and publishable key.
