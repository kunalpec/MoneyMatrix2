import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { ApiClientError, apiRequest } from "../../services/api";

const SESSION_KEY = "moneymatrix_admin_session";

const readPersistedSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistSession = (session) => {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const persistedSession = readPersistedSession();

const extractMessage = (error, fallback) => {
  if (error instanceof ApiClientError) {
    return error.message || fallback;
  }

  return error?.message || fallback;
};

const ensureAdminUser = (user) => {
  if (user?.role !== "admin") {
    throw new Error("This account is not an admin account in backend.");
  }
};

export const initializeAuth = createAsyncThunk(
  "auth/initializeAuth",
  async (_, { getState, dispatch, rejectWithValue }) => {
    const existingUser = getState().auth.user || persistedSession?.user || null;

    try {
      const response = await apiRequest("/users/refresh-token", {
        method: "POST",
        token: persistedSession?.accessToken || "",
        retryAuth: false,
        onAccessToken: (accessToken) => dispatch(setAccessToken(accessToken)),
      });

      return {
        accessToken: response?.data?.accessToken || "",
        user: existingUser,
      };
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Unable to restore session"));
    }
  }
);

export const signupAdmin = createAsyncThunk(
  "auth/signupAdmin",
  async (payload, { dispatch, rejectWithValue }) => {
    try {
      await apiRequest("/users/register", {
        method: "POST",
        body: payload,
        retryAuth: false,
      });

      dispatch(setPendingPhone(payload.phone));
      return {
        phone: payload.phone,
        message: "OTP sent successfully",
      };
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Signup failed"));
    }
  }
);

export const verifyAdminOtp = createAsyncThunk(
  "auth/verifyAdminOtp",
  async ({ phone, otp }, { dispatch, rejectWithValue }) => {
    try {
      const response = await apiRequest("/users/verify-otp", {
        method: "POST",
        body: { phone, otp },
        retryAuth: false,
      });

      const user = response?.data?.user;
      const accessToken = response?.data?.accessToken || "";

      ensureAdminUser(user);
      dispatch(setSession({ user, accessToken }));

      await apiRequest("/wallet", {
        method: "POST",
        token: accessToken,
        onAccessToken: (token) => dispatch(setAccessToken(token)),
      });

      dispatch(clearPendingPhone());

      return {
        user,
        accessToken,
        message: "Account verified and wallet ready",
      };
    } catch (error) {
      return rejectWithValue(extractMessage(error, "OTP verification failed"));
    }
  }
);

export const loginAdmin = createAsyncThunk(
  "auth/loginAdmin",
  async (payload, { dispatch, rejectWithValue }) => {
    try {
      const response = await apiRequest("/users/login", {
        method: "POST",
        body: payload,
        retryAuth: false,
      });

      const user = response?.data?.user;
      const accessToken = response?.data?.accessToken || "";

      ensureAdminUser(user);
      dispatch(setSession({ user, accessToken }));

      await apiRequest("/wallet", {
        method: "POST",
        token: accessToken,
        onAccessToken: (token) => dispatch(setAccessToken(token)),
      });

      return {
        user,
        accessToken,
        message: "Login successful",
      };
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Login failed"));
    }
  }
);

export const requestPasswordReset = createAsyncThunk(
  "auth/requestPasswordReset",
  async ({ phone, newpassword }, { dispatch, rejectWithValue }) => {
    try {
      await apiRequest("/users/forgot-password", {
        method: "POST",
        body: { phone, newpassword },
        retryAuth: false,
      });

      dispatch(setPendingPhone(phone));
      return {
        phone,
        message: "Reset OTP sent",
      };
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Could not send reset OTP"));
    }
  }
);

export const resetPassword = createAsyncThunk(
  "auth/resetPassword",
  async ({ phone, otp }, { rejectWithValue }) => {
    try {
      await apiRequest("/users/reset-password", {
        method: "POST",
        body: { phone, otp },
        retryAuth: false,
      });

      return "Password reset successful";
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Password reset failed"));
    }
  }
);

export const logoutAdmin = createAsyncThunk(
  "auth/logoutAdmin",
  async (_, { rejectWithValue }) => {
    try {
      await apiRequest("/users/logout", {
        method: "GET",
        retryAuth: false,
      });
      return true;
    } catch (error) {
      return rejectWithValue(extractMessage(error, "Logout failed"));
    }
  }
);

const authSlice = createSlice({
  name: "auth",
  initialState: {
    user: persistedSession?.user || null,
    accessToken: persistedSession?.accessToken || "",
    pendingPhone: persistedSession?.pendingPhone || "",
    status: "idle",
    initialized: false,
    isAuthenticated: Boolean(persistedSession?.accessToken && persistedSession?.user),
    error: "",
    notice: "",
  },
  reducers: {
    setPendingPhone: (state, action) => {
      state.pendingPhone = action.payload;
      persistSession({
        user: state.user,
        accessToken: state.accessToken,
        pendingPhone: state.pendingPhone,
      });
    },
    clearPendingPhone: (state) => {
      state.pendingPhone = "";
      persistSession({
        user: state.user,
        accessToken: state.accessToken,
        pendingPhone: "",
      });
    },
    setAccessToken: (state, action) => {
      state.accessToken = action.payload || "";
      state.isAuthenticated = Boolean(state.accessToken && state.user);
      persistSession({
        user: state.user,
        accessToken: state.accessToken,
        pendingPhone: state.pendingPhone,
      });
    },
    setSession: (state, action) => {
      state.user = action.payload.user;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = true;
      state.error = "";
      persistSession({
        user: state.user,
        accessToken: state.accessToken,
        pendingPhone: state.pendingPhone,
      });
    },
    clearSession: (state) => {
      state.user = null;
      state.accessToken = "";
      state.pendingPhone = "";
      state.isAuthenticated = false;
      state.error = "";
      persistSession(null);
    },
    clearAuthFeedback: (state) => {
      state.error = "";
      state.notice = "";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(initializeAuth.pending, (state) => {
        state.status = "loading";
      })
      .addCase(initializeAuth.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.initialized = true;
        state.accessToken = action.payload.accessToken;
        state.user = action.payload.user;
        state.isAuthenticated = Boolean(action.payload.accessToken && action.payload.user);
        state.error = "";
        persistSession({
          user: state.user,
          accessToken: state.accessToken,
          pendingPhone: state.pendingPhone,
        });
      })
      .addCase(initializeAuth.rejected, (state) => {
        state.status = "idle";
        state.initialized = true;
        state.isAuthenticated = Boolean(state.accessToken && state.user);
      })
      .addCase(signupAdmin.pending, (state) => {
        state.status = "loading";
        state.error = "";
        state.notice = "";
      })
      .addCase(signupAdmin.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.pendingPhone = action.payload.phone;
        state.notice = action.payload.message;
      })
      .addCase(signupAdmin.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })
      .addCase(verifyAdminOtp.pending, (state) => {
        state.status = "loading";
        state.error = "";
      })
      .addCase(verifyAdminOtp.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
        state.notice = action.payload.message;
      })
      .addCase(verifyAdminOtp.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })
      .addCase(loginAdmin.pending, (state) => {
        state.status = "loading";
        state.error = "";
      })
      .addCase(loginAdmin.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload.user;
        state.accessToken = action.payload.accessToken;
        state.isAuthenticated = true;
        state.notice = action.payload.message;
      })
      .addCase(loginAdmin.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })
      .addCase(requestPasswordReset.pending, (state) => {
        state.status = "loading";
        state.error = "";
      })
      .addCase(requestPasswordReset.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.pendingPhone = action.payload.phone;
        state.notice = action.payload.message;
      })
      .addCase(requestPasswordReset.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })
      .addCase(resetPassword.pending, (state) => {
        state.status = "loading";
        state.error = "";
      })
      .addCase(resetPassword.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.notice = action.payload;
      })
      .addCase(resetPassword.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload;
      })
      .addCase(logoutAdmin.fulfilled, (state) => {
        state.user = null;
        state.accessToken = "";
        state.pendingPhone = "";
        state.isAuthenticated = false;
        state.status = "idle";
        state.notice = "Logged out";
        persistSession(null);
      })
      .addCase(logoutAdmin.rejected, (state, action) => {
        state.user = null;
        state.accessToken = "";
        state.pendingPhone = "";
        state.isAuthenticated = false;
        state.status = "idle";
        state.error = action.payload || "";
        persistSession(null);
      });
  },
});

export const {
  clearAuthFeedback,
  clearPendingPhone,
  clearSession,
  setAccessToken,
  setPendingPhone,
  setSession,
} = authSlice.actions;

export default authSlice.reducer;
