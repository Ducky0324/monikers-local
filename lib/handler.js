const { loadState, saveState } = require('./kv');
const { checkTimerExpiry, applyAction, buildView } = require('./game');

function makeActionHandler(actionName){
  return async function handler(req, res){
    if(req.method !== 'POST'){
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const pid = req.headers['x-player-id'];
    if(!pid){
      res.status(400).json({ error: 'Missing player id' });
      return;
    }
    const state = await loadState();
    checkTimerExpiry(state);
    try{
      applyAction(state, actionName, pid, req.body || {});
    }catch(e){
      res.status(400).json({ error: e.message || 'Action failed' });
      return;
    }
    await saveState(state);
    res.status(200).json(buildView(state, pid));
  };
}

module.exports = { makeActionHandler };
