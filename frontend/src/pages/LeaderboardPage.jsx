import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import SectionCard from "../components/SectionCard";
import { fetchLeaderboard } from "../features/admin/adminSlice";
import { currency } from "../utils/format";

export default function LeaderboardPage() {
  const dispatch = useAppDispatch();
  const { leaderboard, leaderboardStatus } = useAppSelector((state) => state.admin);

  useEffect(() => {
    dispatch(fetchLeaderboard());
  }, [dispatch]);

  return (
    <SectionCard
      title="Leaderboard"
      description="Users ranked by total winning amount."
      actions={
        <button className="secondary-button" onClick={() => dispatch(fetchLeaderboard())} type="button">
          Refresh
        </button>
      }
    >
      <div className="leaderboard-grid">
        {leaderboard.map((entry, index) => (
          <article className="leaderboard-card" key={entry._id}>
            <span className="leaderboard-rank">#{index + 1}</span>
            <strong>{entry.name}</strong>
            <p>{entry.email || entry.tronAddress || "No contact info"}</p>
            <div className="leaderboard-metrics">
              <div>
                <span>Total won</span>
                <strong>{currency(entry.totalWinAmount)}</strong>
              </div>
              <div>
                <span>Bets won</span>
                <strong>{entry.totalBetsWon}</strong>
              </div>
            </div>
          </article>
        ))}
        {!leaderboard.length ? (
          <div className="screen-state">
            {leaderboardStatus === "loading" ? "Loading leaderboard..." : "No leaderboard data"}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
