import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Peer from "peerjs";
import {
  Activity,
  Copy,
  Play,
  RefreshCcw,
  Send,
  Shield,
  Trophy,
  Users,
  Wifi,
  WifiOff
} from "lucide-react";
import "./styles.css";

const TEAM_KEYS = ["A", "B"];
const RUN_OPTIONS = [0, 1, 2, 3, 4, 5, 6];
const TURN_MS = 5000;

const initialGame = () => ({
  status: "setup",
  batting: "A",
  innings: 1,
  winner: null,
  target: null,
  ball: {
    batting: null,
    bowling: null
  },
  turnId: 0,
  turnDeadline: null,
  submissions: {},
  teams: {
    A: makeTeam("Team A"),
    B: makeTeam("Team B")
  },
  log: []
});

const makeTeam = (name) => ({
  name,
  roster: ["Player 1"],
  score: 0,
  wickets: 0,
  balls: 0,
  currentPlayer: 0,
  rosterSaved: false,
  inningsDone: false
});

function restartGame(game) {
  const fresh = initialGame();
  return {
    ...fresh,
    teams: {
      A: {
        ...fresh.teams.A,
        name: game.teams.A.name,
        roster: game.teams.A.roster,
        rosterSaved: game.teams.A.rosterSaved
      },
      B: {
        ...fresh.teams.B,
        name: game.teams.B.name,
        roster: game.teams.B.roster,
        rosterSaved: game.teams.B.rosterSaved
      }
    },
    log: ["Match restarted. Rosters are kept."]
  };
}

const oversText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const otherTeam = (team) => (team === "A" ? "B" : "A");
const activeBowling = (game) => otherTeam(game.batting);
const currentBatter = (team) => team.roster[team.currentPlayer] || `Player ${team.currentPlayer + 1}`;
const currentBowler = (team, balls) => team.roster[Math.min(team.roster.length - 1, Math.floor(balls / 6))] || "Bowler";
const totalBallsForTeam = (team) => Math.max(1, team.roster.length) * 6;
const isAllOut = (team) => team.wickets >= team.roster.length;
const isValidHand = (value) => Number.isInteger(value) && RUN_OPTIONS.includes(value);
const withNextTurn = (game) => ({
  ...game,
  turnId: game.turnId + 1,
  turnDeadline: Date.now() + TURN_MS
});

function reducer(game, event) {
  if (event.type === "restart") {
    return restartGame(game);
  }

  if (event.type === "roster") {
    if (game.status !== "setup") return game;
    return {
      ...game,
      teams: {
        ...game.teams,
        [event.team]: {
          ...game.teams[event.team],
          name: event.name.trim() || game.teams[event.team].name,
          roster: normalizeRoster(event.roster),
          rosterSaved: true
        }
      }
    };
  }

  if (event.type === "start") {
    if (!game.teams.A.rosterSaved || !game.teams.B.rosterSaved) return game;
    return withNextTurn({
      ...game,
      status: "playing",
      batting: "A",
      innings: 1,
      log: ["Team A starts batting. Match on."]
    });
  }

  if (event.type === "timeout" && game.status === "playing" && event.turnId === game.turnId) {
    const nextBall = {
      batting: game.ball.batting ?? 0,
      bowling: game.ball.bowling ?? 0
    };
    return resolveBall({
      ...game,
      ball: nextBall,
      submissions: {
        [game.batting]: nextBall.batting,
        [activeBowling(game)]: nextBall.bowling
      }
    });
  }

  if (event.type !== "submit" || game.status !== "playing" || !isValidHand(event.value)) return game;

  const role = event.team === game.batting ? "batting" : event.team === activeBowling(game) ? "bowling" : null;
  if (!role || game.ball[role] !== null) return game;

  const nextBall = { ...game.ball, [role]: event.value };
  const next = {
    ...game,
    ball: nextBall,
    submissions: { ...game.submissions, [event.team]: event.value }
  };

  if (nextBall.batting === null || nextBall.bowling === null) return next;
  return resolveBall(next);
}

function normalizeRoster(roster) {
  const clean = roster.map((name) => name.trim()).filter(Boolean);
  return clean.length ? clean.slice(0, 11) : ["Player 1"];
}

