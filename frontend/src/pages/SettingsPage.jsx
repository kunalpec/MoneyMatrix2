import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import SectionCard from "../components/SectionCard";
import StatusBadge from "../components/StatusBadge";
import { setSocketError } from "../features/admin/adminSlice";
import { getAdminSocket } from "../services/socket";
import { formatDateTime } from "../utils/format";

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const currentRound = useAppSelector((state) => state.admin.currentRound);
  const queuedResult =
    currentRound?.status === "running" && currentRound?.isManualResult ? currentRound?.result : "";
  const [resultColor, setResultColor] = useState("red");
  const [seconds, setSeconds] = useState(15);
  const [actionMessage, setActionMessage] = useState("");

  const sendResult = () => {
    const socket = getAdminSocket();

    if (!socket) {
      setActionMessage("Socket is not connected");
      return;
    }

    dispatch(setSocketError(""));
    socket.emit("change-result", { color: resultColor });
    setActionMessage(`Queued ${resultColor} as the round result`);
  };

  const changeDuration = (isIncrease) => {
    const socket = getAdminSocket();

    if (!socket) {
      setActionMessage("Socket is not connected");
      return;
    }

    dispatch(setSocketError(""));
    socket.emit("change-duration", { seconds: Number(seconds), isIncrease });
    setActionMessage(
      `${isIncrease ? "Increased" : "Decreased"} round time by ${seconds} seconds`
    );
  };

  return (
    <div className="page-grid two-column">
      <section className="settings-hero">
        <div>
          <p className="eyebrow">Admin Controls</p>
          <h2>Manage the round without leaving the control room.</h2>
          <p>
            Configure result intent and timing adjustments from a cleaner, more professional
            operations panel.
          </p>
        </div>
        <div className="settings-hero-meta">
          <div>
            <span>Round</span>
            <strong>{currentRound?.roundId || currentRound?._id || "--"}</strong>
          </div>
          <StatusBadge tone={currentRound?.status === "running" ? "success" : "neutral"}>
            {currentRound?.status || "idle"}
          </StatusBadge>
        </div>
      </section>

      <SectionCard
        title="Set result"
        description="Choose a winning color for the running round."
      >
        <div className="control-panel">
          <div className="result-preview">
            <span className={`result-swatch ${resultColor}`} aria-hidden="true" />
            <div>
              <span>Selected color</span>
              <strong>{resultColor}</strong>
            </div>
          </div>

          <div className="form-stack compact">
            <label className="form-field">
              <span>Winning color</span>
              <select onChange={(event) => setResultColor(event.target.value)} value={resultColor}>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
                <option value="violet">Violet</option>
              </select>
            </label>

            <button className="primary-button" onClick={sendResult} type="button">
              Set round result
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Change duration"
        description="Adjust the running round end time from the admin socket."
      >
        <div className="control-panel">
          <div className="duration-presets">
            {[10, 15, 30, 45].map((value) => (
              <button
                className={`preset-chip ${Number(seconds) === value ? "active" : ""}`}
                key={value}
                onClick={() => setSeconds(value)}
                type="button"
              >
                {value}s
              </button>
            ))}
          </div>

          <div className="form-stack compact">
            <label className="form-field">
              <span>Seconds</span>
              <input
                min="1"
                onChange={(event) => setSeconds(event.target.value)}
                type="number"
                value={seconds}
              />
            </label>

            <div className="button-row">
              <button className="secondary-button" onClick={() => changeDuration(true)} type="button">
                Increase
              </button>
              <button className="secondary-button danger" onClick={() => changeDuration(false)} type="button">
                Decrease
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Current round status"
        description="Quick visibility into the round before taking admin actions."
      >
        <div className="detail-grid settings-grid">
          <div className="status-tile">
            <span>Round</span>
            <strong>{currentRound?.roundId || currentRound?._id || "--"}</strong>
          </div>
          <div className="status-tile">
            <span>Status</span>
            <strong>{currentRound?.status || "--"}</strong>
          </div>
          <div className="status-tile">
            <span>Result</span>
            <strong>{currentRound?.status === "running" ? "Pending" : currentRound?.result || "Pending"}</strong>
          </div>
          <div className="status-tile">
            <span>Queued result</span>
            <strong>{queuedResult || "Not set"}</strong>
          </div>
          <div className="status-tile">
            <span>Start time</span>
            <strong>{formatDateTime(currentRound?.startTime)}</strong>
          </div>
          <div className="status-tile">
            <span>End time</span>
            <strong>{formatDateTime(currentRound?.endTime)}</strong>
          </div>
          <div className="status-tile full-width">
            <span>Action state</span>
            <strong>{actionMessage || "No admin action yet"}</strong>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
