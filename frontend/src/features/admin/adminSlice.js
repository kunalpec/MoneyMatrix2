import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { apiRequest } from "../../services/api";
import { setAccessToken } from "../auth/authSlice";

const getLiveTotalsFromRound = (round) => ({
  total: round?.totalBetAmount || 0,
  red: round?.totalRed || 0,
  blue: round?.totalBlue || 0,
  violet: round?.totalViolet || 0,
});

export const fetchPlatformUsers = createAsyncThunk(
  "admin/fetchPlatformUsers",
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      const response = await apiRequest("/admin/users", {
        token: getState().auth.accessToken,
        onAccessToken: (token) => dispatch(setAccessToken(token)),
      });

      return response?.data;
    } catch (error) {
      return rejectWithValue(error?.message || "Could not fetch platform users");
    }
  }
);

export const fetchLeaderboard = createAsyncThunk(
  "admin/fetchLeaderboard",
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      const response = await apiRequest("/admin/leaderboard?limit=10", {
        token: getState().auth.accessToken,
        onAccessToken: (token) => dispatch(setAccessToken(token)),
      });

      return response?.data || [];
    } catch (error) {
      return rejectWithValue(error?.message || "Could not fetch leaderboard");
    }
  }
);

export const fetchAdminWallet = createAsyncThunk(
  "admin/fetchAdminWallet",
  async (_, { getState, dispatch, rejectWithValue }) => {
    try {
      const response = await apiRequest("/admin/wallet", {
        token: getState().auth.accessToken,
        onAccessToken: (token) => dispatch(setAccessToken(token)),
      });

      return response?.data;
    } catch (error) {
      return rejectWithValue(error?.message || "Could not fetch admin wallet");
    }
  }
);

const adminSlice = createSlice({
  name: "admin",
  initialState: {
    users: [],
    totalUsers: 0,
    livePlayers: 0,
    leaderboard: [],
    usersStatus: "idle",
    leaderboardStatus: "idle",
    walletStatus: "idle",
    socketStatus: "disconnected",
    adminWallet: {
      address: "",
      trxBalance: 0,
      trxLockedBalance: 0,
      trxBalanceSun: 0,
      trxLockedBalanceSun: 0,
      currency: "TRX",
    },
    currentRound: null,
    timer: {
      remaining: 0,
      status: "idle",
    },
    liveTotals: {
      total: 0,
      red: 0,
      blue: 0,
      violet: 0,
    },
    notices: [],
    socketError: "",
  },
  reducers: {
    setSocketStatus: (state, action) => {
      state.socketStatus = action.payload;
    },
    syncCurrentRound: (state, action) => {
      const round =
        action.payload?.currentRound && action.payload?.status !== "running"
          ? action.payload.currentRound
          : action.payload;

      if (round) {
        state.currentRound = {
          ...state.currentRound,
          ...round,
        };
        if (state.currentRound.status === "running" && !state.currentRound.isManualResult) {
          state.currentRound.result = undefined;
        }
        state.liveTotals = getLiveTotalsFromRound(state.currentRound);
      }

      if (action.payload?.status && state.currentRound) {
        state.currentRound.status = action.payload.status;
      }

      if ("result" in (action.payload || {}) && state.currentRound) {
        state.currentRound.result = action.payload.result;
      }

      if (action.payload?.nextRoundAt && state.currentRound) {
        state.currentRound.endTime = action.payload.nextRoundAt;
      }
    },
    setRoundTimer: (state, action) => {
      state.timer.remaining = Number(action.payload?.remaining || 0);
      state.timer.status = action.payload?.status || state.timer.status;

      if (state.currentRound) {
        state.currentRound.status = state.timer.status;
      }
    },
    applyAdminBetUpdate: (state, action) => {
      state.liveTotals = action.payload.currentTotals;
      state.notices.unshift(
        `${action.payload.color.toUpperCase()} bet received: ${action.payload.amount}`
      );
      state.notices = state.notices.slice(0, 6);
    },
    setPlayerCount: (state, action) => {
      state.livePlayers = Number(action.payload || 0);
    },
    setSocketError: (state, action) => {
      state.socketError = action.payload;
    },
    addAdminNotice: (state, action) => {
      state.notices.unshift(action.payload);
      state.notices = state.notices.slice(0, 6);
    },
    clearAdminState: (state) => {
      state.users = [];
      state.totalUsers = 0;
      state.livePlayers = 0;
      state.leaderboard = [];
      state.usersStatus = "idle";
      state.leaderboardStatus = "idle";
      state.walletStatus = "idle";
      state.socketStatus = "disconnected";
      state.adminWallet = {
        address: "",
        trxBalance: 0,
        trxLockedBalance: 0,
        trxBalanceSun: 0,
        trxLockedBalanceSun: 0,
        currency: "TRX",
      };
      state.currentRound = null;
      state.timer = {
        remaining: 0,
        status: "idle",
      };
      state.liveTotals = {
        total: 0,
        red: 0,
        blue: 0,
        violet: 0,
      };
      state.notices = [];
      state.socketError = "";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPlatformUsers.pending, (state) => {
        state.usersStatus = "loading";
      })
      .addCase(fetchPlatformUsers.fulfilled, (state, action) => {
        state.usersStatus = "succeeded";
        state.users = action.payload?.users || [];
        state.totalUsers = action.payload?.totalUsers || 0;
        state.livePlayers = action.payload?.livePlayers || 0;
      })
      .addCase(fetchPlatformUsers.rejected, (state, action) => {
        state.usersStatus = "failed";
        state.socketError = action.payload;
      })
      .addCase(fetchLeaderboard.pending, (state) => {
        state.leaderboardStatus = "loading";
      })
      .addCase(fetchLeaderboard.fulfilled, (state, action) => {
        state.leaderboardStatus = "succeeded";
        state.leaderboard = action.payload;
      })
      .addCase(fetchLeaderboard.rejected, (state, action) => {
        state.leaderboardStatus = "failed";
        state.socketError = action.payload;
      })
      .addCase(fetchAdminWallet.pending, (state) => {
        state.walletStatus = "loading";
      })
      .addCase(fetchAdminWallet.fulfilled, (state, action) => {
        state.walletStatus = "succeeded";
        state.adminWallet = action.payload || state.adminWallet;
      })
      .addCase(fetchAdminWallet.rejected, (state, action) => {
        state.walletStatus = "failed";
        state.socketError = action.payload;
      });
  },
});

export const {
  addAdminNotice,
  applyAdminBetUpdate,
  clearAdminState,
  setPlayerCount,
  setRoundTimer,
  setSocketError,
  setSocketStatus,
  syncCurrentRound,
} = adminSlice.actions;

export default adminSlice.reducer;