function resolveBall(game) {
  const battingKey = game.batting;
  const bowlingKey = activeBowling(game);
  const battingTeam = game.teams[battingKey];
  const batterValue = game.ball.batting;
  const bowlerValue = game.ball.bowling;
  const isOut = batterValue === bowlerValue;
  const runs = isOut ? 0 : batterValue;
  const nextBattingTeam = {
    ...battingTeam,
    score: battingTeam.score + runs,
    balls: battingTeam.balls + 1,
    wickets: battingTeam.wickets + (isOut ? 1 : 0),
    currentPlayer: battingTeam.currentPlayer + (isOut ? 1 : 0)
  };

  const line = isOut
    ? `${battingTeam.name}: ${currentBatter(battingTeam)} is out on ${batterValue}.`
    : `${battingTeam.name}: ${currentBatter(battingTeam)} scores ${runs}.`;

  const updated = {
    ...game,
    ball: { batting: null, bowling: null },
    turnDeadline: null,
    submissions: {},
    teams: {
      ...game.teams,
      [battingKey]: nextBattingTeam
    },
    log: [line, ...game.log].slice(0, 12)
  };

  if (game.innings === 2 && nextBattingTeam.score > game.target) {
    return finishGame(updated, battingKey);
  }

  const allBatsmenOut = isAllOut(nextBattingTeam);
  const allBowlersBowled = nextBattingTeam.balls >= totalBallsForTeam(game.teams[bowlingKey]);
  const inningsOver = allBatsmenOut || allBowlersBowled;

  if (!inningsOver) return withNextTurn(updated);

  if (game.innings === 1) {
    return withNextTurn({
      ...updated,
      innings: 2,
      batting: bowlingKey,
      target: nextBattingTeam.score + 1,
      teams: {
        ...updated.teams,
        [battingKey]: { ...nextBattingTeam, inningsDone: true }
      },
      log: [
        `${battingTeam.name} finishes on ${nextBattingTeam.score}/${nextBattingTeam.wickets}. ${game.teams[bowlingKey].name} needs ${nextBattingTeam.score + 1}.`,
        ...updated.log
      ].slice(0, 12)
    });
  }

  const firstBatting = otherTeam(battingKey);
  const firstScore = updated.teams[firstBatting].score;
  const winner = nextBattingTeam.score === firstScore ? "Tie" : nextBattingTeam.score > firstScore ? battingKey : firstBatting;
  return finishGame(updated, winner);
}

function finishGame(game, winner) {
  const winnerText = winner === "Tie" ? "Match tied." : `${game.teams[winner].name} wins.`;
  return {
    ...game,
    status: "finished",
    winner,
    turnDeadline: null,
    log: [winnerText, ...game.log].slice(0, 12)
  };
}

function getHandsLabel(game) {
  if (game.status !== "playing") return { batting: "Waiting", bowling: "Waiting" };

  const battingReady = game.ball.batting !== null;
  const bowlingReady = game.ball.bowling !== null;

  return {
    batting: battingReady ? "Locked" : "Waiting",
    bowling: bowlingReady ? "Locked" : "Waiting"
  };
}

function App() {
  const route = useHashRoute();
  if (route.page === "team") return <TeamPage teamKey={route.team} />;
  return <MainPage />;
}

function useHashRoute() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return route;
}

function getRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.toLowerCase().startsWith("team-b")) return { page: "team", team: "B" };
  if (hash.toLowerCase().startsWith("team-a")) return { page: "team", team: "A" };
  return { page: "main" };
}

