import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuthFeedback, signupAdmin } from "../features/auth/authSlice";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";

export default function SignupPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error, notice } = useAppSelector((state) => state.auth);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "admin",
    adminKey: "",
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
    const result = await dispatch(signupAdmin(form));

    if (signupAdmin.fulfilled.match(result)) {
      navigate("/verify-otp");
    }
  };

  return (
    <AuthLayout
      title="Create admin access"
      subtitle="Use the backend signup flow, verify OTP, then continue to the admin dashboard."
      footer={
        <p>
          Already have an admin account? <Link to="/login">Log in</Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={handleSubmit}>
        <FormInput label="Full name" name="name" onChange={updateField} value={form.name} />
        <FormInput
          autoComplete="email"
          label="Email"
          name="email"
          onChange={updateField}
          type="email"
          value={form.email}
        />
        <FormInput
          autoComplete="tel"
          label="Phone"
          name="phone"
          onChange={updateField}
          placeholder="+919876543210"
          value={form.phone}
        />
        <FormInput
          autoComplete="new-password"
          label="Password"
          name="password"
          onChange={updateField}
          type="password"
          value={form.password}
        />
        <FormInput
          autoComplete="one-time-code"
          label="Admin signup key"
          name="adminKey"
          onChange={updateField}
          type="password"
          value={form.adminKey}
        />

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        <button className="primary-button" disabled={status === "loading"} type="submit">
          {status === "loading" ? "Sending OTP..." : "Sign up"}
        </button>
      </form>
    </AuthLayout>
  );
}
