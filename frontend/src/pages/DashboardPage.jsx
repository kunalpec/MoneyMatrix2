import { useAppSelector } from "../app/hooks";
import { useEffect, useState } from "react";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import {
  compactNumber,
  currency,
  formatCountdown,
  formatDateTime,
  formatTrx,
} from "../utils/format";

export default function DashboardPage() {
  const {
    totalUsers,
    livePlayers,
    liveTotals,
    currentRound,
    notices,
    socketError,
    timer,
    adminWallet,
    walletStatus,
  } = useAppSelector((state) => state.admin);
  const leaderboard = useAppSelector((state) => state.admin.leaderboard);

  const [timerProgress, setTimerProgress] = useState(0);

  useEffect(() => {
    const updateProgress = () => {
      if (currentRound?.status === "running" && currentRound?.startTime && currentRound?.endTime) {
        const now = Date.now();
        const start = new Date(currentRound.startTime).getTime();
        const end = new Date(currentRound.endTime).getTime();
        const progress = Math.max(
          0,
          Math.min(
            100,
            ((end - now) / (end - start)) * 100
          )
        );
        setTimerProgress(progress);
      } else {
        setTimerProgress(0);
      }
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    return () => clearInterval(interval);
  }, [currentRound]);

  const colorSegments = [
    { label: "Red", value: Number(liveTotals.red || 0), className: "red" },
    { label: "Blue", value: Number(liveTotals.blue || 0), className: "blue" },
    { label: "Violet", value: Number(liveTotals.violet || 0), className: "violet" },
  ];
  const totalPool = Math.max(
    Number(liveTotals.total || 0),
    colorSegments.reduce((sum, item) => sum + item.value, 0)
  );
  const redStop = totalPool ? (colorSegments[0].value / totalPool) * 360 : 0;
  const blueStop = totalPool
    ? ((colorSegments[0].value + colorSegments[1].value) / totalPool) * 360
    : 0;
  const donutStyle = {
    background: `conic-gradient(#ff6b6b 0deg ${redStop}deg, #39a0ff ${redStop}deg ${blueStop}deg, #9a6cff ${blueStop}deg 360deg)`,
  };
  const leadColor = [...colorSegments].sort((a, b) => b.value - a.value)[0];
  const visibleResult = currentRound?.status === "running" ? "Pending" : currentRound?.result || "Pending";

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Live Operations</p>
          <h2>Command the round with clearer visibility.</h2>
          <p>
            Monitor player activity, pool distribution, and round timing from one polished control
            surface.
          </p>
        </div>
        <div className="hero-aside">
          <div>
            <span>Round state</span>
            <strong>{currentRound?.status || "Waiting"}</strong>
          </div>
          <div>
            <span>Visible result</span>
            <strong>{visibleResult}</strong>
          </div>
          <div>
            <span>Largest color pool</span>
            <strong>{leadColor?.label || "None"}</strong>
          </div>
        </div>
      </section>

      <SectionCard
        title="Admin wallet"
        description="Treasury wallet address and crypto amount currently stored for the admin wallet."
        actions={
          <StatusBadge tone={walletStatus === "failed" ? "danger" : "neutral"}>
            {walletStatus}
          </StatusBadge>
        }
      >
        <div className="detail-grid wallet-detail-grid">
          <div className="wallet-address-block">
            <span>Wallet address</span>
            <strong>{adminWallet?.address || "--"}</strong>
          </div>
          <div>
            <span>Crypto balance</span>
            <strong>{formatTrx(adminWallet?.trxBalance)}</strong>
          </div>
          <div>
            <span>Locked balance</span>
            <strong>{formatTrx(adminWallet?.trxLockedBalance)}</strong>
          </div>
          <div>
            <span>Currency</span>
            <strong>{adminWallet?.currency || "TRX"}</strong>
          </div>
        </div>
      </SectionCard>

      <div className="stats-grid">
        <StatCard accent="cyan" hint="All registered players" label="Users" value={compactNumber(totalUsers)} />
        <StatCard accent="amber" hint="Live sockets in game" label="Current players" value={compactNumber(livePlayers)} />
        <StatCard accent="pink" hint="Total amount locked in this round" label="Money in game" value={currency(liveTotals.total)} />
        <StatCard
          accent="cyan"
          hint={timer?.status ? `Live timer: ${timer.status}` : "Waiting for timer sync"}
          label="Countdown"
          value={formatCountdown(timer?.remaining)}
        />
        <StatCard
          accent="violet"
          hint={currentRound?.status ? `Status: ${currentRound.status}` : "Waiting for socket data"}
          label="Current result"
          value={visibleResult}
        />
      </div>

      <div className="analytics-grid">
        <SectionCard
          title="Live color split"
          description="Real-time bet totals from the running round."
        >
          <div className="distribution-layout">
            <div className="donut-wrap">
              <div className="donut-chart" style={donutStyle}>
                <div className="donut-core">
                  <span>Total pool</span>
                  <strong>{currency(totalPool)}</strong>
                </div>
              </div>
            </div>

            <div className="chart-legend">
              {colorSegments.map((segment) => {
                const percent = totalPool ? Math.round((segment.value / totalPool) * 100) : 0;

                return (
                  <div className="legend-card" key={segment.label}>
                    <div className="legend-meta">
                      <span className={`legend-dot ${segment.className}`} aria-hidden="true" />
                      <strong>{segment.label}</strong>
                      <span>{percent}%</span>
                    </div>
                    <div className="legend-bar-track">
                      <div
                        className={`legend-bar-fill ${segment.className}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span>{currency(segment.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Round pulse"
          description="Visual progress for the active timer and settlement window."
          actions={
            <StatusBadge tone={currentRound?.status === "running" ? "success" : "neutral"}>
              {currentRound?.status || "idle"}
            </StatusBadge>
          }
        >
          <div className="pulse-panel">
            <div className="pulse-meter">
              <div className="pulse-ring">
                <svg viewBox="0 0 120 120" className="pulse-svg" aria-hidden="true">
                  <circle cx="60" cy="60" r="45" pathLength="100" className="pulse-track" />
                  <circle
                    cx="60"
                    cy="60"
                    r="45"
                    pathLength="100"
                    className="pulse-progress"
                    style={{ strokeDasharray: `${timerProgress} 100` }}
                  />
                </svg>
                <div className="pulse-label">
                  <span>Time left</span>
                  <strong>{formatCountdown(timer?.remaining)}</strong>
                </div>
              </div>
            </div>

            <div className="pulse-details">
              <div className="signal-card">
                <span>Round ID</span>
                <strong>{currentRound?.roundId || currentRound?._id || "--"}</strong>
              </div>
              <div className="signal-card">
                <span>Result</span>
                <strong>{visibleResult}</strong>
              </div>
              <div className="signal-card">
                <span>Players in room</span>
                <strong>{compactNumber(livePlayers)}</strong>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Pool summary"
        description="Fast access to the current round split."
      >
        <div className="totals-strip">
          <div className="total-pill red">Red {currency(liveTotals.red)}</div>
          <div className="total-pill blue">Blue {currency(liveTotals.blue)}</div>
          <div className="total-pill violet">Violet {currency(liveTotals.violet)}</div>
          <div className="total-pill neutral">Total {currency(liveTotals.total)}</div>
        </div>
      </SectionCard>

      <SectionCard
        title="Round details"
        description="Current round timing and backend game status."
      >
        <div className="detail-grid">
          <div>
            <span>Round ID</span>
            <strong>{currentRound?.roundId || currentRound?._id || "--"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{currentRound?.status || "--"}</strong>
          </div>
          <div>
            <span>Start</span>
            <strong>{formatDateTime(currentRound?.startTime)}</strong>
          </div>
          <div>
            <span>End</span>
            <strong>{formatDateTime(currentRound?.endTime)}</strong>
          </div>
        </div>
        <div className="timeline-strip" aria-hidden="true">
          <span className="timeline-node active" />
          <span className={`timeline-node ${currentRound?.status !== "running" ? "active" : ""}`} />
          <span className={`timeline-node ${currentRound?.status === "ended" ? "active" : ""}`} />
        </div>
      </SectionCard>

      <div className="insight-grid">
        <SectionCard
          title="Leaderboard snapshot"
          description="Top winning users from the admin API."
        >
          <div className="list-stack">
            {leaderboard.slice(0, 5).map((entry, index) => (
              <div className="list-row premium" key={entry._id}>
                <span>#{index + 1}</span>
                <strong>{entry.name}</strong>
                <span>{currency(entry.totalWinAmount)}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Live notices"
          description="Recent admin room updates and action feedback."
          actions={socketError ? <StatusBadge tone="danger">{socketError}</StatusBadge> : null}
        >
          <div className="list-stack">
            {notices.length ? (
              notices.map((item, index) => (
                <div className="notice-row premium" key={`${item}-${index}`}>
                  <span className="notice-marker" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))
            ) : (
              <div className="notice-row muted premium">Waiting for admin socket events...</div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
