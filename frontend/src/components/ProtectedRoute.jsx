import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAppSelector } from "../app/hooks";

export default function ProtectedRoute() {
  const location = useLocation();
  const { initialized, isAuthenticated, user } = useAppSelector((state) => state.auth);

  if (!initialized) {
    return <div className="screen-state">Restoring your admin session...</div>;
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return <Navigate replace state={{ from: location }} to="/login" />;
  }

  return <Outlet />;
}
