import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  addAdminNotice,
  applyAdminBetUpdate,
  fetchLeaderboard,
  fetchPlatformUsers,
  setPlayerCount,
  setRoundTimer,
  setSocketError,
  setSocketStatus,
  syncCurrentRound,
} from "../features/admin/adminSlice";
import { connectAdminSocket, disconnectAdminSocket } from "../services/socket";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AdminLayout() {
  const dispatch = useAppDispatch();
  const token = useAppSelector((state) => state.auth.accessToken);

  useEffect(() => {
    dispatch(fetchPlatformUsers());
    dispatch(fetchLeaderboard());
  }, [dispatch]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    dispatch(setSocketStatus("connecting"));
    const socket = connectAdminSocket(token);

    if (!socket) {
      return undefined;
    }

    const onConnect = () => dispatch(setSocketStatus("connected"));
    const onDisconnect = () => dispatch(setSocketStatus("disconnected"));
    const onCurrentRound = (payload) => dispatch(syncCurrentRound(payload));
    const onNewRound = (payload) => {
      dispatch(setSocketError(""));
      dispatch(syncCurrentRound(payload));
      dispatch(addAdminNotice("A new round has started"));
    };
    const onRoundEnded = (payload) => {
      dispatch(setSocketError(""));
      dispatch(syncCurrentRound(payload));
      dispatch(addAdminNotice(`Round result: ${payload?.result || "pending"}`));
    };
    const onAdminBetUpdate = (payload) => dispatch(applyAdminBetUpdate(payload));
    const onPlayerCount = (payload) => dispatch(setPlayerCount(payload));
    const onTimer = (payload) => dispatch(setRoundTimer(payload));
    const onAdminSetResult = (payload) => {
      dispatch(setSocketError(""));
      dispatch(syncCurrentRound(payload?.currentRound || payload));
      dispatch(addAdminNotice(`Manual result queued: ${payload?.result || "unknown"}`));
    };
    const onDurationChange = (payload) => {
      dispatch(setSocketError(""));
      dispatch(syncCurrentRound(payload?.currentRound || { endTime: payload?.newEndTime }));
      dispatch(addAdminNotice("Round duration updated"));
    };
    const onSocketError = (payload) =>
      dispatch(setSocketError(payload?.message || "Socket action failed"));

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("current-round", onCurrentRound);
    socket.on("new-round", onNewRound);
    socket.on("round-ended", onRoundEnded);
    socket.on("admin-bet-update", onAdminBetUpdate);
    socket.on("player-count", onPlayerCount);
    socket.on("timer", onTimer);
    socket.on("admin-set-result", onAdminSetResult);
    socket.on("admin-change-duration", onDurationChange);
    socket.on("error", onSocketError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("current-round", onCurrentRound);
      socket.off("new-round", onNewRound);
      socket.off("round-ended", onRoundEnded);
      socket.off("admin-bet-update", onAdminBetUpdate);
      socket.off("player-count", onPlayerCount);
      socket.off("timer", onTimer);
      socket.off("admin-set-result", onAdminSetResult);
      socket.off("admin-change-duration", onDurationChange);
      socket.off("error", onSocketError);
      disconnectAdminSocket();
    };
  }, [dispatch, token]);

  return (
    <div className="admin-shell">
      <Sidebar />
      <main className="admin-main">
        <Topbar />
        <Outlet />
      </main>
    </div>
  );
}
