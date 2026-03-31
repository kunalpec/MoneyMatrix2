import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuthFeedback, loginAdmin } from "../features/auth/authSlice";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error, notice } = useAppSelector((state) => state.auth);
  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const updateField = (event) => {
    dispatch(clearAuthFeedback());
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const result = await dispatch(loginAdmin(form));

    if (loginAdmin.fulfilled.match(result)) {
      navigate("/dashboard");
    }
  };

  return (
    <AuthLayout
      title="Admin login"
      subtitle="Sign in with your backend admin account. Refresh-token cookies restore access after page refresh."
      footer={
        <p>
          Need help? <Link to="/forgot-password">Reset password</Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <FormInput
          autoComplete="email"
          label="Email"
          name="email"
          onChange={updateField}
          type="email"
          value={form.email}
        />
        <FormInput
          autoComplete="current-password"
          label="Password"
          name="password"
          onChange={updateField}
          type="password"
          value={form.password}
        />

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        <button className="primary-button" disabled={status === "loading"} type="submit">
          {status === "loading" ? "Signing in..." : "Login"}
        </button>

        <div className="split-links">
          <Link to="/signup">Create account</Link>
          <Link to="/forgot-password">Forgot password</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
