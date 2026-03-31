import { useState } from "react";
import { useAppSelector } from "../app/hooks";
import SectionCard from "../components/SectionCard";
import { getAdminSocket } from "../services/socket";

export default function SettingsPage() {
  const currentRound = useAppSelector((state) => state.admin.currentRound);
  const [resultColor, setResultColor] = useState("red");
  const [seconds, setSeconds] = useState(15);
  const [actionMessage, setActionMessage] = useState("");

  const sendResult = () => {
    const socket = getAdminSocket();

    if (!socket) {
      setActionMessage("Socket is not connected");
      return;
    }

    socket.emit("change-result", { color: resultColor });
    setActionMessage(`Requested result change to ${resultColor}`);
  };

  const changeDuration = (isIncrease) => {
    const socket = getAdminSocket();

    if (!socket) {
      setActionMessage("Socket is not connected");
      return;
    }

    socket.emit("change-duration", { seconds: Number(seconds), isIncrease });
    setActionMessage(
      `${isIncrease ? "Increased" : "Reduced"} round time by ${seconds} seconds`
    );
  };

  return (
    <div className="page-grid two-column">
      <SectionCard
        title="Set result"
        description="Choose a winning color for the running round."
      >
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
      </SectionCard>

      <SectionCard
        title="Change duration"
        description="Adjust the running round end time from the admin socket."
      >
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
      </SectionCard>

      <SectionCard
        title="Current round status"
        description="Quick visibility into the round before taking admin actions."
      >
        <div className="detail-grid">
          <div>
            <span>Round</span>
            <strong>{currentRound?.roundId || currentRound?._id || "--"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{currentRound?.status || "--"}</strong>
          </div>
          <div>
            <span>Result</span>
            <strong>{currentRound?.result || "Pending"}</strong>
          </div>
          <div>
            <span>Action state</span>
            <strong>{actionMessage || "No admin action yet"}</strong>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
