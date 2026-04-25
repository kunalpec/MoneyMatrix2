# Payment Production Checklist

This project is safer now, but real-money use still requires a funded treasury wallet and real production secrets.

## What changed

- direct withdraw no longer depends on a stale admin-balance check in the API layer
- failed queued withdrawals now refund the user's reserved balance
- TRC20 mode no longer activates just because a token contract exists in env
- production startup blocks insecure config such as ngrok URLs, localhost CORS, placeholder secrets, and invalid transfer mode
- frontend dev host config is no longer hardcoded to one ngrok URL

## Before real payments

- ensure one MongoDB wallet has `isAdmin: true`
- ensure that admin wallet has a valid signer setup
- fund the admin wallet with enough TRX for gas
- fund the admin wallet with the payout token too if using TRC20 payouts
- replace every placeholder in `backend/.env`
- use production HTTPS domains for backend, webhook, and Transak host settings

## Commands

```bash
cd backend
npm run payments:check
```

```bash
cd backend
npm run admin:wallet
```

```bash
cd backend
npm run kms:admin
```

## Note

The readiness check script uses Tatum's official `GET /v3/tron/account/{address}` account endpoint so it can report native TRX balance and configured TRC20 holdings when Tatum access is available.
