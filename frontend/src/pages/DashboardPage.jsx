import { useAppSelector } from "../app/hooks";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import StatusBadge from "../components/StatusBadge";
import { compactNumber, currency, formatCountdown, formatDateTime } from "../utils/format";

export default function DashboardPage() {
  const { totalUsers, livePlayers, liveTotals, currentRound, notices, socketError, timer } =
    useAppSelector((state) => state.admin);
  const leaderboard = useAppSelector((state) => state.admin.leaderboard);

  return (
    <div className="page-grid">
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
          value={currentRound?.result || "Pending"}
        />
      </div>

      <SectionCard
        title="Live color split"
        description="Real-time bet totals from the running round."
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
      </SectionCard>

      <SectionCard
        title="Leaderboard snapshot"
        description="Top winning users from the admin API."
      >
        <div className="list-stack">
          {leaderboard.slice(0, 5).map((entry, index) => (
            <div className="list-row" key={entry._id}>
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
              <div className="notice-row" key={`${item}-${index}`}>
                {item}
              </div>
            ))
          ) : (
            <div className="notice-row muted">Waiting for admin socket events...</div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
