// Persistence layer. Vercel functions don't share memory between
// invocations, so game state has to live somewhere external. This uses
// Upstash Redis via the Vercel Marketplace integration (the current
// recommended path — Vercel KV itself is deprecated).
//
// Setup: in your Vercel project dashboard, go to Storage -> Marketplace ->
// search "Upstash" -> Redis -> connect it to this project. That
// automatically sets UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// as env vars, which Redis.fromEnv() picks up below — no extra config
// needed here or in vercel.json.

const { Redis } = require('@upstash/redis');
const { freshState } = require('./game');

const redis = Redis.fromEnv();
const KEY = 'monikers:game:state';

async function loadState(){
  const data = await redis.get(KEY);
  return data || freshState();
}

async function saveState(state){
  await redis.set(KEY, state);
}

module.exports = { loadState, saveState };