function MainPage() {
  const [peerId, setPeerId] = useState("");
  const [connections, setConnections] = useState({});
  const [game, setGame] = useState(initialGame);
  const peerRef = useRef(null);
  const connectionsRef = useRef({});
  const connTeamsRef = useRef({});
  const gameRef = useRef(game);

  useEffect(() => {
    gameRef.current = game;
    broadcast(connectionsRef.current, { type: "state", game });
  }, [game]);

  useEffect(() => {
    if (game.status !== "playing" || !game.turnDeadline) return undefined;

    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "timeout", turnId: game.turnId });
    }, Math.max(0, game.turnDeadline - Date.now()));

    return () => window.clearTimeout(timeoutId);
  }, [game.status, game.turnDeadline, game.turnId]);

  useEffect(() => {
    const peer = new Peer();
    peerRef.current = peer;
    peer.on("open", setPeerId);
    peer.on("connection", (conn) => {
      conn.on("data", (message) => handleTeamMessage(conn, message));
      conn.on("open", () => conn.send({ type: "state", game: gameRef.current }));
      conn.on("close", () => {
        delete connTeamsRef.current[conn.connectionId];
        connectionsRef.current = Object.fromEntries(
          Object.entries(connectionsRef.current).filter(([, value]) => value.connection.connectionId !== conn.connectionId)
        );
        setConnections({ ...connectionsRef.current });
      });
    });

    return () => {
      peer.destroy();
    };
  }, []);

  function handleTeamMessage(conn, message) {
    if (!message) return;
    if (message.type === "hello") {
      if (!TEAM_KEYS.includes(message.team)) return;
      const existingConnection = connectionsRef.current[message.team]?.connection;
      if (existingConnection && existingConnection.connectionId !== conn.connectionId) existingConnection.close();
      connTeamsRef.current[conn.connectionId] = message.team;
      connectionsRef.current = {
        ...connectionsRef.current,
        [message.team]: { connected: true, connection: conn }
      };
      setConnections({ ...connectionsRef.current });
      conn.send({ type: "state", game: gameRef.current });
      return;
    }

    const lockedTeam = connTeamsRef.current[conn.connectionId];
    if (!lockedTeam || message.team !== lockedTeam) return;
    if (connectionsRef.current[lockedTeam]?.connection?.connectionId !== conn.connectionId) return;
    setGame((current) => reducer(current, { ...message, team: lockedTeam }));
  }

  function dispatch(event) {
    setGame((current) => reducer(current, event));
  }

  const shareBase = `${window.location.origin}${window.location.pathname}`;
  const teamAUrl = `${shareBase}#/team-a`;
  const teamBUrl = `${shareBase}#/team-b`;
  const canStart = TEAM_KEYS.every((key) => connections[key]?.connected && game.teams[key].rosterSaved);
  const handsLabel = getHandsLabel(game);
  const bowlingKey = activeBowling(game);
  const bowlerLabel =
    game.status === "playing" ? currentBowler(game.teams[bowlingKey], game.teams[game.batting].balls) : "Not set";

  return (
    <div className="appShell mainView">
      <header className="topbar">
        <div>
          <p className="eyebrow">PeerJS host</p>
          <h1>Hand Cricket Arena</h1>
        </div>
        <div className="hostBadge">
          <Wifi size={18} />
          <span>{peerId || "Starting host..."}</span>
          <IconButton label="Copy host ID" onClick={() => copyText(peerId)} disabled={!peerId}>
            <Copy size={18} />
          </IconButton>
        </div>
      </header>

      <main className="mainGrid">
        <section className="scoreboard">
          <div className="matchHeader">
            <div>
              <p className="eyebrow">Innings {game.innings}</p>
              <h2>{game.status === "setup" ? "Waiting for teams" : game.status === "finished" ? "Result" : `${game.teams[game.batting].name} batting`}</h2>
            </div>
            <div className="actions">
              {game.status === "setup" && (
                <button className="primaryButton" onClick={() => dispatch({ type: "start" })} disabled={!canStart}>
                  <Play size={18} /> Start
                </button>
              )}
              <button className="iconTextButton" onClick={() => dispatch({ type: "restart" })}>
                <RefreshCcw size={18} /> Restart
              </button>
            </div>
          </div>

          <div className="teams">
            {TEAM_KEYS.map((key) => (
              <ScorePanel
                key={key}
                teamKey={key}
                team={game.teams[key]}
                active={game.status === "playing" && game.batting === key}
                connected={connections[key]?.connected}
              />
            ))}
          </div>

          <div className="statusStrip">
            <StatusItem icon={<Trophy size={18} />} label="Target" value={game.target ? `${game.target}` : "Not set"} />
            <StatusItem icon={<Users size={18} />} label="Bowler" value={bowlerLabel} />
            <StatusItem icon={<Activity size={18} />} label="Batting hand" value={handsLabel.batting} />
            <StatusItem icon={<Shield size={18} />} label="Bowling hand" value={handsLabel.bowling} />
          </div>

          <div className="resultBanner">
            {game.status === "finished"
              ? game.winner === "Tie"
                ? "Match tied"
                : `${game.teams[game.winner].name} wins`
              : game.status === "setup"
                ? "Connect both teams and save rosters, then start."
                : `${game.teams[game.batting].name} batting against ${game.teams[activeBowling(game)].name}`}
          </div>
        </section>

        <aside className="sidePanel">
          <section>
            <h2>Team Links</h2>
            <LinkBox title="Team A page" url={teamAUrl} hostId={peerId} />
            <LinkBox title="Team B page" url={teamBUrl} hostId={peerId} />
          </section>
          <section>
            <h2>Ball Log</h2>
            <div className="logList">
              {game.log.length ? game.log.map((line, index) => <p key={`${line}-${index}`}>{line}</p>) : <p>No balls yet.</p>}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function TeamPage({ teamKey }) {
  const [hostId, setHostId] = useState(localStorage.getItem("hand-cricket-host") || "");
  const [connected, setConnected] = useState(false);
  const [game, setGame] = useState(null);
  const [teamName, setTeamName] = useState(`Team ${teamKey}`);
  const [players, setPlayers] = useState(["Player 1"]);
  const [timeLeft, setTimeLeft] = useState(null);
  const peerRef = useRef(null);
  const connRef = useRef(null);
  const sentTurnRef = useRef("");

  useEffect(() => {
    if (!game) return;
    const remoteTeam = game.teams[teamKey];
    setTeamName(remoteTeam.name);
    setPlayers(remoteTeam.roster);
  }, [game, teamKey]);

  function connect() {
    if (!hostId.trim()) return;
    localStorage.setItem("hand-cricket-host", hostId.trim());
    const peer = new Peer();
    peerRef.current = peer;
    peer.on("open", () => {
      const conn = peer.connect(hostId.trim(), { reliable: true });
      connRef.current = conn;
      conn.on("open", () => {
        setConnected(true);
        send({ type: "hello", team: teamKey });
      });
      conn.on("data", (message) => {
        if (message.type === "state") setGame(message.game);
      });
      conn.on("close", () => setConnected(false));
    });
  }

  function send(message) {
    connRef.current?.send(message);
  }

  function saveRoster() {
    send({ type: "roster", team: teamKey, name: teamName, roster: players });
  }

  const role = !game || game.status !== "playing" ? "idle" : game.batting === teamKey ? "batting" : "bowling";
  const ownBallValue = role === "batting" ? game?.ball.batting : role === "bowling" ? game?.ball.bowling : null;
  const turnKey = game ? `${game.innings}-${game.batting}-${game.teams[game.batting].balls}-${role}` : "";
  const canPick =
    connected &&
    game?.status === "playing" &&
    role !== "idle" &&
    ownBallValue === null &&
    sentTurnRef.current !== turnKey;
  const team = game?.teams[teamKey] || makeTeam(`Team ${teamKey}`);
  const opponent = game?.teams[otherTeam(teamKey)] || makeTeam(`Team ${otherTeam(teamKey)}`);

  function submitPick(value) {
    if (!canPick) return;
    sentTurnRef.current = turnKey;
    setTimeLeft(null);
    send({ type: "submit", team: teamKey, value });
  }

  useEffect(() => {
    if (!game || game.status !== "playing" || role === "idle" || ownBallValue !== null || !game.turnDeadline) {
      setTimeLeft(null);
      return undefined;
    }

    sentTurnRef.current = sentTurnRef.current === turnKey ? sentTurnRef.current : "";
    setTimeLeft(Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000)));

    const intervalId = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) window.clearInterval(intervalId);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [connected, game?.status, game?.turnDeadline, ownBallValue, role, turnKey]);

  return (
    <div className="appShell teamView">
      <header className="topbar">
        <div>
          <p className="eyebrow">{team.name}</p>
          <h1>{role === "idle" ? "Team Room" : role === "batting" ? "Batting" : "Bowling"}</h1>
        </div>
        <a className="iconTextButton" href="#/">
          Main page
        </a>
      </header>

      <main className="teamGrid">
        <section className="controlSurface">
          <div className="connectRow">
            <label>
              Host ID
              <input value={hostId} onChange={(event) => setHostId(event.target.value)} placeholder="Paste main page host ID" />
            </label>
            <button className="primaryButton" onClick={connect}>
              {connected ? <Wifi size={18} /> : <WifiOff size={18} />} {connected ? "Connected" : "Connect"}
            </button>
          </div>

          <div className="rosterEditor">
            <label>
              Team name
              <input value={teamName} onChange={(event) => setTeamName(event.target.value)} disabled={game?.status !== "setup"} />
            </label>
            <div className="playersHeader">
              <h2>Players</h2>
              <button
                className="iconTextButton"
                disabled={game?.status !== "setup" || players.length >= 11}
                onClick={() => setPlayers([...players, `Player ${players.length + 1}`])}
              >
                <Users size={18} /> Add
              </button>
            </div>
            {players.map((player, index) => (
              <input
                key={index}
                value={player}
                disabled={game?.status !== "setup"}
                onChange={(event) => setPlayers(players.map((value, playerIndex) => (playerIndex === index ? event.target.value : value)))}
              />
            ))}
            <button className="primaryButton" onClick={saveRoster} disabled={!connected || game?.status !== "setup"}>
              <Send size={18} /> Save Team
            </button>
          </div>
        </section>

        <section className="playSurface">
          <div className="miniScore">
            <div>
              <span>{team.name}</span>
              <strong>{team.score}/{team.wickets}</strong>
              <small>{oversText(team.balls)} overs</small>
            </div>
            <div>
              <span>{opponent.name}</span>
              <strong>{opponent.score}/{opponent.wickets}</strong>
              <small>{oversText(opponent.balls)} overs</small>
            </div>
          </div>

          <div className={`rolePanel ${role}`}>
            <p className="eyebrow">{game?.status || "Disconnected"}</p>
            <h2>
              {game?.status === "finished"
                ? game.winner === "Tie"
                  ? "Match tied"
                  : `${game.teams[game.winner].name} wins`
                : role === "batting"
                  ? `${currentBatter(team)} on strike`
                  : role === "bowling"
                    ? `${currentBowler(team, game.teams[game.batting].balls)} bowling`
                    : "Waiting for match"}
            </h2>
            {game?.target && <p className="targetText">Target: {game.target}</p>}
            {role === "bowling" && game?.status === "playing" && (
              <p className="targetText">To {currentBatter(game.teams[game.batting])}</p>
            )}
            {timeLeft !== null && <div className="timerBadge">{timeLeft}</div>}
            <div className="runPad">
              {RUN_OPTIONS.map((value) => (
                <button key={value} onClick={() => submitPick(value)} disabled={!canPick}>
                  {value}
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ScorePanel({ teamKey, team, active, connected }) {
  return (
    <article className={`scorePanel ${active ? "active" : ""}`}>
      <div className="panelTop">
        <div>
          <p className="eyebrow">{teamKey === "A" ? "First innings" : "Second innings"}</p>
          <h3>{team.name}</h3>
        </div>
        <span className={connected ? "online" : "offline"}>{connected ? "Online" : "Offline"}</span>
      </div>
      <div className="scoreLine">
        <strong>{team.score}</strong>
        <span>/{team.wickets}</span>
      </div>
      <div className="metricRow">
        <span>Overs {oversText(team.balls)}</span>
        <span>{team.currentPlayer >= team.roster.length ? "All done" : currentBatter(team)}</span>
      </div>
    </article>
  );
}

function LinkBox({ title, url, hostId }) {
  const fullText = `${url}\nHost ID: ${hostId || "starting..."}`;
  return (
    <div className="linkBox">
      <div>
        <span>{title}</span>
        <a href={url}>{url}</a>
      </div>
      <IconButton label={`Copy ${title}`} onClick={() => copyText(fullText)}>
        <Copy size={18} />
      </IconButton>
    </div>
  );
}

function StatusItem({ icon, label, value }) {
  return (
    <div className="statusItem">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }) {
  return (
    <button className="iconButton" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function copyText(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text);
}

function broadcast(connections, message) {
  Object.values(connections).forEach(({ connection }) => {
    if (connection?.open) connection.send(message);
  });
}

createRoot(document.getElementById("root")).render(<App />);
