import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { useAppDispatch } from "./app/hooks";
import AdminLayout from "./components/AdminLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import PublicOnlyRoute from "./components/PublicOnlyRoute";
import { initializeAuth } from "./features/auth/authSlice";
import DashboardPage from "./pages/DashboardPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import LoginPage from "./pages/LoginPage";
import LogoutPage from "./pages/LogoutPage";
import OtpPage from "./pages/OtpPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SettingsPage from "./pages/SettingsPage";
import SignupPage from "./pages/SignupPage";
import UsersPage from "./pages/UsersPage";
import "./App.css";

export default function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(initializeAuth());
  }, [dispatch]);

  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-otp" element={<OtpPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/logout" element={<LogoutPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate replace to="/login" />} />
    </Routes>
  );
}
