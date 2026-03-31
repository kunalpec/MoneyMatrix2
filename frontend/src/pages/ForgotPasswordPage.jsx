import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { clearAuthFeedback, requestPasswordReset } from "../features/auth/authSlice";
import AuthLayout from "../components/AuthLayout";
import FormInput from "../components/FormInput";

export default function ForgotPasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { status, error, notice } = useAppSelector((state) => state.auth);
  const [form, setForm] = useState({
    phone: "",
    newpassword: "",
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
    const result = await dispatch(requestPasswordReset(form));

    if (requestPasswordReset.fulfilled.match(result)) {
      navigate("/reset-password");
    }
  };

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="Send an OTP to the registered phone number and stage the next password."
      footer={
        <p>
          Back to <Link to="/login">login</Link>
        </p>
      }
    >
      <form className="form-stack" onSubmit={handleSubmit}>
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
          label="New password"
          name="newpassword"
          onChange={updateField}
          type="password"
          value={form.newpassword}
        />

        {notice ? <p className="feedback success">{notice}</p> : null}
        {error ? <p className="feedback error">{error}</p> : null}

        <button className="primary-button" disabled={status === "loading"} type="submit">
          {status === "loading" ? "Sending..." : "Send reset OTP"}
        </button>
      </form>
    </AuthLayout>
  );
}
