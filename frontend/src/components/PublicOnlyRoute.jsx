import { Navigate, Outlet } from "react-router-dom";
import { useAppSelector } from "../app/hooks";

export default function PublicOnlyRoute() {
  const { initialized, isAuthenticated, user } = useAppSelector((state) => state.auth);

  if (!initialized) {
    return <div className="screen-state">Loading access flow...</div>;
  }

  if (isAuthenticated && user?.role === "admin") {
    return <Navigate replace to="/dashboard" />;
  }

  return <Outlet />;
}
