import { useAppSelector } from "../app/hooks";
import StatusBadge from "./StatusBadge";

export default function Topbar() {
  const user = useAppSelector((state) => state.auth.user);
  const socketStatus = useAppSelector((state) => state.admin.socketStatus);

  const tone =
    socketStatus === "connected"
      ? "success"
      : socketStatus === "connecting"
      ? "warning"
      : "danger";

  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Control Room</p>
        <h1>Admin overview</h1>
      </div>

      <div className="topbar-meta">
        <StatusBadge tone={tone}>{socketStatus}</StatusBadge>
        <div className="profile-chip">
          <strong>{user?.name || "Admin"}</strong>
          <span>{user?.email || user?.phone || "No profile data"}</span>
        </div>
      </div>
    </header>
  );
}
