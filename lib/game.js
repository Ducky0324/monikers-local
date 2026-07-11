// Shared Monikers game logic — pure functions operating on a plain state
// object. No module-level mutable state here (that's the whole point:
// serverless functions don't share memory between invocations), and no
// setInterval — the turn timer is a timestamp (turnEndsAt) that any client
// or function can compare against Date.now().

const ROUNDS = [
  { name: 'Round One', sub: 'Describe It',
    desc: 'Say anything you like about the card except the word itself (no rhymes, no spelling it out, no "sounds like"). Unlimited clues until your team guesses or you skip.' },
  { name: 'Round Two', sub: 'One Word Only',
    desc: 'Same cards. This time you get exactly one single word per clue. Choose it carefully — you cannot repeat it or add more.' },
  { name: 'Round Three', sub: 'Charades',
    desc: 'Same cards, no talking at all. Act it out with gestures only until your team guesses or you skip.' }
];

function freshState(){
  return {
    phase: 'setup', // setup -> lobby -> intro -> play -> turnRecap -> roundRecap -> final
    hostId: null,
    turnSeconds: 60,
    pool: [],
    teams: [],
    players: {},
    round: 1,
    remaining: [],
    turnTeamIndex: 0,
    revealerId: null,
    turnEndsAt: null,   // ms epoch timestamp; null when not mid-turn
    wonThisTurn: []
  };
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function parseDeckText(text){
  return text.split('\n').map(s=>s.trim()).filter(Boolean).map(line=>{
    const parts = line.split('::');
    const word = parts[0].trim();
    const desc = parts.length > 1 ? parts.slice(1).join('::').trim() : '';
    return { word, desc };
  }).filter(c=>c.word);
}

function rotateRevealer(state, teamIndex){
  const team = state.teams[teamIndex];
  if(!team || team.playerIds.length === 0){ state.revealerId = null; return; }
  state.revealerId = team.playerIds[team.rotation % team.playerIds.length];
  team.rotation++;
}

function canActAsReader(state, pid){
  if(pid === state.revealerId) return true;
  if(pid !== state.hostId) return false;
  const me = state.players[pid];
  const hostIsPlaying = me && me.teamIndex !== -1;
  return !hostIsPlaying;
}

// Lazily expire the turn if time is up. Called at the top of every request
// (both reads and writes) since there's no background process to do it for
// us. Returns true if it changed the state (so the caller knows to persist).
function checkTimerExpiry(state){
  if(state.phase === 'play' && state.turnEndsAt && Date.now() >= state.turnEndsAt){
    state.phase = 'turnRecap';
    state.turnEndsAt = null;
    return true;
  }
  return false;
}

function buildView(state, pid){
  const isHost = !!pid && pid === state.hostId;
  const me = pid ? state.players[pid] : null;
  const myTeamIndex = me ? me.teamIndex : -1;
  const isRevealer = !!pid && pid === state.revealerId;
  const hostIsPlaying = isHost && myTeamIndex !== -1;
  const hostFallback = isHost && !hostIsPlaying;

  const teamsView = state.teams.map((t,i)=>({
    index: i, name: t.name, color: t.color, scores: t.scores,
    players: t.playerIds.map(id => state.players[id] ? state.players[id].name : '?')
  }));
  const unassignedPlayers = Object.values(state.players)
    .filter(p => p.teamIndex === -1)
    .map(p => p.name);

  const view = {
    phase: state.phase,
    isHost,
    isRevealer,
    joined: !!me,
    myTeamIndex,
    turnSeconds: state.turnSeconds,
    round: state.round,
    roundInfo: ROUNDS[state.round-1],
    teams: teamsView,
    unassignedPlayers,
    turnTeamIndex: state.turnTeamIndex,
    turnTeamName: state.teams[state.turnTeamIndex] ? state.teams[state.turnTeamIndex].name : null,
    turnTeamColor: state.teams[state.turnTeamIndex] ? state.teams[state.turnTeamIndex].color : null,
    revealerName: (state.revealerId && state.players[state.revealerId]) ? state.players[state.revealerId].name : null,
    remainingCount: state.remaining.length,
    deckSize: state.pool.length,
    turnEndsAt: state.phase === 'play' ? state.turnEndsAt : null,
    serverNow: Date.now(),
    wonThisTurn: (state.phase === 'turnRecap') ? state.wonThisTurn.map(c=>c.word) : [],
    canControlRevealerActions: isRevealer || hostFallback
  };

  if((isRevealer || hostFallback) && state.phase === 'play' && state.remaining.length > 0){
    view.currentCard = state.remaining[0];
  }
  return view;
}

// Mutates `state` in place to apply an action. Throws Error with a
// user-facing message on invalid actions.
function applyAction(state, action, pid, body){
  body = body || {};
  switch(action){
    case 'setup': {
      if(state.phase !== 'setup') throw new Error('The game has already been set up.');
      const teamNames = Array.isArray(body.teamNames) ? body.teamNames : [];
      const teamColors = Array.isArray(body.teamColors) ? body.teamColors : [];
      if(teamNames.length < 2) throw new Error('Add at least two teams.');
      const pool = parseDeckText(String(body.deckText || ''));
      if(pool.length < 6) throw new Error('Add at least 6 cards to the deck.');
      const turnSeconds = Math.max(15, parseInt(body.turnSeconds,10) || 60);

      const fresh = freshState();
      fresh.teams = teamNames.map((name,i)=>({
        name: String(name).trim() || ('Team ' + (i+1)),
        color: teamColors[i] || '#E1483A',
        scores: [0,0,0], playerIds: [], rotation: 0
      }));
      fresh.pool = pool;
      fresh.turnSeconds = turnSeconds;
      fresh.hostId = pid;
      fresh.phase = 'lobby';
      Object.assign(state, fresh);
      return;
    }

    case 'join': {
      if(state.phase === 'setup') throw new Error('Wait for the host to finish setup.');
      if(state.phase === 'final') throw new Error('This game has ended.');
      const name = String(body.name || '').trim().slice(0,24);
      if(!name) throw new Error('Enter a name.');
      let teamIndex = Number.isInteger(body.teamIndex) ? body.teamIndex : -1;
      if(teamIndex >= state.teams.length) teamIndex = -1;

      if(state.players[pid] && state.phase !== 'lobby') return;

      state.teams.forEach(t => { t.playerIds = t.playerIds.filter(id => id !== pid); });
      state.players[pid] = { id: pid, name, teamIndex };
      if(teamIndex >= 0) state.teams[teamIndex].playerIds.push(pid);
      return;
    }

    case 'start': {
      if(pid !== state.hostId) throw new Error('Only the host can start the game.');
      if(state.phase !== 'lobby') throw new Error('Game already started.');
      if(!state.teams.every(t => t.playerIds.length > 0)) throw new Error('Every team needs at least one player.');
      state.round = 1;
      state.remaining = shuffle(state.pool);
      state.turnTeamIndex = 0;
      rotateRevealer(state, 0);
      state.phase = 'intro';
      return;
    }

    case 'beginTurn': {
      if(!canActAsReader(state, pid)) throw new Error('Only the reader for this turn can start it.');
      if(state.phase !== 'intro') throw new Error('Not ready to start a turn.');
      state.wonThisTurn = [];
      state.turnEndsAt = Date.now() + state.turnSeconds * 1000;
      state.phase = 'play';
      return;
    }

    case 'correct': {
      if(!canActAsReader(state, pid)) throw new Error('Only the current reader can mark cards.');
      if(state.phase !== 'play' || state.remaining.length === 0) return;
      const card = state.remaining.shift();
      state.teams[state.turnTeamIndex].scores[state.round-1]++;
      state.wonThisTurn.push(card);
      if(state.remaining.length === 0){ state.turnEndsAt = null; state.phase = 'roundRecap'; }
      return;
    }

    case 'skip': {
      if(!canActAsReader(state, pid)) throw new Error('Only the current reader can skip.');
      if(state.phase !== 'play' || state.remaining.length <= 1) return;
      const card = state.remaining.shift();
      state.remaining.push(card);
      return;
    }

    case 'endTurn': {
      if(!canActAsReader(state, pid)) throw new Error('Only the current reader can end the turn.');
      if(state.phase !== 'play') return;
      state.turnEndsAt = null;
      state.phase = 'turnRecap';
      return;
    }

    case 'nextTurn': {
      if(pid !== state.hostId) throw new Error('Only the host can advance the game.');
      if(state.phase !== 'turnRecap') return;
      if(state.remaining.length === 0){ state.phase = 'roundRecap'; return; }
      state.turnTeamIndex = (state.turnTeamIndex + 1) % state.teams.length;
      rotateRevealer(state, state.turnTeamIndex);
      state.phase = 'intro';
      return;
    }

    case 'nextRound': {
      if(pid !== state.hostId) throw new Error('Only the host can advance the game.');
      if(state.phase !== 'roundRecap') return;
      if(state.round >= 3){ state.phase = 'final'; return; }
      state.round++;
      state.remaining = shuffle(state.pool);
      state.turnTeamIndex = 0;
      rotateRevealer(state, 0);
      state.phase = 'intro';
      return;
    }

    case 'playAgain': {
      if(pid !== state.hostId) throw new Error('Only the host can start a new game.');
      state.teams.forEach(t => { t.scores = [0,0,0]; t.rotation = 0; });
      state.round = 1;
      state.remaining = [];
      state.revealerId = null;
      state.wonThisTurn = [];
      state.turnEndsAt = null;
      state.phase = 'lobby';
      return;
    }

    default:
      throw new Error('Unknown action.');
  }
}

module.exports = {
  ROUNDS, freshState, shuffle, parseDeckText, rotateRevealer,
  canActAsReader, checkTimerExpiry, buildView, applyAction
};
