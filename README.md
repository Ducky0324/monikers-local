# Monikers — Multiplayer (Vercel)

Same game as the LAN version, but deployed to Vercel so anyone can join
over the internet — no shared Wi-Fi required.

## What's different from the LAN version

The LAN version runs as one long-lived Node process holding game state in
memory, with a `setInterval` ticking the turn timer down every second.
Vercel doesn't work that way — each request can hit a fresh, stateless
function instance, so:

- **State** now lives in Upstash Redis (via the Vercel Marketplace
  integration) instead of a JS variable, and every request loads it,
  applies one change, and saves it back.
- **The timer** is a `turnEndsAt` timestamp instead of a live countdown.
  Each device computes its own remaining seconds locally from that
  timestamp, and the turn is lazily marked over the next time anyone's
  device talks to the server after time runs out — no background process
  required.

Everything else — rounds, scoring, roles, who can see which card — works
identically to the LAN version.

## Deploy it

1. Push this folder to a GitHub repo (or run `vercel` from inside it with
   the [Vercel CLI](https://vercel.com/docs/cli) — either works).
2. Import the repo in the Vercel dashboard, or finish the CLI flow. No
   special build settings are needed — it's a static `index.html` plus a
   folder of serverless functions in `api/`.
3. Add storage: in the project's **Storage** tab, open the **Marketplace**,
   search for **Upstash**, and connect a Redis database to the project.
   This sets the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   environment variables automatically — nothing to copy by hand.
4. Redeploy (Vercel usually does this for you after adding the
   integration; if not, trigger a redeploy so the new env vars take
   effect).
5. Open the deployed URL. Whoever fills out the setup form first becomes
   the host; send the same URL to everyone else to join.

## Local development

```
npm install
vercel dev
```

`vercel dev` runs the serverless functions locally and still needs the
Upstash env vars — run `vercel env pull` after linking the project to pull
them into a local `.env` file, or set `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` yourself if you have a database already.

## Notes

- This is a single shared game per deployment (one Redis key holds all the
  state), same as the LAN version's "one game at a time" design. If you
  want multiple simultaneous games, each would need its own Redis key —
  ask if you'd like that added (e.g. a room code in the URL).
- Deck format is unchanged: one card per line, optional hint after `::`.
