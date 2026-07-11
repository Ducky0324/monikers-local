const { loadState, saveState } = require('../lib/kv');
const { checkTimerExpiry, buildView } = require('../lib/game');

module.exports = async function handler(req, res){
  if(req.method !== 'GET'){
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const pid = req.headers['x-player-id'] || null;
  const state = await loadState();
  const changed = checkTimerExpiry(state);
  if(changed) await saveState(state);
  res.status(200).json(buildView(state, pid));
};
