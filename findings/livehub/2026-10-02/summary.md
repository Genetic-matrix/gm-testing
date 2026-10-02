# LIVE hub check 2026-10-02 (read-only): 0/4 tiers reached the hub, 5 finding(s), 20 write(s) blocked.

Run 36986252673, started 2026-10-02T08:50:06.201Z, 3 min.

- **starter**: tier claim ?, people ?, chart tabs checked 0
- **plus**: tier claim ?, people ?, chart tabs checked 0
- **advanced**: tier claim ?, people ?, chart tabs checked 0
- **pro**: tier claim ?, people ?, chart tabs checked 0

## Findings

- [blocker] starter / login: Logged in but the hub has no token: login failed or the hub bootstrap failed on live.
- [blocker] plus / login: Logged in but the hub has no token: login failed or the hub bootstrap failed on live.
- [blocker] advanced / login: Logged in but the hub has no token: login failed or the hub bootstrap failed on live.
- [blocker] pro / login: Logged in but the hub has no token: login failed or the hub bootstrap failed on live.
- [critical] - / read-only guard: The live hub tried 20 write request(s) during a read-only session; all were blocked.
